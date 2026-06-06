/**
 * 市区町村ごとの塗り割合（％）表示に使う統計ファイルを生成する。
 *
 * 入力: frontend/public/data/mesh.geojson（build-mesh.mjs の出力）
 *   各セルに MESHCODE / PREF_NAME / CITY_NAME を持つ。
 * 出力: frontend/public/data/muni-stats.json
 *   {
 *     "munis": [
 *       { "k": "東京都|千代田区", "c": [53394600, 53394601, ...] },  // k=PREF|CITY, c=セルのメッシュコード一覧
 *       ...
 *     ]
 *   }
 *
 * 分母（市区町村の総セル数）= c.length、分子（塗ったセル数）はクライアントが
 * 塗り状態と c の対応から数える。約37万セル分のメッシュコードを含むため
 * フロントは map 表示後に遅延ロードする。
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

console.log('mesh.geojson を読み込み中...');
const mesh = JSON.parse(readFileSync(join(publicData, 'mesh.geojson'), 'utf8'));

// PREF|CITY ごとにメッシュコードを集約
/** @type {Map<string, number[]>} */
const byMuni = new Map();
let skipped = 0;
for (const f of mesh.features) {
  const p = f.properties || {};
  const pref = p.PREF_NAME || '';
  const city = p.CITY_NAME || '';
  const code = Number(p.MESHCODE);
  if (!city || !Number.isFinite(code)) {
    skipped++;
    continue;
  }
  const key = `${pref}|${city}`;
  let list = byMuni.get(key);
  if (!list) {
    list = [];
    byMuni.set(key, list);
  }
  list.push(code);
}

// 安定した出力にするためキー順・コード順にソート
const munis = [...byMuni.entries()]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([k, c]) => ({ k, c: c.sort((x, y) => x - y) }));

const out = join(publicData, 'muni-stats.json');
writeFileSync(out, JSON.stringify({ munis }));
const sizeMB = (readFileSync(out).length / 1024 / 1024).toFixed(1);
const totalCells = munis.reduce((s, m) => s + m.c.length, 0);
console.log(
  `完成: muni-stats.json（${munis.length} 市区町村, ${totalCells} セル, ${sizeMB}MB${
    skipped ? `, スキップ ${skipped}` : ''
  }）`
);
