// ユーザー行動ログをバックエンドに送るクライアントヘルパー。
// Next.js の rewrite 経由で /api/backend/log に到達する。

import { appPlatform, appVersionString } from './platform';

const LOG_API = '/api/backend/log';
const ACCESS_API = '/api/backend/access';

// サイトへのアクセス（ページ表示）を1件カウントする。ログイン有無に関わらず数える。
// fire-and-forget：失敗しても画面表示には影響させない。
export function recordAccess(): void {
  fetch(ACCESS_API, { method: 'POST', credentials: 'include', keepalive: true }).catch(
    () => {}
  );
}

// クライアントから送る主要アクション（塗りは含めない＝painted 側で記録）。
// video_reward は動画リワード広告の各段階（meta.event で start/granted/dismissed/…を区別）。
export type LogAction =
  | 'login'
  | 'signup'
  | 'logout'
  | 'session_start'
  | 'search'
  | 'gps'
  | 'video_reward'
  | 'stats'
  | 'ranking';

type LngLatMuni = { lat: number; lng: number; municipality: string | null };

// 直近に取得できた現在地（GeolocateControl 由来）。塗り以外のアクションの
// 位置情報を best-effort で埋めるために共有する。取得できていなければ null。
let lastKnownLocation: LngLatMuni | null = null;

export function setLastKnownLocation(loc: LngLatMuni | null): void {
  lastKnownLocation = loc;
}

export type LogEventOptions = {
  lat?: number;
  lng?: number;
  municipality?: string | null;
  meta?: unknown;
};

// navigator.connection（Network Information API）の最小型。Chrome系のみ存在する。
type NetworkInformation = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

// 回線状態の概要。広告の在庫なし/タイムアウトの切り分け用にログの meta へ添える。
// 非対応ブラウザ（Safari 等）は online フラグだけになる。
export function connectionMeta(): Record<string, unknown> {
  if (typeof navigator === 'undefined') return {};
  const conn = (navigator as { connection?: NetworkInformation }).connection;
  return {
    online: navigator.onLine,
    ...(conn?.effectiveType ? { effectiveType: conn.effectiveType } : {}),
    ...(typeof conn?.downlink === 'number' ? { downlink: conn.downlink } : {}),
    ...(typeof conn?.rtt === 'number' ? { rtt: conn.rtt } : {}),
    ...(conn?.saveData ? { saveData: true } : {}),
  };
}

// 端末環境の概要（画面サイズ・言語・タイムゾーン・回線）。session_start の meta に残す。
export function clientEnvMeta(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* 取得できない環境は省略 */
  }
  return {
    screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio ?? 1,
    lang: navigator.language,
    ...(tz ? { tz } : {}),
    net: connectionMeta(),
  };
}

// アクションを1件記録する。位置が指定されなければ直近の現在地で補完する。
// プラットフォーム（web/pwa/ios/android）とバージョン表記は常に自動で添える。
// fire-and-forget：失敗しても呼び出し側の処理は止めない。
export function logEvent(action: LogAction, opts?: LogEventOptions): Promise<void> {
  const lat = opts?.lat ?? lastKnownLocation?.lat;
  const lng = opts?.lng ?? lastKnownLocation?.lng;
  const municipality =
    opts?.municipality ?? lastKnownLocation?.municipality ?? null;

  return appVersionString()
    .catch(() => null)
    .then((appVersion) =>
      fetch(LOG_API, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          lat: lat ?? null,
          lng: lng ?? null,
          municipality,
          platform: appPlatform(),
          appVersion,
          meta: opts?.meta ?? null,
          url: typeof window !== 'undefined' ? window.location.href : null,
        }),
      })
    )
    .then(() => undefined)
    .catch((err) => {
      console.warn('failed to log event', action, err);
    });
}
