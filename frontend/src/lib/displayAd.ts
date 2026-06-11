// AdSense のディスプレイ広告を全画面オーバーレイで 1 枚表示するヘルパー（Web のみ）。
//
// GPT のリワード動画（rewardedAd.ts）は日本の Web では需要が薄くほぼ no fill だったため、
// 「▶ 動画を見て回復」ボタンは通常のディスプレイユニット（chizunurie_display_1）を
// モーダル表示する方式に変更した。ディスプレイ広告には rewardedSlotGranted のような
// 「視聴完了」イベントが無いので、**オーバーレイを閉じた時点で granted 扱い**にする
// （視聴完了は待たない仕様）。フィルの有無（data-ad-status）は debug に記録だけする。
//
// adsbygoogle.js 本体は AdSenseLoader（layout.tsx）が全ページで読み込み済み。
// `(adsbygoogle = window.adsbygoogle || []).push({})` はスクリプト未ロードでも
// キュー（配列）に積まれるだけなので、ここでは存在チェック不要。
//
// 返り値は rewardedAd.ts と同じ { outcome, debug } 形。呼び出し側（Map.tsx の
// openVideoReward）は granted 後に backend へ nonce 付きで報酬請求する（従来どおり）。

import type { RewardedAdResult, RewardedAdDebug, RewardedAdDetail } from './rewardedAd';

const ADSENSE_CLIENT = 'ca-pub-3466778617044617';

// data-ad-status（filled/unfilled）が付くのを待つ上限。超えてもエラーにはせず
// 「フィル不明」として記録だけ残す（広告ブロッカー・回線遅延など）。
const FILL_STATUS_TIMEOUT_MS = 8000;

const DEBUG_AD = process.env.NODE_ENV !== 'production';
function dbg(...args: unknown[]) {
  if (DEBUG_AD) console.log('[displayAd]', ...args);
}

/**
 * ディスプレイ広告のオーバーレイを表示し、ユーザーが閉じたら granted で解決する。
 * 広告が出ない（unfilled）場合は unavailable で解決し、回復はさせない。
 */
export function showDisplayAdOverlay(slot: string): Promise<RewardedAdResult> {
  const t0 = performance.now();
  const debug: RewardedAdDebug = { trail: [], isMock: DEBUG_AD };
  const mark = (label: string, ...args: unknown[]) => {
    debug.trail.push(`${Math.round(performance.now() - t0)}ms ${label}`);
    dbg(label, ...args);
  };
  mark('start');

  return new Promise<RewardedAdResult>((resolve) => {
    // ---- オーバーレイ DOM（React 外・GPT が自前オーバーレイを作るのと同じ流儀）----
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.85);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;';

    // 読み込み状態表示用のステータスメッセージ
    const statusMsg = document.createElement('div');
    statusMsg.style.cssText =
      'color:#fff;font-size:16px;font-weight:700;text-align:center;margin-bottom:12px;font-family:sans-serif;';
    statusMsg.textContent = '広告を読み込んでいます… / Loading ad…';
    overlay.appendChild(statusMsg);

    const box = document.createElement('div');
    box.style.cssText =
      'width:min(92vw,640px);max-height:75vh;overflow:hidden;background:#fff;' +
      'border-radius:12px;padding:8px;display:none;'; // 読み込み完了まで非表示

    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.cssText = 'display:block;width:100%;min-height:250px;';
    ins.setAttribute('data-ad-client', ADSENSE_CLIENT);
    ins.setAttribute('data-ad-slot', slot);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    box.appendChild(ins);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕ 閉じる / Close';
    closeBtn.style.cssText =
      'appearance:none;border:none;border-radius:9999px;padding:10px 24px;' +
      'background:#10b981;color:#fff;font-weight:700;font-size:14px;cursor:pointer;';

    overlay.appendChild(box);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);

    // 開発環境（dev）では AdSense 広告が配信されないため、モック用のテスト広告を表示する
    if (DEBUG_AD) {
      const mockAd = document.createElement('div');
      mockAd.style.cssText =
        'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'width:100%;min-height:250px;background:linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);' +
        'color:#fff;font-family:sans-serif;border-radius:8px;padding:24px;box-sizing:border-box;text-align:center;';
      mockAd.innerHTML = `
        <div style="font-size: 20px; font-weight: bold; margin-bottom: 8px;">[TEST AD]</div>
        <div style="font-size: 14px; margin-bottom: 16px; opacity: 0.9;">これは開発環境用のテスト広告です。<br>閉じるボタンを押すとポイントが回復します。</div>
        <div style="font-size: 11px; border: 1px solid rgba(255,255,255,0.4); padding: 4px 12px; border-radius: 4px; background: rgba(255,255,255,0.1); font-family: monospace;">
          Client: ${ADSENSE_CLIENT} / Slot: ${slot}
        </div>
      `;
      ins.appendChild(mockAd);
      
      // 0.8秒後に読み込み完了ステータスに変更して MutationObserver を発火させる
      window.setTimeout(() => {
        ins.setAttribute('data-ad-status', 'filled');
      }, 800);
    }

    // ---- フィル状況の記録 ----
    let loadErrorDetail: RewardedAdDetail | undefined = undefined;
    let statusTimer: number | null = null;
    const observer = new MutationObserver(() => {
      const status = ins.getAttribute('data-ad-status');
      if (!status) return;
      debug.adStatus = status;
      debug.renderIsEmpty = status !== 'filled';
      mark(`ad_status ${status}`);
      observer.disconnect();
      if (statusTimer !== null) {
        window.clearTimeout(statusTimer);
        statusTimer = null;
      }

      if (status === 'filled') {
        statusMsg.style.display = 'none';
        box.style.display = 'block';
      } else {
        loadErrorDetail = 'ad_unfilled';
        statusMsg.textContent = '表示できる広告がありません / No ad available';
      }
    });
    observer.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
    statusTimer = window.setTimeout(() => {
      // ブロッカー・回線遅延などで status が付かないまま。フィル不明として記録。
      if (debug.renderIsEmpty === undefined) {
        debug.renderIsEmpty = true;
        loadErrorDetail = 'ad_timeout';
        debug.adStatus = ins.getAttribute('data-ad-status') ?? 'timeout';
        mark(`ad_status_timeout (${FILL_STATUS_TIMEOUT_MS}ms)`);
        statusMsg.textContent = '広告の読み込みがタイムアウトしました / Ad loading timed out';
      }
      observer.disconnect();
    }, FILL_STATUS_TIMEOUT_MS);

    // ---- 広告リクエスト ----
    if (!DEBUG_AD) {
      try {
        const w = window as unknown as { adsbygoogle?: unknown[] };
        (w.adsbygoogle = w.adsbygoogle || []).push({});
        mark('push');
      } catch (e) {
        debug.renderIsEmpty = true;
        loadErrorDetail = 'ad_push_failed';
        if (e instanceof Error) {
          debug.pushError = {
            name: e.name,
            message: e.message,
            stack: e.stack,
          };
        } else {
          debug.pushError = {
            name: 'UnknownError',
            message: String(e),
          };
        }
        mark('push_threw', e);
      }
    } else {
      mark('mock_push');
    }

    // ---- 閉じる ----
    let settled = false;
    closeBtn.onclick = () => {
      if (settled) return;
      settled = true;
      mark('closed');
      observer.disconnect();
      if (statusTimer !== null) window.clearTimeout(statusTimer);

      // 閉じる直前の要素の寸法とブラウザの表示状態を記録
      debug.visibilityState = document.visibilityState;
      debug.boxDimensions = {
        width: box.offsetWidth,
        height: box.offsetHeight,
      };
      debug.insDimensions = {
        width: ins.offsetWidth,
        height: ins.offsetHeight,
      };

      overlay.remove();

      // 広告が正常に読み込めた場合（filled）のみ granted と判定し、ポイント回復の対象とする。
      // 未フィル（unfilled）やタイムアウト、ロード中のキャンセルは回復の対象外とする。
      const isLoaded = debug.renderIsEmpty === false;
      const outcome = isLoaded ? 'granted' : 'unavailable';
      const detail = isLoaded ? undefined : (loadErrorDetail ?? 'ad_closed_during_load');
      resolve({ outcome, detail, debug });
    };
  });
}
