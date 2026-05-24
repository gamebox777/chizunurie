import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { auth } from "../lib/auth.js";
import { db } from "../db/index.js";
import { paintedRegions } from "../db/schema.js";

export const paintedRouter = new Hono();

const ALLOWED_LAYERS = new Set(["municipalities", "chocho"]);

async function requireUser(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user ?? null;
}

type PaintBody = { sourceLayer?: unknown; keyCode?: unknown };

function parseBody(body: PaintBody | null) {
  if (!body) return null;
  const { sourceLayer, keyCode } = body;
  if (typeof sourceLayer !== "string" || typeof keyCode !== "string") return null;
  if (!ALLOWED_LAYERS.has(sourceLayer)) return null;
  if (keyCode.length === 0 || keyCode.length > 32) return null;
  return { sourceLayer, keyCode };
}

paintedRouter.get("/", async (c) => {
  const user = await requireUser(c.req.raw);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const rows = await db
    .select({
      sourceLayer: paintedRegions.sourceLayer,
      keyCode: paintedRegions.keyCode,
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
  await db
    .insert(paintedRegions)
    .values({ userId: user.id, ...parsed })
    .onConflictDoNothing();
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
