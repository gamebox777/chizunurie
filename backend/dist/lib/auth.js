import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
export const auth = betterAuth({
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [process.env.FRONTEND_URL ?? "http://localhost:3000"],
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: schema.user,
            session: schema.session,
            account: schema.account,
            verification: schema.verification,
        },
    }),
    // Secure Cookie は baseURL が https のときだけ有効化する。
    // 本番(https)では Secure、ローカル/フルDocker(http://localhost)では無効になり、
    // どちらのモードでもログインが成立する。
    advanced: {
        useSecureCookies: baseURL.startsWith("https://"),
    },
    user: {
        additionalFields: {
            // 権限。session.user.role としてクライアントへ返る。
            // input:false なので新規登録のリクエストでは設定できず、必ず既定の 'user' になる。
            // 開発者にするには DB の user.role を 'developer' に手動で更新する。
            role: {
                type: "string",
                required: false,
                defaultValue: "user",
                input: false,
            },
            // Google プロフィールの本名。mapProfileToUser でのみ書き込む（input:false なので
            // クライアントからは設定できない）。ゲーム画面では表示せず管理画面専用。
            realName: {
                type: "string",
                required: false,
                input: false,
            },
        },
    },
    emailAndPassword: {
        enabled: true,
    },
    socialProviders: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // ニックネーム(name)は空のままにし、ログイン後に本人に入力してもらう。
            // 本名は取得できれば realName に保存する（ゲーム画面では非表示・管理画面専用）。
            // 日本語は姓→名の順が自然なので family_name + given_name を優先し、
            // 無ければ Google の表示名 name にフォールバックする。
            mapProfileToUser: (profile) => {
                const composed = [profile.family_name, profile.given_name]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                const realName = composed || profile.name?.trim() || "";
                return { name: "", realName };
            },
        },
    },
});
// リクエストからログインユーザーを取り出す。未ログインなら null。
export async function getSessionUser(req) {
    const session = await auth.api.getSession({ headers: req.headers });
    return session?.user ?? null;
}
// 開発者（デバッグ機能を使える権限）かどうか。
export function isDeveloper(user) {
    return user?.role === "developer";
}
