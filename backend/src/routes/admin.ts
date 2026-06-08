import { Hono } from "hono";
import type { Context } from "hono";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getSessionUser, isDeveloper } from "../lib/auth.js";
import { db } from "../db/index.js";
import { paintedRegions, user, userLogs, userPoints } from "../db/schema.js";
import { ensurePoints } from "../lib/points.js";

// 開発者専用の管理画面（フロントの /admin）向け API。
// すべてのルートで isDeveloper を要求する。Next.js の rewrite 経由で
// /api/backend/admin/* から到達する。
export const adminRouter = new Hono();

// 開発者でなければ 401/403 のレスポンスを返す。OK なら null。
async function requireDeveloper(c: Context): Promise<Response | null> {
  const u = await getSessionUser(c.req.raw);
  if (!u) return c.json({ error: "unauthorized" }, 401);
  if (!isDeveloper(u)) return c.json({ error: "forbidden" }, 403);
  return null;
}

// 全ユーザー一覧（権限・塗り数・ポイント/レベルを結合して返す）。塗りセル数の多い順。
adminRouter.get("/users", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const users = await db
    .select({
      id: user.id,
      name: user.name,
      realName: user.realName,
      email: user.email,
      role: user.role,
      country: user.country,
      createdAt: user.createdAt,
    })
    .from(user);

  // ユーザーごとの塗りセル数（gps / manual 内訳つき）
  const counts = await db
    .select({
      userId: paintedRegions.userId,
      total: sql<number>`count(*)::int`,
      gps: sql<number>`(count(*) filter (where ${paintedRegions.mode} = 'gps'))::int`,
    })
    .from(paintedRegions)
    .groupBy(paintedRegions.userId);

  const points = await db.select().from(userPoints);

  const countMap = new Map(counts.map((r) => [r.userId, r]));
  const pointMap = new Map(points.map((r) => [r.userId, r]));

  const result = users.map((u) => {
    const cnt = countMap.get(u.id);
    const pt = pointMap.get(u.id);
    const total = cnt?.total ?? 0;
    const gps = cnt?.gps ?? 0;
    return {
      id: u.id,
      name: u.name,
      realName: u.realName,
      email: u.email,
      role: u.role,
      country: u.country,
      createdAt: u.createdAt,
      painted: { total, gps, manual: total - gps },
      points: pt
        ? { points: pt.points, level: pt.level, exp: pt.exp }
        : null,
      playTimeSec: pt?.playTimeSec ?? 0,
    };
  });
  result.sort((a, b) => b.painted.total - a.painted.total);

  return c.json({ users: result });
});

// 全体統計（ユーザー数・権限内訳・塗りセル合計）。
adminRouter.get("/stats", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const [users] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(user);

  const byRole = await db
    .select({ role: user.role, count: sql<number>`count(*)::int` })
    .from(user)
    .groupBy(user.role);

  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      gps: sql<number>`(count(*) filter (where ${paintedRegions.mode} = 'gps'))::int`,
    })
    .from(paintedRegions);

  const total = agg?.total ?? 0;
  const gps = agg?.gps ?? 0;

  return c.json({
    users: { total: users?.total ?? 0, byRole },
    painted: { total, gps, manual: total - gps },
  });
});

// 権限変更。role は 'user' | 'developer' のみ許可。
adminRouter.post("/users/:id/role", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as { role?: unknown } | null;
  const role = body?.role;
  if (role !== "user" && role !== "developer") {
    return c.json({ error: "bad request" }, 400);
  }

  const updated = await db
    .update(user)
    .set({ role, updatedAt: new Date() })
    .where(eq(user.id, id))
    .returning({ id: user.id });
  if (updated.length === 0) return c.json({ error: "not found" }, 404);

  return c.json({ ok: true, id, role });
});

// ポイント / レベル / 経験値を任意の値にセットする（指定したフィールドのみ更新）。
adminRouter.post("/users/:id/points", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const id = c.req.param("id");
  const exists = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, id));
  if (exists.length === 0) return c.json({ error: "not found" }, 404);

  const body = (await c.req.json().catch(() => null)) as
    | { points?: unknown; level?: unknown; exp?: unknown }
    | null;

  const fields: { points?: number; level?: number; exp?: number } = {};
  for (const key of ["points", "level", "exp"] as const) {
    const raw = body?.[key];
    if (raw === undefined) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return c.json({ error: "bad request" }, 400);
    if (key === "level" && v < 1) return c.json({ error: "bad request" }, 400);
    fields[key] = Math.floor(v);
  }
  if (Object.keys(fields).length === 0) {
    return c.json({ error: "bad request" }, 400);
  }

  const now = Date.now();
  await ensurePoints(id, now); // 行が無ければ初期化（回復時計も now 基準になる）
  await db
    .update(userPoints)
    .set({ ...fields, updatedAt: new Date(now) })
    .where(eq(userPoints.userId, id));

  const state = await ensurePoints(id, now);
  return c.json({ ok: true, points: state });
});

// 特定ユーザーの塗りを全消去する（運用メンテ用）。ポイントは返金しない。
adminRouter.delete("/users/:id/painted", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const id = c.req.param("id");
  const deleted = await db
    .delete(paintedRegions)
    .where(eq(paintedRegions.userId, id))
    .returning({ id: paintedRegions.id });
  return c.json({ ok: true, deleted: deleted.length });
});

// limit（既定100・上限200）と beforeId（id < beforeId のカーソル）を取り出す。
function parsePaging(c: Context): { limit: number; beforeId: number | null } {
  const limitRaw = Number(c.req.query("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 100;
  const beforeRaw = Number(c.req.query("beforeId"));
  const beforeId =
    Number.isFinite(beforeRaw) && beforeRaw > 0 ? Math.floor(beforeRaw) : null;
  return { limit, beforeId };
}

// ユーザー行動ログ（user_logs）を新しい順で返す。userId / action / カーソルで絞り込める。
adminRouter.get("/logs", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const { limit, beforeId } = parsePaging(c);
  const userId = c.req.query("userId");
  const action = c.req.query("action");

  // 絞り込み条件（カーソル beforeId を含まない）。総件数の集計にも使う。
  const filterConds = [];
  if (userId) filterConds.push(eq(userLogs.userId, userId));
  if (action) filterConds.push(eq(userLogs.action, action));

  const conds = [...filterConds];
  if (beforeId !== null) conds.push(lt(userLogs.id, beforeId));

  const rows = await db
    .select({
      id: userLogs.id,
      userId: userLogs.userId,
      userName: user.name,
      userEmail: user.email,
      action: userLogs.action,
      ipAddress: userLogs.ipAddress,
      userAgent: userLogs.userAgent,
      lat: userLogs.lat,
      lng: userLogs.lng,
      municipality: userLogs.municipality,
      meta: userLogs.meta,
      createdAt: userLogs.createdAt,
    })
    .from(userLogs)
    .leftJoin(user, eq(userLogs.userId, user.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(userLogs.id))
    .limit(limit);

  // 絞り込み後の総件数（カーソル非依存）。ページャーの「全N件」表示用。
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(userLogs)
    .where(filterConds.length ? and(...filterConds) : undefined);

  return c.json({ logs: rows, total });
});

// 動画リワード広告の集計。user_logs（action='video_reward'）を meta.event ごとに
// 集計し、ボタン押下→視聴完了のファネルを返す。?days=N で直近 N 日に絞れる（既定は全期間）。
adminRouter.get("/video-stats", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const daysRaw = Number(c.req.query("days"));
  const days =
    Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(365, Math.floor(daysRaw)) : null;

  const conds = [eq(userLogs.action, "video_reward")];
  if (days !== null) {
    conds.push(
      sql`${userLogs.createdAt} >= now() - (${days} * interval '1 day')`
    );
  }

  // meta->>'event' ごとの件数・ユニークユーザー数。
  const rows = await db
    .select({
      event: sql<string>`${userLogs.meta}->>'event'`,
      count: sql<number>`count(*)::int`,
      users: sql<number>`count(distinct ${userLogs.userId})::int`,
    })
    .from(userLogs)
    .where(and(...conds))
    .groupBy(sql`${userLogs.meta}->>'event'`);

  // event → {count, users} のマップに整える（null event は "unknown" にまとめる）。
  const byEvent: Record<string, { count: number; users: number }> = {};
  for (const r of rows) {
    const key = r.event ?? "unknown";
    byEvent[key] = { count: r.count, users: r.users };
  }
  const cnt = (k: string) => byEvent[k]?.count ?? 0;

  const start = cnt("start");
  const granted = cnt("granted");
  const dismissed = cnt("dismissed");
  const unavailable = cnt("unavailable");
  const error = cnt("error");
  const cooldown = cnt("cooldown");
  const dailyLimit = cnt("daily_limit");
  const nonceError = cnt("nonce_error");
  const claimFailed = cnt("claim_failed");

  return c.json({
    days,
    byEvent,
    funnel: {
      start, // 「動画を見る」ボタン押下
      granted, // 視聴完了＋報酬付与
      dismissed, // 途中キャンセル
      unavailable, // 在庫なし・非対応・タイムアウト
      error, // 想定外エラー
      cooldown, // クールダウンで弾かれた（広告未表示）
      dailyLimit, // 1日上限で弾かれた（広告未表示）
      nonceError, // nonce 発行のその他失敗
      claimFailed, // 視聴後の報酬請求失敗
      // 完了率＝報酬付与 / ボタン押下（押下が無ければ null）。
      completionRate: start > 0 ? granted / start : null,
    },
  });
});

// 塗りログ（painted_regions）を新しい順で返す。塗りの文脈（ip/ua/位置/市町村）つき。
adminRouter.get("/painted", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const { limit, beforeId } = parsePaging(c);
  const userId = c.req.query("userId");

  // 絞り込み条件（カーソル beforeId を含まない）。総件数の集計にも使う。
  const filterConds = [];
  if (userId) filterConds.push(eq(paintedRegions.userId, userId));

  const conds = [...filterConds];
  if (beforeId !== null) conds.push(lt(paintedRegions.id, beforeId));

  const rows = await db
    .select({
      id: paintedRegions.id,
      userId: paintedRegions.userId,
      userName: user.name,
      userEmail: user.email,
      sourceLayer: paintedRegions.sourceLayer,
      keyCode: paintedRegions.keyCode,
      mode: paintedRegions.mode,
      ipAddress: paintedRegions.ipAddress,
      userAgent: paintedRegions.userAgent,
      lat: paintedRegions.lat,
      lng: paintedRegions.lng,
      municipality: paintedRegions.municipality,
      country: paintedRegions.country,
      paintedAt: paintedRegions.paintedAt,
    })
    .from(paintedRegions)
    .leftJoin(user, eq(paintedRegions.userId, user.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(paintedRegions.id))
    .limit(limit);

  // 絞り込み後の総件数（カーソル非依存）。ページャーの「全N件」表示用。
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(paintedRegions)
    .where(filterConds.length ? and(...filterConds) : undefined);

  return c.json({ painted: rows, total });
});
