/**
 * 世界の国別ポリゴン（日本以外の下地・グレー表示＋国境・国名ラベル用）の GeoJSON を生成する。
 *
 * 世界版への準備として、日本の外は世界の国をグレーで見せる。塗りの対象は日本だけなので
 * 下地でよいが、国境（国どうしの境界線）と国名を出したいので、陸地だけの land ではなく
 * Natural Earth の admin_0_countries（国別ポリゴン・国名属性つき）を使う。
 *
 * 取得元: Natural Earth Vector / ne_50m_admin_0_countries.geojson
 *         （50m。110m より海岸線・島がだいぶ細かい＝「もう少し細かく」）
 * 出力:   frontend/public/data/world-land.geojson
 *         （国別ポリゴン・各 feature に NAME / NAME_JA を持つ。Map.tsx が実行時に読む静的データ）
 *
 * 整形は mapshaper（npx・このリポジトリで利用可）に任せる：
 *   - filter-fields NAME,NAME_JA … ラベルに使う属性だけ残す（軽量化）
 *   - filter-islands min-area=   … ごく小さな島ポリゴンを落とす（国の本体は keep-shapes で保持）
 *   - simplify                   … 頂点を減らして軽量化
 *
 * 使い方:
 *   node scripts/build-world-land.mjs   （npm run build-world-land・ネット接続が必要）
 */
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicData = join(__dirname, '..', 'frontend', 'public', 'data');

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const OUT = join(publicData, 'world-land.geojson');

async function main() {
  console.log('世界の国別データを取得中:', SOURCE_URL);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`ダウンロード失敗: HTTP ${res.status}`);
  const raw = await res.text();

  // mapshaper に渡すため一時ファイルへ落とす
  const tmp = mkdtempSync(join(tmpdir(), 'world-land-'));
  const srcFile = join(tmp, 'ne_50m_admin_0_countries.geojson');
  writeFileSync(srcFile, raw);

  try {
    console.log('mapshaper で属性絞り込み・小島除去・簡略化中…');
    // 国名属性（NAME=英名 / NAME_JA=日本語名）だけ残し、ごく小さな島を落とし、
    // 頂点を減らして出力する。国の本体は keep-shapes で消さない。
    execFileSync(
      'npx',
      [
        'mapshaper',
        srcFile,
        '-filter-fields', 'NAME,NAME_JA',
        '-filter-islands', 'min-area=1000km2', 'remove-empty',
        '-simplify', '15%', 'keep-shapes',
        '-o', 'format=geojson', 'precision=0.01', OUT,
      ],
      { stdio: 'inherit' }
    );
    console.log('出力:', OUT);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
