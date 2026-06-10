import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "遊び方｜ちずぬりえ",
  description:
    "ちずぬりえの遊び方ガイド。GPS で現在地を塗る方法、となり塗り・離れた場所塗りの違い、塗りポイントの回復、レベルと経験値、市区町村の制覇、ランキングまでをまとめて説明します。How to play Chizunurie.",
  robots: { index: true, follow: true },
};

function JaContent() {
  return (
    <>
      <section>
        <h2 className="text-lg font-bold">1. まずは開くだけ — 登録は不要</h2>
        <p className="mt-3">
          <Link href="/" className="text-blue-600 underline">地図のページ</Link>
          を開くと、自動的にゲストとしてゲームが始まります。会員登録やアプリのインストールは
          必要ありません。塗った内容はゲストのままでも保存されます。
        </p>
        <p className="mt-2">
          メールアドレスまたは Google アカウントで登録（無料）すると、塗った地図・ポイント・レベルを
          別の端末でも引き継げます。ゲスト中に塗った分は、登録時にそのまま本アカウントへ移行されます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">2. 塗りの単位は「約1km四方のマス」</h2>
        <p className="mt-3">
          地図をズームしていくと（目安：ズーム10以上）、地図の上に細かいマス目が現れます。
          これが塗りの単位で、全国どこでも同じ広さの<strong>約1km四方のグリッド</strong>です。
          引いた状態では市区町村の白地図として全体を見渡せます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">3. 塗り方は3種類</h2>
        <ul className="mt-3 list-disc space-y-3 pl-6">
          <li>
            <strong>GPS塗り（無料）</strong>
            ：地図の GPS ボタンで現在地を取得すると、いまいるマスが塗れます。実際に訪れた場所として
            記録され、<strong>経験値 +100</strong> のボーナス。同じマスでも時間をおいて再訪すると
            再訪ボーナスがもらえます。さらに歩き回ると、マスの中に細かい「足あと」が刻まれて
            少しずつ経験値が増えます。
          </li>
          <li>
            <strong>となり塗り（1ポイント）</strong>
            ：塗り済みのマスに隣接するマスは、タップ（クリック）で1ポイント消費して塗れます。
            最初の1マスだけはどこでも自由に塗れます。経験値 +50。
          </li>
          <li>
            <strong>離れた場所塗り（10ポイント）</strong>
            ：隣接していない離れた場所も、確認のうえ10ポイントで塗れます。経験値 +50。
            なお日本国外は1回の操作で 10×10 マスをまとめて塗れます。
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">4. 塗りポイントの回復</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>ポイントは<strong>時間経過で自動回復</strong>します（10分ごとに1ポイント）。</li>
          <li>最大ポイントは最初は10。<strong>レベルが上がると上限が増えます</strong>。</li>
          <li>
            動画広告を最後まで視聴するとポイントを回復できる機能を準備中です
            （公開までもうしばらくお待ちください）。
          </li>
          <li>GPS塗りはポイントを消費しません。歩ける場所は歩いて塗るのがおトクです。</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">5. レベルと経験値（XP）</h2>
        <p className="mt-3">
          塗ったり訪れたりするたびに経験値がたまり、一定値に達するとレベルアップします。
          レベルが上がると塗りポイントの上限が増え、より広く塗れるようになります。
          経験値は累積制で、減ることはありません。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">6. 市区町村を「制覇」しよう</h2>
        <p className="mt-3">
          マスにカーソルを合わせる（タップする）と、その市区町村の塗り％が
          「○○市　35%（n/N）」のように表示されます。市区町村のすべてのマスを塗って
          <strong> 100% にすると「制覇」</strong>。市区町村をぜんぶ制覇すると、
          その都道府県の「完全制覇」になります。世界では国・州ごとの塗り％が表示されます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">7. ランキング</h2>
        <p className="mt-3">
          塗ったマスの数は、全体ランキング・都道府県別・国別のランキングで他のプレイヤーと
          競えます。毎日の散歩がそのまま順位に反映されます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">8. 便利な設定</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>ヘッダー右の歯車メニューから、言語（日本語／English）を切り替えられます。</li>
          <li>「地図を薄く表示」を ON にすると、白地図の下に地理院地図をうっすら重ねられます。道や駅を確認しながら塗りたいときに便利です。</li>
          <li>BGM・効果音・バイブ（対応端末）も歯車メニューで設定できます。</li>
          <li>スマートフォンでは「ホーム画面に追加」すると、アプリのように全画面で遊べます。</li>
        </ul>
      </section>

      <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-base font-bold text-amber-900">⚠ 安全に遊ぶために</h2>
        <p className="mt-2 text-sm text-amber-900">
          歩きながら画面を見続ける「歩きスマホ」は危険です。GPS塗りは立ち止まって行い、
          周囲の安全・交通ルール・立入禁止区域に十分注意してプレイしてください。
        </p>
      </section>

      <section className="mt-8">
        <p>
          ゲームの概要・特徴は
          <Link href="/about" className="text-blue-600 underline">「ちずぬりえとは」</Link>
          、楽しみ方のヒントは
          <Link href="/columns" className="text-blue-600 underline">コラム</Link>
          もどうぞ。
        </p>
      </section>
    </>
  );
}

function EnContent() {
  return (
    <>
      <section>
        <h2 className="text-lg font-bold">1. Just open it — no sign-up needed</h2>
        <p className="mt-3">
          Open the <Link href="/" className="text-blue-600 underline">map page</Link> and the game
          starts automatically as a guest. No account, no install. Everything you paint is saved
          even as a guest.
        </p>
        <p className="mt-2">
          Sign up for free with an email address or a Google account to carry your painted map,
          points and level across devices. Anything you painted as a guest is transferred to your
          account when you register.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">2. The painting unit: cells about 1 km square</h2>
        <p className="mt-3">
          Zoom in (roughly zoom level 10 or more) and a fine grid appears on the map. These cells
          are the painting unit — a <strong>uniform grid about 1 km square</strong>, the same size
          everywhere. Zoom out and you get a blank municipal map of Japan to admire your progress.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">3. Three ways to paint</h2>
        <ul className="mt-3 list-disc space-y-3 pl-6">
          <li>
            <strong>GPS painting (free)</strong>: tap the GPS button and the cell you are standing
            in gets painted. It is recorded as actually visited and earns a{" "}
            <strong>+100 XP</strong> bonus. Revisiting the same cell after a while earns a revisit
            bonus, and walking around inside a cell leaves fine &ldquo;footprints&rdquo; that add
            extra XP bit by bit.
          </li>
          <li>
            <strong>Adjacent painting (1 point)</strong>: any cell next to one you have already
            painted can be painted with a tap for 1 point. Your very first cell can be placed
            anywhere for free. +50 XP.
          </li>
          <li>
            <strong>Remote painting (10 points)</strong>: faraway, non-adjacent cells can be painted
            for 10 points after a confirmation. +50 XP. Outside Japan, one action paints a 10×10
            block of cells at once.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">4. Recovering paint points</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>Points <strong>regenerate automatically</strong> over time (1 point every 10 minutes).</li>
          <li>Your maximum starts at 10 and <strong>grows as you level up</strong>.</li>
          <li>
            A feature to recover points by watching a video ad to the end is in preparation —
            coming soon.
          </li>
          <li>GPS painting never costs points. If you can walk there, walking is always the best deal.</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">5. Levels and experience (XP)</h2>
        <p className="mt-3">
          Painting and visiting earn XP, and reaching the threshold levels you up. Each level raises
          your maximum paint points so you can paint wider. XP is cumulative and never decreases.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">6. Conquer municipalities</h2>
        <p className="mt-3">
          Hover over (or tap) a cell to see the municipality&rsquo;s painted percentage, shown like
          &ldquo;Sapporo 35% (n/N)&rdquo;. Paint every cell in a municipality to reach{" "}
          <strong>100% and &ldquo;conquer&rdquo; it</strong>. Conquer all municipalities in a
          prefecture for a full conquest. Outside Japan, percentages are shown per country and
          state.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">7. Rankings</h2>
        <p className="mt-3">
          Compete on painted-cell counts in the overall ranking, plus per-prefecture and per-country
          rankings. Every daily walk counts toward your rank.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">8. Handy settings</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>Switch the language (日本語 / English) from the gear menu at the top right.</li>
          <li>
            Turn on &ldquo;show base map&rdquo; to overlay a faint GSI map under the blank map —
            useful for checking roads and stations while you paint.
          </li>
          <li>BGM, sound effects and vibration (on supported devices) are also in the gear menu.</li>
          <li>On smartphones, &ldquo;Add to Home Screen&rdquo; gives you a full-screen, app-like experience.</li>
        </ul>
      </section>

      <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-base font-bold text-amber-900">⚠ Play safely</h2>
        <p className="mt-2 text-sm text-amber-900">
          Staring at your screen while walking is dangerous. Stop walking before you use GPS
          painting, watch your surroundings, follow traffic rules, and stay out of restricted
          areas.
        </p>
      </section>

      <section className="mt-8">
        <p>
          For an overview of the game, see{" "}
          <Link href="/about" className="text-blue-600 underline">About Chizunurie</Link>; for tips
          on enjoying it, check the{" "}
          <Link href="/columns" className="text-blue-600 underline">articles</Link>.
        </p>
      </section>
    </>
  );
}

export default function HowToPlayPage() {
  return (
    <InfoPage
      title={{ ja: "遊び方", en: "How to play" }}
      subtitle={{
        ja: "はじめてでも3分でわかる、ちずぬりえの基本",
        en: "The basics of Chizunurie in three minutes",
      }}
      ja={<JaContent />}
      en={<EnContent />}
    />
  );
}
