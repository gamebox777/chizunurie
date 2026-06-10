import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "ちずぬりえとは｜歩いた街が色になる GPS 白地図ぬりつぶしゲーム",
  description:
    "「ちずぬりえ」は、GPS で訪れた場所や選んだ場所を約1km四方のマスで塗っていく、ブラウザで遊べる無料の白地図ぬりつぶしゲームです。市区町村の塗り％やランキングで日本制覇を目指せます。Chizunurie is a free browser-based GPS map-painting game.",
  robots: { index: true, follow: true },
};

function Screenshot({ caption }: { caption: string }) {
  return (
    <>
      <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
        <Image
          src="/promo/promo-ogp.png"
          alt={caption}
          width={1200}
          height={630}
          className="w-full h-auto"
        />
      </div>
      <p className="mt-2 text-xs text-gray-500">{caption}</p>
    </>
  );
}

function JaContent() {
  return (
    <>
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
        <Screenshot caption="白地図の上に、訪れた場所・選んだ場所が約1km四方のマスで塗られていきます。" />
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
    </>
  );
}

function EnContent() {
  return (
    <>
      <section>
        <p>
          Chizunurie (&ldquo;map coloring&rdquo; in Japanese) is a free game you can play right in
          your browser: a blank map of Japan that you fill in with your own feet. When you share
          your GPS location, the roughly 1&nbsp;km × 1&nbsp;km cell you are standing in gets painted.
          Commutes, walks, errands, trips — your everyday movement becomes a record, and the map
          slowly fills with color like a coloring book of everywhere you have been.
        </p>
        <p className="mt-3">
          There is nothing to install and no sign-up required — just open the site on your phone or
          computer and start playing as a guest. If you create a free account later, your painted
          map and points carry over to any device.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Screenshot</h2>
        <Screenshot caption="Places you visit or choose are painted on the blank map as roughly 1 km square cells." />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Features</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong>Paint the map just by walking</strong>: painting the cell you are standing in
            with GPS is free. Places you actually visit are specially recorded as
            &ldquo;visited&rdquo; and earn bonus experience points.
          </li>
          <li>
            <strong>Fair, equal-sized cells (about 1 km square)</strong>: the painting unit is a
            uniform grid that is the same size everywhere. One cell in central Tokyo is worth the
            same as one cell in the countryside — steady walking always fills the map.
          </li>
          <li>
            <strong>Conquer municipalities</strong>: each city, town and village shows a painted
            percentage (painted cells / total cells). Reach 100% to &ldquo;conquer&rdquo; it, and
            conquer every municipality to fully conquer the prefecture.
          </li>
          <li>
            <strong>Points and levels</strong>: places you cannot reach can be painted manually
            using paint points. Painting earns XP, and leveling up raises your maximum points.
          </li>
          <li>
            <strong>Rankings</strong>: compete on painted-cell counts with other players — overall,
            by prefecture, and by country.
          </li>
          <li>
            <strong>The whole world is paintable</strong>: outside Japan the same ~1 km cells apply,
            and your travels are tracked as painted percentages per country and state.
          </li>
          <li>
            <strong>Browser-only, PWA-ready</strong>: no install needed. Add it to your home screen
            to play full-screen like a native app.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Map data sources</h2>
        <p className="mt-3">
          The maps and administrative boundaries are built from the following public and open data:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-sm">
          <li>MLIT &ldquo;National Land Numerical Information&rdquo; (municipal boundaries)</li>
          <li>Statistics Bureau of Japan, e-Stat census small-area data (neighborhood boundaries)</li>
          <li>Geospatial Information Authority of Japan (GSI) maps (base-map overlay and reverse geocoding)</li>
          <li>Natural Earth (country and state boundaries for the world map)</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Jump in</h2>
        <p className="mt-3">
          The full rules are on the{" "}
          <Link href="/how-to-play" className="text-blue-600 underline">How to play page</Link>.
          To start, just <Link href="/" className="text-blue-600 underline">open the map</Link> and
          tap the GPS button — your first cell gets its color right where you are.
        </p>
      </section>
    </>
  );
}

export default function AboutPage() {
  return (
    <InfoPage
      title={{ ja: "ちずぬりえとは", en: "About Chizunurie" }}
      subtitle={{
        ja: "歩いた街が色になる、GPS 白地図ぬりつぶしゲーム",
        en: "A GPS map-painting game where the streets you walk turn into color",
      }}
      ja={<JaContent />}
      en={<EnContent />}
    />
  );
}
