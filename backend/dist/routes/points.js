import { Hono } from "hono";
import { getSessionUser, isDeveloper } from "../lib/auth.js";
import { addPlayTime, claimVideoReward, ensurePoints, getVideoRewardStatus, setPoints, } from "../lib/points.js";
export const pointsRouter = new Hono();
async function requireUser(req) {
    return getSessionUser(req);
}
// 現在の塗りポイント残高（回復を反映して確定）を返す
pointsRouter.get("/", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const state = await ensurePoints(user.id, Date.now());
    return c.json(state);
});
// 合計プレイ時間を加算する。クライアントが約1分ごと／アクション時に経過秒を送る。
// 戻り値は更新後の PointsState（playTimeSec を含む）。
pointsRouter.post("/heartbeat", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null));
    const state = await addPlayTime(user.id, Number(body?.deltaSec), Date.now());
    return c.json(state);
});
// 動画リワードの現在の利用可否（残り回数・クールダウンの次回時刻）を返す。
pointsRouter.get("/reward/video", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const status = await getVideoRewardStatus(user.id, Date.now());
    return c.json(status);
});
// 動画視聴の報酬を受け取る（そのレベルの満タン分を回復）。
// クールダウン中・1日上限到達なら 429 で理由を返す。
// ※モック実装：サーバーは視聴完了を検証していない。実広告SDK導入時は
//   SSV（Server-Side Verification）等で視聴完了を検証してから付与する。
pointsRouter.post("/reward/video", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const result = await claimVideoReward(user.id, Date.now());
    if (!result.ok) {
        return c.json({ error: result.reason, status: result.status }, 429);
    }
    return c.json({
        points: result.state,
        granted: result.granted,
        status: result.status,
    });
});
// デバッグ用：残高を任意の値にセットする（MAX を超える値も許容）。開発者のみ。
pointsRouter.post("/debug/set", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    if (!isDeveloper(user))
        return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => null));
    const value = Number(body?.points);
    if (!Number.isFinite(value) || value < 0) {
        return c.json({ error: "bad request" }, 400);
    }
    const state = await setPoints(user.id, Math.floor(value), Date.now());
    return c.json(state);
});
