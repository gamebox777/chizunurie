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
    emailAndPassword: {
        enabled: true,
    },
    socialProviders: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // 本名は保存しない。ニックネームはログイン後に本人に入力してもらう。
            mapProfileToUser: () => ({ name: "" }),
        },
    },
});
