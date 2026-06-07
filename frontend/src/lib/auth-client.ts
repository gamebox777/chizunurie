import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: {
        // バックエンドの user.additionalFields.role と対応。session.user.role が型付けされる。
        // input:false で新規登録の入力対象から外す（必ずサーバー既定の 'user' になる）。
        role: { type: "string", required: false, input: false },
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession, updateUser } = authClient;
