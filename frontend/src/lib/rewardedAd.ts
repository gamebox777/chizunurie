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

export type RewardedAdOutcome =
  | 'granted' // 報酬条件を満たした（rewardedSlotGranted）
  | 'dismissed' // 表示されたが報酬前に閉じられた
  | 'unavailable' // 広告を出せなかった（在庫なし・非対応・タイムアウト）
  | 'error'; // gpt.js のロード失敗など想定外

// 使う範囲だけの最小 googletag 型（@types/google-publisher-tag を追加せずに済ませる）。
type GptSlot = { addService: (service: GptPubAds) => GptSlot };
type GptEvent = { slot: GptSlot; makeRewardedVisible?: () => void };
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
export async function showRewardedAd(
  adUnitPath: string
): Promise<RewardedAdOutcome> {
  try {
    await loadGpt();
  } catch {
    return 'error';
  }
  const googletag = getGoogletag();

  return new Promise<RewardedAdOutcome>((resolve) => {
    googletag.cmd.push(() => {
      let slot: GptSlot | null;
      try {
        slot = googletag.defineOutOfPageSlot(
          adUnitPath,
          googletag.enums.OutOfPageFormat.REWARDED
        );
      } catch {
        resolve('error');
        return;
      }
      // ブラウザ／環境がリワードに非対応のとき null が返る。
      if (!slot) {
        resolve('unavailable');
        return;
      }
      const activeSlot = slot;
      const pubads = googletag.pubads();
      activeSlot.addService(pubads);

      let granted = false;
      let settled = false;
      let readyTimer: number | null = null;

      const cleanup = () => {
        if (readyTimer !== null) {
          window.clearTimeout(readyTimer);
          readyTimer = null;
        }
        pubads.removeEventListener('rewardedSlotReady', onReady);
        pubads.removeEventListener('rewardedSlotGranted', onGranted);
        pubads.removeEventListener('rewardedSlotClosed', onClosed);
      };
      const settle = (outcome: RewardedAdOutcome) => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          googletag.destroySlot(activeSlot);
        } catch {
          /* 破棄失敗は無視（次回 define で作り直す） */
        }
        resolve(outcome);
      };

      const onReady = (e: GptEvent) => {
        if (e.slot !== activeSlot) return;
        if (readyTimer !== null) {
          window.clearTimeout(readyTimer);
          readyTimer = null;
        }
        e.makeRewardedVisible?.();
      };
      const onGranted = (e: GptEvent) => {
        if (e.slot !== activeSlot) return;
        granted = true;
      };
      const onClosed = (e: GptEvent) => {
        if (e.slot !== activeSlot) return;
        settle(granted ? 'granted' : 'dismissed');
      };

      pubads.addEventListener('rewardedSlotReady', onReady);
      pubads.addEventListener('rewardedSlotGranted', onGranted);
      pubads.addEventListener('rewardedSlotClosed', onClosed);

      googletag.enableServices();
      googletag.display(activeSlot);

      // 一定時間内に ready にならなければ在庫なし扱いで終える。
      readyTimer = window.setTimeout(() => settle('unavailable'), READY_TIMEOUT_MS);
    });
  });
}
