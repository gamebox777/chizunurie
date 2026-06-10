import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

const CONTACT_EMAIL = "rin7studio@gmail.com";

export const metadata: Metadata = {
  title: "運営者情報・お問い合わせ｜ちずぬりえ",
  description:
    "GPS 白地図ぬりつぶしゲーム「ちずぬりえ」の運営者情報とお問い合わせ先のご案内です。不具合のご報告・ご意見・ご要望はメールで受け付けています。",
  robots: { index: true, follow: true },
};

export default function ContactPage() {
  return (
    <InfoPage title="運営者情報・お問い合わせ">
      <section>
        <h2 className="text-lg font-bold">運営者情報</h2>
        <dl className="mt-3 space-y-3">
          <div>
            <dt className="text-sm text-gray-500">サービス名</dt>
            <dd className="font-medium">ちずぬりえ（Chizunurie）</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">運営者</dt>
            <dd className="font-medium">gamebox（個人開発）</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">連絡先メールアドレス</dt>
            <dd>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-mono font-semibold text-blue-600 underline"
              >
                {CONTACT_EMAIL}
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">お問い合わせ</h2>
        <p className="mt-3">
          本サービスに関するご質問・不具合のご報告・ご意見・ご要望は、上記メールアドレスまで
          お気軽にお送りください。個人で運営しているため返信にお時間をいただく場合がありますが、
          内容はすべて確認しています。
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-sm text-gray-700">
          <li>
            不具合のご報告の際は、お使いの端末・ブラウザ（例：iPhone の Safari）と、
            どの操作で発生したかを書き添えていただけると調査がスムーズです。
          </li>
          <li>
            アカウントの削除をご希望の場合は、
            <Link href="/delete-account" className="text-blue-600 underline">
              アカウント削除ページ
            </Link>
            をご利用ください。
          </li>
          <li>
            個人情報の取り扱いについては
            <Link href="/privacy" className="text-blue-600 underline">
              プライバシーポリシー
            </Link>
            をご確認ください。
          </li>
        </ul>
      </section>
    </InfoPage>
  );
}
