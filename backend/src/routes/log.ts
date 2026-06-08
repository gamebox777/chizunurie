import { Hono } from "hono";
import { getSessionUser } from "../lib/auth.js";
import { logEvent } from "../lib/userlog.js";

// クライアントが報告する主要アクションを user_logs に記録する。
// Next.js の rewrite 経由で /api/backend/log から到達する。
export const logRouter = new Hono();

// クライアントから記録を許可するアクション（塗りは含めない＝painted_regions 側で持つ）。
const ALLOWED_ACTIONS = new Set([
  "login",
  "signup",
  "logout",
  "session_start",
  "search",
  "gps",
  // 動画リワード広告の各段階（meta.event で start/granted/dismissed/… を区別）。
  "video_reward",
]);

type LogBody = {
  action?: unknown;
  lat?: unknown;
  lng?: unknown;
  municipality?: unknown;
  meta?: unknown;
};

// 緯度経度の妥当性チェック（範囲外・非数値は null にする）。
function toCoord(v: unknown, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < -max || v > max) return null;
  return v;
}

logRouter.post("/", async (c) => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = (await c.req.json().catch(() => null)) as LogBody | null;
  const action = body?.action;
  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
    return c.json({ error: "invalid action" }, 400);
  }

  const lat = toCoord(body?.lat, 90);
  const lng = toCoord(body?.lng, 180);
  const municipality =
    typeof body?.municipality === "string" && body.municipality.length <= 128
      ? body.municipality
      : null;

  await logEvent(c, {
    userId: user.id,
    action,
    lat,
    lng,
    municipality,
    meta: body?.meta ?? null,
  });
  return c.json({ ok: true });
});
