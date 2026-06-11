// Google Publisher Tag (GPT) を使った Web のリワード動画広告ヘルパー。
//
// AdMob（アプリ）と違い、Web の GPT リワードには SSV ポストバックが無く、報酬付与は
// クライアントの `rewardedSlotGranted` イベントで判断する（公式仕様）。このモジュールは
// その一連の流れ（gpt.js ロード → out-of-page スロット定義 → 表示 → granted / closed 待ち）
// を 1 つの Promise にまとめ、呼び出し側は結果（outcome）だけを受け取れるようにする。
//
// 不正対策は backend 側の nonce 照合＋クールダウン/日次上限で行う（このファイルは表示のみ）。

const GPT_SRC = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';

// 広告が ready にならない（在庫なし・ブロッカー等）まま待ち続けないための上限。
const READY_TIMEOUT_MS = 8000;

// 開発時のみ、リワード表示フローの各段階を console に出して失敗モードを切り分ける。
// （gpt.js ロード失敗＝ブロッカー / slot null＝非対応 / timeout＝fill なし を見分ける）
const DEBUG_REWARDED = process.env.NODE_ENV !== 'production';
function dbg(...args: unknown[]) {
  if (DEBUG_REWARDED) console.log('[rewardedAd]', ...args);
}

export type RewardedAdOutcome =
  | 'granted' // 報酬条件を満たした（rewardedSlotGranted）
  | 'dismissed' // 表示されたが報酬前に閉じられた
  | 'unavailable' // 広告を出せなかった（在庫なし・非対応・タイムアウト）
  | 'error'; // gpt.js のロード失敗など想定外

// 失敗（granted 以外）の具体的な原因。操作ログ（video_reward の meta.detail）に残す。
export type RewardedAdDetail =
  | 'gpt_load_failed' // gpt.js を読めなかった（広告ブロッカー等）
  | 'define_threw' // defineOutOfPageSlot が例外
  | 'slot_null' // リワード非対応・スロット重複で slot が null
  | 'ready_timeout'; // 一定時間 ready にならず在庫なし扱い

// 表示フローの詳細トレース。失敗の切り分け用に操作ログ（video_reward の meta.debug）へ残す。
// trail は「経過ms イベント名」の時系列。renderIsEmpty=true は GPT が応答したが在庫ゼロ
// （本当の no fill）、slotRenderEnded 自体が無いままの ready_timeout はリクエストが
// 返ってきていない（ブロック・回線）ことを示す。
export type RewardedAdDebug = {
  trail: string[];
  renderIsEmpty?: boolean;
  lineItemId?: number | null;
  creativeId?: number | null;
  size?: string | null;
  reward?: { type?: string; amount?: number } | null;
};

// 表示結果。granted 以外のとき detail に具体的な失敗理由を添える。
export type RewardedAdResult = {
  outcome: RewardedAdOutcome;
  detail?: RewardedAdDetail;
  debug?: RewardedAdDebug;
};

// 使う範囲だけの最小 googletag 型（@types/google-publisher-tag を追加せずに済ませる）。
type GptSlot = { addService: (service: GptPubAds) => GptSlot };
type GptEvent = {
  slot: GptSlot;
  makeRewardedVisible?: () => void;
  // slotRenderEnded（応答の中身。isEmpty=true は在庫ゼロ＝no fill）
  isEmpty?: boolean;
  lineItemId?: number | null;
  creativeId?: number | null;
  size?: number[] | string | null;
  // rewardedSlotGranted の報酬内容（例 {type:'coins', amount:1}）
  payload?: { type?: string; amount?: number } | null;
};
type GptPubAds = {
  addEventListener: (type: string, listener: (e: GptEvent) => void) => void;
  removeEventListener: (type: string, listener: (e: GptEvent) => void) => void;
};
type Googletag = {
  cmd: Array<() => void>;
  enums: { OutOfPageFormat: { REWARDED: number } };
  defineOutOfPageSlot: (
    adUnitPath: string,
    format: number
  ) => GptSlot | null;
  pubads: () => GptPubAds;
  enableServices: () => void;
  display: (slot: GptSlot) => void;
  destroySlot: (slot: GptSlot) => boolean;
};

function getGoogletag(): Googletag {
  const w = window as unknown as { googletag?: Googletag };
  w.googletag = w.googletag || ({ cmd: [] } as unknown as Googletag);
  return w.googletag;
}

let gptLoading: Promise<void> | null = null;

// gpt.js を一度だけ読み込む（読み込み済みなら即解決）。失敗時は次回再試行できるようにする。
function loadGpt(): Promise<void> {
  if (gptLoading) return gptLoading;
  gptLoading = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${GPT_SRC}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = GPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gptLoading = null;
      reject(new Error('failed to load gpt.js'));
    };
    document.head.appendChild(s);
  });
  return gptLoading;
}

// リワード広告を 1 本表示し、結果を返す。広告 UI（全画面オーバーレイ）は GPT 自身が生成する。
// debug にイベントの時系列トレースを残す（呼び出し側が操作ログの meta に添える）。
export async function showRewardedAd(
  adUnitPath: string
): Promise<RewardedAdResult> {
  const t0 = performance.now();
  const debug: RewardedAdDebug = { trail: [] };
  const mark = (label: string, ...args: unknown[]) => {
    debug.trail.push(`${Math.round(performance.now() - t0)}ms ${label}`);
    dbg(label, ...args);
  };
  mark('start');
  try {
    await loadGpt();
    mark('gpt_loaded');
  } catch (e) {
    mark('gpt_load_failed (ad blocker?)', e);
    return { outcome: 'error', detail: 'gpt_load_failed', debug };
  }
  const googletag = getGoogletag();

  return new Promise<RewardedAdResult>((resolve) => {
    googletag.cmd.push(() => {
      let slot: GptSlot | null;
      try {
        slot = googletag.defineOutOfPageSlot(
          adUnitPath,
          googletag.enums.OutOfPageFormat.REWARDED
        );
      } catch (e) {
        mark('define_threw', e);
        resolve({ outcome: 'error', detail: 'define_threw', debug });
        return;
      }
      // ブラウザ／環境がリワードに非対応のとき null が返る。
      if (!slot) {
        mark('slot_null (rewarded unsupported / already active)');
        resolve({ outcome: 'unavailable', detail: 'slot_null', debug });
        return;
      }
      const activeSlot = slot;
      const pubads = googletag.pubads();
      activeSlot.addService(pubads);

      let granted = false;
      let settled = false;
      let readyTimer: number | null = null;

      // 自スロットのイベントだけ trail に積む共通リスナー（リクエスト〜描画の各段階）。
      const traceListeners: Array<[string, (e: GptEvent) => void]> = [
        'slotRequested',
        'slotResponseReceived',
        'slotOnload',
        'impressionViewable',
      ].map((type): [string, (e: GptEvent) => void] => [
        type,
        (e) => {
          if (e.slot === activeSlot) mark(type);
        },
      ]);
      // slotRenderEnded は応答の中身（在庫の有無・配信された広告）も控える。
      const onRenderEnded = (e: GptEvent) => {
        if (e.slot !== activeSlot) return;
        debug.renderIsEmpty = e.isEmpty === true;
        debug.lineItemId = e.lineItemId ?? null;
        debug.creativeId = e.creativeId ?? null;
        debug.size = e.size != null ? String(e.size) : null;
        mark(`slotRenderEnded isEmpty=${String(e.isEmpty)}`);
      };

      const cleanup = () => {
        if (readyTimer !== null) {
          window.clearTimeout(readyTimer);
          readyTimer = null;
        }
        pubads.removeEventListener('rewardedSlotReady', onReady);
        pubads.removeEventListener('rewardedSlotGranted', onGranted);
        pubads.removeEventListener('rewardedSlotClosed', onClosed);
        pubads.removeEventListener('slotRenderEnded', onRenderEnded);
        for (const [type, fn] of traceListeners) {
          pubads.removeEventListener(type, fn);
        }
      };
      const settle = (outcome: RewardedAdOutcome, detail?: RewardedAdDetail) => {
        if (settled) return;
        settled = true;
        mark(`settle ${outcome}${detail ? ` (${detail})` : ''}`);
        cleanup();
        try {
          googletag.destroySlot(activeSlot);
        } catch {
          /* 破棄失敗は無視（次回 define で作り直す） */
        }
        resolve({ outcome, detail, debug });
      };

      const onReady = (e: GptEvent) => {
        if (e.slot !== activeSlot) return;
        mark('rewardedSlotReady → makeRewardedVisible');
        if (readyTimer !== null) {
          window.clearTimeout(readyTimer);
          readyTimer = null;
        }
        e.makeRewardedVisible?.();
      };
      const onGranted = (e: GptEvent) => {
        if (e.slot !== activeSlot) return;
        debug.reward = e.payload ?? null;
        mark('rewardedSlotGranted');
        granted = true;
      };
      const onClosed = (e: GptEvent) => {
        if (e.slot !== activeSlot) return;
        mark(`rewardedSlotClosed granted=${String(granted)}`);
        settle(granted ? 'granted' : 'dismissed');
      };

      pubads.addEventListener('rewardedSlotReady', onReady);
      pubads.addEventListener('rewardedSlotGranted', onGranted);
      pubads.addEventListener('rewardedSlotClosed', onClosed);
      pubads.addEventListener('slotRenderEnded', onRenderEnded);
      for (const [type, fn] of traceListeners) {
        pubads.addEventListener(type, fn);
      }

      googletag.enableServices();
      googletag.display(activeSlot);
      mark('display() called, waiting for rewardedSlotReady…');

      // 一定時間内に ready にならなければ在庫なし扱いで終える。
      readyTimer = window.setTimeout(() => {
        mark(`ready_timeout (${READY_TIMEOUT_MS}ms) → unavailable (no fill?)`);
        settle('unavailable', 'ready_timeout');
      }, READY_TIMEOUT_MS);
    });
  });
}
