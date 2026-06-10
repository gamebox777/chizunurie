import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "なぜ塗りマスは「約1km四方」なのか — 地域メッシュのはなし｜ちずぬりえ",
  description:
    "ちずぬりえの塗りの単位は約1km四方のマス。市区町村単位ではダメだった理由、統計で使われる「地域メッシュ」の考え方、そして世界中を同じルールで塗るための工夫を解説するコラムです。Why Chizunurie paints in ~1 km grid cells.",
  robots: { index: true, follow: true },
};

function JaContent() {
  return (
    <>
      <section>
        <h2 className="text-lg font-bold">市区町村単位だと、なにが困るのか</h2>
        <p className="mt-3">
          「地図を塗りつぶすゲーム」を作るとき、まず思いつくのは市区町村を1つの塗り単位に
          することです。実際、ちずぬりえも開発の最初期は市区町村単位で塗っていました。
          ところがすぐに問題が見えてきます。<strong>行政区画は、広さがあまりに不揃い</strong>なのです。
        </p>
        <p className="mt-3">
          たとえば日本でいちばん広い岐阜県高山市は約2,178km²で、東京都全体（約2,194km²）と
          ほぼ同じ広さがあります。一方、日本でいちばん狭い富山県舟橋村は約3.5km²。
          その差はおよそ600倍です。市区町村を1単位にすると、「高山市を1回訪れる」のと
          「舟橋村を1回訪れる」のが同じ1マスになってしまい、歩いた量とゲームの進み方が
          まったく釣り合いません。都市部はあっという間に塗り終わり、山間部は1つの市を
          塗るのに何日も歩くことになります。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">統計の世界には「地域メッシュ」がある</h2>
        <p className="mt-3">
          この「地域の大きさが不揃い」問題は、ゲームよりずっと前から統計の世界で知られていました。
          人口や産業のデータを市区町村ごとに集計すると、広い自治体と狭い自治体を同じ土俵で
          比べられません。そこで日本の統計では、緯度・経度に沿って国土を網の目（メッシュ）状に
          区切る<strong>「地域メッシュ」</strong>という仕組みが使われています。
          約80km四方の第1次メッシュを8×8に割った約10km四方が第2次メッシュ、
          それをさらに10×10に割った<strong>約1km四方が第3次メッシュ</strong>です。
          国勢調査の人口メッシュデータなどでおなじみの区切り方です。
        </p>
        <p className="mt-3">
          ちずぬりえの塗りマスは、この第3次メッシュと同じ発想の
          「緯度1/120度 × 経度1/80度」のグリッドです。日本付近ではこれがほぼ1km四方になります。
          どこの1マスも同じルールで区切られているので、<strong>都会の1マスも山奥の1マスも
          同じ価値</strong>。歩いた分だけ公平に地図が埋まります。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">マスは「データ」ではなく「数式」でできている</h2>
        <p className="mt-3">
          おもしろいのは、このマスには境界データが存在しないことです。緯度・経度を決まった数で
          割るだけでマスの位置が一意に決まるため、ちずぬりえは画面に映っている範囲のマス目を
          その場で計算して描いています。日本全国ぶんのマスの形をあらかじめ用意すると
          膨大なデータ量になりますが、数式ならゼロ。だからこそ、
          同じ仕組みのまま<strong>世界中どこでも</strong>塗れるようになっています。
        </p>
        <p className="mt-3">
          ちなみに陸地だけで数えても、地球上には約1km四方のマスがおよそ2億個あります。
          すべて塗り終えた人類はまだいません。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">それでも市区町村は主役</h2>
        <p className="mt-3">
          塗りの単位はメッシュですが、「どこまで塗れたか」を実感させてくれるのはやはり
          市区町村です。ちずぬりえでは、市区町村ごとに「その中に約1kmマスが何個あるか」を
          数えておき、塗ったマス数との割合を「○○市 35%（n/N）」のように表示します。
          100% に到達すればその市区町村を「制覇」。メッシュの公平さと、
          行政区画の達成感。両方のいいとこ取りが、ちずぬりえの塗りの仕組みです。
        </p>
      </section>

      <section className="mt-8">
        <p>
          遊び方の基本は
          <Link href="/how-to-play" className="text-blue-600 underline">遊び方ページ</Link>
          へ。コラムの一覧は
          <Link href="/columns" className="text-blue-600 underline">こちら</Link>。
        </p>
      </section>
    </>
  );
}

function EnContent() {
  return (
    <>
      <section>
        <h2 className="text-lg font-bold">What goes wrong with municipalities</h2>
        <p className="mt-3">
          When you build a &ldquo;paint the map&rdquo; game, the first idea is to make each
          municipality one painting unit — and in its earliest days, Chizunurie did exactly that.
          The problem shows up immediately: <strong>administrative areas are wildly uneven in
          size</strong>.
        </p>
        <p className="mt-3">
          Takayama in Gifu, Japan&rsquo;s largest city by area, covers about 2,178 km² — roughly
          the size of all of Tokyo (about 2,194 km²). Funahashi in Toyama, the smallest village,
          is about 3.5 km². That is a difference of roughly 600×. With municipalities as the unit,
          one visit to Takayama and one visit to Funahashi would count as the same single cell, so
          progress would have almost nothing to do with how much you actually walked. Cities would
          be finished in an afternoon while a single mountain municipality could take days.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Statistics already solved this: the regional mesh</h2>
        <p className="mt-3">
          This &ldquo;uneven areas&rdquo; problem was known in statistics long before games.
          Comparing population or industry data across municipalities of very different sizes is
          unfair, so Japanese statistics use a system called the{" "}
          <strong>regional mesh</strong>: the country is divided into a net of cells along lines of
          latitude and longitude. A first-level mesh of about 80 km is split 8×8 into ~10 km
          second-level meshes, each split 10×10 again into{" "}
          <strong>third-level meshes of about 1 km</strong> — the grid familiar from census
          population maps.
        </p>
        <p className="mt-3">
          Chizunurie&rsquo;s cells use the same idea: a grid of 1/120° of latitude by 1/80° of
          longitude, which is almost exactly 1 km square around Japan. Every cell is cut by the
          same rule, so <strong>a downtown cell and a mountain cell are worth the same</strong> —
          the map fills in fairly, in proportion to your walking.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">The cells are a formula, not data</h2>
        <p className="mt-3">
          The fun part: these cells have no boundary data at all. Because dividing latitude and
          longitude by fixed numbers uniquely determines every cell, Chizunurie computes the grid
          for whatever is on screen on the fly. Pre-baking the shapes of every cell in Japan would
          take enormous storage; a formula takes none. That is also why the very same mechanism
          paints <strong>anywhere in the world</strong>.
        </p>
        <p className="mt-3">
          Counting land only, Earth has roughly 200 million of these ~1 km cells. No human being
          has painted them all yet.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Municipalities still get the spotlight</h2>
        <p className="mt-3">
          The painting unit is the mesh, but what makes progress feel real is still the
          municipality. Chizunurie counts how many ~1 km cells each municipality contains and shows
          your ratio like &ldquo;Sapporo 35% (n/N)&rdquo;. Reach 100% and you have conquered it.
          The fairness of the mesh plus the satisfaction of administrative boundaries — the best of
          both is how painting works in Chizunurie.
        </p>
      </section>

      <section className="mt-8">
        <p>
          The basic rules are on the{" "}
          <Link href="/how-to-play" className="text-blue-600 underline">How to play page</Link>;
          all articles are listed{" "}
          <Link href="/columns" className="text-blue-600 underline">here</Link>.
        </p>
      </section>
    </>
  );
}

export default function MeshColumnPage() {
  return (
    <InfoPage
      title={{
        ja: "なぜ塗りマスは「約1km四方」なのか",
        en: "Why the cells are about 1 km square",
      }}
      subtitle={{
        ja: "コラム — 地域メッシュのはなし",
        en: "Article — a story about grid squares",
      }}
      ja={<JaContent />}
      en={<EnContent />}
    />
  );
}
