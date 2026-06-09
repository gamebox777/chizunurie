import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getSessionUser, isDeveloper } from "../lib/auth.js";
import { db } from "../db/index.js";
import { appSettings } from "../db/schema.js";
// ゲーム全体で共有する共通設定（app_settings の単一行 id=1）の取得・保存。
// デバッグ用の十字キー移動スピードなど、ユーザーごとではなくゲーム全体に効く設定を扱う。
// 変更はゲーム全体に影響するため取得・保存とも開発者（role=developer）のみに限定する。
// Next.js の rewrite 経由で /api/backend/settings/* から到達する。
export const settingsRouter = new Hono();
// app_settings は常に id=1 の1行だけを使う（単一行テーブル）。
const ROW_ID = 1;
// 開発者でなければ 401/403 のレスポンスを返す。OK なら null。
async function requireDeveloper(c) {
    const u = await getSessionUser(c.req.raw);
    if (!u)
        return c.json({ error: "unauthorized" }, 401);
    if (!isDeveloper(u))
        return c.json({ error: "forbidden" }, 403);
    return null;
}
// app_settings の単一行を読む（無ければ空オブジェクト）。GET / と GET /public で共有する。
async function readSettings() {
    const [row] = await db
        .select({ settings: appSettings.settings })
        .from(appSettings)
        .where(eq(appSettings.id, ROW_ID));
    return row?.settings ?? {};
}
// ゲーム共通設定を取得する（管理画面の編集用・開発者専用）。まだ1行も無ければ空オブジェクト。
settingsRouter.get("/", async (c) => {
    const guard = await requireDeveloper(c);
    if (guard)
        return guard;
    return c.json({ settings: await readSettings() });
});
// ゲーム共通設定の「全員に見せてよい」サブセットを誰でも取得できるようにする公開エンドポイント。
// 波紋（ripple）の見た目など、全クライアントの描画に効く設定はログイン状態に関わらず読めないと
// いけない（開発者以外の画面でも波紋は出る）。クライアントは起動時に1回だけ取得してキャッシュし、
// 波紋を出すたびに DB を読みにこない。app_settings に入る設定はゲーム全体に効く非機密な
// ゲーム設定なので、ここでは丸ごと返す（将来 機密値を足すならホワイトリストに切り替える）。
settingsRouter.get("/public", async (c) => {
    return c.json({ settings: await readSettings() });
});
// ゲーム共通設定を保存する（単一行を upsert）。設定項目は今後増減するので、サーバーは中身を
// 解釈せず格納する（項目ごとのマイグレーションが不要）。送られたトップレベルキーだけを既存値に
// 浅くマージするので、複数の編集元（地図のデバッグメニュー＝移動スピード／管理画面＝波紋など）が
// それぞれ自分のキーだけを送っても、相手のキーを消さずに済む。
settingsRouter.put("/", async (c) => {
    const guard = await requireDeveloper(c);
    if (guard)
        return guard;
    const body = (await c.req.json().catch(() => null));
    const settings = body?.settings;
    if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
        return c.json({ error: "bad request" }, 400);
    }
    // 暴走・悪用対策のサイズ上限（設定は小さい JSON のはず）。
    if (JSON.stringify(settings).length > 8192) {
        return c.json({ error: "too large" }, 413);
    }
    const merged = { ...(await readSettings()), ...settings };
    await db
        .insert(appSettings)
        .values({ id: ROW_ID, settings: merged, updatedAt: new Date() })
        .onConflictDoUpdate({
        target: appSettings.id,
        set: { settings: merged, updatedAt: new Date() },
    });
    return c.json({ ok: true });
});
