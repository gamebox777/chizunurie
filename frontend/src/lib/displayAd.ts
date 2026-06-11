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

import type { RewardedAdResult, RewardedAdDebug } from './rewardedAd';

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
 * 広告が出ない（unfilled）場合も閉じれば granted（回復はさせる・debug に状況を残す）。
 */
export function showDisplayAdOverlay(slot: string): Promise<RewardedAdResult> {
  const t0 = performance.now();
  const debug: RewardedAdDebug = { trail: [] };
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

    const box = document.createElement('div');
    box.style.cssText =
      'width:min(92vw,640px);max-height:75vh;overflow:hidden;background:#fff;' +
      'border-radius:12px;padding:8px;';

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

    // ---- フィル状況の記録（report 専用・報酬判定には使わない）----
    let statusTimer: number | null = null;
    const observer = new MutationObserver(() => {
      const status = ins.getAttribute('data-ad-status');
      if (!status) return;
      debug.renderIsEmpty = status !== 'filled';
      mark(`ad_status ${status}`);
      observer.disconnect();
      if (statusTimer !== null) {
        window.clearTimeout(statusTimer);
        statusTimer = null;
      }
    });
    observer.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
    statusTimer = window.setTimeout(() => {
      // ブロッカー・回線遅延などで status が付かないまま。フィル不明として記録。
      if (debug.renderIsEmpty === undefined) {
        debug.renderIsEmpty = true;
        mark(`ad_status_timeout (${FILL_STATUS_TIMEOUT_MS}ms)`);
      }
      observer.disconnect();
    }, FILL_STATUS_TIMEOUT_MS);

    // ---- 広告リクエスト ----
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] };
      (w.adsbygoogle = w.adsbygoogle || []).push({});
      mark('push');
    } catch (e) {
      // push が落ちても閉じれば granted（広告が出ないだけ）。状況は trail に残る。
      mark('push_threw', e);
    }

    // ---- 閉じる＝報酬確定 ----
    let settled = false;
    closeBtn.onclick = () => {
      if (settled) return;
      settled = true;
      mark('closed');
      observer.disconnect();
      if (statusTimer !== null) window.clearTimeout(statusTimer);
      overlay.remove();
      resolve({ outcome: 'granted', debug });
    };
  });
}
