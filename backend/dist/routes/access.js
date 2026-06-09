import { Hono } from "hono";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { siteVisits } from "../db/schema.js";
import { getSessionUser } from "../lib/auth.js";
import { clientInfo } from "../lib/userlog.js";
import { jstDateKey } from "../lib/time.js";
// サイトへのアクセス数をカウントするルート（Next.js の rewrite 経由で
// /api/backend/access から到達）。ログイン有無に関わらず数えるため認証は要求しない。
// クライアントはページ表示ごとに POST する。当日×訪問者の行を +1（無ければ作成）する。
export const accessRouter = new Hono();
// 訪問者の識別子を返す。ログイン中はユーザーID基準（端末をまたいで1人）、
// 未ログインは IP+UA のハッシュ基準。生の IP / UA は保存せず、ここで作った
// 固定長ハッシュだけを保存するので個人情報を残さずユニーク判定だけできる。
async function visitorId(c) {
    const user = await getSessionUser(c.req.raw).catch(() => null);
    if (user)
        return `u:${user.id}`;
    const { ipAddress, userAgent } = clientInfo(c);
    const hash = createHash("sha256")
        .update(`${ipAddress ?? ""}|${userAgent ?? ""}`)
        .digest("hex")
        .slice(0, 16);
    return `h:${hash}`;
}
accessRouter.post("/", async (c) => {
    const date = jstDateKey();
    const visitor = await visitorId(c);
    try {
        await db
            .insert(siteVisits)
            .values({ date, visitor, count: 1 })
            .onConflictDoUpdate({
            target: [siteVisits.date, siteVisits.visitor],
            set: { count: sql `${siteVisits.count} + 1` },
        });
    }
    catch (err) {
        // fire-and-forget：カウント失敗で画面表示を妨げない。
        console.warn("failed to record site visit", err);
    }
    return c.json({ ok: true });
});
