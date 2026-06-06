/**
 * e-Stat の小地域（町丁目）境界データを全47都道府県分ダウンロード・変換する。
 *
 * 取得元: 国勢調査2020 小地域（町丁・字等別）境界データ（A002005212020）
 *   https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=XX&coordSys=1&format=shape&downloadType=5
 *   coordSys=1 = JGD2000 緯度経度（度）。format=shape の zip に r2kaXX.shp 一式が入る。
 *
 * 出力: frontend/public/data/chocho/XX_chocho.geojson（XX = 2桁都道府県コード）
 *   - properties: KEY_CODE, PREF_NAME, CITY_NAME, S_NAME（build-mesh.mjs が S_NAME を使う）
 *
 * GitHub のファイル容量制限（50MB で警告・100MB で拒否）を避けるため、
 * 既定の簡略化率で大きすぎる県は自動でさらに簡略化して上限内に収める。
 *
 * 使い方:
 *   node scripts/fetch-chocho.mjs                # 全47都道府県
 *   node scripts/fetch-chocho.mjs --only 13,01   # 指定コードのみ
 *   node scripts/fetch-chocho.mjs --simplify 5%  # 既定の簡略化率を変更（既定 8%）
 *   node scripts/fetch-chocho.mjs --max-mb 45    # 1ファイルの目標上限MB（既定 45）
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, statSync, readdirSync, renameSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'frontend', 'public', 'data', 'chocho');

// ── 引数 ────────────────────────────────────────────────
function argVal(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const onlyArg = argVal('--only');
const codes = onlyArg
  ? onlyArg.split(',').map((s) => s.trim().padStart(2, '0'))
  : Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0'));
const baseSimplify = argVal('--simplify') || '8%';
const maxMB = Number(argVal('--max-mb') || 45);

// 目標MBを超えたとき順に強める簡略化率（基準より小さい % へ）
const FALLBACK_SIMPLIFY = ['5%', '3%', '2%', '1%'];

mkdirSync(outDir, { recursive: true });

function fileSizeMB(p) {
  return statSync(p).size / 1024 / 1024;
}

function download(code, dest) {
  const url = `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=${code}&coordSys=1&format=shape&downloadType=5`;
  // リトライ付き curl（-f で HTTP エラーを失敗扱い）
  execFileSync('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', dest, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function convert(shp, out, simplify) {
  execFileSync(
    'npx',
    [
      'mapshaper',
      shp,
      '-simplify',
      simplify,
      '-filter-fields',
      'KEY_CODE,PREF_NAME,CITY_NAME,S_NAME',
      '-o',
      `format=geojson`,
      out,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
}

let ok = 0;
let failed = [];
for (const code of codes) {
  const tmp = mkdtempSync(join(tmpdir(), `chocho-${code}-`));
  try {
    process.stdout.write(`[${code}] ダウンロード中... `);
    const zip = join(tmp, `${code}.zip`);
    download(code, zip);
    execFileSync('unzip', ['-o', '-q', zip, '-d', tmp]);
    const shp = readdirSync(tmp).find((f) => /\.shp$/i.test(f));
    if (!shp) throw new Error('shp が見つかりません');

    const out = join(outDir, `${code}_chocho.geojson`);
    let simplify = baseSimplify;
    convert(join(tmp, shp), out, simplify);

    // サイズガード: 目標MBを超えたら順に簡略化を強める
    const fallbacks = [...FALLBACK_SIMPLIFY];
    while (fileSizeMB(out) > maxMB && fallbacks.length) {
      simplify = fallbacks.shift();
      convert(join(tmp, shp), out, simplify);
    }
    const mb = fileSizeMB(out).toFixed(1);
    const note = simplify === baseSimplify ? '' : ` (簡略化 ${simplify} に強化)`;
    console.log(`完了 → ${code}_chocho.geojson ${mb}MB${note}`);
    ok++;
  } catch (e) {
    console.log(`失敗: ${e.message}`);
    failed.push(code);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\n${ok}/${codes.length} 県を取得`);
if (failed.length) {
  console.log(`失敗: ${failed.join(', ')} → 再実行: node scripts/fetch-chocho.mjs --only ${failed.join(',')}`);
  process.exit(1);
}
