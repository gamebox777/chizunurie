// ランキング動作確認用のテストユーザーを開発 DB に流し込むスクリプト。
//
//   cd backend && npm run seed:rankings
//
// 冪等：実行のたびに「テストユーザー（email が @ranktest.local）」を一度全削除してから
// 入れ直すので、何度回しても重複しない。テストユーザーを消したいだけなら:
//
//   cd backend && npm run seed:rankings -- --clean
//
// painted_regions / user_points は user への外部キーが onDelete:cascade なので、
// user を消せば塗り・ポイントも一緒に消える。本物のユーザーには一切触れない。
import { like } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { paintedRegions, user, userPoints } from "../src/db/schema.js";
import { expToNext } from "../src/lib/points.js";

const TEST_EMAIL_DOMAIN = "@ranktest.local";

// 各テストユーザーの素性。ランキングのタブごとに違う人が1位になるよう、
// painted（塗ったマス）・gps（GPS訪問）・muni（市区町村数）・level をばらけさせている。
type Spec = {
  slug: string; // id / email に使う識別子
  name: string; // 画面に出るニックネーム
  total: number; // 塗ったマスの総数
  gps: number; // うち GPS 訪問（残りは manual）
  muni: number; // 訪れた市区町村の数（total をこの数の市区町村に振り分ける）
  level: number; // レベル
  activeDays: number; // 塗りを散らす日数（直近 activeDays 日に total を均等配置）
};

// activeDays を変えると週間／月間／全期間で1位が入れ替わる。
// 例：マップ太郎は直近7日に集中→週間トップ、県境ハンターは長期分散→全期間トップ。
const SPECS: Spec[] = [
  { slug: "rank01", name: "ぬりお", total: 1280, gps: 240, muni: 95, level: 18, activeDays: 90 },
  { slug: "rank02", name: "マップ太郎", total: 980, gps: 600, muni: 40, level: 12, activeDays: 7 },
  { slug: "rank03", name: "あるきすと", total: 760, gps: 720, muni: 120, level: 22, activeDays: 45 },
  { slug: "rank04", name: "県境ハンター", total: 2100, gps: 90, muni: 210, level: 9, activeDays: 80 },
  { slug: "rank05", name: "Sato", total: 540, gps: 120, muni: 33, level: 7, activeDays: 30 },
  { slug: "rank06", name: "のんびり塗師", total: 320, gps: 60, muni: 25, level: 5, activeDays: 120 },
  { slug: "rank07", name: "全国制覇したい", total: 1750, gps: 410, muni: 160, level: 30, activeDays: 60 },
  { slug: "rank08", name: "週末トラベラー", total: 880, gps: 510, muni: 88, level: 14, activeDays: 14 },
  { slug: "rank09", name: "ご近所さん", total: 150, gps: 12, muni: 6, level: 3, activeDays: 60 },
  { slug: "rank10", name: "Kenta", total: 1430, gps: 320, muni: 70, level: 16, activeDays: 20 },
];

// 市区町村キー "PREF|CITY" を muni 個ぶん作るための材料。都道府県をまたいで配ると
// それっぽくなるので、県名のリストから順番に市名を生成する。
const PREFS = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "東京都", "神奈川県", "千葉県", "埼玉県", "愛知県", "大阪府", "京都府",
  "兵庫県", "広島県", "岡山県", "福岡県", "熊本県", "鹿児島県", "沖縄県",
];

// i 番目の市区町村キーを決める（都道府県を順に回し、その中で連番の市を作る）。
function muniKeyFor(i: number): string {
  const pref = PREFS[i % PREFS.length];
  const cityNo = Math.floor(i / PREFS.length) + 1;
  return `${pref}|テスト${cityNo}市`;
}

// レベルに応じた累計獲得経験値（level 未満の必要経験値を全部足す）。同レベル同士の
// タイブレークと、データとしての自然さのために概算で入れておく。
function totalExpForLevel(level: number): number {
  let sum = 0;
  for (let lv = 1; lv < level; lv++) sum += expToNext(lv);
  return sum;
}

async function clean(): Promise<number> {
  const deleted = await db
    .delete(user)
    .where(like(user.email, `%${TEST_EMAIL_DOMAIN}`))
    .returning({ id: user.id });
  return deleted.length;
}

async function seed(): Promise<void> {
  const removed = await clean();
  if (removed > 0) console.log(`既存のテストユーザー ${removed} 件を削除しました`);

  const now = new Date();

  for (const spec of SPECS) {
    const id = `testuser-${spec.slug}`;

    await db.insert(user).values({
      id,
      name: spec.name,
      email: `${spec.slug}${TEST_EMAIL_DOMAIN}`,
      emailVerified: true,
      role: "user",
      country: "JPN",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(userPoints).values({
      userId: id,
      points: 10,
      level: spec.level,
      exp: 0,
      totalExp: totalExpForLevel(spec.level),
      // それっぽいプレイ時間（マス数に比例 + レベルぶん）。
      playTimeSec: spec.total * 30 + spec.level * 600,
      updatedAt: now,
    });

    // 塗りマスを total 個作る。先頭 gps 個を 'gps'、残りを 'manual'。
    // 市区町村は muniKeyFor(0..muni-1) を巡回させて muni 種類に散らす。
    // paintedAt は直近 activeDays 日に均等配置（j=0 が最も新しく、最後が activeDays 日前）。
    const spanMs = spec.activeDays * 86_400_000;
    const rows = Array.from({ length: spec.total }, (_, j) => ({
      userId: id,
      sourceLayer: "mesh",
      // keyCode はユーザー内で一意なら良い（ユーザー間の重複は制約対象外）。
      keyCode: String(900_000_000 + j),
      mode: j < spec.gps ? "gps" : "manual",
      municipality: muniKeyFor(j % spec.muni),
      country: "JPN",
      paintedAt: new Date(now.getTime() - Math.round((j / spec.total) * spanMs)),
    }));

    // 大量 INSERT はチャンクに分けて流す（パラメータ数の上限対策）。
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(paintedRegions).values(rows.slice(i, i + CHUNK));
    }

    console.log(
      `投入: ${spec.name.padEnd(10)} total=${spec.total} gps=${spec.gps} muni=${spec.muni} lv=${spec.level}`
    );
  }

  console.log(`\n完了：テストユーザー ${SPECS.length} 人を投入しました。`);
}

async function main() {
  const cleanOnly = process.argv.includes("--clean");
  if (cleanOnly) {
    const removed = await clean();
    console.log(`テストユーザー ${removed} 件を削除しました。`);
  } else {
    await seed();
  }
  // postgres-js のコネクションを閉じてプロセスを終了させる。
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
