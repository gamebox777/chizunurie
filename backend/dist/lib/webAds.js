import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { appSettings, user } from "../db/schema.js";
export const WEB_ADS_DEFAULTS = { auto: true, reward: true };
function asBool(v) {
    return typeof v === "boolean" ? v : undefined;
}
// app_settings.webAds から全体設定を読む（行・キーが無ければ既定＝両方 ON）。
export async function getGlobalWebAds() {
    const rows = await db
        .select({ settings: appSettings.settings })
        .from(appSettings)
        .where(eq(appSettings.id, 1));
    const raw = rows[0]?.settings
        ?.webAds;
    return {
        auto: asBool(raw?.autoEnabled) ?? WEB_ADS_DEFAULTS.auto,
        reward: asBool(raw?.rewardEnabled) ?? WEB_ADS_DEFAULTS.reward,
    };
}
// 全体設定にユーザー個別の上書きを重ねて、そのユーザーの実効値を返す。
// userId が null（未ログイン）なら全体設定をそのまま返す。
export async function resolveWebAdsForUser(userId) {
    const global = await getGlobalWebAds();
    if (!userId)
        return global;
    const rows = await db
        .select({ adSettings: user.adSettings })
        .from(user)
        .where(eq(user.id, userId));
    const ov = (rows[0]?.adSettings ?? {});
    return {
        auto: asBool(ov.auto) ?? global.auto,
        reward: asBool(ov.reward) ?? global.reward,
    };
}
