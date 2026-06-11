import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import type { GoogleProfile } from "@better-auth/core/social-providers";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";

// 匿名（ゲスト）→ 本登録/ログイン時のデータ移行。
// 匿名ユーザーが塗った painted_regions とポイント（user_points）を本ユーザーへ引き継ぐ。
// 同一 Postgres 内なので付け替えるだけで済む（localStorage 同期のような変換は不要）。
// この後 anonymous プラグインが匿名ユーザー行を削除する（移行済みなので cascade で消えるものは無い）。
async function linkAnonymousData(anonId: string, newId: string): Promise<void> {
  if (!anonId || !newId || anonId === newId) return;
  await db.transaction(async (tx) => {
    // 1. 本ユーザーが既に塗っているセルと衝突する匿名側の塗りは捨てる（本ユーザー優先）。
    //    unique(user_id, source_layer, key_code) があるため衝突を先に除く必要がある。
    await tx.execute(sql`
      DELETE FROM painted_regions a
      USING painted_regions b
      WHERE a.user_id = ${anonId}
        AND b.user_id = ${newId}
        AND a.source_layer = b.source_layer
        AND a.key_code = b.key_code
    `);
    // 2. 残りの匿名塗りを本ユーザーへ付け替える。
    await tx
      .update(schema.paintedRegions)
      .set({ userId: newId })
      .where(eq(schema.paintedRegions.userId, anonId));
    // 3. ポイント/レベル：本ユーザーがまだ持っていなければ匿名分を引き継ぐ。
    //    既に持っている場合（既存ユーザーがゲスト状態でログイン）は本ユーザー側を優先して触らない。
    const existing = await tx
      .select({ userId: schema.userPoints.userId })
      .from(schema.userPoints)
      .where(eq(schema.userPoints.userId, newId));
    if (existing.length === 0) {
      await tx
        .update(schema.userPoints)
        .set({ userId: newId })
        .where(eq(schema.userPoints.userId, anonId));
    }
  });
}

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
    // 本人によるセルフ削除（アカウント削除ページの「今すぐ削除」ボタンから実行）。
    // メール検証コールバックは設けず即時削除する（確認は UI の入力で取る）。user 行を
    // 1 つ消すと session/account/painted_regions/user_logs/user_points が schema の
    // onDelete:"cascade" で連鎖削除される。匿名（ゲスト）ユーザーもそのまま削除できる。
    deleteUser: {
      enabled: true,
    },
  },
  // 削除など要注意操作に必要なセッションの鮮度。0 にして、ログイン直後でなくても
  // 本人セッションさえあれば（Google/メール/ゲストいずれでも）削除できるようにする。
  session: {
    freshAge: 0,
  },
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      // Google 側にセッションが残っていると確認なしで前回のアカウントで自動ログイン
      // されてしまう（特にアプリ版 WebView は Cookie が消えないので顕著）。
      // 毎回アカウント選択画面を必ず出す。
      prompt: "select_account",
      // ニックネーム(name)は空のままにし、ログイン後に本人に入力してもらう。
      // 本名は取得できれば realName に保存する（ゲーム画面では非表示・管理画面専用）。
      // 日本語は姓→名の順が自然なので family_name + given_name を優先し、
      // 無ければ Google の表示名 name にフォールバックする。
      mapProfileToUser: (profile: GoogleProfile) => {
        const composed = [profile.family_name, profile.given_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        const realName = composed || profile.name?.trim() || "";
        return { name: "", realName };
      },
    },
  },
  plugins: [
    // 匿名（ゲスト）認証。クライアントが起動時に signIn.anonymous() を呼ぶと、
    // user.isAnonymous=true の本物のユーザー行＋セッション Cookie を発行する。
    // これにより未ログインでも painted_regions / user_points に通常どおり保存でき、
    // requireUser もそのまま通る（塗り API 側の改修は不要）。
    // 本登録/ログイン時に onLinkAccount で塗り・ポイントを本ユーザーへ移行する。
    anonymous({
      // ゲストの表示名。既定の "Anonymous" ではなく "guest-<ランダムキー>" にして、
      // ランキング等で1人ずつ識別できるようにする（user.name は一意制約なしなので衝突は表示のみ・許容）。
      generateName: () => `guest-${randomUUID().slice(0, 8)}`,
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await linkAnonymousData(anonymousUser.user.id, newUser.user.id);
      },
    }),
  ],
});

// セッションのユーザー（role を含む）。additionalFields の role は型に出ないため明示する。
export type SessionUser = { id: string; role?: string };

// リクエストからログインユーザーを取り出す。未ログインなら null。
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return (session?.user as SessionUser | undefined) ?? null;
}

// 開発者（デバッグ機能を使える権限）かどうか。
export function isDeveloper(user: SessionUser | null | undefined): boolean {
  return user?.role === "developer";
}
