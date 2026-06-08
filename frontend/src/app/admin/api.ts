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
  createdAt: string;
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

// ── ログ閲覧 ───────────────────────────────────────────────

export type UserLog = {
  id: number;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  ipAddress: string | null;
  userAgent: string | null;
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

export function fetchLogs(params: {
  userId?: string;
  action?: string;
  beforeId?: number;
  limit?: number;
}) {
  return request<{ logs: UserLog[]; total: number }>(`/logs${toQuery(params)}`);
}

export function fetchPaintedLog(params: {
  userId?: string;
  beforeId?: number;
  limit?: number;
}) {
  return request<{ painted: PaintedLog[]; total: number }>(`/painted${toQuery(params)}`);
}

// ── 動画リワード広告の集計 ───────────────────────────────────

export type VideoStats = {
  days: number | null;
  byEvent: Record<string, { count: number; users: number }>;
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
  // 全期間の累計アクセス数。
  total: number;
  // 今日（JST）のアクセス数。
  today: number;
  // 直近7日（今日を含む）の合計。
  last7: number;
  // 日別件数（新しい順・最大30件）。"YYYY-MM-DD"（JST）→ 件数。
  daily: { date: string; count: number }[];
};

export function fetchAccessStats() {
  return request<AccessStats>('/access-stats');
}
