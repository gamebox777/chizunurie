import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getSessionUser, isDeveloper } from "../lib/auth.js";
import { db } from "../db/index.js";
import { paintedRegions, user as userTable } from "../db/schema.js";
import { ALLOWED_COSTS, COST_ADJACENT, addExp, ensurePoints, getExpConfig, spendPoints, } from "../lib/points.js";
export const paintedRouter = new Hono();
// 'mesh' が現行の塗り単位。'municipalities'/'chocho' は旧データ互換のため許可
const ALLOWED_LAYERS = new Set(["mesh", "municipalities", "chocho"]);
const ALLOWED_MODES = new Set(["gps", "manual"]);
async function requireUser(req) {
    return getSessionUser(req);
}
// 緯度経度の妥当性チェック（範囲外・非数値は null）。塗った位置の記録用。
function toCoord(v, max) {
    if (typeof v !== "number" || !Number.isFinite(v))
        return null;
    if (v < -max || v > max)
        return null;
    return v;
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
    // bulk: 外国 10×10 まとめ塗りの「残り」セル。代表1セルだけが課金＆経験値を得て、
    // 残りはこのフラグで無料・経験値なしに塗る（manual の新規 insert のみ意味を持つ）。
    const bulk = body.bulk === true;
    // subIndex: GPS歩き塗りで「1kmセル内のどの細セル（125m = 8×8=64 分割）を踏んだか」（0..63）。
    // mode='gps' のときだけ意味を持つ。省略時（旧クライアント・まとめ塗り等）は null＝細セル指定なし
    // で、その場合は1kmを「全面塗り」として扱う（walked_mask=0・従来の挙動）。
    const subIndex = typeof body.subIndex === "number" &&
        Number.isInteger(body.subIndex) &&
        body.subIndex >= 0 &&
        body.subIndex < 64
        ? body.subIndex
        : null;
    // 塗った時点の文脈（任意）。新規 insert のときだけ保存する。
    const lat = toCoord(body.lat, 90);
    const lng = toCoord(body.lng, 180);
    const municipality = typeof body.municipality === "string" && body.municipality.length <= 128
        ? body.municipality
        : null;
    // 世界版の州・県コード（adm1_code）。日本の外を塗った時だけ入る。
    const region = typeof body.region === "string" && body.region.length <= 32
        ? body.region
        : null;
    // 塗った国（adm0_a3。日本は "JPN"）。管理画面の塗りログ表示用。GPS かどうかに関わらず
    // 「そのタイルが所属する国」を必ず記録する。クライアントが country を送ってこなくても、
    // 市区町村（muni）が取れていれば日本＝"JPN" とサーバー側で補完する（古いクライアント対策）。
    const country = typeof body.country === "string" && body.country.length <= 8
        ? body.country
        : municipality
            ? "JPN"
            : null;
    return { sourceLayer, keyCode, mode: resolvedMode, cost: resolvedCost, bulk, subIndex, lat, lng, municipality, region, country };
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
        municipality: paintedRegions.municipality,
        region: paintedRegions.region,
        walkedMask: paintedRegions.walkedMask,
        paintedAt: paintedRegions.paintedAt,
    })
        .from(paintedRegions)
        .where(eq(paintedRegions.userId, user.id));
    // walked_mask は 64 ビット（bigint）。JSON 数値は安全に表せないので文字列で返す。
    // クライアントは BigInt(walkedMask) で復元する。0（全面塗り）も "0" で返る。
    return c.json({
        painted: rows.map((r) => ({ ...r, walkedMask: r.walkedMask.toString() })),
    });
});
paintedRouter.post("/", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    const parsed = parseBody(await c.req.json().catch(() => null));
    if (!parsed)
        return c.json({ error: "invalid body" }, 400);
    // cost===0 は無料デバッグ塗り（Shift+クリック）。開発者のみ許可する。
    if (parsed.cost === 0 && !isDeveloper(user)) {
        return c.json({ error: "forbidden" }, 403);
    }
    const now = Date.now();
    // 塗った時点の文脈（新規 insert のときだけ保存）。
    // ip/ua はデータ量削減のため塗りログには保存しない。
    const context = {
        lat: parsed.lat,
        lng: parsed.lng,
        municipality: parsed.municipality,
        region: parsed.region,
        country: parsed.country,
    };
    // 経験値・レベル設定を1回だけ読む（トランザクション内で渡して再読みを防ぐ）。
    const expCfg = await getExpConfig();
    if (parsed.lat !== null && parsed.lng !== null) {
        try {
            await db
                .update(userTable)
                .set({
                lastLat: parsed.lat,
                lastLng: parsed.lng,
                updatedAt: new Date(now),
            })
                .where(eq(userTable.id, user.id));
        }
        catch (err) {
            console.warn("failed to update user last coordinates", err);
        }
    }
    if (parsed.mode === "gps") {
        // GPS（実際の移動）はポイント無料。最優先なので既存（manual含む）があれば gps に昇格。
        // 「実際に訪れる」と経験値を獲得する。歩き塗りは1kmを 8×8=64 の細セル（125m）に分け、
        // walked_mask に踏んだ細セル（subIndex）のビットを立てる：
        //   ・新規1km（行の新規 insert）        … 1km初訪問 expVisit ＋ 細セル初 expFine
        //   ・取得済み1km内で新しい細セルを踏む   … 細セル初 expFine（1kmは既に取得済みなので初訪問XPは無し）
        //   ・全面セル(mask=0：手動/旧GPS/まとめ) … 細分化しない。manual→gps昇格 or 再訪で expVisit
        //   ・既に踏んだ細セルへ入り直し         … 再訪扱い。クールダウン経過時のみ expVisit
        // subIndex 無し（旧クライアント等）は bit=0 として「全面塗り」扱い（従来挙動）。
        // ※ Postgres の bigint は符号付き64bit なので、subIndex=63（最上位ビット=2^63）は
        //   そのままだと範囲外になる。マスクの計算は符号なし64bit（asUintN）で行い、DB へ書く
        //   ときだけ符号付き64bit（asIntN）へ畳む。読み出した値も asUintN で符号なしに戻す。
        const cellWhere = and(eq(paintedRegions.userId, user.id), eq(paintedRegions.sourceLayer, parsed.sourceLayer), eq(paintedRegions.keyCode, parsed.keyCode));
        const bit = parsed.subIndex !== null ? 1n << BigInt(parsed.subIndex) : 0n; // 符号なし（0..2^63）
        const result = await db.transaction(async (tx) => {
            const inserted = await tx
                .insert(paintedRegions)
                .values({
                userId: user.id,
                sourceLayer: parsed.sourceLayer,
                keyCode: parsed.keyCode,
                mode: "gps",
                walkedMask: BigInt.asIntN(64, bit), // 符号付き64bit へ畳んで保存
                lastVisitAt: new Date(now),
                ...context,
            })
                .onConflictDoNothing()
                .returning({ id: paintedRegions.id });
            if (inserted.length > 0) {
                // 新規1kmを訪問 → 1km初訪問 ＋ 細セルを踏んでいれば細セル初
                const gained = expCfg.expVisit + (bit !== 0n ? expCfg.expFine : 0);
                const state = await addExp(user.id, gained, now, tx, expCfg);
                return { ok: true, points: state, gainedExp: gained };
            }
            // 既存セル：現在のモード・最終訪問・歩いた細セルマスクを読む。
            const existing = await tx
                .select({
                mode: paintedRegions.mode,
                lastVisitAt: paintedRegions.lastVisitAt,
                walkedMask: paintedRegions.walkedMask,
            })
                .from(paintedRegions)
                .where(cellWhere);
            const curMask = BigInt.asUintN(64, existing[0]?.walkedMask ?? 0n); // 符号なしへ戻す
            // 部分塗り（mask 非0）で、まだ踏んでいない細セルを踏んだ → ビットを立てて細セル初 XP。
            if (bit !== 0n && curMask !== 0n && (curMask & bit) === 0n) {
                await tx
                    .update(paintedRegions)
                    .set({
                    walkedMask: BigInt.asIntN(64, curMask | bit),
                    lastVisitAt: new Date(now),
                })
                    .where(cellWhere);
                const state = await addExp(user.id, expCfg.expFine, now, tx, expCfg);
                return { ok: true, points: state, gainedExp: expCfg.expFine };
            }
            // 全面セル（mask=0）で manual → gps 昇格。訪問時刻も now に更新する。
            // （部分塗りセルは既に gps なのでこの分岐には来ない）
            if (existing[0]?.mode !== "gps") {
                await tx
                    .update(paintedRegions)
                    .set({ mode: "gps", lastVisitAt: new Date(now) })
                    .where(cellWhere);
                const state = await addExp(user.id, expCfg.expVisit, now, tx, expCfg);
                return { ok: true, points: state, gainedExp: expCfg.expVisit };
            }
            // 再訪（全面セルへ入り直し／既に踏んだ細セルへ入り直し）：前回訪問から十分時間が
            // 経っていれば再び経験値を付与する。履歴は残さず lastVisitAt を上書きするだけ。
            // 細セル再訪（bit が立っていて既に踏んだビット）は expFineRevisit、
            // 全面セル・subIndex なし再訪は expVisit を付与する。
            const last = existing[0]?.lastVisitAt ?? null;
            const canReward = last === null || now - last.getTime() >= expCfg.revisitCooldownSec * 1000;
            if (canReward) {
                await tx
                    .update(paintedRegions)
                    .set({ lastVisitAt: new Date(now) })
                    .where(cellWhere);
                const revisitExp = bit !== 0n && curMask !== 0n ? expCfg.expFineRevisit : expCfg.expVisit;
                const state = await addExp(user.id, revisitExp, now, tx, expCfg);
                return { ok: true, points: state, gainedExp: revisitExp };
            }
            // クールダウン中：経験値なし（lastVisitAt も触らない）
            const state = await ensurePoints(user.id, now, tx, expCfg);
            return { ok: true, points: state, gainedExp: 0 };
        });
        return c.json(result);
    }
    // manual：新規セルのみ塗りポイントを消費する。残高不足ならロールバックして 402 を返す。
    // 既存セルへの再 POST（idempotent）は課金しない。新規かつ有料（cost>0）なら経験値 expPaint を付与。
    try {
        const result = await db.transaction(async (tx) => {
            const inserted = await tx
                .insert(paintedRegions)
                .values({
                userId: user.id,
                sourceLayer: parsed.sourceLayer,
                keyCode: parsed.keyCode,
                mode: parsed.mode,
                ...context,
            })
                .onConflictDoNothing()
                .returning({ id: paintedRegions.id });
            if (inserted.length === 0) {
                // 既に塗り済み → 課金せず現在の残高を返す
                const state = await ensurePoints(user.id, now, tx, expCfg);
                return { ok: true, points: state, gainedExp: 0 };
            }
            // 外国まとめ塗りの「残り」セル：課金も経験値もなし（代表1セルが既に支払い済み）。
            if (parsed.bulk) {
                const state = await ensurePoints(user.id, now, tx, expCfg);
                return { ok: true, points: state, gainedExp: 0 };
            }
            const spent = await spendPoints(user.id, parsed.cost, now, tx, expCfg);
            if (!spent) {
                // 残高不足 → トランザクションを巻き戻して塗りを取り消す
                throw new InsufficientPointsError();
            }
            // 新規セルの塗りに経験値を付与。cost===0 の Shift+デバッグ塗り（開発者のみ・96行目で
            // チェック済み）も経験値が入るようにする。spent は cost===0 でも残高据え置きで返るので使わない。
            const state = await addExp(user.id, expCfg.expPaint, now, tx, expCfg);
            return { ok: true, points: state, gainedExp: expCfg.expPaint };
        });
        return c.json(result);
    }
    catch (err) {
        if (err instanceof InsufficientPointsError) {
            const state = await ensurePoints(user.id, now, undefined, expCfg);
            return c.json({ error: "insufficient_points", points: state }, 402);
        }
        throw err;
    }
});
class InsufficientPointsError extends Error {
}
// ユーザーの塗りを全消去する（デバッグ用）。ポイントは返金しない。開発者のみ。
paintedRouter.delete("/all", async (c) => {
    const user = await requireUser(c.req.raw);
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    if (!isDeveloper(user))
        return c.json({ error: "forbidden" }, 403);
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
