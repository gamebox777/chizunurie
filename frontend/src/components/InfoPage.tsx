import type { ReactNode } from 'react';
import Link from 'next/link';
import SiteFooter from './SiteFooter';

// 情報ページ（紹介・遊び方・プライバシーポリシー等）の共通枠。
// サーバーコンポーネントとして SSR され、クローラがテキストを読める状態で配信される。
export default function InfoPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-white px-5 py-10 text-gray-800 leading-relaxed">
      <div className="mx-auto max-w-2xl">
        <p className="mb-5">
          <Link href="/" className="text-blue-600 underline">
            ← 地図に戻る / Back to map
          </Link>
        </p>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-gray-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        <SiteFooter />
      </div>
    </main>
  );
}
