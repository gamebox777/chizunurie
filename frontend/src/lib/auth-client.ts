import { createAuthClient } from "better-auth/react";
import {
  anonymousClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    // 匿名（ゲスト）認証。signIn.anonymous() でゲストセッションを作れるようにする。
    // 未ログインでも塗り（となり塗り）を DB に保存でき、本登録/ログイン時にサーバーの
    // onLinkAccount でデータを本ユーザーへ移行する。
    anonymousClient(),
    inferAdditionalFields({
      user: {
        // バックエンドの user.additionalFields.role と対応。session.user.role が型付けされる。
        // input:false で新規登録の入力対象から外す（必ずサーバー既定の 'user' になる）。
        role: { type: "string", required: false, input: false },
        // 匿名ユーザーかどうか。session.user.isAnonymous が型付けされる（ゲスト判定に使う）。
        isAnonymous: { type: "boolean", required: false, input: false },
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession, updateUser } = authClient;
