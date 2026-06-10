import { Hono } from "hono";
import { and, eq, ne, sql } from "drizzle-orm";
import { getSessionUser } from "../lib/auth.js";
import { db } from "../db/index.js";
import { paintedRegions, user, userPoints } from "../db/schema.js";
// 各種ランキング（塗ったマス数・GPS訪問・市区町村数・レベル・プレイ時間）を返す公開 API。
// Next.js の rewrite 経由で /api/backend/rankings から到達する。
// 開発者（role='developer'）はランキングから除外する。
export const rankingsRouter = new Hono();
// 各ランキングで返す上位件数。
const LIMIT = 100;
// 全ユーザーを sortKey の降順に並べ、上位 LIMIT 件と（指定があれば）自分の順位を返す。
// rank は 0 を含めた全体での順位。display は表示する値、minValue 未満は一覧から除く。
function buildBoard(users, sortKey, display, meId, minValue = 1) {
    const sorted = [...users].sort((a, b) => sortKey(b) - sortKey(a));
    const top = [];
    let me = null;
    for (let i = 0; i < sorted.length; i++) {
        const u = sorted[i];
        const value = display(u);
        const entry = { rank: i + 1, userId: u.id, name: u.name, value };
        if (i < LIMIT && value >= minValue)
            top.push(entry);
        // 自分はランキング外（top 100 外・値0）でも順位を返す（パネル最下部に表示するため）。
        if (meId && u.id === meId)
            me = entry;
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
    const sinceCond = period === "week"
        ? sql `${paintedRegions.paintedAt} >= now() - interval '7 days'`
        : period === "month"
            ? sql `${paintedRegions.paintedAt} >= now() - interval '30 days'`
            : undefined;
    // 開発者を除く全ユーザー（レベル・累計経験値つき）。
    const users = await db
        .select({
        id: user.id,
        name: user.name,
        level: userPoints.level,
        totalExp: userPoints.totalExp,
        playTimeSec: userPoints.playTimeSec,
    })
        .from(user)
        .leftJoin(userPoints, eq(userPoints.userId, user.id))
        .where(ne(user.role, "developer"));
    // ユーザーごとの塗り集計（合計・GPS・訪れた市区町村数）。
    const counts = await db
        .select({
        userId: paintedRegions.userId,
        total: sql `count(*)::int`,
        gps: sql `(count(*) filter (where ${paintedRegions.mode} = 'gps'))::int`,
        muni: sql `count(distinct ${paintedRegions.municipality})::int`,
    })
        .from(paintedRegions)
        .where(sinceCond)
        .groupBy(paintedRegions.userId);
    const countMap = new Map(counts.map((r) => [r.userId, r]));
    const painted = (u) => countMap.get(u.id)?.total ?? 0;
    const gps = (u) => countMap.get(u.id)?.gps ?? 0;
    const muni = (u) => countMap.get(u.id)?.muni ?? 0;
    // レベル順位はレベル優先・同レベルは累計経験値で並べる（表示はレベルのみ）。
    const levelKey = (u) => (u.level ?? 1) * 1e12 + (u.totalExp ?? 0);
    const level = (u) => u.level ?? 1;
    // プレイ時間（秒）。累計値なのでレベルと同じく常に全期間で並べる。
    const playtime = (u) => u.playTimeSec ?? 0;
    return c.json({
        totalUsers: users.length,
        boards: {
            painted: buildBoard(users, painted, painted, meId),
            gps: buildBoard(users, gps, gps, meId),
            muni: buildBoard(users, muni, muni, meId),
            level: buildBoard(users, levelKey, level, meId),
            playtime: buildBoard(users, playtime, playtime, meId),
        },
    });
});
// 地域（都道府県／国）を1つ選び、その地域内で塗ったマス数のユーザーランキングを返す。
// type=pref … municipality "PREF|CITY" の PREF 部分でグルーピング（key は都道府県名）。
// type=country … country（Natural Earth の adm0_a3）でグルーピング（key は国コード）。
// regions … 選択用ドロップダウン向けに、塗りのある地域を総マス数の多い順で返す。
// key … 集計対象の地域。未指定なら regions の先頭（最も塗られた地域）を既定にする。
// period … "/" と同じく week=直近7日 / month=直近30日 / それ以外=全期間。
rankingsRouter.get("/region", async (c) => {
    const sessionUser = await getSessionUser(c.req.raw);
    const meId = sessionUser?.id ?? null;
    const type = c.req.query("type") === "country" ? "country" : "pref";
    const period = c.req.query("period");
    const sinceCond = period === "week"
        ? sql `${paintedRegions.paintedAt} >= now() - interval '7 days'`
        : period === "month"
            ? sql `${paintedRegions.paintedAt} >= now() - interval '30 days'`
            : undefined;
    // 地域キー（都道府県名 or 国コード）を取り出す式と、その値が有効である条件。
    const regionExpr = type === "country"
        ? sql `${paintedRegions.country}`
        : sql `split_part(${paintedRegions.municipality}, '|', 1)`;
    const regionValid = type === "country"
        ? sql `${paintedRegions.country} is not null and ${paintedRegions.country} <> ''`
        : sql `${paintedRegions.municipality} is not null and split_part(${paintedRegions.municipality}, '|', 1) <> ''`;
    // 選択用の地域一覧（開発者を除く塗りの総マス数が多い順）。
    const regionRows = await db
        .select({
        key: sql `${regionExpr}`.as("key"),
        count: sql `count(*)::int`,
    })
        .from(paintedRegions)
        .innerJoin(user, eq(user.id, paintedRegions.userId))
        .where(and(regionValid, ne(user.role, "developer")))
        .groupBy(regionExpr)
        .orderBy(sql `count(*) desc`);
    const selectedKey = c.req.query("key") || regionRows[0]?.key || null;
    if (!selectedKey) {
        return c.json({ key: null, regions: regionRows, board: { top: [], me: null } });
    }
    // 選択地域内・期間内のユーザーごとの塗りマス数（開発者を除く）。
    const rows = await db
        .select({
        userId: paintedRegions.userId,
        name: user.name,
        value: sql `count(*)::int`,
    })
        .from(paintedRegions)
        .innerJoin(user, eq(user.id, paintedRegions.userId))
        .where(and(regionValid, sql `${regionExpr} = ${selectedKey}`, ne(user.role, "developer"), sinceCond))
        .groupBy(paintedRegions.userId, user.name);
    rows.sort((a, b) => b.value - a.value);
    const top = [];
    let me = null;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const entry = { rank: i + 1, userId: r.userId, name: r.name, value: r.value };
        if (i < LIMIT)
            top.push(entry);
        if (meId && r.userId === meId)
            me = entry;
    }
    // この地域を1マスも塗っていない自分も最下部に順位を出す（値0・塗った人の次の順位）。
    // 開発者はランキング対象外なので me も付けない。
    if (meId && !me) {
        const [self] = await db
            .select({ name: user.name, role: user.role })
            .from(user)
            .where(eq(user.id, meId));
        if (self && self.role !== "developer") {
            me = { rank: rows.length + 1, userId: meId, name: self.name, value: 0 };
        }
    }
    return c.json({ key: selectedKey, regions: regionRows, board: { top, me } });
});
