import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "なぜ塗りマスは「約1km四方」なのか — 地域メッシュのはなし｜ちずぬりえ",
  description:
    "ちずぬりえの塗りの単位は約1km四方のマス。市区町村単位ではダメだった理由、統計で使われる「地域メッシュ」の考え方、そして世界中を同じルールで塗るための工夫を解説するコラムです。",
  robots: { index: true, follow: true },
};

export default function MeshColumnPage() {
  return (
    <InfoPage
      title="なぜ塗りマスは「約1km四方」なのか"
      subtitle="コラム — 地域メッシュのはなし"
    >
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
    </InfoPage>
  );
}
