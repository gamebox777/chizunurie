import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { auth } from "./lib/auth.js";
import { paintedRouter } from "./routes/painted.js";
import { pointsRouter } from "./routes/points.js";

const app = new Hono();

app.use(logger());
app.use(
  cors({
    origin: [process.env.FRONTEND_URL ?? "http://localhost:3000"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

// better-auth のルート（/api/auth/signin, /api/auth/signup 等）
app.on(["GET", "POST"], "/api/auth/**", (c) => auth.handler(c.req.raw));

// 塗り状態の永続化（Next.js の rewrite 経由で /api/backend/painted から到達）
app.route("/painted", paintedRouter);

// 塗りポイント残高（/api/backend/points から到達）
app.route("/points", pointsRouter);

const port = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port }, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
