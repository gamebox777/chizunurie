import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { auth } from "./lib/auth.js";
import { paintedRouter } from "./routes/painted.js";
import { pointsRouter } from "./routes/points.js";
import { adminRouter } from "./routes/admin.js";
import { logRouter } from "./routes/log.js";
import { userRouter } from "./routes/user.js";
import { accessRouter } from "./routes/access.js";
import { rankingsRouter } from "./routes/rankings.js";
import { settingsRouter } from "./routes/settings.js";

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

// 開発者専用の管理画面 API（/api/backend/admin から到達）
app.route("/admin", adminRouter);

// ユーザー行動ログの記録（/api/backend/log から到達）
app.route("/log", logRouter);

// ログイン中ユーザー自身のプロフィール更新（所在国・設定。/api/backend/user から到達）
app.route("/user", userRouter);

// サイトへのアクセス数カウント（未ログインも数える。/api/backend/access から到達）
app.route("/access", accessRouter);

// 各種ランキング（開発者を除く。/api/backend/rankings から到達）
app.route("/rankings", rankingsRouter);

// ゲーム全体で共有する共通設定（開発者専用。/api/backend/settings から到達）
app.route("/settings", settingsRouter);

const port = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port }, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
