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
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      // 本名は保存しない。ニックネームはログイン後に本人に入力してもらう。
      mapProfileToUser: () => ({ name: "" }),
    },
  },
});
