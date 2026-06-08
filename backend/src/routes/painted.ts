import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getSessionUser, isDeveloper } from "../lib/auth.js";
import { db } from "../db/index.js";
import { paintedRegions } from "../db/schema.js";
import {
  ALLOWED_COSTS,
  COST_ADJACENT,
  EXP_PAINT,
  EXP_VISIT,
  REVISIT_EXP_COOLDOWN_MS,
  addExp,
  ensurePoints,
  spendPoints,
} from "../lib/points.js";
import { clientInfo } from "../lib/userlog.js";

export const paintedRouter = new Hono();

// 'mesh' が現行の塗り単位。'municipalities'/'chocho' は旧データ互換のため許可
const ALLOWED_LAYERS = new Set(["mesh", "municipalities", "chocho"]);
const ALLOWED_MODES = new Set(["gps", "manual"]);

async function requireUser(req: Request) {
  return getSessionUser(req);
}

type PaintBody = {
  sourceLayer?: unknown;
  keyCode?: unknown;
  mode?: unknown;
  cost?: unknown;
  bulk?: unknown;
  lat?: unknown;
  lng?: unknown;
  municipality?: unknown;
  region?: unknown;
  country?: unknown;
};

// 緯度経度の妥当性チェック（範囲外・非数値は null）。塗った位置の記録用。
function toCoord(v: unknown, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < -max || v > max) return null;
  return v;
}

function parseBody(body: PaintBody | null) {
  if (!body) return null;
  const { sourceLayer, keyCode, mode, cost } = body;
  if (typeof sourceLayer !== "string" || typeof keyCode !== "string") return null;
  if (!ALLOWED_LAYERS.has(sourceLayer)) return null;
  if (keyCode.length === 0 || keyCode.length > 32) return null;
  // mode は省略可（後方互換）。指定時は gps / manual のみ許可
  const resolvedMode =
    typeof mode === "string" && ALLOWED_MODES.has(mode) ? mode : "manual";
  // cost はクライアントが隣接判定して送る塗りポイント消費量（manual のみ意味を持つ）。
  // 省略時は隣接塗り（COST_ADJACENT）扱い。許可値以外は弾く。
  const resolvedCost =
    typeof cost === "number" && ALLOWED_COSTS.has(cost) ? cost : COST_ADJACENT;
  // bulk: 外国 10×10 まとめ塗りの「残り」セル。代表1セルだけが課金＆経験値を得て、
  // 残りはこのフラグで無料・経験値なしに塗る（manual の新規 insert のみ意味を持つ）。
  const bulk = body.bulk === true;
  // 塗った時点の文脈（任意）。新規 insert のときだけ保存する。
  const lat = toCoord(body.lat, 90);
  const lng = toCoord(body.lng, 180);
  const municipality =
    typeof body.municipality === "string" && body.municipality.length <= 128
      ? body.municipality
      : null;
  // 世界版の州・県コード（adm1_code）。日本の外を塗った時だけ入る。
  const region =
    typeof body.region === "string" && body.region.length <= 32
      ? body.region
      : null;
  // 塗った国（adm0_a3。日本は "JPN"）。管理画面の塗りログ表示用。
  const country =
    typeof body.country === "string" && body.country.length <= 8
      ? body.country
      : null;
  return { sourceLayer, keyCode, mode: resolvedMode, cost: resolvedCost, bulk, lat, lng, municipality, region, country };
}

paintedRouter.get("/", async (c) => {
  const user = await requireUser(c.req.raw);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const rows = await db
    .select({
      sourceLayer: paintedRegions.sourceLayer,
      keyCode: paintedRegions.keyCode,
      mode: paintedRegions.mode,
      municipality: paintedRegions.municipality,
      region: paintedRegions.region,
    })
    .from(paintedRegions)
    .where(eq(paintedRegions.userId, user.id));
  return c.json({ painted: rows });
});

paintedRouter.post("/", async (c) => {
  const user = await requireUser(c.req.raw);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const parsed = parseBody(await c.req.json().catch(() => null));
  if (!parsed) return c.json({ error: "invalid body" }, 400);

  // cost===0 は無料デバッグ塗り（Shift+クリック）。開発者のみ許可する。
  if (parsed.cost === 0 && !isDeveloper(user)) {
    return c.json({ error: "forbidden" }, 403);
  }

  const now = Date.now();
  // 塗った時点の文脈（新規 insert のときだけ保存）。ip/ua はサーバー側で取得。
  const { ipAddress, userAgent } = clientInfo(c);
  const context = {
    ipAddress,
    userAgent,
    lat: parsed.lat,
    lng: parsed.lng,
    municipality: parsed.municipality,
    region: parsed.region,
    country: parsed.country,
  };

  if (parsed.mode === "gps") {
    // GPS（実際の移動）はポイント無料。最優先なので既存（manual含む）があれば gps に昇格。
    // 「実際に訪れる」と経験値 EXP_VISIT を獲得する。新規セル・となり塗りからの昇格に加え、
    // 既に gps 済みのセルへ入り直した「再訪」も、前回訪問から REVISIT_EXP_COOLDOWN_MS 以上
    // 経っていれば再付与する（lastVisitAt を上書き更新するので行は増えない＝DB は肥大化しない）。
    const cellWhere = and(
      eq(paintedRegions.userId, user.id),
      eq(paintedRegions.sourceLayer, parsed.sourceLayer),
      eq(paintedRegions.keyCode, parsed.keyCode)
    );
    const result = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(paintedRegions)
        .values({
          userId: user.id,
          sourceLayer: parsed.sourceLayer,
          keyCode: parsed.keyCode,
          mode: "gps",
          lastVisitAt: new Date(now),
          ...context,
        })
        .onConflictDoNothing()
        .returning({ id: paintedRegions.id });

      if (inserted.length > 0) {
        // 新規セルを訪問 → 経験値付与
        const state = await addExp(user.id, EXP_VISIT, now, tx);
        return { ok: true as const, points: state, gainedExp: EXP_VISIT };
      }

      // 既存セル：となり塗り（manual）なら gps に昇格して経験値付与。
      // 既に gps 済みなら再訪扱い（クールダウン経過時のみ再付与）。
      const existing = await tx
        .select({
          mode: paintedRegions.mode,
          lastVisitAt: paintedRegions.lastVisitAt,
        })
        .from(paintedRegions)
        .where(cellWhere);
      if (existing[0]?.mode !== "gps") {
        // manual → gps 昇格。訪問時刻も now に更新する。
        await tx
          .update(paintedRegions)
          .set({ mode: "gps", lastVisitAt: new Date(now) })
          .where(cellWhere);
        const state = await addExp(user.id, EXP_VISIT, now, tx);
        return { ok: true as const, points: state, gainedExp: EXP_VISIT };
      }

      // 再訪：前回訪問から十分時間が経っていれば再び経験値を付与する。
      // 履歴は残さず lastVisitAt を上書きするだけなので行数は増えない。
      const last = existing[0]?.lastVisitAt ?? null;
      const canReward =
        last === null || now - last.getTime() >= REVISIT_EXP_COOLDOWN_MS;
      if (canReward) {
        await tx
          .update(paintedRegions)
          .set({ lastVisitAt: new Date(now) })
          .where(cellWhere);
        const state = await addExp(user.id, EXP_VISIT, now, tx);
        return { ok: true as const, points: state, gainedExp: EXP_VISIT };
      }
      // クールダウン中：経験値なし（lastVisitAt も触らない）
      const state = await ensurePoints(user.id, now, tx);
      return { ok: true as const, points: state, gainedExp: 0 };
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
          ...context,
        })
        .onConflictDoNothing()
        .returning({ id: paintedRegions.id });

      if (inserted.length === 0) {
        // 既に塗り済み → 課金せず現在の残高を返す
        const state = await ensurePoints(user.id, now, tx);
        return { ok: true as const, points: state, gainedExp: 0 };
      }

      // 外国まとめ塗りの「残り」セル：課金も経験値もなし（代表1セルが既に支払い済み）。
      if (parsed.bulk) {
        const state = await ensurePoints(user.id, now, tx);
        return { ok: true as const, points: state, gainedExp: 0 };
      }

      const spent = await spendPoints(user.id, parsed.cost, now, tx);
      if (!spent) {
        // 残高不足 → トランザクションを巻き戻して塗りを取り消す
        throw new InsufficientPointsError();
      }
      // 新規セルの塗りに経験値を付与。cost===0 の Shift+デバッグ塗り（開発者のみ・96行目で
      // チェック済み）も経験値が入るようにする。spent は cost===0 でも残高据え置きで返るので使わない。
      const state = await addExp(user.id, EXP_PAINT, now, tx);
      return { ok: true as const, points: state, gainedExp: EXP_PAINT };
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof InsufficientPointsError) {
      const state = await ensurePoints(user.id, now);
      return c.json({ error: "insufficient_points", points: state }, 402);
    }
    throw err;
  }
});

class InsufficientPointsError extends Error {}

// ユーザーの塗りを全消去する（デバッグ用）。ポイントは返金しない。開発者のみ。
paintedRouter.delete("/all", async (c) => {
  const user = await requireUser(c.req.raw);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!isDeveloper(user)) return c.json({ error: "forbidden" }, 403);
  await db.delete(paintedRegions).where(eq(paintedRegions.userId, user.id));
  return c.json({ ok: true });
});

paintedRouter.delete("/", async (c) => {
  const user = await requireUser(c.req.raw);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const parsed = parseBody(await c.req.json().catch(() => null));
  if (!parsed) return c.json({ error: "invalid body" }, 400);
  await db
    .delete(paintedRegions)
    .where(
      and(
        eq(paintedRegions.userId, user.id),
        eq(paintedRegions.sourceLayer, parsed.sourceLayer),
        eq(paintedRegions.keyCode, parsed.keyCode)
      )
    );
  return c.json({ ok: true });
});
