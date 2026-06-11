// 自分に適用される Web 広告配信の実効設定（全体設定＋ユーザー個別上書き・個別優先）を
// サーバーから取得するヘルパー。解決はサーバー（backend/src/lib/webAds.ts）が行い、
// クライアントは結果の { auto, reward } を読むだけ。
//  - auto   … 自動広告（AdSenseLoader が adsbygoogle.js を読み込むか）
//  - reward … 「広告を見て回復」ボタン（Web 版）を出すか
// 失敗時は従来挙動（両方 ON）にフォールバックする。アプリ版（Unity Ads）は対象外。

export type EffectiveWebAds = { auto: boolean; reward: boolean };

export const WEB_ADS_FALLBACK: EffectiveWebAds = { auto: true, reward: true };

// 同一ページ内で AdSenseLoader と Map.tsx の両方が呼ぶので、1ページロードにつき
// 1リクエストになるよう Promise をモジュールスコープでキャッシュする。
let cached: Promise<EffectiveWebAds> | null = null;

async function fetchEffectiveWebAds(): Promise<EffectiveWebAds> {
  try {
    const res = await fetch('/api/backend/user/me/ads', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return WEB_ADS_FALLBACK;
    const data = (await res.json()) as {
      ads?: { auto?: unknown; reward?: unknown };
    };
    return {
      auto: typeof data.ads?.auto === 'boolean' ? data.ads.auto : WEB_ADS_FALLBACK.auto,
      reward:
        typeof data.ads?.reward === 'boolean' ? data.ads.reward : WEB_ADS_FALLBACK.reward,
    };
  } catch (err) {
    console.warn('failed to fetch web ads config', err);
    return WEB_ADS_FALLBACK;
  }
}

// 実効 Web 広告設定を取得する（ページロード内でキャッシュ）。
export function getMyWebAds(): Promise<EffectiveWebAds> {
  if (!cached) cached = fetchEffectiveWebAds();
  return cached;
}

// ログイン・アカウント連携などでユーザーが切り替わったときにキャッシュを捨てて取り直す。
export function refreshMyWebAds(): Promise<EffectiveWebAds> {
  cached = fetchEffectiveWebAds();
  return cached;
}
