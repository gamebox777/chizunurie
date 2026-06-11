// ゲーム全体で共有する共通設定（サーバーの app_settings・単一行）を扱うクライアントヘルパー。
// ユーザーごとの設定（userApi / userSettings）とは別で、開発者だけが読み書きできる
// 「ゲーム全体に効く設定」。デバッグ用の十字キー移動スピードなどをここに入れる。
// Next.js の rewrite 経由で /api/backend/settings に到達する。

const SETTINGS_API = '/api/backend/settings';

// 塗りの瞬間に出る波紋（paint-ripple）の演出パラメータ。塗り方（隣塗り＝manual／GPS塗り）
// ごとに別々に持つ。全クライアントの描画に効くので、開発者が管理画面で調整し、各クライアントは
// 起動時に1回だけ取得してキャッシュする。
export type RippleModeSettings = {
  durationMs?: number; // 波紋（リング）が広がりきるまでの時間[ms]。小さいほど速い＝広がるスピード
  maxScale?: number; // リングの最大サイズ倍率（セル幅の何倍まで広がるか）＝サイズ
  lifetimeMs?: number; // 波紋を画面から消すまでの時間[ms]＝表示時間
  color?: string; // リングの色（'#rrggbb'）
  alpha?: number; // 半透明値（0〜1）。0で透明・1で不透明
};

// 隣塗り（manual）と GPS塗り（gps）でそれぞれ別設定を持つ。
export type RippleSettings = {
  manual?: RippleModeSettings; // 隣塗り（手動・となり塗り）
  gps?: RippleModeSettings; // GPS塗り（現地訪問）
};

export type ResolvedRippleMode = Required<RippleModeSettings>;
export type ResolvedRipple = { manual: ResolvedRippleMode; gps: ResolvedRippleMode };

// 波紋演出の既定値（サーバー未設定・取得失敗時のフォールバック）。
// 既存の挙動（CSS の 0.8s リング・scale(15)・spawnRipple の 1100ms 寿命）に合わせ、色は
// ゲームの塗り色に揃える（GPS＝黄・manual＝赤）。
export const DEFAULT_RIPPLE: ResolvedRipple = {
  manual: { durationMs: 800, maxScale: 15, lifetimeMs: 1100, color: '#ef4444', alpha: 0.6 },
  gps: { durationMs: 800, maxScale: 15, lifetimeMs: 1100, color: '#facc15', alpha: 0.6 },
};

// '#rrggbb' + 半透明値(0〜1) を CSS の rgba() 文字列にする（spawnRipple が --c に渡す）。
export function rippleRgba(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// サーバー設定（部分的＝未設定キーあり）を既定値で埋めて確定値にする。
export function resolveRippleMode(
  s: RippleModeSettings | undefined,
  def: ResolvedRippleMode
): ResolvedRippleMode {
  return {
    durationMs: typeof s?.durationMs === 'number' ? s.durationMs : def.durationMs,
    maxScale: typeof s?.maxScale === 'number' ? s.maxScale : def.maxScale,
    lifetimeMs: typeof s?.lifetimeMs === 'number' ? s.lifetimeMs : def.lifetimeMs,
    color: typeof s?.color === 'string' ? s.color : def.color,
    alpha: typeof s?.alpha === 'number' ? s.alpha : def.alpha,
  };
}

export function resolveRipple(s: RippleSettings | undefined): ResolvedRipple {
  return {
    manual: resolveRippleMode(s?.manual, DEFAULT_RIPPLE.manual),
    gps: resolveRippleMode(s?.gps, DEFAULT_RIPPLE.gps),
  };
}

// 動画リワード（広告を見て回復）の運用設定。backend（points.ts の getVideoRewardConfig）が
// リワード系リクエストのたびに読むので、保存すると即・全ユーザーに効く。
export type VideoRewardSettings = {
  cooldownWebSec?: number; // Web 版のみの視聴クールダウン（秒）。アプリ（Unity Ads）は常に 0
  amountMode?: 'full' | 'half' | 'fixed'; // 回復量：満タン分／満タンの50%（切り上げ）／固定値
  fixedAmount?: number; // amountMode='fixed' のときの回復ポイント
};

export type ResolvedVideoReward = Required<VideoRewardSettings>;

// 動画リワードの既定値。backend（points.ts の VIDEO_REWARD_DEFAULTS）と揃えること。
export const DEFAULT_VIDEO_REWARD: ResolvedVideoReward = {
  cooldownWebSec: 300, // 5分
  amountMode: 'full',
  fixedAmount: 10,
};

// サーバー設定（部分的＝未設定キーあり）を既定値で埋めて確定値にする。
export function resolveVideoReward(
  s: VideoRewardSettings | undefined
): ResolvedVideoReward {
  return {
    cooldownWebSec:
      typeof s?.cooldownWebSec === 'number' && s.cooldownWebSec >= 0
        ? Math.floor(s.cooldownWebSec)
        : DEFAULT_VIDEO_REWARD.cooldownWebSec,
    amountMode:
      s?.amountMode === 'full' || s?.amountMode === 'half' || s?.amountMode === 'fixed'
        ? s.amountMode
        : DEFAULT_VIDEO_REWARD.amountMode,
    fixedAmount:
      typeof s?.fixedAmount === 'number' && s.fixedAmount >= 1
        ? Math.floor(s.fixedAmount)
        : DEFAULT_VIDEO_REWARD.fixedAmount,
  };
}

// Web 広告配信（AdSense）の全体 ON/OFF。autoEnabled=自動広告（adsbygoogle.js の読み込み）、
// rewardEnabled=「広告を見て回復」（Web 版のディスプレイ広告リワード）。アプリ版（Unity Ads）は
// 対象外。ユーザー個別の上書き（user.ad_settings・管理画面のユーザー一覧から編集）があれば
// そちらが優先される。実効値の解決はサーバー（/api/backend/user/me/ads）が行う。
export type WebAdsSettings = {
  autoEnabled?: boolean; // 自動広告を配信するか（既定 true）
  rewardEnabled?: boolean; // 「広告を見て回復」を有効にするか（既定 true）
};

export type ResolvedWebAds = Required<WebAdsSettings>;

// Web 広告の既定値（未設定・取得失敗時は従来どおり両方 ON）。
// backend（lib/webAds.ts の WEB_ADS_DEFAULTS）と揃えること。
export const DEFAULT_WEB_ADS: ResolvedWebAds = {
  autoEnabled: true,
  rewardEnabled: true,
};

// サーバー設定（部分的＝未設定キーあり）を既定値で埋めて確定値にする。
export function resolveWebAds(s: WebAdsSettings | undefined): ResolvedWebAds {
  return {
    autoEnabled:
      typeof s?.autoEnabled === 'boolean' ? s.autoEnabled : DEFAULT_WEB_ADS.autoEnabled,
    rewardEnabled:
      typeof s?.rewardEnabled === 'boolean'
        ? s.rewardEnabled
        : DEFAULT_WEB_ADS.rewardEnabled,
  };
}

// ゲーム共通設定（十字キー移動スピード・波紋演出など）。項目が増えてもここに1キー足すだけ。
// DB はスキーマ変更不要（jsonb に丸ごと入る）。
export type GameSettings = {
  moveSpeed?: number; // デバッグ十字キー移動：通常移動 m/s
  sprintSpeed?: number; // デバッグ十字キー移動：Shift（加速）時 m/s
  ripple?: RippleSettings; // 塗りの波紋演出（全ユーザーに効く）
  videoReward?: VideoRewardSettings; // 動画リワードのクールダウン・回復量（全ユーザーに効く）
  webAds?: WebAdsSettings; // Web 広告配信の全体 ON/OFF（個別上書きは user.ad_settings）
};

// サーバーに保存されたゲーム共通設定を取得する。開発者でなければ／失敗時は空オブジェクト。
export async function fetchGameSettings(): Promise<GameSettings> {
  try {
    // リロードのたびに最新の設定をサーバーから取り直す（ブラウザの HTTP キャッシュで古い値が
    // 返らないように no-store を明示する）。
    const res = await fetch(`${SETTINGS_API}`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return {};
    const data = (await res.json()) as { settings?: GameSettings };
    return data.settings ?? {};
  } catch (err) {
    console.warn('failed to fetch game settings', err);
    return {};
  }
}

// 全員に見せてよいゲーム共通設定（波紋演出など）を取得する（ログイン不要）。
// 波紋は開発者以外の画面でも出るので、開発者専用の fetchGameSettings ではなく公開
// エンドポイントから取る。クライアントは起動時に1回だけ呼んでキャッシュし、波紋を
// 出すたびに DB を読みにこないようにする。失敗時は空オブジェクト。
export async function fetchPublicGameSettings(): Promise<GameSettings> {
  try {
    // 波紋などの共通設定は管理画面で変更されるので、リロードのたびに最新を取り直す（HTTP
    // キャッシュで古い波紋設定が返らないように no-store を明示する）。
    const res = await fetch(`${SETTINGS_API}/public`, { cache: 'no-store' });
    if (!res.ok) return {};
    const data = (await res.json()) as { settings?: GameSettings };
    return data.settings ?? {};
  } catch (err) {
    console.warn('failed to fetch public game settings', err);
    return {};
  }
}

// ゲーム共通設定を丸ごと保存する（開発者専用）。fire-and-forget。
export function saveGameSettings(settings: GameSettings): Promise<void> {
  return fetch(`${SETTINGS_API}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  })
    .then(() => undefined)
    .catch((err) => {
      console.warn('failed to save game settings', err);
    });
}
