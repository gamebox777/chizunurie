/**
 * 市区町村の読み仮名（ひらがな）データを生成する。
 *
 * 出典: 総務省「全国地方公共団体コード」をもとにした code4fukui/localgovjp
 *   https://github.com/code4fukui/localgovjp （CC0）
 *   各団体に 6桁コード(lgcode) と よみがな(citykana, ひらがな) が付く。
 *   lgcode の先頭5桁 = N03 の行政区域コード(N03_007) と一致する。
 *
 * 出力: frontend/public/data/muni-kana.json
 *   {
 *     "byCode": { "01101": "ちゅうおうく", ... },  // 表示名(区名 or 市区町村名)の読み。キー=N03_007
 *     "byCity": { "北海道|札幌市": "さっぽろし", ... } // 政令市ラベル(N03_004)の読み
 *   }
 *
 * 政令指定都市の区は表示名が「区名」だけなので、citykana の末尾セグメント
 * （"さっぽろし ちゅうおうく" → "ちゅうおうく"）を採用する。
 *
 * localgovjp に無い団体（北方領土の村・2024年新設の浜松市の区）は手動で補う。
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicData = join(root, 'frontend', 'public', 'data');

const LOCALGOVJP_URL =
  'https://raw.githubusercontent.com/code4fukui/localgovjp/master/localgovjp.json';

// localgovjp に存在しない団体の読み仮名（N03_007 → ひらがな）。
// 浜松市は 2024-01 に区を再編（中央区/浜名区/天竜区）、北方領土6村は団体データに無い。
const MANUAL_BY_CODE = {
  '22138': 'ちゅうおうく', // 浜松市 中央区
  '22139': 'はまなく', // 浜松市 浜名区
  '22140': 'てんりゅうく', // 浜松市 天竜区
  '01695': 'しこたんむら', // 色丹村（北方領土）
  '01696': 'とまりむら', // 泊村（北方領土）
  '01697': 'るやべつむら', // 留夜別村（北方領土）
  '01698': 'るべつむら', // 留別村（北方領土）
  '01699': 'しゃなむら', // 紗那村（北方領土）
  '01700': 'しべとろむら', // 蘂取村（北方領土）
};

async function main() {
  console.log('localgovjp を取得中...');
  const res = await fetch(LOCALGOVJP_URL);
  if (!res.ok) throw new Error(`localgovjp の取得に失敗: HTTP ${res.status}`);
  const lg = await res.json();

  // lgcode 先頭5桁 → 行(読み仮名つき)
  const byLgCode = new Map();
  // "pref|市区町村名"(空白なし=政令市の親や通常市町村) → よみがな
  const byCity = {};
  for (const r of lg) {
    if (r.lgcode) byLgCode.set(r.lgcode.slice(0, 5), r);
    if (r.city && !/\s/.test(r.city)) {
      byCity[`${r.pref}|${r.city}`] = r.citykana;
    }
  }

  const muni = JSON.parse(readFileSync(join(publicData, 'municipalities.geojson'), 'utf8'));
  const byCode = {};
  const missing = [];
  for (const f of muni.features) {
    const p = f.properties;
    const code = p.N03_007;
    const isWard = Boolean(p.N03_005); // 政令市の区
    const r = byLgCode.get(code);
    if (r) {
      // 区なら citykana の末尾セグメント、市町村なら全体
      byCode[code] = isWard ? r.citykana.split(/\s+/).pop() : r.citykana;
    } else if (MANUAL_BY_CODE[code]) {
      byCode[code] = MANUAL_BY_CODE[code];
    } else {
      // 「所属未定地」など名前のない区域は読みなし
      if (p.N03_004 !== '所属未定地') missing.push([code, p.N03_001, p.N03_004, p.N03_005]);
    }
  }

  if (missing.length) {
    console.warn(`読み仮名が見つからない団体が ${missing.length} 件あります:`);
    for (const m of missing) console.warn('  ', m.join(' '));
  }

  // 政令指定都市ラベル用に N03_004 の読みも確認（不足は警告）
  const cities = JSON.parse(readFileSync(join(publicData, 'designated_cities.geojson'), 'utf8'));
  for (const f of cities.features) {
    const p = f.properties;
    const key = `${p.N03_001}|${p.N03_004}`;
    if (!byCity[key]) console.warn('政令市の読みが見つかりません:', key);
  }

  const out = { byCode, byCity };
  const outPath = join(publicData, 'muni-kana.json');
  writeFileSync(outPath, JSON.stringify(out));
  console.log(
    `完成: muni-kana.json（byCode ${Object.keys(byCode).length} 件 / byCity ${Object.keys(byCity).length} 件）`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
