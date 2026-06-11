// 管理画面（/admin）専用の API ヘルパーと型。
// すべて Next.js の rewrite 経由でバックエンド /admin/* に到達する。

const BASE = '/api/backend/admin';

export type AdminUser = {
  id: string;
  name: string;
  // Google ログイン時に取得できた本名（管理画面のみ表示。ゲーム画面には出さない）。
  realName: string | null;
  email: string;
  role: string;
  // GPS で判定した所在国（adm0_a3。日本は "JPN"）。未取得なら null。
  country: string | null;
  // 直近のアクション時に観測した IP / UserAgent（最新）。
  lastIpAddress: string | null;
  lastUserAgent: string | null;
  // このユーザー個別の Web 広告配信の上書き設定。キーが無い項目は全体設定
  // （app_settings.webAds）に従い、true/false が入っていれば全体設定より優先される。
  adSettings: { auto?: boolean; reward?: boolean };
  createdAt: string;
  // 最終更新日時（ログイン・GPS・検索などのアクションやプレイ中の heartbeat で更新）。
  updatedAt: string;
  painted: { total: number; gps: number; manual: number };
  points: { points: number; level: number; exp: number } | null;
  playTimeSec: number;
};

export type AdminStats = {
  users: { total: number; byRole: { role: string; count: number }[] };
  painted: { total: number; gps: number; manual: number };
};

// 共通の fetch。Cookie 認証を送り、エラー時は例外を投げる。
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchUsers() {
  return request<{ users: AdminUser[] }>('/users');
}

export function fetchStats() {
  return request<AdminStats>('/stats');
}

export function setRole(id: string, role: 'user' | 'developer') {
  return request<{ ok: true; role: string }>(`/users/${id}/role`, {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}

// ユーザー個別の Web 広告配信の上書き設定を更新する。
// true/false=全体設定を上書きして強制 ON/OFF、null=上書き解除（全体設定に従う）、
// undefined（キーを送らない）=その項目は変更しない。
export function setUserAds(
  id: string,
  fields: { auto?: boolean | null; reward?: boolean | null }
) {
  return request<{ ok: true; adSettings: { auto?: boolean; reward?: boolean } }>(
    `/users/${id}/ads`,
    {
      method: 'POST',
      body: JSON.stringify(fields),
    }
  );
}

export function setPoints(
  id: string,
  fields: { points?: number; level?: number; exp?: number }
) {
  return request<{ ok: true }>(`/users/${id}/points`, {
    method: 'POST',
    body: JSON.stringify(fields),
  });
}

export function deletePainted(id: string) {
  return request<{ ok: true; deleted: number }>(`/users/${id}/painted`, {
    method: 'DELETE',
  });
}

// ユーザーを関連データごと完全削除する（塗り・ポイント・ログ・セッション等）。
export function deleteUser(id: string) {
  return request<{ ok: true; id: string }>(`/users/${id}`, {
    method: 'DELETE',
  });
}

// ── ログ閲覧 ───────────────────────────────────────────────

export type UserLog = {
  id: number;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  ipAddress: string | null;
  userAgent: string | null;
  // クライアント申告の実行プラットフォーム（web/pwa/ios/android）とバージョン表記。
  platform: string | null;
  appVersion: string | null;
  lat: number | null;
  lng: number | null;
  municipality: string | null;
  meta: unknown;
  createdAt: string;
};

export type PaintedLog = {
  id: number;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  sourceLayer: string;
  keyCode: string;
  mode: string;
  lat: number | null;
  lng: number | null;
  municipality: string | null;
  country: string | null;
  paintedAt: string | null;
};

// クエリ文字列を組み立てる（空値は除外）。
function toQuery(params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// 一覧 API 共通のソート/ページングパラメータ。sort はサーバー側ホワイトリストの列キー
// （未指定・未知のキーは新しい順）。offset ページングなので任意のページへ飛べる。
export type ListQuery = {
  offset?: number;
  limit?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
};

export function fetchLogs(
  params: { userId?: string; action?: string } & ListQuery
) {
  return request<{ logs: UserLog[]; total: number }>(`/logs${toQuery(params)}`);
}

export function fetchPaintedLog(
  params: { userId?: string; mode?: 'gps' | 'manual' } & ListQuery
) {
  return request<{ painted: PaintedLog[]; total: number }>(`/painted${toQuery(params)}`);
}

// ── 動画リワード広告の集計 ───────────────────────────────────

export type VideoStats = {
  days: number | null;
  byEvent: Record<string, { count: number; users: number }>;
  // 失敗の具体的な原因の内訳（meta.detail / claim_failed は meta.reason）。件数降順。
  details: {
    event: string;
    detail: string;
    count: number;
    users: number;
    lastAt: string; // 最終発生日時（ISO）
  }[];
  funnel: {
    start: number;
    granted: number;
    dismissed: number;
    unavailable: number;
    error: number;
    cooldown: number;
    dailyLimit: number;
    nonceError: number;
    claimFailed: number;
    completionRate: number | null;
  };
};

export function fetchVideoStats(params: { days?: number }) {
  return request<VideoStats>(`/video-stats${toQuery(params)}`);
}

// ── サイトアクセス数の集計 ───────────────────────────────────

export type AccessStats = {
  // アクセス数（ページ表示・延べ）の累計／今日／直近7日。
  views: { total: number; today: number; last7: number };
  // ユニークユーザー数の累計／今日／直近7日。
  uniques: { total: number; today: number; last7: number };
  // 日別（新しい順・最大30件）。views=表示回数、uniques=ユニーク訪問者数。
  daily: { date: string; views: number; uniques: number }[];
};

export function fetchAccessStats() {
  return request<AccessStats>('/access-stats');
}
