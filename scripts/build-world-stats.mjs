/**
 * 世界版の塗り％の分母（州・県ごと＋国ごとの約1kmセル総数）を作る。
 *
 * 日本版 build-muni-stats.mjs の世界版。ただし計算方式が違う：
 *   - 日本版: 各ポリゴンの bbox 内を1セルずつ point-in-polygon（約30万セル）。
 *   - 世界版: 陸地セルは約2〜3億あり per-cell PIP では非現実的。そこで
 *     「scanline 塗りつぶし」に置き換える。各セル行 ri の中央緯度で水平線を引き、
 *     ポリゴンの全エッジとの交点 x を求めてソートし、even-odd で内側区間を作り、
 *     その区間に中心が入るセル数を一気に加算する。セルを Set に貯めないので
 *     メモリ O(1)・計算 O(総セル数) で済む。
 *
 * 入力: frontend/public/data/world-states.geojson（build-world.mjs が生成・
 *       name / admin / adm0_a3 / adm1_code を持つ）
 * 出力: frontend/public/data/world-stats.json
 *       { states: { adm1_code: セル数 }, countries: { adm0_a3: セル数 },
 *         stateMeta: { adm1_code: { name, name_ja, admin, adm0_a3 } },
 *         countryMeta: { adm0_a3: { name, name_ja } } }（国名は world-countries.geojson 由来）
 *
 * 高緯度の歪みは補正しない（生セル数）。Map.tsx の meshCodeAt と同じグリッド定数を使う。
 *
 * 使い方: node --max-old-space-size=8192 scripts/build-world-stats.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicData = join(__dirname, '..', 'frontend', 'public', 'data');

// Map.tsx と同一のグリッド（緯度1/120°・経度1/80°の均一グリッド）
const LAT_DIV = 120;
const LON_DIV = 80;

// geometry を「リング配列（=1ポリゴン）」の配列に正規化
function toPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/**
 * 1ポリゴン（rings=[outer, hole, ...]）の陸地セル数を scanline で数える。
 * cells を貯めずカウントのみ。中心がポリゴン内に入るセルを「内側」とする。
 */
function countCellsInPolygon(rings) {
  // bbox から行範囲を出す
  let minLat = Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [, y] of ring) {
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
  }
  const riMin = Math.floor(minLat * LAT_DIV);
  const riMax = Math.floor(maxLat * LAT_DIV);
  let count = 0;
  const xs = [];
  for (let ri = riMin; ri <= riMax; ri++) {
    const lat = (ri + 0.5) / LAT_DIV; // セル中央の緯度で走査
    xs.length = 0;
    // 全リングの全エッジと水平線 y=lat の交点 x を集める
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const yi = ring[i][1], yj = ring[j][1];
        // 片方が lat 以下、もう片方が lat より上のときだけ交差（境界の二重カウント回避）
        if ((yi > lat) !== (yj > lat)) {
          const xi = ring[i][0], xj = ring[j][0];
          xs.push(xi + ((lat - yi) / (yj - yi)) * (xj - xi));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    // even-odd: [xs[0],xs[1]], [xs[2],xs[3]], ... が内側区間
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = xs[k], xb = xs[k + 1];
      // 中心 lng=(ci+0.5)/LON_DIV が [xa,xb] に入る ci の個数
      const ciFirst = Math.ceil(xa * LON_DIV - 0.5);
      const ciLast = Math.floor(xb * LON_DIV - 0.5);
      if (ciLast >= ciFirst) count += ciLast - ciFirst + 1;
    }
  }
  return count;
}

function main() {
  console.log('world-states.geojson を読み込み中...');
  const states = JSON.parse(readFileSync(join(publicData, 'world-states.geojson'), 'utf8'));

  /** @type {Map<string, number>} adm1_code → セル数 */
  const byState = new Map();
  /** @type {Map<string, number>} adm0_a3 → セル数 */
  const byCountry = new Map();
  /** @type {Object<string, {name,name_ja,admin,adm0_a3}>} */
  const stateMeta = {};

  let processed = 0;
  const n = states.features.length;
  for (const f of states.features) {
    const p = f.properties || {};
    const code = p.adm1_code;
    const a3 = p.adm0_a3 || '';
    if (!code) continue;
    let cells = 0;
    for (const rings of toPolygons(f.geometry)) cells += countCellsInPolygon(rings);
    byState.set(code, (byState.get(code) ?? 0) + cells);
    if (a3) byCountry.set(a3, (byCountry.get(a3) ?? 0) + cells);
    stateMeta[code] = {
      name: p.name ?? '',
      name_ja: p.name_ja ?? '',
      admin: p.admin ?? '',
      adm0_a3: a3,
    };
    if (++processed % 200 === 0) process.stdout.write(`\r  ${processed}/${n} 州・県`);
  }
  process.stdout.write(`\r  ${processed}/${n} 州・県\n`);

  // 国名（日本語・英語）は world-countries.geojson（ADM0_A3 / NAME / NAME_JA）から引く。
  // ホバー時に「日本語の国名」を出すためのメタ。states 側は admin（英名）しか持たない。
  const countryMeta = {};
  try {
    const countries = JSON.parse(readFileSync(join(publicData, 'world-countries.geojson'), 'utf8'));
    for (const f of countries.features) {
      const p = f.properties || {};
      const a3 = p.ADM0_A3;
      if (a3 && !countryMeta[a3]) countryMeta[a3] = { name: p.NAME ?? '', name_ja: p.NAME_JA ?? '' };
    }
  } catch (err) {
    console.warn('world-countries.geojson 読み込み失敗（国名メタなしで続行）', err.message);
  }

  const out = {
    states: Object.fromEntries(byState),
    countries: Object.fromEntries(byCountry),
    stateMeta,
    countryMeta,
  };
  const outPath = join(publicData, 'world-stats.json');
  writeFileSync(outPath, JSON.stringify(out));
  const sizeKB = (readFileSync(outPath).length / 1024).toFixed(0);
  const totalCells = [...byState.values()].reduce((a, b) => a + b, 0);
  console.log(`完成: world-stats.json (${sizeKB}KB, ${byState.size} 州 / ${byCountry.size} 国 / 陸地約 ${totalCells.toLocaleString()} セル)`);
}

main();
