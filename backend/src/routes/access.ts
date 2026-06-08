import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { siteVisits } from "../db/schema.js";
import { jstDateKey } from "../lib/time.js";

// サイトへのアクセス数をカウントするルート（Next.js の rewrite 経由で
// /api/backend/access から到達）。ログイン有無に関わらず数えるため認証は要求しない。
// クライアントはページ表示ごとに POST する。当日の行を +1（無ければ作成）するだけ。
export const accessRouter = new Hono();

accessRouter.post("/", async (c) => {
  const date = jstDateKey();
  try {
    await db
      .insert(siteVisits)
      .values({ date, count: 1 })
      .onConflictDoUpdate({
        target: siteVisits.date,
        set: { count: sql`${siteVisits.count} + 1` },
      });
  } catch (err) {
    // fire-and-forget：カウント失敗で画面表示を妨げない。
    console.warn("failed to record site visit", err);
  }
  return c.json({ ok: true });
});
