import type { Metadata } from "next";

// Google Play「データセーフティ → アカウント削除用 URL」要件を満たす公開ページ。
// https://chizunurie.gamebox777.org/delete-account に公開する。
// 必須3条件：①アプリ/デベロッパー名に言及 ②削除リクエスト手順を目立たせる
// ③削除/保持されるデータの種類と保持期間を明記。

const CONTACT_EMAIL = "rin7studio@gmail.com";

export const metadata: Metadata = {
  title: "アカウント削除のお願い | ちずぬりえ",
  description:
    "ちずぬりえのアカウントおよび関連データの削除をリクエストする方法と、削除・保持されるデータについて説明します。",
  robots: { index: true, follow: true },
};

export default function DeleteAccountPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-gray-800 leading-relaxed">
      <h1 className="text-2xl font-bold">アカウントとデータの削除について</h1>
      <p className="mt-3 text-sm text-gray-600">
        アプリ名：<strong>ちずぬりえ</strong>（GPS 白地図ぬりつぶしゲーム）
      </p>

      <p className="mt-5">
        「ちずぬりえ」のアカウント、および当該アカウントに紐づくデータの削除を
        ご希望の場合は、以下の手順でリクエストしてください。
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-bold">削除をリクエストする手順</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-6">
          <li>
            下記の連絡先メールアドレス宛に、件名を「アカウント削除依頼」として
            メールを送信してください。
            <div className="mt-2">
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                  "アカウント削除依頼",
                )}`}
                className="font-mono font-semibold text-blue-600 underline"
              >
                {CONTACT_EMAIL}
              </a>
            </div>
          </li>
          <li>
            本人確認のため、<strong>ログインに使用しているメールアドレス</strong>
            （Google ログインの場合はその Google アカウントのメールアドレス）を
            本文に記載してください。
          </li>
          <li>
            ご依頼を受領後、本人確認のうえアカウントと関連データを削除します。
            通常 <strong>30 日以内</strong>に削除を完了し、完了後にメールでご連絡します。
          </li>
        </ol>
        <p className="mt-3 text-sm text-gray-600">
          ※ ゲスト（匿名）のままご利用の場合、アカウントはお使いの端末・ブラウザの
          セッションに紐づきます。アプリのデータ消去（端末設定からアプリのデータ削除）を
          行うことで、当該ゲストデータへのアクセスはできなくなります。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">削除されるデータ</h2>
        <p className="mt-3">削除リクエストにより、以下のデータをすべて削除します。</p>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          <li>アカウント情報（メールアドレス、表示名、認証情報、ログインセッション）</li>
          <li>塗ったマス（地図上のぬりつぶし）の記録</li>
          <li>ポイント・レベル・経験値（XP）・プレイ時間などのゲーム進行データ</li>
          <li>アプリ内の操作・行動ログ</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">保持されるデータと保持期間</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          <li>
            法令対応・不正防止・会計上の義務のために保持が必要なログは、
            該当する目的の範囲で、最長 <strong>最大 12 か月</strong>保持した後に削除します。
          </li>
          <li>
            個人を特定できない形に集計・匿名化された統計・アクセス解析データ
            （Google Analytics 等）は、個人と結び付かないため削除対象外として
            保持されることがあります。
          </li>
        </ul>
      </section>

      <section className="mt-8 border-t border-gray-200 pt-5 text-sm text-gray-600">
        <p>
          関連情報：
          <a
            href="https://unitygamebox.com/?p=2230"
            className="ml-1 text-blue-600 underline"
          >
            プライバシーポリシー
          </a>
        </p>
        <p className="mt-2">
          お問い合わせ：
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="ml-1 font-mono text-blue-600 underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>
    </main>
  );
}
