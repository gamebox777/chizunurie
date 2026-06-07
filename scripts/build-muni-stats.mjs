/**
 * 市区町村ごとの塗り割合（％）表示に使う統計ファイルを生成する。
 *
 * mesh はクライアントで数式生成するようになったため、ここでは mesh.geojson に依存せず
 * 市区町村ポリゴンから直接「各市区町村に何セル（約1km等面積グリッド）入るか」を数える。
 * 出力するのは分母となるセル総数だけで、セル一覧（ジオメトリ）は持たない＝数KBで済む。
 *
 * 入力: frontend/public/data/municipalities_poly.geojson（N03_001/004/005 を持つ）
 * 出力: frontend/public/data/muni-stats.json
 *   {
 *     "munis": [
 *       { "k": "東京都|千代田区", "n": 12 },  // k=PREF|CITY、n=その市区町村の陸地セル総数（分母）
 *       ...
 *     ]
 *   }
 *
 * キー k は「N03_001 | (N03_004 + N03_005)」。Map.tsx の muniKeyFor（municipalities
 * レイヤーへの queryRenderedFeatures から同じ規則で組む）と一致させること。
 *
 * 使い方:
 *   node --max-old-space-size=8192 scripts/build-muni-stats.mjs
 *   （npm run build-muni-stats）
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicData = join(__dirname, '..', 'frontend', 'public', 'data');

// 約1kmの等面積グリッド = 緯度 1/120°、経度 1/80°（Map.tsx と同一）
const LAT_DIV = 120;
const LON_DIV = 80;

// ── 点内外判定（even-odd ray casting）────────────────────
function pointInRings(lng, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0],
        yi = ring[i][1];
      const xj = ring[j][0],
        yj = ring[j][1];
      const intersect =
        yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

// geometry を「ポリゴン（=リング配列）の配列」に正規化し、各々に bbox を付ける
function toPolygons(geometry) {
  if (!geometry) return [];
  const polys =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  return polys.map((rings) => {
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const [x, y] of rings[0]) {
      if (x < minLng) minLng = x;
      if (x > maxLng) maxLng = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
    return { rings, bbox: [minLng, minLat, maxLng, maxLat] };
  });
}

// セルキー（ri,ci を一意な数値に）。グローバル重複排除に使う
const cellKey = (ri, ci) => ri * 100000 + ci;

console.log('市区町村ポリゴンを読み込み中...');
const muni = JSON.parse(
  readFileSync(join(publicData, 'municipalities_poly.geojson'), 'utf8')
);

// PREF|CITY ごとの陸地セル数を数える。1セルは最初に確定した市区町村にだけ数える
// （build-mesh.mjs の陸地セル生成と同じ重複排除＝分母が従来の mesh 由来と一致する）。
/** @type {Map<string, number>} */
const countByMuni = new Map();
const claimed = new Set();
let processed = 0;
for (const f of muni.features) {
  const p = f.properties || {};
  const pref = p.N03_001 || '';
  const city = [p.N03_004, p.N03_005].filter(Boolean).join('');
  if (!city) continue;
  const key = `${pref}|${city}`;
  for (const { rings, bbox } of toPolygons(f.geometry)) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const riMin = Math.floor(minLat * LAT_DIV);
    const riMax = Math.floor(maxLat * LAT_DIV);
    const ciMin = Math.floor(minLng * LON_DIV);
    const ciMax = Math.floor(maxLng * LON_DIV);
    for (let ri = riMin; ri <= riMax; ri++) {
      const lat = (ri + 0.5) / LAT_DIV;
      for (let ci = ciMin; ci <= ciMax; ci++) {
        const ck = cellKey(ri, ci);
        if (claimed.has(ck)) continue;
        const lng = (ci + 0.5) / LON_DIV;
        if (!pointInRings(lng, lat, rings)) continue;
        claimed.add(ck);
        countByMuni.set(key, (countByMuni.get(key) ?? 0) + 1);
      }
    }
  }
  if (++processed % 200 === 0) {
    process.stdout.write(`\r  ${processed}/${muni.features.length} 市区町村, ${claimed.size} セル`);
  }
}
console.log(`\r  ${processed}/${muni.features.length} 市区町村, ${claimed.size} セル`);

// 安定した出力にするためキー順にソート
const munis = [...countByMuni.entries()]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([k, n]) => ({ k, n }));

const outPath = join(publicData, 'muni-stats.json');
writeFileSync(outPath, JSON.stringify({ munis }));
const sizeKB = (readFileSync(outPath).length / 1024).toFixed(1);
console.log(`完成: muni-stats.json（${munis.length} 市区町村, ${claimed.size} セル, ${sizeKB}KB）`);
