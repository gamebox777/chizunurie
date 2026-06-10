'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/i18n';

// 情報ページ（紹介・遊び方・プライバシーポリシー等）へのリンク集。
// AdSense 等のクローラが地図トップから各コンテンツページへ辿れるよう、
// トップページの最下部（variant="bar"）と各情報ページの末尾（variant="block"）に置く。
type Props = {
  // bar: 地図トップ用の極薄1行（横スクロール可）／ block: 情報ページ用の折返しフッター
  variant?: 'bar' | 'block';
};

export default function SiteFooter({ variant = 'block' }: Props) {
  const { t } = useLocale();

  const links: { href: string; label: string }[] = [
    { href: '/about', label: t('footerAbout') },
    { href: '/how-to-play', label: t('footerHowTo') },
    { href: '/news', label: t('footerNews') },
    { href: '/columns', label: t('footerColumns') },
    { href: '/privacy', label: t('footerPrivacy') },
    { href: '/contact', label: t('footerContact') },
    { href: '/delete-account', label: t('footerDeleteAccount') },
  ];

  if (variant === 'bar') {
    return (
      <footer className="shrink-0 bg-white border-t border-gray-200 px-3 py-1 sm:py-1.5 overflow-x-auto">
        <nav className="flex items-center gap-3 sm:gap-5 whitespace-nowrap text-[11px] leading-4 sm:text-sm sm:leading-5 text-gray-500">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-gray-700 hover:underline shrink-0">
              {l.label}
            </Link>
          ))}
          <span className="ml-auto shrink-0 text-gray-400">© gamebox</span>
        </nav>
      </footer>
    );
  }

  return (
    <footer className="mt-12 border-t border-gray-200 pt-5 pb-8 text-sm sm:text-base text-gray-500">
      <nav className="flex flex-wrap gap-x-4 gap-y-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-gray-700 hover:underline">
            {l.label}
          </Link>
        ))}
      </nav>
      <p className="mt-4 text-xs sm:text-sm text-gray-400">© gamebox — ちずぬりえ / Chizunurie</p>
    </footer>
  );
}
