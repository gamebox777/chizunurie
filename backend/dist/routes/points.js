import { Hono } from "hono";
import { auth } from "../lib/auth.js";
import { ensurePoints, setPoints } from "../lib/points.js";
export const pointsRouter = new Hono();
async function requireUser(req) {
    const session = await auth.api.getSession({ headers: req.headers });
    return session?.user ?? null;
}
// 現在の塗りポイント残高（回復を反映して確定）を返す
pointsRouter.get("/", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const state = await ensurePoints(user.id, Date.now());
    return c.json(state);
});
// デバッグ用：残高を任意の値にセットする（MAX を超える値も許容）。
pointsRouter.post("/debug/set", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null));
    const value = Number(body?.points);
    if (!Number.isFinite(value) || value < 0) {
        return c.json({ error: "bad request" }, 400);
    }
    const state = await setPoints(user.id, Math.floor(value), Date.now());
    return c.json(state);
});
