// ユーザー行動ログをバックエンドに送るクライアントヘルパー。
// Next.js の rewrite 経由で /api/backend/log に到達する。

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
  | 'video_reward';

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

// アクションを1件記録する。位置が指定されなければ直近の現在地で補完する。
// fire-and-forget：失敗しても呼び出し側の処理は止めない。
export function logEvent(action: LogAction, opts?: LogEventOptions): Promise<void> {
  const lat = opts?.lat ?? lastKnownLocation?.lat;
  const lng = opts?.lng ?? lastKnownLocation?.lng;
  const municipality =
    opts?.municipality ?? lastKnownLocation?.municipality ?? null;

  const body = JSON.stringify({
    action,
    lat: lat ?? null,
    lng: lng ?? null,
    municipality,
    meta: opts?.meta ?? null,
  });

  return fetch(LOG_API, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
    .then(() => undefined)
    .catch((err) => {
      console.warn('failed to log event', action, err);
    });
}
