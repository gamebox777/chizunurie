import type { Metadata } from "next";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "更新情報｜ちずぬりえ",
  description:
    "GPS 白地図ぬりつぶしゲーム「ちずぬりえ」の更新情報・お知らせの一覧です。新機能の追加や改善の履歴を掲載しています。News and updates for Chizunurie.",
  robots: { index: true, follow: true },
};

type Bi = { ja: string; en: string };

// 更新情報のエントリ。新しいものを先頭に追記していく。
const NEWS: { date: Bi; title: Bi; body: Bi }[] = [
  {
    date: { ja: "2026年6月10日", en: "June 10, 2026" },
    title: {
      ja: "紹介・遊び方などの情報ページを公開しました",
      en: "Published the About, How-to-play and other info pages",
    },
    body: {
      ja: "「ちずぬりえとは」「遊び方」「プライバシーポリシー」「運営者情報・お問い合わせ」「コラム」の各ページを公開しました。地図画面の下部リンクからご覧いただけます。",
      en: "We published the About, How to play, Privacy Policy, Operator & Contact, and Articles pages. You can reach them from the links at the bottom of the map screen.",
    },
  },
  {
    date: { ja: "2026年6月上旬", en: "Early June 2026" },
    title: {
      ja: "アカウント削除ページを公開しました",
      en: "Published the account deletion page",
    },
    body: {
      ja: "ログイン中ならページから直接、ログインできない場合はメールで、アカウントと関連データの削除をリクエストできるようになりました。あわせてお問い合わせ先メールアドレスを統一しました。",
      en: "You can now request deletion of your account and related data directly from the page while signed in, or by email if you cannot sign in. We also unified the contact email address.",
    },
  },
  {
    date: { ja: "2026年6月上旬", en: "Early June 2026" },
    title: {
      ja: "動画を見て塗りポイントを回復できる機能を準備中です",
      en: "A watch-a-video point recovery feature is in preparation",
    },
    body: {
      ja: "塗りポイントが足りないとき、動画広告を最後まで視聴するとポイントを回復できる機能を準備しています。公開までもうしばらくお待ちください。",
      en: "We are preparing a feature that lets you recover paint points by watching a video ad to the end when you run out. Coming soon.",
    },
  },
  {
    date: { ja: "2026年6月", en: "June 2026" },
    title: {
      ja: "世界も塗れるようになりました",
      en: "The whole world is now paintable",
    },
    body: {
      ja: "日本の外も同じ約1km四方のマスで塗れるようになりました。国・州ごとの塗り％も表示されます。海外は1回の操作で10×10マスをまとめて塗れます。",
      en: "Areas outside Japan can now be painted with the same ~1 km cells, with painted percentages per country and state. Outside Japan, one action paints a 10×10 block of cells.",
    },
  },
  {
    date: { ja: "2026年5月下旬", en: "Late May 2026" },
    title: {
      ja: "ランキング機能を追加しました",
      en: "Added rankings",
    },
    body: {
      ja: "塗ったマス数を競う全体ランキングに加えて、都道府県別・国別のランキングを追加しました。ニックネームのみが表示され、メールアドレス等は公開されません。",
      en: "In addition to the overall painted-cell ranking, we added per-prefecture and per-country rankings. Only nicknames are shown; email addresses are never published.",
    },
  },
  {
    date: { ja: "2026年5月下旬", en: "Late May 2026" },
    title: {
      ja: "登録なしで遊べるようになりました",
      en: "Play without signing up",
    },
    body: {
      ja: "初めてアクセスしたときからゲストとしてすぐにプレイでき、塗った内容も保存されるようになりました。あとから登録すると、ゲスト中のデータはそのまま本アカウントへ引き継がれます。",
      en: "You can now play as a guest from your very first visit, and everything you paint is saved. If you register later, your guest data carries over to your account.",
    },
  },
  {
    date: { ja: "2026年5月下旬", en: "Late May 2026" },
    title: {
      ja: "ホーム画面に追加してアプリのように遊べるようになりました（PWA 対応）",
      en: "Add to Home Screen for an app-like experience (PWA)",
    },
    body: {
      ja: "スマートフォンで「ホーム画面に追加」すると、全画面表示でアプリのように起動できます。GPS 再訪ボーナス（同じ場所を時間をおいて再訪すると経験値）も追加しました。",
      en: "On smartphones, “Add to Home Screen” now launches the game full-screen like a native app. We also added a GPS revisit bonus (XP for returning to a place after a while).",
    },
  },
  {
    date: { ja: "2026年5月", en: "May 2026" },
    title: {
      ja: "「ちずぬりえ」を公開しました",
      en: "Chizunurie is live",
    },
    body: {
      ja: "歩いた街が色になる GPS 白地図ぬりつぶしゲーム「ちずぬりえ」を公開しました。全国の市区町村の白地図を、約1km四方のマス単位で塗りつぶせます。",
      en: "We launched Chizunurie, a GPS map-painting game where the streets you walk turn into color. Paint a blank map of every municipality in Japan, one ~1 km cell at a time.",
    },
  },
];

function Entries({ lang }: { lang: "ja" | "en" }) {
  return (
    <div className="space-y-8">
      {NEWS.map((n) => (
        <article key={`${n.date.ja}-${n.title.ja}`} className="border-b border-gray-100 pb-6">
          <p className="text-sm text-gray-500">{n.date[lang]}</p>
          <h2 className="mt-1 text-lg font-bold">{n.title[lang]}</h2>
          <p className="mt-2">{n.body[lang]}</p>
        </article>
      ))}
    </div>
  );
}

export default function NewsPage() {
  return (
    <InfoPage
      title={{ ja: "更新情報", en: "News" }}
      subtitle={{
        ja: "ちずぬりえの新機能・改善のお知らせ",
        en: "New features and improvements in Chizunurie",
      }}
      ja={<Entries lang="ja" />}
      en={<Entries lang="en" />}
    />
  );
}
