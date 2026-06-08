import { Hono } from "hono";
import { eq, ne, sql } from "drizzle-orm";
import { getSessionUser } from "../lib/auth.js";
import { db } from "../db/index.js";
import { paintedRegions, user, userPoints } from "../db/schema.js";

// 各種ランキング（塗ったマス数・GPS訪問・市区町村数・レベル）を返す公開 API。
// Next.js の rewrite 経由で /api/backend/rankings から到達する。
// 開発者（role='developer'）はランキングから除外する。
export const rankingsRouter = new Hono();

// 各ランキングで返す上位件数。
const LIMIT = 100;

type Entry = { rank: number; userId: string; name: string; value: number };
type Board = { top: Entry[]; me: Entry | null };
type RankUser = {
  id: string;
  name: string;
  level: number | null;
  totalExp: number | null;
};

// 全ユーザーを sortKey の降順に並べ、上位 LIMIT 件と（指定があれば）自分の順位を返す。
// rank は 0 を含めた全体での順位。display は表示する値、minValue 未満は一覧から除く。
function buildBoard(
  users: RankUser[],
  sortKey: (u: RankUser) => number,
  display: (u: RankUser) => number,
  meId: string | null,
  minValue = 1
): Board {
  const sorted = [...users].sort((a, b) => sortKey(b) - sortKey(a));
  const top: Entry[] = [];
  let me: Entry | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i];
    const value = display(u);
    const entry: Entry = { rank: i + 1, userId: u.id, name: u.name, value };
    if (i < LIMIT && value >= minValue) top.push(entry);
    if (meId && u.id === meId && value >= minValue) me = entry;
  }
  return { top, me };
}

rankingsRouter.get("/", async (c) => {
  const sessionUser = await getSessionUser(c.req.raw);
  const meId = sessionUser?.id ?? null;

  // 集計期間。塗り由来のランキング（塗ったマス・GPS・市区町村）にだけ効く。
  // 'week'=直近7日 / 'month'=直近30日 / それ以外=全期間。レベルは累計値なので
  // 期間に関係なく常に全期間で並べる。
  const period = c.req.query("period");
  const sinceCond =
    period === "week"
      ? sql`${paintedRegions.paintedAt} >= now() - interval '7 days'`
      : period === "month"
        ? sql`${paintedRegions.paintedAt} >= now() - interval '30 days'`
        : undefined;

  // 開発者を除く全ユーザー（レベル・累計経験値つき）。
  const users: RankUser[] = await db
    .select({
      id: user.id,
      name: user.name,
      level: userPoints.level,
      totalExp: userPoints.totalExp,
    })
    .from(user)
    .leftJoin(userPoints, eq(userPoints.userId, user.id))
    .where(ne(user.role, "developer"));

  // ユーザーごとの塗り集計（合計・GPS・訪れた市区町村数）。
  const counts = await db
    .select({
      userId: paintedRegions.userId,
      total: sql<number>`count(*)::int`,
      gps: sql<number>`(count(*) filter (where ${paintedRegions.mode} = 'gps'))::int`,
      muni: sql<number>`count(distinct ${paintedRegions.municipality})::int`,
    })
    .from(paintedRegions)
    .where(sinceCond)
    .groupBy(paintedRegions.userId);
  const countMap = new Map(counts.map((r) => [r.userId, r]));

  const painted = (u: RankUser) => countMap.get(u.id)?.total ?? 0;
  const gps = (u: RankUser) => countMap.get(u.id)?.gps ?? 0;
  const muni = (u: RankUser) => countMap.get(u.id)?.muni ?? 0;
  // レベル順位はレベル優先・同レベルは累計経験値で並べる（表示はレベルのみ）。
  const levelKey = (u: RankUser) => (u.level ?? 1) * 1e12 + (u.totalExp ?? 0);
  const level = (u: RankUser) => u.level ?? 1;

  return c.json({
    boards: {
      painted: buildBoard(users, painted, painted, meId),
      gps: buildBoard(users, gps, gps, meId),
      muni: buildBoard(users, muni, muni, meId),
      level: buildBoard(users, levelKey, level, meId),
    },
  });
});
