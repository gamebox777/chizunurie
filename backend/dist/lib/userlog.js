import { eq } from "drizzle-orm";
import { getConnInfo } from "@hono/node-server/conninfo";
import { db } from "../db/index.js";
import { user, userLogs } from "../db/schema.js";
import { RUN_MODE } from "./runtime-env.js";
// リクエストから IP / UserAgent を取り出す。
// IP は x-forwarded-for（プロキシ経由の本番が前提・先頭が実クライアント）→ x-real-ip →
// 直結時の接続情報（getConnInfo）の順でフォールバックする。
export function clientInfo(c) {
    const xff = c.req.header("x-forwarded-for");
    let ipAddress = null;
    if (xff) {
        ipAddress = xff.split(",")[0]?.trim() || null;
    }
    if (!ipAddress)
        ipAddress = c.req.header("x-real-ip") ?? null;
    if (!ipAddress) {
        try {
            ipAddress = getConnInfo(c).remote.address ?? null;
        }
        catch {
            ipAddress = null;
        }
    }
    const userAgent = c.req.header("user-agent") ?? null;
    return { ipAddress, userAgent };
}
// ユーザーログを1行記録する。ip/ua はリクエストから補完する。
// fire-and-forget：失敗してもレスポンスをブロックしない（呼び出し側で await しない想定）。
export async function logEvent(c, input) {
    const { ipAddress, userAgent } = clientInfo(c);
    try {
        await db.insert(userLogs).values({
            userId: input.userId ?? null,
            action: input.action,
            ipAddress,
            userAgent,
            lat: input.lat ?? null,
            lng: input.lng ?? null,
            municipality: input.municipality ?? null,
            platform: input.platform ?? null,
            appVersion: input.appVersion ?? null,
            meta: input.meta ?? null,
            url: input.url ?? null,
            environment: RUN_MODE,
        });
        // ユーザーテーブルに「最新の接続元」を上書き保存する（アクションのたびに更新）。
        // updatedAt も併せて進める＝管理画面の「更新日」（最後にアクションした日時）になる。
        if (input.userId) {
            await db
                .update(user)
                .set({
                lastIpAddress: ipAddress,
                lastUserAgent: userAgent,
                updatedAt: new Date(),
            })
                .where(eq(user.id, input.userId));
        }
    }
    catch (err) {
        console.warn("failed to write user log", err);
    }
}
