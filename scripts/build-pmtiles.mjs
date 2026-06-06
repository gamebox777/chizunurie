/**
 * GeoJSON → MBTiles → PMTiles 変換スクリプト
 */
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';
import Database from 'better-sqlite3';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import zlib from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicData = join(root, 'frontend', 'public', 'data');
const mbtilesPath = join(root, 'tmp.mbtiles');
const outputPath = join(publicData, 'japan.pmtiles');

// プラットフォームに応じた pmtiles 実行ファイルを解決する
// 優先順: 1) プロジェクトルートのプラットフォーム別バイナリ 2) PATH上の `pmtiles`
function resolvePmtilesBin() {
  const isWin = platform() === 'win32';
  const localBin = join(root, isWin ? 'pmtiles.exe' : 'pmtiles');
  if (existsSync(localBin)) return localBin;
  // PATH 上に pmtiles があればそれを使う（Mac: `brew install protomaps/go-pmtiles/go-pmtiles` など）
  try {
    execSync(isWin ? 'where pmtiles' : 'command -v pmtiles', { stdio: 'ignore' });
    return 'pmtiles';
  } catch {
    throw new Error(
      `pmtiles バイナリが見つかりません。次のいずれかを実施してください:\n` +
      `  - Mac:   brew install protomaps/go-pmtiles/go-pmtiles\n` +
      `  - 任意:  https://github.com/protomaps/go-pmtiles/releases から取得し、\n` +
      `          実行ファイルをプロジェクトルートに ` +
      (isWin ? '`pmtiles.exe`' : '`pmtiles`') + ` として配置`
    );
  }
}

// 日本の bbox
const BOUNDS = { minLon: 122.9, maxLon: 154.0, minLat: 20.4, maxLat: 45.6 };

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
    minY: lat2tile(BOUNDS.maxLat, z), // maxLat → minY（Y軸反転）
    maxY: lat2tile(BOUNDS.minLat, z),
  };
}
function toTMS(z, x, y) { return (1 << z) - 1 - y; }

// レイヤー定義
const LAYERS = [
  { name: 'municipalities', file: 'municipalities_poly.geojson', minZoom: 4, maxZoom: 13 },
  // 約1kmの等面積メッシュ（塗りの単位）。低ズームはセルが多すぎるので minZoom を上げる
  { name: 'mesh',           file: 'mesh.geojson',                minZoom: 9,  maxZoom: 13 },
  { name: 'prefectures',    file: 'japan.geojson',               minZoom: 4, maxZoom: 8  },
  { name: 'labels',         file: 'municipalities.geojson',      minZoom: 6, maxZoom: 13 },
  // 政令指定都市の外周（区を市単位に dissolve したもの）。枠線・市名ラベル用
  { name: 'cities',         file: 'designated_cities.geojson',   minZoom: 6, maxZoom: 13 },
];

const GLOBAL_MAX_ZOOM = 13;
const GLOBAL_MIN_ZOOM = 4;

// MBTiles初期化
if (existsSync(mbtilesPath)) unlinkSync(mbtilesPath);
const db = new Database(mbtilesPath);
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE metadata (name TEXT, value TEXT);
  CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB,
    PRIMARY KEY (zoom_level, tile_column, tile_row));
`);
db.prepare('INSERT INTO metadata VALUES (?,?)').run('name', '白地図ゲーム');
db.prepare('INSERT INTO metadata VALUES (?,?)').run('format', 'pbf');
db.prepare('INSERT INTO metadata VALUES (?,?)').run('minzoom', String(GLOBAL_MIN_ZOOM));
db.prepare('INSERT INTO metadata VALUES (?,?)').run('maxzoom', String(GLOBAL_MAX_ZOOM));
db.prepare('INSERT INTO metadata VALUES (?,?)').run('bounds', '122.9,20.4,154.0,45.6');
db.prepare('INSERT INTO metadata VALUES (?,?)').run('center', '136.5,37.0,5');
db.prepare('INSERT INTO metadata VALUES (?,?)').run('type', 'overlay');
db.prepare('INSERT INTO metadata VALUES (?,?)').run('json', JSON.stringify({
  vector_layers: [
    { id: 'municipalities', fields: { N03_001:'String', N03_004:'String', N03_005:'String', N03_007:'String' } },
    { id: 'mesh',           fields: { MESHCODE:'String', PREF_NAME:'String', CITY_NAME:'String', S_NAME:'String' } },
    { id: 'prefectures',    fields: { nam_ja:'String', id:'Number' } },
    { id: 'labels',         fields: { N03_001:'String', N03_004:'String', N03_005:'String', N03_007:'String' } },
    { id: 'cities',         fields: { N03_001:'String', N03_004:'String' } },
  ]
}));

// featureId を安定した行政コードで上書き
function assignStableIds(geojson, layer) {
  let collisionCounter = 900000000; // degenerate features 用のフォールバックID
  for (const feature of geojson.features) {
    const p = feature.properties;
    if (layer.name === 'municipalities' || layer.name === 'labels') {
      const code = p?.N03_007;
      feature.id = code && code.length >= 5 ? parseInt(code, 10) : undefined;
    } else if (layer.name === 'mesh') {
      // 8桁の地域メッシュコードを安定IDに使う（リロードでも不変）
      const code = p?.MESHCODE;
      feature.id = code && code.length === 8 ? parseInt(code, 10) : collisionCounter++;
    }
    // prefectures は元々 id フィールドを持つので変更不要
  }
  return geojson;
}

// GeoJSON読み込み & タイルインデックス生成
console.log('GeoJSONを読み込み中...');
const tileIndexes = LAYERS.map(layer => {
  const file = join(publicData, layer.file);
  const size = (readFileSync(file).length / 1024 / 1024).toFixed(1);
  console.log(`  ${layer.file} (${size}MB)`);
  const geojson = assignStableIds(JSON.parse(readFileSync(file, 'utf8')), layer);
  return {
    ...layer,
    index: geojsonvt(geojson, {
      maxZoom: layer.maxZoom,
      tolerance: 3,
      extent: 4096,
      buffer: 64,
    }),
  };
});

// タイル書き込み
const insertTile = db.prepare(
  'INSERT OR REPLACE INTO tiles (zoom_level,tile_column,tile_row,tile_data) VALUES (?,?,?,?)'
);
const writeBatch = db.transaction((rows) => { for (const r of rows) insertTile.run(...r); });

console.log('タイルを生成中...');
let total = 0;

for (let z = GLOBAL_MIN_ZOOM; z <= GLOBAL_MAX_ZOOM; z++) {
  const { minX, maxX, minY, maxY } = tileBounds(z);
  let batch = [];
  let written = 0;

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
      const compressed = zlib.gzipSync(pbf);
      batch.push([z, x, toTMS(z, x, y), compressed]);
      written++;

      if (batch.length >= 2000) {
        writeBatch(batch);
        batch = [];
        total += written;
        process.stdout.write(`\r  z=${z}: ${total} タイル...`);
        written = 0;
      }
    }
  }
  if (batch.length > 0) { writeBatch(batch); total += written; }
  console.log(`\r  z=${z}: ${total} タイル (範囲 ${minX}-${maxX}, ${minY}-${maxY})`);
}

db.close();
console.log(`\nMBTiles完成 (合計 ${total} タイル)`);

// PMTilesに変換
console.log('PMTiles変換中...');
if (existsSync(outputPath)) unlinkSync(outputPath);
const pmtilesBin = resolvePmtilesBin();
execSync(`"${pmtilesBin}" convert "${mbtilesPath}" "${outputPath}"`, { stdio: 'inherit' });
unlinkSync(mbtilesPath);

const sizeMB = (readFileSync(outputPath).length / 1024 / 1024).toFixed(1);
console.log(`\n完成: japan.pmtiles (${sizeMB}MB)`);
