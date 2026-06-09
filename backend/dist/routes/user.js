import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getSessionUser } from "../lib/auth.js";
import { db } from "../db/index.js";
import { user } from "../db/schema.js";
// ログイン中ユーザー自身のプロフィール更新（所在国・設定）。
// Next.js の rewrite 経由で /api/backend/user/* から到達する。
export const userRouter = new Hono();
// 自分の所在国（GPS 由来の adm0_a3。日本は "JPN"）を更新する。
// クライアントは GPS で国が判定／変化したときに送る。現在値と同じなら書き込まない。
userRouter.post("/me/country", async (c) => {
    const u = await getSessionUser(c.req.raw);
    if (!u)
        return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null));
    const raw = body?.country;
    const country = typeof raw === "string" && raw.length > 0 && raw.length <= 8 ? raw : null;
    if (country === null)
        return c.json({ error: "bad request" }, 400);
    // 現在値と同じなら無駄な UPDATE を避ける。
    const [row] = await db
        .select({ country: user.country })
        .from(user)
        .where(eq(user.id, u.id));
    if (row?.country === country) {
        return c.json({ ok: true, country, changed: false });
    }
    await db
        .update(user)
        .set({ country, updatedAt: new Date() })
        .where(eq(user.id, u.id));
    return c.json({ ok: true, country, changed: true });
});
// 自分の設定 JSON を取得する。
userRouter.get("/me/settings", async (c) => {
    const u = await getSessionUser(c.req.raw);
    if (!u)
        return c.json({ error: "unauthorized" }, 401);
    const [row] = await db
        .select({ settings: user.settings })
        .from(user)
        .where(eq(user.id, u.id));
    return c.json({ settings: row?.settings ?? {} });
});
// 自分の設定 JSON を丸ごと保存する。設定項目は今後増減するので、サーバーは中身を解釈せず
// オブジェクトをそのまま格納する（項目ごとのマイグレーションが不要）。
userRouter.put("/me/settings", async (c) => {
    const u = await getSessionUser(c.req.raw);
    if (!u)
        return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null));
    const settings = body?.settings;
    if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
        return c.json({ error: "bad request" }, 400);
    }
    // 暴走・悪用対策のサイズ上限（設定は小さい JSON のはず）。
    if (JSON.stringify(settings).length > 8192) {
        return c.json({ error: "too large" }, 413);
    }
    await db
        .update(user)
        .set({ settings, updatedAt: new Date() })
        .where(eq(user.id, u.id));
    return c.json({ ok: true });
});
