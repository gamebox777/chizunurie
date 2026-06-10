import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "ちずぬりえ散歩のすすめ — 歩いて塗るのを楽しむコツ｜ちずぬりえ",
  description:
    "毎日の通勤・散歩を「塗り」に変える工夫、市区町村100%制覇の進め方、旅行先での塗り方、ポイントの上手な使い方など、ちずぬりえをもっと楽しむためのヒントを紹介するコラムです。Tips for enjoying Chizunurie on foot.",
  robots: { index: true, follow: true },
};

function JaContent() {
  return (
    <>
      <section>
        <h2 className="text-lg font-bold">いつもの道を、すこしだけ変えてみる</h2>
        <p className="mt-3">
          ちずぬりえのいちばんの楽しみ方は、特別な遠出ではなく「いつもの移動」を塗りに変える
          ことです。GPS塗りは無料で、実際に訪れた場所として経験値ボーナス（+100）も付きます。
          通勤・通学の途中、駅のひとつ手前で降りて歩く。昼休みの散歩でいつもと逆方向に曲がる。
          約1km四方のマスは思いのほか細かいので、ほんの数百メートル進路を変えるだけで
          「まだ塗っていないマス」に届きます。
        </p>
        <p className="mt-3">
          歩き回ると、マスの中にはさらに細かい「足あと」も刻まれていきます。同じマスの中でも
          歩いた分だけ少しずつ経験値が増えるので、散歩そのものが無駄になりません。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">最初の目標は「自分の街を100%」</h2>
        <p className="mt-3">
          まず目指したいのは、住んでいる市区町村の制覇（塗り％100%）です。マスにカーソルを
          合わせると「○○市 35%（n/N）」のように進み具合が出るので、残りのマス数が一目で
          わかります。進め方のコツは次の3つです。
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong>外周から攻める</strong>：市の境界沿いはふだん歩かない場所が多く、
            塗り残しがたまりがちです。境界沿いを一周するルートを何回かに分けて歩くと、
            あとは内側を埋めるだけになります。
          </li>
          <li>
            <strong>「となり塗り」で橋をかける</strong>：川や線路で歩いて行きにくい場所は、
            塗り済みマスに隣接していれば1ポイントで塗れます。歩ける場所は歩いて、
            歩きにくい場所はポイントで。使い分けが攻略の鍵です。
          </li>
          <li>
            <strong>ポイントは寝ている間に貯まる</strong>：塗りポイントは10分に1ずつ自動回復します。
            夜のうちに満タンになったポイントを、朝の通勤で「となり塗り」に使うのが効率的です。
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">旅行は「塗りの祭り」</h2>
        <p className="mt-3">
          旅行や出張は、ふだん絶対に塗れないマスを一気に増やすチャンスです。電車や車での移動中も、
          時々 GPS ボタンを押せば通過した場所のマスが塗れます。降りた駅・観光地・宿。
          帰ってから地図を引いて眺めると、自分の旅程がそのまま色の帯になって残っているのが
          わかります。市区町村名のラベルには読み仮名も付くので、知らない土地の地名を
          覚えるのもひそかな楽しみです。海外に行くなら、1回の操作で10×10マスをまとめて
          塗れる海外塗りもお試しください。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">続けるコツは「記録を眺めること」</h2>
        <p className="mt-3">
          塗り絵のような達成感は、ときどき地図全体を引いて眺めることで生まれます。
          1週間前より明らかに色が増えている——それだけで次の散歩に出る理由になります。
          ランキング（全体・都道府県別・国別）で他のプレイヤーの塗りっぷりを見るのも刺激に
          なります。アカウントを登録しておけば、スマートフォンを買い替えても記録は
          引き継がれます。
        </p>
      </section>

      <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-base font-bold text-amber-900">⚠ 安全がいちばん</h2>
        <p className="mt-2 text-sm text-amber-900">
          歩きながらの画面注視（歩きスマホ）は絶対にやめましょう。GPS塗りは立ち止まって、
          周囲の安全を確かめてから。私有地や立入禁止区域には入らず、夜間の散歩は明るく
          人通りのある道を選んでください。
        </p>
      </section>

      <section className="mt-8">
        <p>
          基本のルールは
          <Link href="/how-to-play" className="text-blue-600 underline">遊び方ページ</Link>
          に、塗りマスの仕組みはコラム
          <Link href="/columns/mesh-1km" className="text-blue-600 underline">
            「なぜ塗りマスは約1km四方なのか」
          </Link>
          にまとめています。
        </p>
      </section>
    </>
  );
}

function EnContent() {
  return (
    <>
      <section>
        <h2 className="text-lg font-bold">Change your usual route, just a little</h2>
        <p className="mt-3">
          The best way to enjoy Chizunurie is not a special expedition — it is turning your
          everyday movement into painting. GPS painting is free and earns a +100 XP bonus for an
          actual visit. Get off one station early on your commute. Turn the other way on your lunch
          walk. The ~1 km cells are finer than you expect, so a detour of a few hundred meters is
          often enough to reach a cell you have never painted.
        </p>
        <p className="mt-3">
          As you wander, finer &ldquo;footprints&rdquo; are etched inside each cell too — even
          inside a painted cell, walking keeps adding a little XP, so no stroll is wasted.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">First goal: your own town at 100%</h2>
        <p className="mt-3">
          A great first target is conquering the municipality you live in (100% painted). Hover
          over a cell to see progress like &ldquo;Suginami 35% (n/N)&rdquo; — the remaining cell
          count at a glance. Three tips:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong>Work the perimeter first</strong>: cells along the municipal boundary are the
            ones you never normally walk, and they pile up as leftovers. Walk the boundary loop in
            a few sessions and all that remains is filling the inside.
          </li>
          <li>
            <strong>Bridge with adjacent painting</strong>: spots cut off by rivers or rail lines
            can be painted for 1 point if they touch a painted cell. Walk what you can walk, spend
            points on what you cannot — the balance is the strategy.
          </li>
          <li>
            <strong>Points accumulate while you sleep</strong>: paint points regenerate one every
            10 minutes. Spending a full overnight tank on adjacent painting during the morning
            commute is the efficient play.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Trips are painting festivals</h2>
        <p className="mt-3">
          Trips and business travel are your chance to grab cells you could never reach otherwise.
          Even on a train or in a car, tapping the GPS button now and then paints the cells you
          pass through. The station you got off at, the sights, the hotel — zoom out when you get
          home and your itinerary is right there as a ribbon of color. Going abroad? Try overseas
          painting, where one action fills a 10×10 block of cells.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">The secret to keeping going: look at the record</h2>
        <p className="mt-3">
          The coloring-book satisfaction comes from occasionally zooming all the way out. Clearly
          more color than a week ago — that alone is a reason for the next walk. Checking the
          rankings (overall, by prefecture, by country) to see how others are painting is good fuel
          too. Register an account and your record survives a phone upgrade.
        </p>
      </section>

      <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-base font-bold text-amber-900">⚠ Safety first</h2>
        <p className="mt-2 text-sm text-amber-900">
          Never stare at your screen while walking. Stop, check your surroundings, then use GPS
          painting. Stay out of private property and restricted areas, and choose bright,
          well-traveled streets for night walks.
        </p>
      </section>

      <section className="mt-8">
        <p>
          The basic rules are on the{" "}
          <Link href="/how-to-play" className="text-blue-600 underline">How to play page</Link>,
          and how the cells work is explained in{" "}
          <Link href="/columns/mesh-1km" className="text-blue-600 underline">
            &ldquo;Why the cells are about 1 km square&rdquo;
          </Link>
          .
        </p>
      </section>
    </>
  );
}

export default function WalkingTipsPage() {
  return (
    <InfoPage
      title={{
        ja: "ちずぬりえ散歩のすすめ",
        en: "The Chizunurie walk",
      }}
      subtitle={{
        ja: "コラム — 歩いて塗るのを楽しむコツ",
        en: "Article — tips for enjoying painting on foot",
      }}
      ja={<JaContent />}
      en={<EnContent />}
    />
  );
}
