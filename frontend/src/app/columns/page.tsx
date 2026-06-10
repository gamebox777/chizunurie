import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "コラム｜ちずぬりえ",
  description:
    "GPS 白地図ぬりつぶしゲーム「ちずぬりえ」のコラム一覧。地図やメッシュの豆知識、歩いて塗るのを楽しむコツなどを掲載しています。Articles about maps and tips for Chizunurie.",
  robots: { index: true, follow: true },
};

type Bi = { ja: string; en: string };

const ARTICLES: { href: string; title: Bi; summary: Bi }[] = [
  {
    href: "/columns/mesh-1km",
    title: {
      ja: "なぜ塗りマスは「約1km四方」なのか — 地域メッシュのはなし",
      en: "Why the cells are about 1 km square — a story about grid squares",
    },
    summary: {
      ja: "ちずぬりえの塗りの単位である約1km四方のマスはどう決まっているのか。市区町村単位ではダメだった理由と、統計で使われる「地域メッシュ」の考え方を紹介します。",
      en: "How the ~1 km cells that Chizunurie paints are defined: why municipalities didn't work as the painting unit, and the “regional mesh” idea used in Japanese statistics.",
    },
  },
  {
    href: "/columns/walking-tips",
    title: {
      ja: "ちずぬりえ散歩のすすめ — 歩いて塗るのを楽しむコツ",
      en: "The Chizunurie walk — tips for enjoying painting on foot",
    },
    summary: {
      ja: "毎日の通勤・散歩を「塗り」に変える工夫、市区町村100%制覇の進め方、旅行先での塗り方など、ちずぬりえをもっと楽しむためのヒントをまとめました。",
      en: "Turning daily commutes and walks into painting, strategies for conquering a municipality at 100%, painting on trips, and other hints for getting more out of the game.",
    },
  },
];

function ArticleList({ lang }: { lang: "ja" | "en" }) {
  const readMore = lang === "ja" ? "続きを読む →" : "Read more →";
  return (
    <div className="space-y-8">
      {ARTICLES.map((a) => (
        <article key={a.href} className="border-b border-gray-100 pb-6">
          <h2 className="text-lg font-bold">
            <Link href={a.href} className="text-blue-700 hover:underline">
              {a.title[lang]}
            </Link>
          </h2>
          <p className="mt-2">{a.summary[lang]}</p>
          <p className="mt-2">
            <Link href={a.href} className="text-sm text-blue-600 underline">
              {readMore}
            </Link>
          </p>
        </article>
      ))}
    </div>
  );
}

export default function ColumnsPage() {
  return (
    <InfoPage
      title={{ ja: "コラム", en: "Articles" }}
      subtitle={{
        ja: "地図のはなし・遊び方のヒント",
        en: "Map trivia and tips for playing",
      }}
      ja={<ArticleList lang="ja" />}
      en={<ArticleList lang="en" />}
    />
  );
}
