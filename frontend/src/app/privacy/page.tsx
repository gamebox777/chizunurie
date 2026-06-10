import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

const CONTACT_EMAIL = "rin7studio@gmail.com";

export const metadata: Metadata = {
  title: "プライバシーポリシー｜ちずぬりえ",
  description:
    "GPS 白地図ぬりつぶしゲーム「ちずぬりえ」のプライバシーポリシー。取得する情報（アカウント情報・位置情報・プレイデータ）、Cookie、Google Analytics・Google 広告の利用、データの保持と削除について説明します。Privacy Policy of Chizunurie.",
  robots: { index: true, follow: true },
};

function JaContent() {
  return (
    <>
      <p>
        「ちずぬりえ」（以下「本サービス」）の運営者（以下「運営者」）は、本サービスにおける
        利用者の情報の取り扱いについて、以下のとおりプライバシーポリシーを定めます。
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-bold">1. 取得する情報</h2>
        <ul className="mt-3 list-disc space-y-3 pl-6">
          <li>
            <strong>アカウント情報</strong>
            ：メールアドレス、表示名（ニックネーム）、認証情報。Google アカウントでログインした
            場合は、Google から提供されるメールアドレス等の基本情報を取得します。
            登録せずに利用する場合も、進行状況の保存のために匿名（ゲスト）アカウントを
            自動的に発行します。
          </li>
          <li>
            <strong>位置情報（GPS）</strong>
            ：「GPS塗り」機能を利用する場合に限り、利用者の明示的な許可のもとで端末の位置情報を
            取得します。取得した位置情報は「どのマス（約1km四方の区画）を塗ったか」の判定に
            使用し、サーバーには<strong>塗ったマスの識別子と関連する記録</strong>を保存します。
            位置情報の利用はブラウザ・端末の設定からいつでも拒否できます（GPS を使わなくても
            手動塗りでプレイできます）。
          </li>
          <li>
            <strong>ゲームのプレイデータ</strong>
            ：塗ったマスの記録、塗りポイント・レベル・経験値、プレイ時間、動画リワードの利用状況。
          </li>
          <li>
            <strong>操作ログ</strong>
            ：ログイン、GPS 利用、検索などのアプリ内の操作イベント。不正利用の防止と
            サービス改善のために記録します。
          </li>
          <li>
            <strong>アクセス情報</strong>
            ：アクセス数の集計のため、IP アドレスとブラウザ情報（User-Agent）から生成した
            ハッシュ値（元の値に復元できない形式）を日次で記録します。IP アドレスそのものは
            保存しません。
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">2. 利用目的</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          <li>本サービスの提供・維持（塗った地図やゲーム進行の保存・復元）</li>
          <li>アカウントの認証、端末間のデータ引き継ぎ</li>
          <li>ランキング等の集計機能の提供（表示名のみを表示し、メールアドレスは公開しません）</li>
          <li>不正利用・乱用の防止</li>
          <li>利用状況の分析によるサービスの改善</li>
          <li>広告の表示（後述）</li>
          <li>お問い合わせへの対応</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">3. Cookie の利用</h2>
        <p className="mt-3">
          本サービスは、ログイン状態の維持（セッション管理）のために Cookie を使用します。
          また、後述するアクセス解析・広告配信のために、Google 等の第三者が Cookie を
          使用することがあります。Cookie はブラウザの設定で削除・無効化できますが、
          無効化した場合はログイン状態の維持など一部の機能が利用できなくなります。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">4. アクセス解析（Google Analytics）</h2>
        <p className="mt-3">
          本サービスは、利用状況の把握のために Google アナリティクスを使用しています。
          Google アナリティクスは Cookie 等を利用してトラフィックデータを収集しますが、
          このデータは匿名で収集されており、個人を特定するものではありません。
          詳細は
          <a
            href="https://policies.google.com/technologies/partner-sites?hl=ja"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline"
          >
            「Google のサービスを使用するサイトやアプリから収集した情報の Google による使用」
          </a>
          をご確認ください。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">5. 広告の配信（Google 広告）</h2>
        <p className="mt-3">
          本サービスは、Google などの第三者配信事業者による広告（動画リワード広告等）を
          掲載することがあります。第三者配信事業者は、Cookie 等を使用して、利用者の本サービスや
          他のウェブサイトへの過去のアクセス情報に基づく広告（パーソナライズド広告）を
          配信することがあります。
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            利用者は
            <a
              href="https://adssettings.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              Google の広告設定
            </a>
            でパーソナライズド広告を無効にできます。
          </li>
          <li>
            その他の第三者配信事業者の Cookie については
            <a
              href="https://optout.aboutads.info/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              www.aboutads.info
            </a>
            で無効にできます。
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">6. 第三者への提供</h2>
        <p className="mt-3">
          運営者は、法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません。
          なお、本サービスの提供にあたり、次の外部サービスへ情報が送信されることがあります。
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-sm">
          <li>Google LLC（認証・アクセス解析・広告配信）</li>
          <li>国土地理院（住所表示のための逆ジオコーディング。地図上の座標が送信されます）</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">7. データの保持期間と削除</h2>
        <p className="mt-3">
          アカウントと関連データは、利用者がアカウントを削除するまで保持します。
          アカウントの削除は
          <Link href="/delete-account" className="text-blue-600 underline">
            アカウント削除ページ
          </Link>
          からいつでも行えます。削除されるデータ・保持されるデータの詳細も同ページに記載しています。
          法令対応・不正防止のために保持が必要なログは、目的の範囲で最長12か月保持した後に削除します。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">8. 安全管理</h2>
        <p className="mt-3">
          運営者は、取得した情報への不正アクセス、紛失、漏えい等を防止するため、
          通信の暗号化（HTTPS)、アクセス権限の管理等の合理的な安全管理措置を講じます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">9. 本ポリシーの変更</h2>
        <p className="mt-3">
          本ポリシーの内容は、法令の改正やサービス内容の変更に応じて改定することがあります。
          重要な変更がある場合は、本サービス上でお知らせします。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">10. お問い合わせ</h2>
        <p className="mt-3">
          本ポリシーに関するお問い合わせは、
          <Link href="/contact" className="text-blue-600 underline">
            運営者情報・お問い合わせページ
          </Link>
          または下記メールアドレスまでお願いします。
        </p>
        <p className="mt-2">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-mono font-semibold text-blue-600 underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <p className="mt-10 text-sm text-gray-500">制定日：2026年6月10日</p>
    </>
  );
}

function EnContent() {
  return (
    <>
      <p>
        The operator of Chizunurie (the &ldquo;Service&rdquo;) sets out this Privacy Policy to
        explain how user information is handled in the Service.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-bold">1. Information we collect</h2>
        <ul className="mt-3 list-disc space-y-3 pl-6">
          <li>
            <strong>Account information</strong>: email address, display name (nickname) and
            credentials. If you sign in with Google, we receive basic information such as the email
            address provided by Google. If you play without registering, an anonymous (guest)
            account is created automatically so your progress can be saved.
          </li>
          <li>
            <strong>Location (GPS)</strong>: only when you use the GPS-painting feature, and only
            with your explicit permission, we read your device&rsquo;s location. It is used to
            determine which cell (an area roughly 1 km square) you painted, and the server stores{" "}
            <strong>the identifiers of painted cells and related records</strong>. You can refuse
            location access at any time in your browser or device settings (the game is fully
            playable with manual painting only).
          </li>
          <li>
            <strong>Gameplay data</strong>: painted-cell records, paint points, level, experience
            points, play time, and video-reward usage.
          </li>
          <li>
            <strong>Activity logs</strong>: in-app events such as login, GPS use and search,
            recorded to prevent abuse and improve the Service.
          </li>
          <li>
            <strong>Access statistics</strong>: to count visits, we record a daily hash derived
            from your IP address and browser information (User-Agent) in a form that cannot be
            reversed. The IP address itself is not stored.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">2. Purposes of use</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          <li>Providing and maintaining the Service (saving and restoring your painted map and progress)</li>
          <li>Account authentication and transferring data across devices</li>
          <li>Aggregate features such as rankings (only your display name is shown; email addresses are never published)</li>
          <li>Preventing fraud and abuse</li>
          <li>Improving the Service through usage analysis</li>
          <li>Displaying advertising (see below)</li>
          <li>Responding to inquiries</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">3. Cookies</h2>
        <p className="mt-3">
          The Service uses cookies to keep you signed in (session management). Third parties such
          as Google may also use cookies for analytics and advertising as described below. You can
          delete or block cookies in your browser settings, but some features — such as staying
          signed in — will stop working.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">4. Analytics (Google Analytics)</h2>
        <p className="mt-3">
          The Service uses Google Analytics to understand how it is used. Google Analytics collects
          traffic data using cookies and similar technologies; this data is collected anonymously
          and does not identify individuals. See{" "}
          <a
            href="https://policies.google.com/technologies/partner-sites"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline"
          >
            &ldquo;How Google uses information from sites or apps that use our services&rdquo;
          </a>{" "}
          for details.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">5. Advertising (Google ads)</h2>
        <p className="mt-3">
          The Service may show ads served by third-party vendors such as Google (including rewarded
          video ads). Third-party vendors may use cookies to serve ads based on your prior visits
          to this and other websites (personalized advertising).
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            You can opt out of personalized ads in{" "}
            <a
              href="https://adssettings.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              Google&rsquo;s Ads Settings
            </a>
            .
          </li>
          <li>
            You can opt out of other third-party vendors&rsquo; cookies at{" "}
            <a
              href="https://optout.aboutads.info/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              www.aboutads.info
            </a>
            .
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">6. Disclosure to third parties</h2>
        <p className="mt-3">
          The operator does not provide personal information to third parties without your consent,
          except as required by law. To provide the Service, information may be sent to the
          following external services:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-sm">
          <li>Google LLC (authentication, analytics, advertising)</li>
          <li>
            Geospatial Information Authority of Japan (reverse geocoding for address display; map
            coordinates are sent)
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">7. Retention and deletion</h2>
        <p className="mt-3">
          Your account and related data are retained until you delete your account. You can delete
          it at any time from the{" "}
          <Link href="/delete-account" className="text-blue-600 underline">
            account deletion page
          </Link>
          , which also details what is deleted and what is retained. Logs that must be kept for
          legal compliance or fraud prevention are retained for up to 12 months within that scope
          and then deleted.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">8. Security</h2>
        <p className="mt-3">
          The operator takes reasonable safeguards — including encrypted connections (HTTPS) and
          access controls — to protect collected information against unauthorized access, loss or
          leakage.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">9. Changes to this policy</h2>
        <p className="mt-3">
          This policy may be revised in response to changes in law or in the Service. Significant
          changes will be announced within the Service.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">10. Contact</h2>
        <p className="mt-3">
          For questions about this policy, see the{" "}
          <Link href="/contact" className="text-blue-600 underline">
            operator information and contact page
          </Link>{" "}
          or email us at:
        </p>
        <p className="mt-2">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-mono font-semibold text-blue-600 underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <p className="mt-10 text-sm text-gray-500">Established: June 10, 2026</p>
    </>
  );
}

export default function PrivacyPage() {
  return (
    <InfoPage
      title={{ ja: "プライバシーポリシー", en: "Privacy Policy" }}
      subtitle={{
        ja: "ちずぬりえ（Chizunurie）における利用者情報の取り扱いについて",
        en: "How user information is handled in Chizunurie",
      }}
      ja={<JaContent />}
      en={<EnContent />}
    />
  );
}
