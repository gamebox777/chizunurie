import { Hono } from "hono";
import type { Context } from "hono";
import { and, asc, desc, eq, sql, type AnyColumn } from "drizzle-orm";
import { getSessionUser, isDeveloper } from "../lib/auth.js";
import { db } from "../db/index.js";
import {
  paintedRegions,
  siteVisits,
  user,
  userLogs,
  userPoints,
} from "../db/schema.js";
import { ensurePoints } from "../lib/points.js";
import { jstDateKey } from "../lib/time.js";

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
      lastIpAddress: user.lastIpAddress,
      lastUserAgent: user.lastUserAgent,
      lastLat: user.lastLat,
      lastLng: user.lastLng,
      adSettings: user.adSettings,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
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
      lastIpAddress: u.lastIpAddress,
      lastUserAgent: u.lastUserAgent,
      lastLat: u.lastLat,
      lastLng: u.lastLng,
      adSettings: u.adSettings ?? {},
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
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

// サイトへのアクセス数（site_visits）の集計。アクセス数（ページ表示・延べ）と
// ユニークユーザー数の両方について、累計・今日・直近7日・日別を返す。
adminRouter.get("/access-stats", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  // 直近30日ぶんの日別（新しい順）。views=その日の表示回数合計、
  // uniques=その日のユニーク訪問者数（(date,visitor) が一意なので行数）。
  const daily = await db
    .select({
      date: siteVisits.date,
      views: sql<number>`sum(${siteVisits.count})::int`,
      uniques: sql<number>`count(*)::int`,
    })
    .from(siteVisits)
    .groupBy(siteVisits.date)
    .orderBy(desc(siteVisits.date))
    .limit(30);

  // 全期間の累計（ユニークは訪問者の distinct 数）。
  const [allTime] = await db
    .select({
      views: sql<number>`coalesce(sum(${siteVisits.count}), 0)::int`,
      uniques: sql<number>`count(distinct ${siteVisits.visitor})::int`,
    })
    .from(siteVisits);

  // 直近7日（今日を含む）の累計。ユニークは7日間にまたがる distinct なので
  // 日別の単純合計では出せない（別クエリで distinct を取る）。
  const since7 = jstDateKey(Date.now() - 6 * 86400000);
  const [week] = await db
    .select({
      views: sql<number>`coalesce(sum(${siteVisits.count}), 0)::int`,
      uniques: sql<number>`count(distinct ${siteVisits.visitor})::int`,
    })
    .from(siteVisits)
    .where(sql`${siteVisits.date} >= ${since7}`);

  const today = jstDateKey();
  const todayRow = daily.find((d) => d.date === today);

  return c.json({
    views: {
      total: allTime?.views ?? 0,
      today: todayRow?.views ?? 0,
      last7: week?.views ?? 0,
    },
    uniques: {
      total: allTime?.uniques ?? 0,
      today: todayRow?.uniques ?? 0,
      last7: week?.uniques ?? 0,
    },
    daily, // 新しい順・最大30件（date, views, uniques）
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

// ユーザー個別の Web 広告配信の上書き設定（user.ad_settings）を更新する。
// body: { auto?: boolean | null, reward?: boolean | null }
//   true/false … 全体設定を上書きして強制 ON / OFF
//   null       … 上書きを解除して全体設定（app_settings.webAds）に従う
//   undefined（キー無し）… その項目は変更しない
adminRouter.post("/users/:id/ads", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as
    | { auto?: unknown; reward?: unknown }
    | null;
  if (!body) return c.json({ error: "bad request" }, 400);

  const rows = await db
    .select({ adSettings: user.adSettings })
    .from(user)
    .where(eq(user.id, id));
  if (rows.length === 0) return c.json({ error: "not found" }, 404);

  const next = { ...((rows[0].adSettings ?? {}) as Record<string, unknown>) };
  let touched = false;
  for (const key of ["auto", "reward"] as const) {
    const raw = body[key];
    if (raw === undefined) continue;
    if (raw === null) delete next[key]; // 上書き解除＝全体設定に従う
    else if (typeof raw === "boolean") next[key] = raw;
    else return c.json({ error: "bad request" }, 400);
    touched = true;
  }
  if (!touched) return c.json({ error: "bad request" }, 400);

  await db
    .update(user)
    .set({ adSettings: next, updatedAt: new Date() })
    .where(eq(user.id, id));
  return c.json({ ok: true, id, adSettings: next });
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

// ユーザーを関連データごと完全削除する。session / account / painted_regions /
// user_logs / user_points は外部キーの ON DELETE CASCADE で自動的に消える。
// site_visits は user への FK を持たない（visitor 列が "u:<userId>"）ので、
// ここで明示的に該当行を削除する。better-auth のテーブルも CASCADE で消える。
adminRouter.delete("/users/:id", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const id = c.req.param("id");

  // 自分自身は削除させない（管理画面からログイン中の開発者が誤って消すのを防ぐ）。
  const me = await getSessionUser(c.req.raw);
  if (me?.id === id) {
    return c.json({ error: "cannot delete yourself" }, 400);
  }

  // FK を持たない site_visits の該当行を先に消す。
  await db.delete(siteVisits).where(eq(siteVisits.visitor, `u:${id}`));

  // user 本体を削除（関連テーブルは CASCADE で連鎖削除）。
  const deleted = await db
    .delete(user)
    .where(eq(user.id, id))
    .returning({ id: user.id });
  if (deleted.length === 0) return c.json({ error: "not found" }, 404);

  return c.json({ ok: true, id });
});

// 一覧 API 共通のクエリ（limit 既定100・上限200、offset、ソート列キーと方向）を取り出す。
// 任意の列でソートできるようにするため、ページングはカーソル（beforeId）でなく offset。
function parseListQuery(c: Context): {
  limit: number;
  offset: number;
  sort: string | null;
  dir: "asc" | "desc";
} {
  const limitRaw = Number(c.req.query("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 100;
  const offsetRaw = Number(c.req.query("offset"));
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
  const sort = c.req.query("sort") ?? null;
  const dir = c.req.query("dir") === "asc" ? "asc" : "desc";
  return { limit, offset, sort, dir };
}

// sort キー（ホワイトリスト）から ORDER BY を組み立てる。並びを安定させるため
// 第2キーとして常に id の降順を添える。未知のキーは fallback（id ＝新しい順）に倒す。
function buildOrderBy(
  sortable: Record<string, AnyColumn>,
  sort: string | null,
  dir: "asc" | "desc",
  idColumn: AnyColumn
) {
  const col = (sort && sortable[sort]) || idColumn;
  return [dir === "asc" ? asc(col) : desc(col), desc(idColumn)];
}

// /logs でソートを許可する列（フロントの列 id → DB 列）。
const LOG_SORTABLE: Record<string, AnyColumn> = {
  date: userLogs.id, // 日時順 ≒ id 順（同時刻でも安定する）
  user: user.name,
  action: userLogs.action,
  platform: userLogs.platform,
  municipality: userLogs.municipality,
  ip: userLogs.ipAddress,
  userAgent: userLogs.userAgent,
  url: userLogs.url,
};

// ユーザー行動ログ（user_logs）を返す（既定は新しい順）。userId / action で絞り込め、
// sort / dir / offset で任意の列のソートとページ送りができる。
adminRouter.get("/logs", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const { limit, offset, sort, dir } = parseListQuery(c);
  const userId = c.req.query("userId");
  const action = c.req.query("action");

  // 絞り込み条件。総件数の集計にも使う。
  const filterConds = [];
  if (userId) filterConds.push(eq(userLogs.userId, userId));
  if (action) filterConds.push(eq(userLogs.action, action));

  const conds = [...filterConds];

  const rows = await db
    .select({
      id: userLogs.id,
      userId: userLogs.userId,
      userName: user.name,
      userEmail: user.email,
      action: userLogs.action,
      ipAddress: userLogs.ipAddress,
      userAgent: userLogs.userAgent,
      platform: userLogs.platform,
      appVersion: userLogs.appVersion,
      lat: userLogs.lat,
      lng: userLogs.lng,
      municipality: userLogs.municipality,
      meta: userLogs.meta,
      url: userLogs.url,
      environment: userLogs.environment,
      createdAt: userLogs.createdAt,
    })
    .from(userLogs)
    .leftJoin(user, eq(userLogs.userId, user.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(...buildOrderBy(LOG_SORTABLE, sort, dir, userLogs.id))
    .limit(limit)
    .offset(offset);

  // 絞り込み後の総件数。ページャーの「全N件」表示用。
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

  // 失敗の具体的な原因の内訳。unavailable/error は meta.detail（ready_timeout・
  // gpt_load_failed・load_failed 等）、claim_failed は meta.reason を原因として数える。
  const detailRows = await db
    .select({
      event: sql<string>`${userLogs.meta}->>'event'`,
      detail: sql<string>`coalesce(${userLogs.meta}->>'detail', ${userLogs.meta}->>'reason')`,
      count: sql<number>`count(*)::int`,
      users: sql<number>`count(distinct ${userLogs.userId})::int`,
      lastAt: sql<string>`max(${userLogs.createdAt})::text`,
    })
    .from(userLogs)
    .where(
      and(
        ...conds,
        sql`coalesce(${userLogs.meta}->>'detail', ${userLogs.meta}->>'reason') is not null`
      )
    )
    .groupBy(
      sql`${userLogs.meta}->>'event'`,
      sql`coalesce(${userLogs.meta}->>'detail', ${userLogs.meta}->>'reason')`
    )
    .orderBy(sql`count(*) desc`);

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
    details: detailRows,
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

// /painted でソートを許可する列（フロントの列 id → DB 列）。
const PAINTED_SORTABLE: Record<string, AnyColumn> = {
  date: paintedRegions.id, // 塗った順 ≒ id 順（paintedAt が null の旧行も安定する）
  user: user.name,
  keyCode: paintedRegions.keyCode,
  mode: paintedRegions.mode,
  country: paintedRegions.country,
  municipality: paintedRegions.municipality,
};

// 塗りログ（painted_regions）を返す（既定は新しい順）。塗りの文脈（位置/市町村）つき。
// userId / mode で絞り込め、sort / dir / offset で任意の列のソートとページ送りができる。
adminRouter.get("/painted", async (c) => {
  const guard = await requireDeveloper(c);
  if (guard) return guard;

  const { limit, offset, sort, dir } = parseListQuery(c);
  const userId = c.req.query("userId");
  // モード絞り込み（gps / manual）。それ以外の値は無視してすべて返す。
  const mode = c.req.query("mode");

  // 絞り込み条件。総件数の集計にも使う。
  const filterConds = [];
  if (userId) filterConds.push(eq(paintedRegions.userId, userId));
  if (mode === "gps" || mode === "manual")
    filterConds.push(eq(paintedRegions.mode, mode));

  const conds = [...filterConds];

  const rows = await db
    .select({
      id: paintedRegions.id,
      userId: paintedRegions.userId,
      userName: user.name,
      userEmail: user.email,
      sourceLayer: paintedRegions.sourceLayer,
      keyCode: paintedRegions.keyCode,
      mode: paintedRegions.mode,
      lat: paintedRegions.lat,
      lng: paintedRegions.lng,
      municipality: paintedRegions.municipality,
      country: paintedRegions.country,
      paintedAt: paintedRegions.paintedAt,
    })
    .from(paintedRegions)
    .leftJoin(user, eq(paintedRegions.userId, user.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(...buildOrderBy(PAINTED_SORTABLE, sort, dir, paintedRegions.id))
    .limit(limit)
    .offset(offset);

  // 絞り込み後の総件数。ページャーの「全N件」表示用。
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(paintedRegions)
    .where(filterConds.length ? and(...filterConds) : undefined);

  return c.json({ painted: rows, total });
});
