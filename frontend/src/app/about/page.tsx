import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "ちずぬりえとは｜歩いた街が色になる GPS 白地図ぬりつぶしゲーム",
  description:
    "「ちずぬりえ」は、GPS で訪れた場所や選んだ場所を約1km四方のマスで塗っていく、ブラウザで遊べる無料の白地図ぬりつぶしゲームです。市区町村の塗り％やランキングで日本制覇を目指せます。",
  robots: { index: true, follow: true },
};

export default function AboutPage() {
  return (
    <InfoPage
      title="ちずぬりえとは"
      subtitle="歩いた街が色になる、GPS 白地図ぬりつぶしゲーム"
    >
      <section>
        <p>
          「ちずぬりえ」は、日本の白地図を自分の足で塗りつぶしていく、ブラウザでそのまま遊べる
          無料のゲームです。GPS で現在地を取得すると、いま立っている場所の「約1km四方のマス」に
          色が付きます。通勤・通学・散歩・旅行——ふだんの移動がそのまま記録になり、
          地図の上に「自分が歩いてきた軌跡」が塗り絵のように広がっていきます。
        </p>
        <p className="mt-3">
          アプリのインストールや会員登録は不要で、スマートフォンやパソコンのブラウザで開くだけで
          すぐに遊び始められます（ゲストとしてプレイ可能）。アカウントを登録すると、
          塗った地図やポイントを別の端末でも引き継げます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">スクリーンショット</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
          <Image
            src="/promo/promo-ogp.png"
            alt="ちずぬりえのプレイ画面イメージ。白地図の上に塗ったマスが色付きで表示されている"
            width={1200}
            height={630}
            className="w-full h-auto"
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          白地図の上に、訪れた場所・選んだ場所が約1km四方のマスで塗られていきます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">特徴</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong>歩くだけで地図が塗れる</strong>
            ：GPS で現在地のマスを無料で塗れます。実際に訪れた場所は「訪問済み」として特別に記録され、
            経験値ボーナスももらえます。
          </li>
          <li>
            <strong>約1km四方の公平なマス</strong>
            ：塗りの単位は全国どこでも同じ広さの約1km四方のグリッドです。都会でも地方でも、
            1マスは1マス。コツコツ塗った分だけ確実に地図が埋まります。
          </li>
          <li>
            <strong>市区町村の「制覇」</strong>
            ：市区町村ごとに塗り％（塗ったマス数／全マス数）が表示され、100% に到達するとその
            市区町村を「制覇」。さらに都道府県の完全制覇も目指せます。
          </li>
          <li>
            <strong>ポイントとレベル</strong>
            ：行けない場所は「塗りポイント」を使って手動でも塗れます。塗るほど経験値がたまり、
            レベルが上がるとポイントの上限が増えていきます。
          </li>
          <li>
            <strong>ランキング</strong>
            ：塗ったマス数を全国のプレイヤーと競えます。全体ランキングのほか、都道府県別・国別の
            ランキングもあります。
          </li>
          <li>
            <strong>世界も塗れる</strong>
            ：日本の外も同じ約1kmマスで塗れます。海外旅行の足あとも、国・州ごとの塗り％として
            記録されます。
          </li>
          <li>
            <strong>ブラウザだけで動く・PWA 対応</strong>
            ：インストール不要。ホーム画面に追加すればアプリのように全画面で遊べます。
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">使っている地図データ</h2>
        <p className="mt-3">
          地図・行政区域のデータには、次の公的・オープンなデータを加工して利用しています。
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-sm">
          <li>国土交通省「国土数値情報（行政区域データ）」（市区町村の境界）</li>
          <li>総務省統計局 e-Stat「国勢調査 小地域データ」（町丁目の境界）</li>
          <li>国土地理院 地理院地図（背景地図のオーバーレイ表示・住所の逆ジオコーディング）</li>
          <li>Natural Earth（世界版の国・州の境界）</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">さっそく遊んでみる</h2>
        <p className="mt-3">
          遊び方の詳しい説明は<Link href="/how-to-play" className="text-blue-600 underline">遊び方ページ</Link>
          にまとめています。まずは<Link href="/" className="text-blue-600 underline">地図を開いて</Link>、
          GPS ボタンを押してみてください。いまいる場所に最初の色が付きます。
        </p>
      </section>
    </InfoPage>
  );
}
