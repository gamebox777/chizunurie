'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, type Lang } from '@/lib/i18n';
import SiteFooter from './SiteFooter';

// 情報ページ（紹介・遊び方・プライバシーポリシー等）の共通枠。
// 日本語/英語は同一ページ内の上部タブで切り替える。両言語とも SSR の HTML に
// 含まれ（非表示側は hidden 属性）、クローラはどちらのテキストも読める。
// タブの選択はゲーム本体と同じ LocaleProvider の言語設定に連動・保存される。
type Bi = { ja: string; en: string };

export default function InfoPage({
  title,
  subtitle,
  ja,
  en,
}: {
  title: Bi;
  subtitle?: Bi;
  ja: ReactNode;
  en: ReactNode;
}) {
  const { lang, setLang } = useLocale();

  const tabs: { value: Lang; label: string }[] = [
    { value: 'ja', label: '日本語' },
    { value: 'en', label: 'English' },
  ];

  return (
    <main className="min-h-screen bg-white px-5 py-10 text-gray-800 leading-relaxed">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/" className="text-blue-600 underline">
            {lang === 'en' ? '← Back to map' : '← 地図に戻る'}
          </Link>
          <div
            className="flex shrink-0 overflow-hidden rounded-lg border border-gray-200 text-sm"
            role="tablist"
            aria-label="Language / 言語"
          >
            {tabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={lang === tab.value}
                onClick={() => setLang(tab.value)}
                className={`px-4 py-1.5 transition-colors ${
                  lang === tab.value
                    ? 'bg-blue-500 font-medium text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {(['ja', 'en'] as const).map((l) => (
          <section key={l} lang={l} hidden={lang !== l}>
            <h1 className="text-2xl font-bold">{title[l]}</h1>
            {subtitle && <p className="mt-2 text-sm text-gray-600">{subtitle[l]}</p>}
            <div className="mt-6">{l === 'ja' ? ja : en}</div>
          </section>
        ))}

        <SiteFooter />
      </div>
    </main>
  );
}
