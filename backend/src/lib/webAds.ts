import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { appSettings, user } from "../db/schema.js";

// Web 広告配信（AdSense）の ON/OFF 設定の解決。
//  - 全体設定: app_settings.webAds = { autoEnabled?: boolean, rewardEnabled?: boolean }
//      autoEnabled   … 自動広告（adsbygoogle.js の読み込み＝ページ内の自動広告全般）
//      rewardEnabled … 「広告を見て回復」のディスプレイ広告（Web 版のリワード）
//  - 個別設定: user.ad_settings = { auto?: boolean, reward?: boolean }
//      キーが在れば全体設定より優先する（個別設定＞全体設定）。無ければ全体設定に従う。
// アプリ版（Unity Ads）はこの設定の対象外（Web 広告のみ）。
// 未設定・取得失敗時の既定はどちらも ON（従来挙動）。

export type WebAdsConfig = {
  auto: boolean; // 自動広告（AdSense スクリプト）を配信するか
  reward: boolean; // Web 版の「広告を見て回復」を有効にするか
};

export const WEB_ADS_DEFAULTS: WebAdsConfig = { auto: true, reward: true };

// 個別上書きの形（user.ad_settings）。boolean のキーだけを有効値として扱う。
export type WebAdsOverride = { auto?: boolean; reward?: boolean };

function asBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

// app_settings.webAds から全体設定を読む（行・キーが無ければ既定＝両方 ON）。
export async function getGlobalWebAds(): Promise<WebAdsConfig> {
  const rows = await db
    .select({ settings: appSettings.settings })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  const raw = (rows[0]?.settings as Record<string, unknown> | undefined)
    ?.webAds as { autoEnabled?: unknown; rewardEnabled?: unknown } | undefined;
  return {
    auto: asBool(raw?.autoEnabled) ?? WEB_ADS_DEFAULTS.auto,
    reward: asBool(raw?.rewardEnabled) ?? WEB_ADS_DEFAULTS.reward,
  };
}

// 全体設定にユーザー個別の上書きを重ねて、そのユーザーの実効値を返す。
// userId が null（未ログイン）なら全体設定をそのまま返す。
export async function resolveWebAdsForUser(
  userId: string | null
): Promise<WebAdsConfig> {
  const global = await getGlobalWebAds();
  if (!userId) return global;
  const rows = await db
    .select({ adSettings: user.adSettings })
    .from(user)
    .where(eq(user.id, userId));
  const ov = (rows[0]?.adSettings ?? {}) as WebAdsOverride;
  return {
    auto: asBool(ov.auto) ?? global.auto,
    reward: asBool(ov.reward) ?? global.reward,
  };
}
