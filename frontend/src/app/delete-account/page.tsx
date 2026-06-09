import type { Metadata } from "next";
import DeleteAccountActions from "./DeleteAccountActions";

// Google Play「データセーフティ → アカウント削除用 URL」要件を満たす公開ページ。
// https://chizunurie.gamebox777.org/delete-account に公開する。
// 必須3条件：①アプリ/デベロッパー名に言及 ②削除リクエスト手順を目立たせる
// ③削除/保持されるデータの種類と保持期間を明記。

const CONTACT_EMAIL = "rin7studio@gmail.com";

export const metadata: Metadata = {
  title: "Delete account / アカウント削除 | Chizunurie ちずぬりえ",
  description:
    "How to delete your Chizunurie account and related data, and what data is deleted or retained. ちずぬりえのアカウントおよび関連データの削除をリクエストする方法と、削除・保持されるデータについて説明します。",
  robots: { index: true, follow: true },
};

export default function DeleteAccountPage() {
  return (
    <main className="min-h-screen bg-white px-5 py-10 text-gray-800 leading-relaxed">
      <div className="mx-auto max-w-2xl">
      <p className="mb-5">
        <a href="/" className="text-blue-600 underline">
          ← Back to map / 地図に戻る
        </a>
      </p>
      <h1 className="text-2xl font-bold">Deleting your account and data</h1>
      <h1 className="text-lg font-bold">アカウントとデータの削除について</h1>
      <p className="mt-3 text-sm text-gray-600">
        App name: <strong>Chizunurie</strong> (a GPS map-coloring game)
      </p>
      <p className="text-sm text-gray-600">
        アプリ名：<strong>ちずぬりえ</strong>（GPS 白地図ぬりつぶしゲーム）
      </p>

      <p className="mt-5">
        If you are logged in, you can delete your Chizunurie account and the data
        linked to it directly from this page. If you cannot log in, you may also
        request deletion by email.
      </p>
      <p className="mt-1">
        「ちずぬりえ」のアカウント、および当該アカウントに紐づくデータの削除は、
        ログイン中であればこのページから直接行えます。ログインできない場合は、
        メールでの削除依頼も受け付けています。
      </p>

      <DeleteAccountActions />

      <section className="mt-8">
        <h2 className="text-lg font-bold">
          Request deletion by email (if you cannot log in)
        </h2>
        <h2 className="text-base font-bold">
          メールで削除を依頼する（ログインできない場合）
        </h2>
        <ol className="mt-3 list-decimal space-y-3 pl-6">
          <li>
            <p>
              Send an email to the contact address below with the subject
              &ldquo;Account deletion request&rdquo;.
            </p>
            <p className="mt-1">
              下記の連絡先メールアドレス宛に、件名を「アカウント削除依頼」として
              メールを送信してください。
            </p>
            <div className="mt-2">
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                  "アカウント削除依頼 / Account deletion request",
                )}`}
                className="font-mono font-semibold text-blue-600 underline"
              >
                {CONTACT_EMAIL}
              </a>
            </div>
          </li>
          <li>
            <p>
              For identity verification, include{" "}
              <strong>the email address you use to log in</strong> (for Google
              login, the email address of that Google account) in the body.
            </p>
            <p className="mt-1">
              本人確認のため、<strong>ログインに使用しているメールアドレス</strong>
              （Google ログインの場合はその Google アカウントのメールアドレス）を
              本文に記載してください。
            </p>
          </li>
          <li>
            <p>
              After we receive your request and verify your identity, we will
              delete your account and related data. Deletion is usually
              completed <strong>within 30 days</strong>, and we will notify you
              by email once it is done.
            </p>
            <p className="mt-1">
              ご依頼を受領後、本人確認のうえアカウントと関連データを削除します。
              通常 <strong>30 日以内</strong>に削除を完了し、完了後にメールでご連絡します。
            </p>
          </li>
        </ol>
        <p className="mt-3 text-sm text-gray-600">
          * If you use the app as a guest (anonymous) account, the account is
          tied to the session on your device/browser. Clearing the app data
          (deleting the app data from your device settings) will make that guest
          data inaccessible.
        </p>
        <p className="mt-1 text-sm text-gray-600">
          ※ ゲスト（匿名）のままご利用の場合、アカウントはお使いの端末・ブラウザの
          セッションに紐づきます。アプリのデータ消去（端末設定からアプリのデータ削除）を
          行うことで、当該ゲストデータへのアクセスはできなくなります。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Data that will be deleted</h2>
        <h2 className="text-base font-bold">削除されるデータ</h2>
        <p className="mt-3">
          The deletion will remove all of the following data.
        </p>
        <p className="mt-1">削除リクエストにより、以下のデータをすべて削除します。</p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <p>
              Account information (email address, display name, credentials,
              login sessions)
            </p>
            <p className="text-gray-600">
              アカウント情報（メールアドレス、表示名、認証情報、ログインセッション）
            </p>
          </li>
          <li>
            <p>Records of painted cells (coloring on the map)</p>
            <p className="text-gray-600">塗ったマス（地図上のぬりつぶし）の記録</p>
          </li>
          <li>
            <p>
              Game progress data such as points, levels, experience (XP), and
              play time
            </p>
            <p className="text-gray-600">
              ポイント・レベル・経験値（XP）・プレイ時間などのゲーム進行データ
            </p>
          </li>
          <li>
            <p>In-app operation and activity logs</p>
            <p className="text-gray-600">アプリ内の操作・行動ログ</p>
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">
          Data that is retained and its retention period
        </h2>
        <h2 className="text-base font-bold">保持されるデータと保持期間</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <p>
              Logs that must be retained for legal compliance, fraud prevention,
              or accounting obligations are deleted after being kept for{" "}
              <strong>up to 12 months</strong> at most, within the scope of the
              applicable purpose.
            </p>
            <p className="mt-1 text-gray-600">
              法令対応・不正防止・会計上の義務のために保持が必要なログは、
              該当する目的の範囲で、最長 <strong>最大 12 か月</strong>保持した後に削除します。
            </p>
          </li>
          <li>
            <p>
              Aggregated and anonymized statistics and access analytics data
              (such as Google Analytics) are not linked to individuals, so they
              may be retained as outside the scope of deletion.
            </p>
            <p className="mt-1 text-gray-600">
              個人を特定できない形に集計・匿名化された統計・アクセス解析データ
              （Google Analytics 等）は、個人と結び付かないため削除対象外として
              保持されることがあります。
            </p>
          </li>
        </ul>
      </section>

      <section className="mt-8 border-t border-gray-200 pt-5 text-sm text-gray-600">
        <p>
          Related: / 関連情報：
          <a
            href="https://unitygamebox.com/?p=2230"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 text-blue-600 underline"
          >
            Privacy Policy / プライバシーポリシー
          </a>
        </p>
        <p className="mt-2">
          Contact: / お問い合わせ：
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="ml-1 font-mono text-blue-600 underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>
      </div>
    </main>
  );
}
