// アプリアイコン用 SVG 生成スクリプト（デザイン確認用・ワンオフ）
//   world-countries.geojson を粗いグリッドにラスタライズして「タイル状の世界地図」を作る。
//   ・日本を中央に、アメリカ大陸まで含む全世界を表示（太平洋中心）
//   ・海（太平洋・大西洋）は経度／緯度ごとに「陸があるか」を調べて圧縮し、面積を小さく抽象化。
//     陸の列・行は等倍、海だけ幅・高さを縮めるので、正方形いっぱいに陸が大きく載る。
//   ・陸タイルを「塗り済み（黄色）」と「未塗り（白い枠だけ）」に塗り分けてゲーム性を表現
//   ・日本は塗り済み＋グローで強調し、現行 header-icon の赤いピンを日本の上に置く（文字なし）
//   出力: frontend/public/icons/app-icon.svg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'frontend/public/data/world-countries.geojson');
const OUT = path.join(ROOT, 'frontend/public/icons/app-icon.svg');

// ---- パラメータ -----------------------------------------------------------
const SIZE = 1024;          // アイコン一辺
const M = 44;               // 一辺のタイル数（正方形グリッド）
const LON_CENTER = 150;     // 表示中心の経度（日本を中央／太平洋中心。左右端＝大西洋）
const LAT_LO = -40, LAT_HI = 86; // 表示する緯度帯（南極・北極の海をカット）
const OCEAN_W_LON = 0.26;   // 経度方向の海の重み（小さいほど海を強く圧縮＝陸が横に広がる）
const OCEAN_W_LAT = 0.62;   // 緯度方向の海の重み
const V_TARGET = 0.48;      // 日本セルを縦方向のこの位置（0=上,1=下）に来るよう地図全体を平行移動
const CELL = SIZE / M;
const TILE_GAP = 2.2, TILE_R = 3.5;
const PAINT_R = 5.2;        // 日本中心からこのタイル距離以内の陸を「塗り済み」に
// 日本以外で「少し塗っておく」地域（経度・緯度ボックス）：南米とヨーロッパ
const PAINT_BOXES = [
  { lon: [-72, -44], lat: [-36, -6] },  // 南アメリカ（ブラジル〜ラプラタ）
  { lon: [-6, 26], lat: [40, 58] },     // ヨーロッパ（西〜中欧）
];
const inBox = (lon, lat) => PAINT_BOXES.some(b => lon >= b.lon[0] && lon <= b.lon[1] && lat >= b.lat[0] && lat <= b.lat[1]);

const C = {
  bgTop: '#3f73d8', bgBot: '#2b59c2', grid: '#5786e1',
  unpaintFill: '#ffffff', unpaintStroke: '#dbe7ff',
  paint: '#ffd23f', paintHi: '#ffe98a', japanGlow: '#fff3b0',
  pin: '#e63131', pinDark: '#c81e1e', pinHole: '#ffffff',
};

// ---- ジオメトリ -----------------------------------------------------------
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (pointInRing(x, y, rings[k])) return false;
  return true;
}
function pointInFeature(x, y, geom) {
  if (geom.type === 'Polygon') return pointInPolygon(x, y, geom.coordinates);
  if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) if (pointInPolygon(x, y, poly)) return true;
  return false;
}
function lonBounds(geom) {
  let mn = 180, mx = -180;
  const scan = (ring) => { for (const [lo] of ring) { if (lo < mn) mn = lo; if (lo > mx) mx = lo; } };
  if (geom.type === 'Polygon') geom.coordinates.forEach(scan);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(p => p.forEach(scan));
  return [mn, mx];
}
const wrap = (lo) => { while (lo > 180) lo -= 360; while (lo < -180) lo += 360; return lo; };

const gj = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const feats = gj.features
  .filter(f => f.properties.ADM0_A3 !== 'ATA')
  .map(f => ({ a3: f.properties.ADM0_A3, geom: f.geometry, lb: lonBounds(f.geometry) }));

function landHit(lon, lat, jpOnly = false) {
  for (const f of feats) {
    if (jpOnly && f.a3 !== 'JPN') continue;
    if (lon < f.lb[0] - 1 || lon > f.lb[1] + 1) continue;
    if (pointInFeature(lon, lat, f.geom)) return f.a3 === 'JPN' ? 2 : 1;
  }
  return 0;
}
const landAtLon = (lon) => { for (let t = 0; t <= 14; t++) if (landHit(lon, LAT_LO + (t / 14) * (LAT_HI - LAT_LO))) return true; return false; };
const landAtLat = (lat) => { for (let t = 0; t <= 28; t++) if (landHit(-180 + (t / 28) * 360, lat)) return true; return false; };

// 海を圧縮する軸 remap：陸の区間は等倍、海の区間は OCEAN_W で縮めて M 個に割り付ける
function buildAxis(lo, hi, isLand, toReal, oceanW) {
  const FN = M * 10;
  const cost = new Array(FN), coord = new Array(FN);
  for (let i = 0; i < FN; i++) {
    const v = lo + ((i + 0.5) / FN) * (hi - lo);
    coord[i] = toReal(v);
    cost[i] = isLand(toReal(v)) ? 1 : oceanW;
  }
  const prefix = new Array(FN + 1); prefix[0] = 0;
  for (let i = 0; i < FN; i++) prefix[i + 1] = prefix[i] + cost[i];
  const total = prefix[FN], out = new Array(M);
  for (let m = 0; m < M; m++) {
    const target = ((m + 0.5) / M) * total;
    let a = 0, b = FN - 1;
    while (a < b) { const mid = (a + b) >> 1; if (prefix[mid + 1] <= target) a = mid + 1; else b = mid; }
    out[m] = coord[a];
  }
  return out;
}

const lonMap = buildAxis(-180, 180, (lon) => landAtLon(lon), (v) => wrap(LON_CENTER + v), OCEAN_W_LON);
const latMap = buildAxis(LAT_HI, LAT_LO, (lat) => landAtLat(lat), (v) => v, OCEAN_W_LAT); // 上＝北

// ---- ラスタライズ ---------------------------------------------------------
const grid = Array.from({ length: M }, () => new Array(M).fill(0));
const jp = Array.from({ length: M }, () => new Array(M).fill(false));
for (let r = 0; r < M; r++) {
  const lat = latMap[r];
  const dLat = (r < M - 1 ? Math.abs(latMap[r + 1] - lat) : Math.abs(lat - latMap[r - 1])) || 2;
  for (let c = 0; c < M; c++) {
    const lon = lonMap[c];
    const dLon = (c < M - 1 ? Math.abs(wrap(lonMap[c + 1] - lon)) : Math.abs(wrap(lon - lonMap[c - 1]))) || 2;
    let land = false, isJP = false;
    for (let sj = 0; sj < 4 && !isJP; sj++) for (let si = 0; si < 4; si++) {
      const sLat = lat + (sj / 3 - 0.5) * dLat * 0.8;
      const sLon = wrap(lon + (si / 3 - 0.5) * dLon * 0.8);
      const hit = landHit(sLon, sLat);
      if (hit === 2) { isJP = true; break; }
      if (hit && sj === 1 && si === 1) land = true;
    }
    if (!land && !isJP) land = landHit(lon, lat) > 0; // 中心が陸なら陸
    grid[r][c] = land || isJP ? 1 : 0;
    jp[r][c] = isJP;
  }
}

// 日本セルの重心（タイル座標）→ 塗り済み領域・ピンの基準
const jcells = [];
for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) if (jp[r][c]) jcells.push([r, c]);
const jr = jcells.reduce((a, t) => a + t[0], 0) / jcells.length;
const jc = jcells.reduce((a, t) => a + t[1], 0) / jcells.length;

// 「塗り済み」：日本中心からタイル距離 PAINT_R 以内 ＋ 日本自身 ＋ 南米/欧州ボックス内の陸
for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
  if (grid[r][c] !== 1) continue;
  if (jp[r][c] || Math.hypot(r - jr, c - jc) <= PAINT_R || inBox(lonMap[c], latMap[r])) grid[r][c] = 2;
}

// ---- SVG 生成 -------------------------------------------------------------
const unpaint = [], paint = [], japanTiles = [];
for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
  const v = grid[r][c]; if (!v) continue;
  const x = c * CELL + TILE_GAP / 2, y = r * CELL + TILE_GAP / 2, s = CELL - TILE_GAP;
  const rect = (extra) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" rx="${TILE_R}" ${extra}/>`;
  if (jp[r][c]) japanTiles.push(rect(`fill="url(#jp)"`));
  else if (v === 2) paint.push(rect(`fill="url(#paint)"`));
  else unpaint.push(rect(`fill="${C.unpaintFill}" fill-opacity="0.3" stroke="${C.unpaintStroke}" stroke-opacity="0.7" stroke-width="1.6"`));
}

// 日本セルが縦 V_TARGET の位置に来るよう、地図コンテンツ全体を下方向に平行移動
const V_OFF = Math.max(0, V_TARGET * SIZE - (jr + 0.5) * CELL);

const gx = jc * CELL + CELL / 2, gy = jr * CELL + CELL / 2;
const yTop = Math.min(...jcells.map(t => t[0])) * CELL;
const japanGlow = `<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="${(CELL * 3).toFixed(1)}" fill="${C.japanGlow}" fill-opacity="0.5" filter="url(#soft)"/>`;

const R = 84, px = gx, py = yTop + 4, cyHead = py - R * 2.55, k = R * 1.32;
const pin = `
  <g filter="url(#pinShadow)">
    <path d="M ${px} ${py}
      C ${px - k} ${cyHead + R * 0.9}, ${px - R} ${cyHead + R * 0.55}, ${px - R} ${cyHead}
      A ${R} ${R} 0 1 1 ${px + R} ${cyHead}
      C ${px + R} ${cyHead + R * 0.55}, ${px + k} ${cyHead + R * 0.9}, ${px} ${py} Z"
      fill="url(#pinGrad)"/>
    <circle cx="${px}" cy="${cyHead}" r="${R * 0.42}" fill="${C.pinHole}"/>
  </g>`;

let gridLines = '';
for (let i = 1; i < M; i++) { const p = (i * CELL).toFixed(1); gridLines += `<line x1="${p}" y1="0" x2="${p}" y2="${SIZE}"/><line x1="0" y1="${p}" x2="${SIZE}" y2="${p}"/>`; }

const svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bgTop}"/><stop offset="1" stop-color="${C.bgBot}"/></linearGradient>
  <linearGradient id="paint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.paintHi}"/><stop offset="1" stop-color="${C.paint}"/></linearGradient>
  <linearGradient id="jp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.paintHi}"/><stop offset="1" stop-color="${C.paint}"/></linearGradient>
  <linearGradient id="pinGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.pin}"/><stop offset="1" stop-color="${C.pinDark}"/></linearGradient>
  <filter id="pinShadow" x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#0b1f4d" flood-opacity="0.35"/></filter>
  <filter id="soft" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="16"/></filter>
  <clipPath id="round"><rect width="${SIZE}" height="${SIZE}" rx="220"/></clipPath>
</defs>
<g clip-path="url(#round)">
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  <g stroke="${C.grid}" stroke-width="1.5" stroke-opacity="0.5">${gridLines}</g>
  <g transform="translate(0,${V_OFF.toFixed(1)})">
    <g>${unpaint.join('')}</g>
    <g>${paint.join('')}</g>
    ${japanGlow}
    <g>${japanTiles.join('')}</g>
    ${pin}
  </g>
</g>
</svg>`;

fs.writeFileSync(OUT, svg);
console.log('wrote', path.relative(ROOT, OUT), `(${(svg.length / 1024).toFixed(1)} KB) japan:${jcells.length} painted:${paint.length} unpainted:${unpaint.length}`);
console.log(`japan row=${jr.toFixed(1)}/${M}, V_OFF=${V_OFF.toFixed(0)}, japan y=${((jr + 0.5) * CELL + V_OFF).toFixed(0)}/${SIZE}, pin top y=${(py - 3.55 * R + V_OFF).toFixed(0)} (>=0 で全部入る)`);
