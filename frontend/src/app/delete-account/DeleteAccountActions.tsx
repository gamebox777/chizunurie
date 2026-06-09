"use client";

import { useState } from "react";
import { authClient, useSession, signOut } from "@/lib/auth-client";

// アカウント削除ページに差し込むクライアント側の操作カード。
// ログイン中の本人だけに「今すぐ削除」を出す。サーバーの auth.ts で deleteUser を
// 有効化済みなので、authClient.deleteUser() で user 行を消す → cascade で塗り・
// ポイント・ログ・セッションまで連鎖削除される。本人確認は「delete」または「削除」と
// 入力させて取る。文言は英語（上）＋日本語（下）の併記。
export default function DeleteAccountActions() {
  const { data: session, isPending } = useSession();
  const [confirmText, setConfirmText] = useState("");
  const [status, setStatus] = useState<"idle" | "deleting" | "done" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState("");

  // セッション確認中。
  if (isPending) {
    return (
      <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <p className="text-sm text-gray-500">Checking your login status…</p>
        <p className="text-sm text-gray-500">ログイン状態を確認しています…</p>
      </section>
    );
  }

  // 削除完了。
  if (status === "done") {
    return (
      <section className="mt-8 rounded-lg border border-green-300 bg-green-50 p-5">
        <h2 className="text-lg font-bold text-green-800">Account deleted</h2>
        <h2 className="text-base font-bold text-green-800">
          アカウントを削除しました
        </h2>
        <p className="mt-2 text-sm text-green-800">
          Your account and related data (painted cells, points, experience, and
          logs) have all been deleted, and you have been signed out. Thank you
          for playing.
        </p>
        <p className="mt-1 text-sm text-green-800">
          アカウントと関連データ（塗ったマス・ポイント・経験値・ログ）をすべて
          削除し、ログアウトしました。ご利用ありがとうございました。
        </p>
      </section>
    );
  }

  // 未ログイン：メール依頼の手順（このページの下部）へ誘導する。
  if (!session?.user) {
    return (
      <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <h2 className="text-lg font-bold">Log in to delete</h2>
        <h2 className="text-base font-bold">ログインして削除する</h2>
        <p className="mt-2 text-sm text-gray-600">
          If you open this page while logged in to the app, you can delete your
          account directly from here. If you cannot log in (for example, you
          have already uninstalled the app), please use the email request steps
          below.
        </p>
        <p className="mt-1 text-sm text-gray-600">
          アプリにログインした状態でこのページを開くと、ここから直接アカウントを
          削除できます。ログインできない場合（アプリをアンインストール済みなど）は、
          下記のメール依頼の手順をご利用ください。
        </p>
      </section>
    );
  }

  const u = session.user;
  const accountLabel = u.isAnonymous
    ? "ゲスト（匿名）アカウント / Guest (anonymous) account"
    : u.email || u.name || "ログイン中のアカウント";
  const t = confirmText.trim().toLowerCase();
  const canDelete = (t === "delete" || t === "削除") && status !== "deleting";

  const handleDelete = async () => {
    setStatus("deleting");
    setErrorMsg("");
    const { error } = await authClient.deleteUser();
    if (error) {
      setStatus("error");
      setErrorMsg(
        error.message ||
          "Failed to delete. Please try again later. / 削除に失敗しました。時間をおいて再度お試しください。",
      );
      return;
    }
    // セッションはサーバー側で無効化されるが、念のためクライアントもサインアウトする。
    await signOut().catch(() => {});
    setStatus("done");
  };

  return (
    <section className="mt-8 rounded-lg border border-red-300 bg-red-50 p-5">
      <h2 className="text-lg font-bold text-red-700">
        Delete now from this page
      </h2>
      <h2 className="text-base font-bold text-red-700">
        このページから今すぐ削除する
      </h2>

      <p className="mt-2 text-sm text-gray-700">
        You are logged in as <strong>{accountLabel}</strong>. The action below
        will <strong>immediately and irreversibly</strong> delete this account
        and its related data (painted cells, points, experience, and logs).
      </p>
      <p className="mt-1 text-sm text-gray-700">
        現在 <strong>{accountLabel}</strong> でログインしています。下の操作で、
        このアカウントと関連データ（塗ったマス・ポイント・経験値・ログ）を
        <strong>すぐに、元に戻せない形で</strong>削除します。
      </p>

      <div className="mt-4">
        <label htmlFor="delete-confirm" className="block text-sm text-gray-700">
          To confirm, type <strong>delete</strong> (or <strong>削除</strong>)
        </label>
        <label
          htmlFor="delete-confirm"
          className="block text-sm text-gray-700"
        >
          確認のため <strong>delete</strong> または <strong>削除</strong>{" "}
          と入力してください
        </label>
        <input
          id="delete-confirm"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="delete"
          autoComplete="off"
          disabled={status === "deleting"}
          className="mt-1 w-40 rounded border border-gray-300 bg-white px-3 py-1.5 text-gray-900"
        />
      </div>

      {status === "error" && (
        <p className="mt-3 text-sm text-red-600">{errorMsg}</p>
      )}

      <button
        type="button"
        onClick={handleDelete}
        disabled={!canDelete}
        className="mt-4 rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {status === "deleting"
          ? "Deleting… / 削除しています…"
          : "Permanently delete account / アカウントを完全に削除する"}
      </button>
    </section>
  );
}
