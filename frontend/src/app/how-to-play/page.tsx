import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "遊び方｜ちずぬりえ",
  description:
    "ちずぬりえの遊び方ガイド。GPS で現在地を塗る方法、となり塗り・離れた場所塗りの違い、塗りポイントの回復、レベルと経験値、市区町村の制覇、ランキングまでをまとめて説明します。",
  robots: { index: true, follow: true },
};

export default function HowToPlayPage() {
  return (
    <InfoPage title="遊び方" subtitle="はじめてでも3分でわかる、ちずぬりえの基本">
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
    </InfoPage>
  );
}
