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
  ipAddress: string | null;
  userAgent: string | null;
  lat: number | null;
  lng: number | null;
  municipality: string | null;
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
  return request<{ logs: UserLog[] }>(`/logs${toQuery(params)}`);
}

export function fetchPaintedLog(params: {
  userId?: string;
  beforeId?: number;
  limit?: number;
}) {
  return request<{ painted: PaintedLog[] }>(`/painted${toQuery(params)}`);
}
