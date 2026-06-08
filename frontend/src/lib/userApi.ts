// ログイン中ユーザー自身のプロフィール更新（所在国・設定）を扱うクライアントヘルパー。
// Next.js の rewrite 経由で /api/backend/user/* に到達する。

const USER_API = '/api/backend/user';

// GPS で判定した所在国（adm0_a3。日本は "JPN"）をサーバーに反映する。
// サーバー側で現在値と比較し、変わった時だけ DB を更新する。fire-and-forget。
export function updateMyCountry(country: string): Promise<void> {
  return fetch(`${USER_API}/me/country`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country }),
  })
    .then(() => undefined)
    .catch((err) => {
      console.warn('failed to update country', err);
    });
}

// サーバーに保存された設定 JSON を取得する。失敗時は空オブジェクト。
export async function fetchMySettings(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${USER_API}/me/settings`, { credentials: 'include' });
    if (!res.ok) return {};
    const data = (await res.json()) as { settings?: Record<string, unknown> };
    return data.settings ?? {};
  } catch (err) {
    console.warn('failed to fetch settings', err);
    return {};
  }
}

// 設定 JSON を丸ごと保存する（項目が増減してもこの1呼び出しで済む）。fire-and-forget。
export function saveMySettings(settings: Record<string, unknown>): Promise<void> {
  return fetch(`${USER_API}/me/settings`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  })
    .then(() => undefined)
    .catch((err) => {
      console.warn('failed to save settings', err);
    });
}
