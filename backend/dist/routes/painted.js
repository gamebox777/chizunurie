import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { auth } from "../lib/auth.js";
import { db } from "../db/index.js";
import { paintedRegions } from "../db/schema.js";
import { ALLOWED_COSTS, COST_ADJACENT, EXP_PAINT, EXP_VISIT, addExp, ensurePoints, spendPoints, } from "../lib/points.js";
export const paintedRouter = new Hono();
// 'mesh' が現行の塗り単位。'municipalities'/'chocho' は旧データ互換のため許可
const ALLOWED_LAYERS = new Set(["mesh", "municipalities", "chocho"]);
const ALLOWED_MODES = new Set(["gps", "manual"]);
async function requireUser(req) {
    const session = await auth.api.getSession({ headers: req.headers });
    return session?.user ?? null;
}
function parseBody(body) {
    if (!body)
        return null;
    const { sourceLayer, keyCode, mode, cost } = body;
    if (typeof sourceLayer !== "string" || typeof keyCode !== "string")
        return null;
    if (!ALLOWED_LAYERS.has(sourceLayer))
        return null;
    if (keyCode.length === 0 || keyCode.length > 32)
        return null;
    // mode は省略可（後方互換）。指定時は gps / manual のみ許可
    const resolvedMode = typeof mode === "string" && ALLOWED_MODES.has(mode) ? mode : "manual";
    // cost はクライアントが隣接判定して送る塗りポイント消費量（manual のみ意味を持つ）。
    // 省略時は隣接塗り（COST_ADJACENT）扱い。許可値以外は弾く。
    const resolvedCost = typeof cost === "number" && ALLOWED_COSTS.has(cost) ? cost : COST_ADJACENT;
    return { sourceLayer, keyCode, mode: resolvedMode, cost: resolvedCost };
}
paintedRouter.get("/", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const rows = await db
        .select({
        sourceLayer: paintedRegions.sourceLayer,
        keyCode: paintedRegions.keyCode,
        mode: paintedRegions.mode,
    })
        .from(paintedRegions)
        .where(eq(paintedRegions.userId, user.id));
    return c.json({ painted: rows });
});
paintedRouter.post("/", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const parsed = parseBody(await c.req.json().catch(() => null));
    if (!parsed)
        return c.json({ error: "invalid body" }, 400);
    const now = Date.now();
    if (parsed.mode === "gps") {
        // GPS（実際の移動）はポイント無料。最優先なので既存（manual含む）があれば gps に昇格。
        // 「実際に訪れる」と経験値 EXP_VISIT を獲得する。新規セル・となり塗りからの昇格の
        // どちらも 1 回ずつ付与し、既に gps 済みのセルへの再 POST では付与しない。
        const result = await db.transaction(async (tx) => {
            const inserted = await tx
                .insert(paintedRegions)
                .values({
                userId: user.id,
                sourceLayer: parsed.sourceLayer,
                keyCode: parsed.keyCode,
                mode: "gps",
            })
                .onConflictDoNothing()
                .returning({ id: paintedRegions.id });
            if (inserted.length > 0) {
                // 新規セルを訪問 → 経験値付与
                const state = await addExp(user.id, EXP_VISIT, now, tx);
                return { ok: true, points: state };
            }
            // 既存セル：となり塗り（manual）なら gps に昇格して経験値付与。既に gps なら据え置き。
            const existing = await tx
                .select({ mode: paintedRegions.mode })
                .from(paintedRegions)
                .where(and(eq(paintedRegions.userId, user.id), eq(paintedRegions.sourceLayer, parsed.sourceLayer), eq(paintedRegions.keyCode, parsed.keyCode)));
            if (existing[0]?.mode !== "gps") {
                await tx
                    .update(paintedRegions)
                    .set({ mode: "gps" })
                    .where(and(eq(paintedRegions.userId, user.id), eq(paintedRegions.sourceLayer, parsed.sourceLayer), eq(paintedRegions.keyCode, parsed.keyCode)));
                const state = await addExp(user.id, EXP_VISIT, now, tx);
                return { ok: true, points: state };
            }
            const state = await ensurePoints(user.id, now, tx);
            return { ok: true, points: state };
        });
        return c.json(result);
    }
    // manual：新規セルのみ塗りポイントを消費する。残高不足ならロールバックして 402 を返す。
    // 既存セルへの再 POST（idempotent）は課金しない。新規かつ有料（cost>0）なら経験値 EXP_PAINT を付与。
    try {
        const result = await db.transaction(async (tx) => {
            const inserted = await tx
                .insert(paintedRegions)
                .values({
                userId: user.id,
                sourceLayer: parsed.sourceLayer,
                keyCode: parsed.keyCode,
                mode: parsed.mode,
            })
                .onConflictDoNothing()
                .returning({ id: paintedRegions.id });
            if (inserted.length === 0) {
                // 既に塗り済み → 課金せず現在の残高を返す
                const state = await ensurePoints(user.id, now, tx);
                return { ok: true, points: state };
            }
            const spent = await spendPoints(user.id, parsed.cost, now, tx);
            if (!spent) {
                // 残高不足 → トランザクションを巻き戻して塗りを取り消す
                throw new InsufficientPointsError();
            }
            // 有料の塗り（となり塗り／離れた場所）のみ経験値付与。cost===0 のデバッグ塗りは付与しない。
            const state = parsed.cost > 0 ? await addExp(user.id, EXP_PAINT, now, tx) : spent;
            return { ok: true, points: state };
        });
        return c.json(result);
    }
    catch (err) {
        if (err instanceof InsufficientPointsError) {
            const state = await ensurePoints(user.id, now);
            return c.json({ error: "insufficient_points", points: state }, 402);
        }
        throw err;
    }
});
class InsufficientPointsError extends Error {
}
// ユーザーの塗りを全消去する（デバッグ用）。ポイントは返金しない。
paintedRouter.delete("/all", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    await db.delete(paintedRegions).where(eq(paintedRegions.userId, user.id));
    return c.json({ ok: true });
});
paintedRouter.delete("/", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const parsed = parseBody(await c.req.json().catch(() => null));
    if (!parsed)
        return c.json({ error: "invalid body" }, 400);
    await db
        .delete(paintedRegions)
        .where(and(eq(paintedRegions.userId, user.id), eq(paintedRegions.sourceLayer, parsed.sourceLayer), eq(paintedRegions.keyCode, parsed.keyCode)));
    return c.json({ ok: true });
});
