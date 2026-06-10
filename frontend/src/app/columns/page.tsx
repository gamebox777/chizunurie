import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "コラム｜ちずぬりえ",
  description:
    "GPS 白地図ぬりつぶしゲーム「ちずぬりえ」のコラム一覧。地図やメッシュの豆知識、歩いて塗るのを楽しむコツなどを掲載しています。",
  robots: { index: true, follow: true },
};

const ARTICLES: { href: string; title: string; summary: string }[] = [
  {
    href: "/columns/mesh-1km",
    title: "なぜ塗りマスは「約1km四方」なのか — 地域メッシュのはなし",
    summary:
      "ちずぬりえの塗りの単位である約1km四方のマスはどう決まっているのか。市区町村単位ではダメだった理由と、統計で使われる「地域メッシュ」の考え方を紹介します。",
  },
  {
    href: "/columns/walking-tips",
    title: "ちずぬりえ散歩のすすめ — 歩いて塗るのを楽しむコツ",
    summary:
      "毎日の通勤・散歩を「塗り」に変える工夫、市区町村100%制覇の進め方、旅行先での塗り方など、ちずぬりえをもっと楽しむためのヒントをまとめました。",
  },
];

export default function ColumnsPage() {
  return (
    <InfoPage title="コラム" subtitle="地図のはなし・遊び方のヒント">
      <div className="space-y-8">
        {ARTICLES.map((a) => (
          <article key={a.href} className="border-b border-gray-100 pb-6">
            <h2 className="text-lg font-bold">
              <Link href={a.href} className="text-blue-700 hover:underline">
                {a.title}
              </Link>
            </h2>
            <p className="mt-2">{a.summary}</p>
            <p className="mt-2">
              <Link href={a.href} className="text-sm text-blue-600 underline">
                続きを読む →
              </Link>
            </p>
          </article>
        ))}
      </div>
    </InfoPage>
  );
}
