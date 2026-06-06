/**
 * 約1km（3次地域メッシュ）の等面積グリッドを全国の陸地に生成する。
 *
 * 3次メッシュは「緯度 1/120°・経度 1/80° の均一グリッド」と一致する。
 * 各セルは中心点が市区町村ポリゴン内に入るものだけを陸地セルとして採用し、
 * セルへ近似の地名（都道府県・市区町村、東京/北海道は町丁目名）を埋め込む。
 *
 * 出力: frontend/public/data/mesh.geojson
 *   - feature.id 用の MESHCODE（8桁地域メッシュコード）を properties に持つ
 *   - 表示用に PREF_NAME / CITY_NAME / S_NAME を持つ
 *
 * 使い方:
 *   node scripts/build-mesh.mjs                       # 全国
 *   node scripts/build-mesh.mjs --bbox 139.5,35.5,140.0,35.9  # テスト用に範囲限定
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicData = join(root, 'frontend', 'public', 'data');

// 3次メッシュ = 緯度 1/120°、経度 1/80° の均一グリッド
const LAT_DIV = 120; // 1° を 120 分割（= 0.5 分 = 約 0.92km）
const LON_DIV = 80; //  1° を  80 分割（= 0.75 分 = 約 1km）

// ── 引数（テスト用 bbox） ────────────────────────────────
function parseBboxArg() {
  const i = process.argv.indexOf('--bbox');
  if (i < 0) return null;
  const parts = process.argv[i + 1]?.split(',').map(Number);
  if (!parts || parts.length !== 4 || parts.some(Number.isNaN)) {
    throw new Error('--bbox は minLng,minLat,maxLng,maxLat 形式で指定してください');
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  return { minLng, minLat, maxLng, maxLat };
}
const limitBbox = parseBboxArg();

// ── メッシュコード ←→ グリッド整数 ──────────────────────
// ri = floor(lat * 120), ci = floor(lng * 80)
function meshCode(ri, ci) {
  const p = Math.floor(ri / 80); //   1次メッシュ緯度（2桁）
  const within = ri - p * 80;
  const q = Math.floor(within / 10); // 2次メッシュ緯度（0-7）
  const r = within - q * 10; //        3次メッシュ緯度（0-9）

  const uu = Math.floor(ci / 80); //   floor(lng)
  const u = uu - 100; //               1次メッシュ経度（2桁）
  const withinLon = ci - uu * 80;
  const v = Math.floor(withinLon / 10); // 2次メッシュ経度（0-7）
  const w = withinLon - v * 10; //        3次メッシュ経度（0-9）

  return `${p}${u}${q}${v}${r}${w}`;
}

// ── 点内外判定（even-odd ray casting） ──────────────────
// rings: 1ポリゴン分のリング配列（[0]=外周、[1..]=穴）。すべてのリングを通して
//        交差回数の偶奇で判定すれば穴も正しく扱える。
function pointInRings(lng, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0],
        yi = ring[i][1];
      const xj = ring[j][0],
        yj = ring[j][1];
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
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

// セルキー（ri,ci を一意な数値に）。ci は最大でも ~12320 なので衝突しない
const cellKey = (ri, ci) => ri * 100000 + ci;

// ある feature の全ポリゴンについて、bbox 内のセル中心を走査して
// visit(ri, ci, lng, lat) を呼ぶ
function forEachCandidateCell(polygons, visit) {
  for (const { rings, bbox } of polygons) {
    let [minLng, minLat, maxLng, maxLat] = bbox;
    if (limitBbox) {
      minLng = Math.max(minLng, limitBbox.minLng);
      minLat = Math.max(minLat, limitBbox.minLat);
      maxLng = Math.min(maxLng, limitBbox.maxLng);
      maxLat = Math.min(maxLat, limitBbox.maxLat);
      if (minLng > maxLng || minLat > maxLat) continue;
    }
    const riMin = Math.floor(minLat * LAT_DIV);
    const riMax = Math.floor(maxLat * LAT_DIV);
    const ciMin = Math.floor(minLng * LON_DIV);
    const ciMax = Math.floor(maxLng * LON_DIV);
    for (let ri = riMin; ri <= riMax; ri++) {
      const lat = (ri + 0.5) / LAT_DIV;
      for (let ci = ciMin; ci <= ciMax; ci++) {
        const lng = (ci + 0.5) / LON_DIV;
        if (pointInRings(lng, lat, rings)) visit(ri, ci, lng, lat);
      }
    }
  }
}

// ── 1) 市区町村ポリゴンから陸地セルを作る ─────────────────
console.log('市区町村ポリゴンを読み込み中...');
const muni = JSON.parse(
  readFileSync(join(publicData, 'municipalities_poly.geojson'), 'utf8')
);

/** key -> { ri, ci, pref, city, cho } */
const cells = new Map();

console.log(`陸地セルを生成中（${muni.features.length} 市区町村）...`);
let processed = 0;
for (const f of muni.features) {
  const p = f.properties || {};
  const pref = p.N03_001 || '';
  const city = [p.N03_004, p.N03_005].filter(Boolean).join('');
  const polygons = toPolygons(f.geometry);
  forEachCandidateCell(polygons, (ri, ci) => {
    const key = cellKey(ri, ci);
    if (cells.has(key)) return; // 既に他の市区町村で確定済み
    cells.set(key, { ri, ci, pref, city, cho: '' });
  });
  if (++processed % 200 === 0) {
    process.stdout.write(`\r  ${processed}/${muni.features.length} 市区町村, ${cells.size} セル`);
  }
}
console.log(`\r  ${processed}/${muni.features.length} 市区町村, ${cells.size} セル`);

// ── 2) 全都道府県の町丁目名で上書き ─────────────────────
// frontend/public/data/chocho/XX_chocho.geojson（fetch-chocho.mjs で取得）を全て読む
const chochoDir = join(publicData, 'chocho');
const chochoFiles = existsSync(chochoDir)
  ? readdirSync(chochoDir)
      .filter((f) => /_chocho\.geojson$/.test(f))
      .sort()
      .map((f) => join('chocho', f))
  : [];
if (chochoFiles.length === 0) {
  console.warn('警告: chocho/*.geojson が見つかりません。町丁目名は付与されません（npm run fetch-chocho を実行）');
}
for (const file of chochoFiles) {
  console.log(`町丁目名を付与中: ${file} ...`);
  const cho = JSON.parse(readFileSync(join(publicData, file), 'utf8'));
  let named = 0;
  for (const f of cho.features) {
    const p = f.properties || {};
    const sName = p.S_NAME || '';
    if (!sName) continue; // 名称が無い（海域・島など）はスキップ
    const polygons = toPolygons(f.geometry);
    forEachCandidateCell(polygons, (ri, ci) => {
      const cell = cells.get(cellKey(ri, ci));
      if (cell && !cell.cho) {
        cell.cho = sName;
        named++;
      }
    });
  }
  console.log(`  ${named} セルに町丁目名を付与`);
}

// ── 3) GeoJSON 出力 ─────────────────────────────────────
console.log('GeoJSON を書き出し中...');
const features = [];
for (const { ri, ci, pref, city, cho } of cells.values()) {
  const lngLow = ci / LON_DIV;
  const lngHigh = (ci + 1) / LON_DIV;
  const latLow = ri / LAT_DIV;
  const latHigh = (ri + 1) / LAT_DIV;
  features.push({
    type: 'Feature',
    properties: {
      MESHCODE: meshCode(ri, ci),
      PREF_NAME: pref,
      CITY_NAME: city,
      S_NAME: cho,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lngLow, latLow],
          [lngHigh, latLow],
          [lngHigh, latHigh],
          [lngLow, latHigh],
          [lngLow, latLow],
        ],
      ],
    },
  });
}

const out = join(publicData, 'mesh.geojson');
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
const sizeMB = (readFileSync(out).length / 1024 / 1024).toFixed(1);
console.log(`\n完成: mesh.geojson（${features.length} セル, ${sizeMB}MB）`);
