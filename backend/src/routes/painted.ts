import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { auth } from "../lib/auth.js";
import { db } from "../db/index.js";
import { paintedRegions } from "../db/schema.js";
import { ALLOWED_COSTS, COST_ADJACENT, ensurePoints, spendPoints } from "../lib/points.js";

export const paintedRouter = new Hono();

// 'mesh' が現行の塗り単位。'municipalities'/'chocho' は旧データ互換のため許可
const ALLOWED_LAYERS = new Set(["mesh", "municipalities", "chocho"]);
const ALLOWED_MODES = new Set(["gps", "manual"]);

async function requireUser(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user ?? null;
}

type PaintBody = {
  sourceLayer?: unknown;
  keyCode?: unknown;
  mode?: unknown;
  cost?: unknown;
};

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
  return { sourceLayer, keyCode, mode: resolvedMode, cost: resolvedCost };
}

paintedRouter.get("/", async (c) => {
  const user = await requireUser(c.req.raw);
  if (!user) return c.json({ error: "unauthorized" }, 401);
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
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const parsed = parseBody(await c.req.json().catch(() => null));
  if (!parsed) return c.json({ error: "invalid body" }, 400);

  if (parsed.mode === "gps") {
    // GPS（実際の移動）は無料。最優先なので既存（manual含む）があれば gps に昇格。
    await db
      .insert(paintedRegions)
      .values({
        userId: user.id,
        sourceLayer: parsed.sourceLayer,
        keyCode: parsed.keyCode,
        mode: parsed.mode,
      })
      .onConflictDoUpdate({
        target: [
          paintedRegions.userId,
          paintedRegions.sourceLayer,
          paintedRegions.keyCode,
        ],
        set: { mode: "gps" },
      });
    return c.json({ ok: true });
  }

  // manual：新規セルのみ塗りポイントを消費する。残高不足ならロールバックして 402 を返す。
  // 既存セルへの再 POST（idempotent）は課金しない。
  const now = Date.now();
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
        return { ok: true as const, points: state };
      }

      const state = await spendPoints(user.id, parsed.cost, now, tx);
      if (!state) {
        // 残高不足 → トランザクションを巻き戻して塗りを取り消す
        throw new InsufficientPointsError();
      }
      return { ok: true as const, points: state };
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
