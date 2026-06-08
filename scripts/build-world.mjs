/**
 * 世界版の下地 PMTiles（国＝admin_0／州・県＝admin_1）を生成する。
 *
 * 日本版の japan.pmtiles に相当する世界版。塗りの単位は日本と同じ約1kmメッシュ
 * （Map.tsx が数式生成）なのでここでは焼かない。ここで焼くのは「下地・国境・州境・
 * 国名/州名ラベル・ホバー地名解決のためのポリゴン」だけ。
 *
 * 取得元: Natural Earth Vector 10m（50m より海岸線・島・州境がだいぶ細かい）
 *   - ne_10m_admin_0_countries          … 国別ポリゴン（NAME / NAME_JA / ADM0_A3）
 *   - ne_10m_admin_1_states_provinces   … 州・県ポリゴン（name / name_ja / admin / adm0_a3 / adm1_code）
 * 出力: frontend/public/data/world.pmtiles（layers: countries, states・zoom 0–8）
 *       中間: frontend/public/data/world-countries.geojson, world-states.geojson
 *             （build-world-stats.mjs が world-states.geojson を読んで分母を作る）
 *
 * なぜ z8 まで？ 塗りは z10 以上だが、states 層は MapLibre が z8 タイルを
 * オーバーズームして z10+ でも表示・queryRenderedFeatures できる。z8 までに
 * 抑えることで世界全域でもタイル数・ファイルサイズが現実的に収まる
 * （素の 80MB GeoJSON を一括ロードする必要がなくなる ＝ 表示範囲ぶんだけ range 取得）。
 *
 * 使い方: node --max-old-space-size=8192 scripts/build-world.mjs  （ネット接続が必要）
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { tmpdir, platform } from 'os';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import zlib from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicData = join(root, 'frontend', 'public', 'data');
const mbtilesPath = join(root, 'tmp-world.mbtiles');
const outputPath = join(publicData, 'world.pmtiles');

const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const COUNTRIES_URL = `${NE_BASE}/ne_10m_admin_0_countries.geojson`;
const STATES_URL = `${NE_BASE}/ne_10m_admin_1_states_provinces.geojson`;
const COUNTRIES_OUT = join(publicData, 'world-countries.geojson');
const STATES_OUT = join(publicData, 'world-states.geojson');

// 世界全域（Web メルカトルの緯度上限 ±85.0511）
const BOUNDS = { minLon: -180, maxLon: 180, minLat: -85.0511, maxLat: 85.0511 };
const GLOBAL_MIN_ZOOM = 0;
const GLOBAL_MAX_ZOOM = 8;

const LAYERS = [
  { name: 'countries', file: 'world-countries.geojson', minZoom: 0, maxZoom: 8 },
  { name: 'states',    file: 'world-states.geojson',    minZoom: 3, maxZoom: 8 },
];

function resolvePmtilesBin() {
  const isWin = platform() === 'win32';
  const localBin = join(root, isWin ? 'pmtiles.exe' : 'pmtiles');
  if (existsSync(localBin)) return localBin;
  try {
    execSync(isWin ? 'where pmtiles' : 'command -v pmtiles', { stdio: 'ignore' });
    return 'pmtiles';
  } catch {
    throw new Error('pmtiles バイナリが見つかりません（README 参照）');
  }
}

// Natural Earth を取得し、mapshaper で属性絞り込み・小島除去・簡略化して中間 geojson を作る
async function fetchAndSimplify(url, outFile, fields, simplify) {
  console.log('取得中:', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ダウンロード失敗: HTTP ${res.status} (${url})`);
  const raw = await res.text();
  const tmp = mkdtempSync(join(tmpdir(), 'world-'));
  const srcFile = join(tmp, 'src.geojson');
  writeFileSync(srcFile, raw);
  try {
    console.log(`  mapshaper 整形中 → ${outFile}`);
    execFileSync(
      'npx',
      [
        'mapshaper',
        srcFile,
        '-filter-fields', fields,
        // 小島の除去をゆるめ（20km2→3km2）細かい海岸線・島を残す。
        '-filter-islands', 'min-area=3km2', 'remove-empty',
        // 簡略化をゆるめて頂点を多く残し、日本の海岸線（prefectures）並みに滑らかにする。
        '-simplify', simplify, 'keep-shapes',
        '-o', 'format=geojson', 'precision=0.0003', outFile,
      ],
      { stdio: 'inherit' }
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// タイルXY計算
function lon2tile(lon, z) { return Math.floor((lon + 180) / 360 * (1 << z)); }
function lat2tile(lat, z) {
  const rad = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * (1 << z));
}
function tileBounds(z) {
  return {
    minX: lon2tile(BOUNDS.minLon, z),
    maxX: lon2tile(BOUNDS.maxLon, z),
    minY: lat2tile(BOUNDS.maxLat, z),
    maxY: lat2tile(BOUNDS.minLat, z),
  };
}
function toTMS(z, y) { return (1 << z) - 1 - y; }

// 安定 featureId（states=adm1_code を数値化, countries=adm0 連番）。query で id は使わず
// プロパティ（adm1_code / ADM0_A3）でキーするので、ここは衝突しなければ良い。
function assignIds(geojson, layer) {
  let i = 1;
  for (const f of geojson.features) f.id = i++;
  return geojson;
}

async function main() {
  // 1) 取得・簡略化（海外の輪郭を日本（prefectures）並みに細かくするため頂点を多めに残す）
  await fetchAndSimplify(COUNTRIES_URL, COUNTRIES_OUT, 'NAME,NAME_JA,ADM0_A3', '50%');
  await fetchAndSimplify(STATES_URL, STATES_OUT, 'name,name_ja,admin,adm0_a3,adm1_code', '40%');

  // 2) MBTiles 初期化
  if (existsSync(mbtilesPath)) unlinkSync(mbtilesPath);
  const db = new Database(mbtilesPath);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB,
      PRIMARY KEY (zoom_level, tile_column, tile_row));
  `);
  const meta = db.prepare('INSERT INTO metadata VALUES (?,?)');
  meta.run('name', '世界ぬりえ下地');
  meta.run('format', 'pbf');
  meta.run('minzoom', String(GLOBAL_MIN_ZOOM));
  meta.run('maxzoom', String(GLOBAL_MAX_ZOOM));
  meta.run('bounds', '-180,-85,180,85');
  meta.run('center', '0,20,2');
  meta.run('type', 'overlay');
  meta.run('json', JSON.stringify({
    vector_layers: [
      { id: 'countries', fields: { NAME: 'String', NAME_JA: 'String', ADM0_A3: 'String' } },
      { id: 'states', fields: { name: 'String', name_ja: 'String', admin: 'String', adm0_a3: 'String', adm1_code: 'String' } },
    ],
  }));

  // 3) タイルインデックス生成
  console.log('GeoJSON を読み込み中...');
  const tileIndexes = LAYERS.map((layer) => {
    const file = join(publicData, layer.file);
    const size = (readFileSync(file).length / 1024 / 1024).toFixed(1);
    console.log(`  ${layer.file} (${size}MB)`);
    const geojson = assignIds(JSON.parse(readFileSync(file, 'utf8')), layer);
    return {
      ...layer,
      index: geojsonvt(geojson, { maxZoom: layer.maxZoom, tolerance: 1.5, extent: 4096, buffer: 64 }),
    };
  });

  // 4) タイル書き込み
  const insertTile = db.prepare(
    'INSERT OR REPLACE INTO tiles (zoom_level,tile_column,tile_row,tile_data) VALUES (?,?,?,?)'
  );
  const writeBatch = db.transaction((rows) => { for (const r of rows) insertTile.run(...r); });

  console.log('タイルを生成中...');
  let total = 0;
  for (let z = GLOBAL_MIN_ZOOM; z <= GLOBAL_MAX_ZOOM; z++) {
    const { minX, maxX, minY, maxY } = tileBounds(z);
    let batch = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const layerMap = {};
        for (const { name, index, minZoom, maxZoom } of tileIndexes) {
          if (z < minZoom || z > maxZoom) continue;
          const t = index.getTile(z, x, y);
          if (t) layerMap[name] = t;
        }
        if (Object.keys(layerMap).length === 0) continue;
        const pbf = vtpbf.fromGeojsonVt(layerMap, { version: 2 });
        batch.push([z, x, toTMS(z, y), zlib.gzipSync(pbf)]);
        if (batch.length >= 2000) { writeBatch(batch); total += batch.length; batch = []; process.stdout.write(`\r  z=${z}: ${total} タイル...`); }
      }
    }
    if (batch.length > 0) { writeBatch(batch); total += batch.length; }
    console.log(`\r  z=${z}: ${total} タイル累計 (範囲 ${minX}-${maxX}, ${minY}-${maxY})`);
  }
  db.close();
  console.log(`\nMBTiles 完成 (合計 ${total} タイル)`);

  // 5) PMTiles 変換
  console.log('PMTiles 変換中...');
  if (existsSync(outputPath)) unlinkSync(outputPath);
  const pmtilesBin = resolvePmtilesBin();
  execSync(`"${pmtilesBin}" convert "${mbtilesPath}" "${outputPath}"`, { stdio: 'inherit' });
  unlinkSync(mbtilesPath);
  const sizeMB = (readFileSync(outputPath).length / 1024 / 1024).toFixed(1);
  console.log(`\n完成: world.pmtiles (${sizeMB}MB)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
