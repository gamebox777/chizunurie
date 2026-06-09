'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useSession } from '@/lib/auth-client';
import { logEvent, setLastKnownLocation } from '@/lib/userlog';
import { updateMyCountry } from '@/lib/userApi';
import { RUN_MODE, RUN_MODE_LABEL, RUN_MODE_BADGE } from '@/lib/runtime-env';
import { useLocale, type Lang, type TFunc } from '@/lib/i18n';
import { kanaToRomaji, prefRomaji } from '@/lib/romaji';
import { playPaint, playLevelUp, playConquer, unlockAudio } from '@/lib/sound';
import { vibratePaint } from '@/lib/haptics';
import { isBasemapEnabled, onBasemapChange, getBasemapOpacity, onBasemapOpacityChange } from '@/lib/basemap';
import { isGpsAddressEnabled, onGpsAddressChange } from '@/lib/gpsAddress';
import { getIconSize, onIconSizeChange } from '@/lib/iconSize';
import { showRewardedAd } from '@/lib/rewardedAd';

const PAINT_API = '/api/backend/painted';
const POINTS_API = '/api/backend/points';
const RANKINGS_API = '/api/backend/rankings';
// 動画リワードの GPT 広告ユニットパス（/ネットワークコード/広告ユニットコード）。
// 本番：GAM で作成済み（ネットワーク 23356418393・ユニット chizunurie_rewarded_video）。
const REWARDED_AD_UNIT_PROD = '/23356418393/chizunurie_rewarded_video';
// 開発：Google 公式のテスト用リワードユニット。ドメイン審査・ads.txt 不要で必ずテスト広告が出る。
const REWARDED_AD_UNIT_SAMPLE = '/22639388115/rewarded_web_example';
// 解決順：env で明示 > 開発ビルドはサンプル > 本番ユニット。
// （NODE_ENV はビルド時に静的置換される。npm run dev=development / build=production）
const REWARDED_AD_UNIT_PATH =
  process.env.NEXT_PUBLIC_REWARDED_AD_UNIT ||
  (process.env.NODE_ENV !== 'production'
    ? REWARDED_AD_UNIT_SAMPLE
    : REWARDED_AD_UNIT_PROD);
// 市区町村ごとの総メッシュ数（塗り％の分母）と meshcode→市区町村 の対応表。
// 約37万セル分を含むため map 表示後に遅延ロードする（build-muni-stats.mjs が生成）。
const MUNI_STATS_URL = '/data/muni-stats.json';
// 世界版の塗り％の分母（州・県 adm1_code → セル数 / 国 adm0_a3 → セル数）と地名メタ。
const WORLD_STATS_URL = '/data/world-stats.json';

// ── 塗りポイント／レベル（GPS移動は無料・それ以外の塗りはポイント消費） ──────────
// ※サーバー側（backend/src/lib/points.ts）が権威。max・level・exp はサーバーから受け取る。
const DEFAULT_MAX_POINTS = 10; // level 1 の最大塗りポイント（サーバー応答前の初期表示用）
const REGEN_INTERVAL_MS = 30 * 60 * 1000; // 30分で1ポイント回復
const COST_ADJACENT = 1; // 塗り済みに隣接する場所
const COST_FAR = 10; // 離れた場所（確認ダイアログ付き）
// 外国（自国＝GPSで判定した adm0_a3 以外）はざっくり 10×10 のブロックをまとめて塗る。
// 1ブロック固定コスト・隣接条件なし・離れていても COST_FAR は課さない。
const FOREIGN_BLOCK_SIZE = 10; // 外国のまとめ塗りブロックの一辺（セル数）
const COST_FOREIGN_BLOCK = 1; // 外国 1 ブロック（最大100マス）の固定コスト＝1マス分のポイント
// 新規セルを塗った瞬間にふわっと出す経験値（backend/src/lib/points.ts と一致）。
// gps＝現地塗り（訪問）、それ以外（となり塗り・離れた場所・外国ブロック）＝EXP_PAINT。
const EXP_VISIT = 100; // 現地塗り（GPS で実際に訪れる）
const EXP_PAINT = 50; // となり塗り・離れた場所塗り（manual）

// サーバーの塗りポイント状態（backend/src/lib/points.ts の PointsState と一致）
type ServerPoints = {
  points: number;
  max: number;
  regenAt: number | null;
  level: number;
  exp: number;
  expToNext: number;
  totalExp: number;
  playTimeSec: number;
};

// 合計プレイ時間のハートビート間隔（約1分ごとに経過秒をサーバーへ送る）
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

// 動画リワードの利用可否（backend/src/lib/points.ts の VideoRewardStatus と一致）
type VideoRewardStatus = {
  maxPerDay: number;
  remainingToday: number;
  cooldownMs: number;
  nextAvailableAt: number | null; // クールダウン中の次回視聴可能時刻 / 可能なら null
  resetAt: number | null; // 1日上限到達時のリセット時刻（翌JST0時）/ 未達なら null
  available: boolean;
};

// 「+1まで mm:ss」表示用。0以下は言語に応じた「まもなく / soon」。
function formatCountdown(ms: number, t: TFunc): string {
  if (ms <= 0) return t('countdownSoon');
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 合計プレイ時間（秒）を「X時間Y分Z秒 / Xh Ym Zs」に整形する（秒単位まで表示）
function formatPlayTime(sec: number, t: TFunc): string {
  if (!Number.isFinite(sec) || sec <= 0) return t('timeSec', 0 as never);
  const totalSec = Math.floor(sec);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(t('timeDay', d as never));
  if (d > 0 || h > 0) parts.push(t('timeHour', h as never));
  if (d > 0 || h > 0 || m > 0) parts.push(t('timeMin', m as never));
  parts.push(t('timeSec', s as never));
  return parts.join('').trim();
}

// 塗り方モード。gps = 実際に訪問（最優先・黄）、manual = マウスで隣接塗り（茶）
type PaintMode = 'gps' | 'manual';

const COLOR_GPS = '#facc15'; // 黄色（一番強い）
const COLOR_MANUAL = '#a0522d'; // 茶色

// 制覇（市区町村100%塗り）した境界を強調する金枠の色
const COLOR_CONQUER = '#f59e0b';
// コンボ（連鎖塗り）が途切れたと見なすまでの間隔（ms）
const COMBO_WINDOW_MS = 2500;

// 制覇した市区町村の金枠グローを描く MapLibre フィルタを組み立てる。
// municipalities レイヤーの "PREF|CITY+WARD" が完了キー集合に含まれる地物だけ通す。
// muni-stats / ラベルと同じキー形式 `${N03_001}|${N03_004}${N03_005}` で照合する。
function muniGlowFilter(keys: string[]): maplibregl.FilterSpecification {
  if (keys.length === 0) return ['==', ['literal', 0], ['literal', 1]]; // 常に偽
  return [
    'in',
    [
      'concat',
      ['coalesce', ['get', 'N03_001'], ''],
      '|',
      ['coalesce', ['get', 'N03_004'], ''],
      ['coalesce', ['get', 'N03_005'], ''],
    ],
    ['literal', keys],
  ] as unknown as maplibregl.FilterSpecification;
}

const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  // demotiles のフォントサーバーは Open Sans Regular を持たず 404 になるため、
  // ラテン文字・数字（国名/州名ラベル・塗り％）を配信できる openmaptiles を使う。
  // CJK は localIdeographFontFamily でローカル描画されるのでここには含まれない。
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f0ece4' },
    },
  ],
};

// このズーム以上でメッシュ（塗りの単位）を表示・操作対象にする。
// それより引いた状態では市区町村の白地図として見せる。日本・海外とも共通。
const MESH_MIN_ZOOM = 9;

// 塗った箇所を描く painted-overlay の表示開始ズーム（mesh はベイクしないので全ズーム
// この1レイヤーが塗りの色付けを担う）。これ未満は塗りも非表示。
const PAINTED_OVERLAY_MIN_ZOOM = 6;

// 地理院「標準地図」オーバーレイの表示開始ズーム。これ未満（世界全体を見る低ズーム）では
// 出さず、世界地図（白地図＋国境＋ラベル）を全面表示する。ズームインすると日本（bounds 内）
// だけ地形画像が乗る。低ズームで bounds の矩形が世界地図の上に出るのを防ぐため。
const GSI_OVERLAY_MIN_ZOOM = 6;

// 地理院オーバーレイを乗せる矩形群。GSI 標準地図は海上・国外でも不透明な（≒真っ白な）
// タイルを返すため、日本全体を覆う1個の巨大 bounds にすると外洋・日本海の大半・国外まで
// GSI が CARTO 世界地図を覆い「世界が消える」。そこで主要な陸地クラスタごとに tight な
// bounds を分けて張り、矩形の外（外洋・国外）では CARTO が見えるようにする。
// （ラスターの bounds は矩形1個しか持てないため source を島ごとに分ける。矩形内に残る
//  沿岸海・内海は GSI のまま。小笠原・南鳥島・沖ノ鳥島など遠方離島は CARTO 表示で割り切る。）
const GSI_OVERLAY_REGIONS: { id: string; bounds: [number, number, number, number] }[] = [
  { id: 'hokkaido', bounds: [139.2, 41.3, 146.1, 45.7] }, // 北海道＋利尻・礼文
  { id: 'honshu', bounds: [130.6, 33.2, 142.2, 41.7] }, // 本州（佐渡・能登・房総・下北含む）
  { id: 'shikoku', bounds: [132.0, 32.6, 134.9, 34.6] }, // 四国
  { id: 'kyushu', bounds: [128.3, 30.0, 132.3, 34.8] }, // 九州＋対馬・種子島・屋久島
  { id: 'nansei', bounds: [122.8, 24.0, 131.1, 29.0] }, // 奄美〜沖縄〜宮古〜石垣〜与那国
];

// 地理院オーバーレイのレイヤー＋ソースを追加する（=この時だけタイル取得が始まる）。
// world-basemap（CARTO）の上・world-states-border（境界線）の下に差し込み、地図画像どうしの
// 重ね順を保つ。既に追加済みなら何もしない（多重 addLayer を防ぐ）。
function addGsiOverlay(map: maplibregl.Map): void {
  const beforeId = map.getLayer('world-states-border') ? 'world-states-border' : undefined;
  for (const region of GSI_OVERLAY_REGIONS) {
    const srcId = `gsi-std-${region.id}`;
    const layerId = `gsi-std-overlay-${region.id}`;
    if (map.getLayer(layerId)) continue;
    if (!map.getSource(srcId)) {
      map.addSource(srcId, {
        type: 'raster',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 18,
        bounds: region.bounds,
        attribution:
          '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>',
      });
    }
    map.addLayer(
      {
        id: layerId,
        type: 'raster',
        source: srcId,
        // 日本へズームインした時だけ地形画像を出す（低ズームでは矩形が世界地図の上に出るのを防ぐ）。
        minzoom: GSI_OVERLAY_MIN_ZOOM,
        paint: { 'raster-opacity': getBasemapOpacity() },
      },
      beforeId,
    );
  }
}

// 地理院オーバーレイのレイヤー＋ソースを削除する（OFF 時はタイルを一切取得しなくなる）。
function removeGsiOverlay(map: maplibregl.Map): void {
  for (const region of GSI_OVERLAY_REGIONS) {
    const layerId = `gsi-std-overlay-${region.id}`;
    const srcId = `gsi-std-${region.id}`;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(srcId)) map.removeSource(srcId);
  }
}

// 約1kmの等面積グリッド = 緯度 1/120°・経度 1/80° の均一グリッド
const MESH_LAT_DIV = 120;
const MESH_LON_DIV = 80;

// 全球で一意なセルID（CELLID）のエンコード。
// グリッド整数 ri=floor(lat*120) ∈[-10800,10800]、ci=floor(lng*80) ∈[-14400,14400] を
// 非負へオフセットして 1 整数に詰める。旧8桁JIS地域メッシュコードは経度100〜180・緯度2桁
// 前提で世界版では破綻するため、全球で破綻しないこの方式に統一した。
//   RI0 = ri + 10800 ∈[0,21600]   CI0 = ci + 14400 ∈[0,28800]
//   CELLID = RI0 * 30000 + CI0      // 乗数30000 > CI0最大 で衝突なし・最大 648,028,800（9桁）
const CELL_RI_OFFSET = 10800;
const CELL_CI_OFFSET = 14400;
const CELL_CI_SPAN = 30000;

// グリッド整数 (ri, ci) → CELLID（数値ID）
function meshCodeFromGrid(ri: number, ci: number): number {
  return (ri + CELL_RI_OFFSET) * CELL_CI_SPAN + (ci + CELL_CI_OFFSET);
}

// 経度・緯度 → CELLID（数値ID）
function meshCodeAt(lng: number, lat: number): number {
  const ri = Math.floor(lat * MESH_LAT_DIV);
  const ci = Math.floor(lng * MESH_LON_DIV);
  return meshCodeFromGrid(ri, ci);
}

// CELLID（数値ID）→ グリッド整数 [ri, ci]
function gridFromMeshCode(code: number): [number, number] {
  const ci0 = code % CELL_CI_SPAN;
  const ri0 = (code - ci0) / CELL_CI_SPAN;
  return [ri0 - CELL_RI_OFFSET, ci0 - CELL_CI_OFFSET];
}

// CELLID（数値ID）→ セルの矩形ポリゴンの外周リング（[lng,lat] の5点）
function meshCellRing(code: number): [number, number][] {
  const [ri, ci] = gridFromMeshCode(code);
  const lat0 = ri / MESH_LAT_DIV;
  const lat1 = (ri + 1) / MESH_LAT_DIV;
  const lng0 = ci / MESH_LON_DIV;
  const lng1 = (ci + 1) / MESH_LON_DIV;
  return [
    [lng0, lat0],
    [lng1, lat0],
    [lng1, lat1],
    [lng0, lat1],
    [lng0, lat0],
  ];
}

// ── 市区町村の帰属判定（セル中心 point-in-polygon）──────────────────
// 塗ったセルがどの市区町村に属するか（塗り％の分子）を、ズームに依存する
// queryRenderedFeatures（タイルは zoom ごとに簡略化が違う）ではなく、build-muni-stats
// が分母を数えるときと「同一のジオメトリ・同一のアルゴリズム」で判定する。これにより
// 分子＝分母が厳密に一致し、どのズームで塗っても市区町村は必ず 100% に到達する。
// 判定用ポリゴンは muni-classify.geojson（build-muni-classify が生成・遅延ロード）。
const MUNI_CLASSIFY_URL = '/data/muni-classify.geojson';

// 帰属判定用の市区町村。parts は build-muni-stats と同じ {rings, bbox}（polysWithBbox で生成）。
type MuniPoly = { key: string; address: string; parts: PolyWithBbox[] };

// 帰属判定を速くする粗いグリッド索引（バケット → そのバケットに bbox が重なる市区町村の
// インデックス昇順）。約0.2°（緯度約22km）刻み。塗りセルを大量に数え直す（reclassify）
// ときに、全1905市区町村を線形走査せず候補だけ調べられるようにする。
const MUNI_GRID = 0.2;
const muniBucketKey = (gx: number, gy: number) => gx * 100000 + gy;

function buildMuniIndex(feats: MuniPoly[]): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (let fi = 0; fi < feats.length; fi++) {
    for (const { bbox } of feats[fi].parts) {
      const gx0 = Math.floor(bbox[0] / MUNI_GRID);
      const gx1 = Math.floor(bbox[2] / MUNI_GRID);
      const gy0 = Math.floor(bbox[1] / MUNI_GRID);
      const gy1 = Math.floor(bbox[3] / MUNI_GRID);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const bk = muniBucketKey(gx, gy);
          let arr = index.get(bk);
          if (!arr) index.set(bk, (arr = []));
          // feats を昇順に回しているので、同一バケットも昇順を保つ（ファイル順＝分母の重複排除順）
          if (arr[arr.length - 1] !== fi) arr.push(fi);
        }
      }
    }
  }
  return index;
}

// セル中心 (lng,lat) を含む最初の市区町村（ファイル順）を返す。build-muni-stats の
// グローバル重複排除（先に確定した市区町村にだけ数える）と同じく「ファイル順で最初に
// 含むもの」を採用するので、分母と完全に同じ帰属になる。
function classifyMuniCell(
  feats: MuniPoly[],
  index: Map<number, number[]>,
  lng: number,
  lat: number
): { key: string; address: string } | null {
  const cand = index.get(muniBucketKey(Math.floor(lng / MUNI_GRID), Math.floor(lat / MUNI_GRID)));
  if (!cand) return null;
  for (const fi of cand) {
    const f = feats[fi];
    for (const { rings, bbox } of f.parts) {
      if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
      if (pointInRings(lng, lat, rings)) return { key: f.key, address: f.address };
    }
  }
  return null;
}

// 国土地理院の住所検索API（キー不要・日本の地名/住所→経緯度・市区町村〜町丁目の細かさ）
const GEOCODE_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';

type GeocodeResult = {
  geometry: { coordinates: [number, number]; type: 'Point' };
  properties: { title: string };
};

// 世界の地名検索（OpenStreetMap Nominatim・キー不要・日本語クエリ/表示にも対応）。
// 日本は国土地理院の方が細かいので、Nominatim は主に日本の外をカバーする（粒度は粗め）。
const WORLD_GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

// 検索結果の統一型。scope で日本（国土地理院・細かい）／世界（Nominatim・粗い）を区別する。
type SearchHit = {
  title: string;
  lng: number;
  lat: number;
  scope: 'jp' | 'world';
};

// 検索でこの bbox 内の世界(Nominatim)結果は国土地理院の結果と重複しがちなので落とす。
const JP_SEARCH_BOUNDS = { minLng: 122.9, maxLng: 154.0, minLat: 20.4, maxLat: 45.6 };
function isInJapanBounds(lng: number, lat: number): boolean {
  return (
    lng >= JP_SEARCH_BOUNDS.minLng &&
    lng <= JP_SEARCH_BOUNDS.maxLng &&
    lat >= JP_SEARCH_BOUNDS.minLat &&
    lat <= JP_SEARCH_BOUNDS.maxLat
  );
}

// 国土地理院（日本・細かい）で検索。失敗時は空配列。
// 国土地理院 API は先頭1文字だけの一致でも大量に返し（例「東京」で「東」を含む北海道の地名が
// 上位に来る）、クエリ全体を含む地名が埋もれる。そこで「クエリ全体を文字部分一致で含む」結果を
// 優先して並べ替える（完全一致 > 前方一致 > 部分一致 > その他。各バケット内は API の順序を維持）。
async function searchJapan(query: string): Promise<SearchHit[]> {
  try {
    const res = await fetch(`${GEOCODE_URL}?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as GeocodeResult[];
    if (!Array.isArray(data)) return [];
    const hits = data.map((r) => ({
      title: r.properties.title,
      lng: r.geometry.coordinates[0],
      lat: r.geometry.coordinates[1],
      scope: 'jp' as const,
    }));
    const rank = (title: string): number => {
      if (title === query) return 0;
      if (title.startsWith(query)) return 1;
      if (title.includes(query)) return 2;
      return 3;
    };
    // 安定ソート（同ランクは元の順序を保つ）でクエリ全体を含む地名を上位に出す
    return hits
      .map((h, i) => ({ h, i, r: rank(h.title) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.h);
  } catch (err) {
    console.warn('gsi geocode failed', err);
    return [];
  }
}

// Nominatim（世界・粗い）で検索。accept-language で表示名の言語を切り替える。失敗時は空配列。
async function searchWorld(query: string, lang: Lang): Promise<SearchHit[]> {
  try {
    const url =
      `${WORLD_GEOCODE_URL}?format=jsonv2&limit=8&accept-language=${lang}` +
      `&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as NominatimResult[];
    if (!Array.isArray(data)) return [];
    return data.map((r) => ({
      title: r.display_name,
      lng: Number(r.lon),
      lat: Number(r.lat),
      scope: 'world' as const,
    }));
  } catch (err) {
    console.warn('nominatim geocode failed', err);
    return [];
  }
}

// 国土地理院の逆ジオコーダ（経緯度→住所）。現地塗りで「グリッド内の近似住所」では
// なく、現在地そのものの正確な住所（町丁目まで）を表示するのに使う。
const REVERSE_GEOCODE_URL =
  'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
// muniCd（5桁市区町村コード）→「都道府県名＋市区町村名」の対応表（旧地理院地図）
const MUNI_JS_URL = 'https://maps.gsi.go.jp/js/muni.js';

// muni.js を一度だけ取得して muniCd→「都道府県市区町村」表を作る（モジュール内キャッシュ）
let muniMapPromise: Promise<Map<string, string>> | null = null;
function loadMuniMap(): Promise<Map<string, string>> {
  if (!muniMapPromise) {
    muniMapPromise = fetch(MUNI_JS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        // 例: GSI.MUNI_ARRAY["13103"] = '13,東京都,13103,港区';
        const map = new Map<string, string>();
        const re = /MUNI_ARRAY\["(\d+)"\]\s*=\s*'\d+,([^,]+),\d+,([^']+)'/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          // 政令市は「札幌市　中央区」のように全角空白が入るので除去する
          map.set(m[1], (m[2] + m[3]).replace(/[\s　]/g, '')); // 都道府県名 + 市区町村名
        }
        return map;
      })
      .catch((err) => {
        console.warn('muni.js load failed', err);
        muniMapPromise = null; // 失敗時は次回再試行できるようにする
        return new Map<string, string>();
      });
  }
  return muniMapPromise;
}

// 経緯度→正確な住所（都道府県＋市区町村＋町丁目）。取得失敗時は空文字を返す。
async function reverseGeocode(lng: number, lat: number): Promise<string> {
  try {
    const res = await fetch(`${REVERSE_GEOCODE_URL}?lat=${lat}&lon=${lng}`);
    if (!res.ok) return '';
    const data = (await res.json()) as {
      results?: { muniCd?: string; lv01Nm?: string };
    };
    const r = data.results;
    if (!r || !r.muniCd) return ''; // 海上など住所が無い地点は {} が返る
    const muniMap = await loadMuniMap();
    // muni.js のキーは先頭ゼロ無し（北海道は "1101"）。reverse は "01101" を返すので正規化する
    const muniName = muniMap.get(String(Number(r.muniCd))) ?? muniMap.get(r.muniCd) ?? '';
    const town = r.lv01Nm && r.lv01Nm !== '-' ? r.lv01Nm : '';
    return muniName + town;
  } catch (err) {
    console.warn('reverse geocode failed', err);
    return '';
  }
}

// 検索（虫眼鏡）ボタンを位置情報アイコンの下に積むためのカスタムコントロール
class SearchControl implements maplibregl.IControl {
  private onClick: () => void;
  private container?: HTMLDivElement;
  constructor(onClick: () => void) {
    this.onClick = onClick;
  }
  onAdd(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = '地名を検索';
    btn.setAttribute('aria-label', '地名を検索');
    btn.style.color = '#1a1a1a';
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    btn.addEventListener('click', () => this.onClick());
    this.container.appendChild(btn);
    return this.container;
  }
  onRemove(): void {
    this.container?.parentNode?.removeChild(this.container);
    this.container = undefined;
  }
}

// 検索ボタンの下にデバッグメニューを開くレンチアイコンを積むカスタムコントロール
class DebugControl implements maplibregl.IControl {
  private onClick: () => void;
  private container?: HTMLDivElement;
  constructor(onClick: () => void) {
    this.onClick = onClick;
  }
  onAdd(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'デバッグメニュー';
    btn.setAttribute('aria-label', 'デバッグメニューを開く');
    btn.style.color = '#1a1a1a';
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
    btn.addEventListener('click', () => this.onClick());
    this.container.appendChild(btn);
    return this.container;
  }
  onRemove(): void {
    this.container?.parentNode?.removeChild(this.container);
    this.container = undefined;
  }
}

// 位置情報アイコンの下に「自分のデータ詳細」を開く棒グラフアイコンを積むカスタムコントロール
class StatsControl implements maplibregl.IControl {
  private onClick: () => void;
  private container?: HTMLDivElement;
  constructor(onClick: () => void) {
    this.onClick = onClick;
  }
  onAdd(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'データ詳細';
    btn.setAttribute('aria-label', '自分のデータ詳細を開く');
    btn.style.color = '#1a1a1a';
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>';
    btn.addEventListener('click', () => this.onClick());
    this.container.appendChild(btn);
    return this.container;
  }
  onRemove(): void {
    this.container?.parentNode?.removeChild(this.container);
    this.container = undefined;
  }
}

// データ詳細アイコンの下に「ランキング」を開くトロフィーアイコンを積むカスタムコントロール
class RankingsControl implements maplibregl.IControl {
  private onClick: () => void;
  private container?: HTMLDivElement;
  constructor(onClick: () => void) {
    this.onClick = onClick;
  }
  onAdd(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'ランキング';
    btn.setAttribute('aria-label', 'ランキングを開く');
    btn.style.color = '#1a1a1a';
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';
    btn.addEventListener('click', () => this.onClick());
    this.container.appendChild(btn);
    return this.container;
  }
  onRemove(): void {
    this.container?.parentNode?.removeChild(this.container);
    this.container = undefined;
  }
}

type PaintedState = Record<string, PaintMode>;

// ランキングの種類（塗ったマス数・GPS訪問・市区町村数・レベル）
type RankingMetric = 'painted' | 'gps' | 'muni' | 'level';
// 集計期間（全期間・月間・週間）。塗り由来のランキングにだけ効く。
type RankingPeriod = 'all' | 'month' | 'week';
type RankingEntry = { rank: number; userId: string; name: string; value: number };
type RankingBoard = { top: RankingEntry[]; me: RankingEntry | null };
type RankingsResponse = { boards: Record<RankingMetric, RankingBoard> };

// 塗った日時（ISO 文字列）を「YYYY/M/D HH:mm」に整形。不正値は空文字。
function formatPaintedAt(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 塗った全セルを矩形ポリゴンの FeatureCollection に変換（低ズーム用オーバーレイ）。
// メッシュコードから数式でセル範囲を復元するので PMTiles 側にメッシュが無い
// 低ズームでも塗りを描画できる。
function buildPaintedOverlay(painted: PaintedState): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [key, mode] of Object.entries(painted)) {
    const [sourceLayer, idStr] = key.split(':');
    if (sourceLayer !== 'mesh') continue;
    const code = Number(idStr);
    if (!Number.isFinite(code)) continue;
    features.push({
      type: 'Feature',
      properties: { mode },
      geometry: { type: 'Polygon', coordinates: [meshCellRing(code)] },
    });
  }
  return { type: 'FeatureCollection', features };
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

// 点内外判定（even-odd ray casting）。rings: [外周, 穴...]。
function pointInRings(lng: number, lat: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0],
        yi = ring[i][1];
      const xj = ring[j][0],
        yj = ring[j][1];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// GeoJSON geometry を「{rings, bbox}」の配列に正規化（Polygon / MultiPolygon）
type PolyWithBbox = { rings: number[][][]; bbox: [number, number, number, number] };
function polysWithBbox(geometry: GeoJSON.Geometry | null | undefined): PolyWithBbox[] {
  if (!geometry) return [];
  const polys =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  return (polys as number[][][][]).map((rings) => {
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

// CELLID 1個ぶんの矩形 Feature（ホバー表示用）
function cellFeature(code: number): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [meshCellRing(code)] },
  };
}

// 外国まとめ塗り用：中心セルを基準に FOREIGN_BLOCK_SIZE×FOREIGN_BLOCK_SIZE の
// セル群を生成する（プレビュー矩形・塗り対象の走査で共用）。偶数サイズなので
// クリックしたセルを中心寄りに -4..+5（=10マス）の正方形にする。
function foreignBlockGrid(centerId: number): Array<[number, number]> {
  const [ri0, ci0] = gridFromMeshCode(centerId);
  const lo = -Math.floor((FOREIGN_BLOCK_SIZE - 1) / 2); // -4
  const hi = lo + FOREIGN_BLOCK_SIZE - 1; // +5
  const out: Array<[number, number]> = [];
  for (let dri = lo; dri <= hi; dri++) {
    for (let dci = lo; dci <= hi; dci++) out.push([ri0 + dri, ci0 + dci]);
  }
  return out;
}

// プレビューの半透明矩形（10×10ぶん）。陸海問わず正方形で「ここをまとめて塗る」を示す。
function blockCellFeatures(centerId: number): GeoJSON.Feature[] {
  return foreignBlockGrid(centerId).map(([ri, ci]) =>
    cellFeature(meshCodeFromGrid(ri, ci))
  );
}

// 格子生成・陸地判定で走査するセル数の安全上限（引きすぎ時は格子を出さない）
const GRID_MAX_CELLS = 20000;

type MapProps = {
  onHoverAddressChange?: (address: string) => void;
};

export default function MapView({ onHoverAddressChange }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onHoverAddressChangeRef = useRef(onHoverAddressChange);
  const [mapReady, setMapReady] = useState(false);
  const [painted, setPainted] = useState<PaintedState>({});
  const paintedRef = useRef<PaintedState>({});
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  // 塗りポイント／レベル（ログインユーザーのみ）。ref は塗りハンドラ内から同期参照する。
  const [points, setPoints] = useState(0);
  const [regenAt, setRegenAt] = useState<number | null>(null); // 次の回復時刻(ms) / 満タンなら null
  const [maxPoints, setMaxPoints] = useState(DEFAULT_MAX_POINTS); // 現在レベルの最大塗りポイント（回復上限）
  const [level, setLevel] = useState(1);
  const [exp, setExp] = useState(0); // 現在レベル内の経験値
  const [expToNext, setExpToNext] = useState(0); // 次レベルまでに必要な経験値
  const [totalExp, setTotalExp] = useState(0); // 累計獲得経験値（減らない記録）
  const [playTimeSec, setPlayTimeSec] = useState(0); // 合計プレイ時間（秒）
  const pointsRef = useRef(0);
  const regenAtRef = useRef<number | null>(null);
  const maxPointsRef = useRef(DEFAULT_MAX_POINTS);
  const levelRef = useRef<number | null>(null); // 直近のレベル（レベルアップ検出用・未取得は null）
  const lastBeatRef = useRef<number>(0); // 合計プレイ時間：前回ハートビートで計上した時刻(ms)
  const [nowTick, setNowTick] = useState(() => Date.now()); // カウントダウン再描画用
  // レベルアップ演出（{ to: 到達レベル } を一時表示）
  const [levelUp, setLevelUp] = useState<{ to: number } | null>(null);
  const levelUpTimerRef = useRef<number | null>(null);
  // 離れた場所（10ポイント）の確認ダイアログ。map init の外（JSX）から確定させる。
  const [confirmPaint, setConfirmPaint] = useState<{
    id: number;
    cost: number;
    muniKey: string | null;
    region: { key: string; a3: string } | null;
    address: string;
  } | null>(null);
  const doManualPaintRef = useRef<
    (
      id: number,
      muniKey: string | null,
      region: { key: string; a3: string } | null,
      address: string,
      cost: number
    ) => void
  >(() => {});
  // 動画リワード（動画視聴でそのレベルの満タン分を回復）
  const [rewardStatus, setRewardStatus] = useState<VideoRewardStatus | null>(null);
  // 進行中フェーズ：null=非表示 / 'loading'=広告準備中 / 'claiming'=報酬請求中。
  // 実際の広告 UI（全画面）は GPT が生成するため、こちらは前後のローディング表示専用。
  const [videoPhase, setVideoPhase] = useState<'loading' | 'claiming' | null>(
    null
  );
  // 連打・二重起動を防ぐためのフラグ（state はクロージャで古くなるので ref で持つ）。
  const videoBusyRef = useRef(false);
  // 市区町村ごとの塗り％表示用
  const [hoverStat, setHoverStat] = useState<string | null>(null); // ホバー中市区町村の「市名 35%（n/N）」
  // 外国（自国以外）にホバー中か。true の間「10×10まとめ塗り！」バッジを出す。
  const [foreignHover, setForeignHover] = useState(false);
  // 塗ったセルの CELLID → "PREF|CITY"。塗り時に求めた値を保持し、復元時は backend の
  // municipality 列から埋める。mesh をベイクしなくなったので「全セルの cell→市」表は持たない。
  const muniByPaintedCellRef = useRef<Map<number, string>>(new Map());
  const paintedAtRef = useRef<Map<number, string>>(new Map()); // CELLID → 塗った日時（ISO・DB復元値／その場塗りは now で上書き）
  const totalByMuniRef = useRef<Map<string, number>>(new Map()); // "PREF|CITY" → 総セル数（分母）
  const paintedByMuniRef = useRef<Map<string, number>>(new Map()); // "PREF|CITY" → 塗ったセル数（分子）
  const muniPolysRef = useRef<MuniPoly[]>([]); // 帰属判定用ポリゴン（muni-classify.geojson・遅延ロード）
  const muniIndexRef = useRef<Map<number, number[]>>(new Map()); // 帰属判定用の粗いグリッド索引
  const hoverKeyRef = useRef<string | null>(null); // 現在ホバー中の市区町村キー
  // ── 世界版の塗り％（州・県 adm1_code ＋ 国 adm0_a3 単位）──────────────────
  // 日本の muni と同じ二段（分母=world-stats / 分子=塗ったセルから集計）。日本の外を塗ると入る。
  const regionByPaintedCellRef = useRef<Map<number, string>>(new Map()); // CELLID → adm1_code
  const totalByStateRef = useRef<Map<string, number>>(new Map()); // adm1_code → 総セル数（分母）
  const totalByCountryRef = useRef<Map<string, number>>(new Map()); // adm0_a3 → 総セル数（分母）
  const paintedByStateRef = useRef<Map<string, number>>(new Map()); // adm1_code → 塗ったセル数
  const paintedByCountryRef = useRef<Map<string, number>>(new Map()); // adm0_a3 → 塗ったセル数
  const stateMetaRef = useRef<Map<string, { name: string; name_ja: string; admin: string; adm0_a3: string }>>(new Map());
  const countryMetaRef = useRef<Map<string, { name: string; name_ja: string }>>(new Map());
  const hoverRegionRef = useRef<string | null>(null); // 現在ホバー中の adm1_code（日本外）
  // ラベル横に塗り％を出すためのクライアント側 GeoJSON（PMTiles のラベルは静的なので使えない）
  const muniLabelFCRef = useRef<GeoJSON.FeatureCollection | null>(null); // 市区町村名ポイント
  const cityLabelFCRef = useRef<GeoJSON.FeatureCollection | null>(null); // 政令指定都市ポリゴン
  const prefLabelFCRef = useRef<GeoJSON.FeatureCollection | null>(null); // 都道府県ポリゴン
  // 市区町村名の読み仮名（ひらがな）。ラベルの下に小さく添える。build-muni-kana.mjs が生成。
  const kanaByCodeRef = useRef<Record<string, string>>({}); // N03_007 → 読み（表示名=区名 or 市区町村名）
  const kanaByCityRef = useRef<Record<string, string>>({}); // "PREF|市名" → 読み（政令市ラベル用）
  const cityKeyPrefixesRef = useRef<string[]>([]); // ["北海道|札幌市", ...]（政令市の集計用プレフィックス）
  const labelRefreshTimerRef = useRef<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // ── 制覇（市区町村100%）演出 ──
  const completedMuniRef = useRef<Set<string>>(new Set()); // 100%塗った "PREF|CITY" 集合（金枠グローの対象）
  const completedPrefRef = useRef<Set<string>>(new Set()); // 完全制覇した都道府県名の集合
  const [conqueredCount, setConqueredCount] = useState(0); // 制覇した市区町村数（UI再描画用）
  const [conquer, setConquer] = useState<string | null>(null); // 制覇バナーのメッセージ
  const conquerTimerRef = useRef<number | null>(null);

  // ── コンボ（連鎖塗り）演出 ──
  const comboRef = useRef(0);
  const lastPaintAtRef = useRef(0);
  const [combo, setCombo] = useState(0);
  const comboTimerRef = useRef<number | null>(null);
  const comboKeyRef = useRef(0); // 表示の再アニメ用キー

  // ── 塗りの瞬間の波紋（paint-ripple）。塗ったセルを中心に地図空間で広がる。──
  // 地図座標への貼り付け（パン/ズーム追従）は MapLibre の Marker に任せる。波紋の大きさだけ
  // requestAnimationFrame でセルの実ピクセル幅（--size）に追従させ、ズームと一緒に拡大させる。
  const fxItemsRef = useRef<Array<{ el: HTMLDivElement; lng: number; marker: maplibregl.Marker }>>([]);
  const fxRafRef = useRef<number | null>(null);

  // 生きている波紋のサイズをセル幅に合わせて毎フレーム更新（空になったら自動で止まる）。
  const tickRipples = useCallback(() => {
    const map = mapRef.current;
    const items = fxItemsRef.current;
    if (!map || items.length === 0) {
      fxRafRef.current = null;
      return;
    }
    for (const it of items) {
      const c = map.project([it.lng, 35]);
      const e = map.project([it.lng + 1 / MESH_LON_DIV, 35]); // 隣セルとの差＝セル横幅px
      const size = Math.max(12, Math.abs(e.x - c.x));
      it.el.style.setProperty('--size', `${size}px`);
    }
    fxRafRef.current = requestAnimationFrame(tickRipples);
  }, []);

  // 塗ったセル中心（地理座標）に派手な波紋を出す。
  const spawnRipple = useCallback(
    (lng: number, lat: number, color: string) => {
      const map = mapRef.current;
      if (!map) return;
      const el = document.createElement('div');
      el.className = 'paint-ripple';
      el.style.setProperty('--c', color);
      // セル横幅 px を初期サイズに（rAF が来る前から正しい大きさで出す）
      const c = map.project([lng, lat]);
      const e = map.project([lng + 1 / MESH_LON_DIV, lat]);
      el.style.setProperty('--size', `${Math.max(12, Math.abs(e.x - c.x))}px`);
      el.innerHTML =
        '<span class="paint-ripple-flash"></span>' +
        '<span class="paint-ripple-ring r1"></span>';
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
      const item = { el, lng, marker };
      fxItemsRef.current.push(item);
      if (fxRafRef.current === null) fxRafRef.current = requestAnimationFrame(tickRipples);
      window.setTimeout(() => {
        marker.remove();
        fxItemsRef.current = fxItemsRef.current.filter((i) => i !== item);
      }, 1700);
    },
    [tickRipples]
  );

  // map 初期化 effect 内（mount 時クロージャ）の syncPaint から最新の spawnRipple を呼べるよう ref に保持
  const spawnRippleRef = useRef(spawnRipple);
  spawnRippleRef.current = spawnRipple;

  // 逆ジオコーダ（経緯度→町丁目まで）の結果キャッシュ（CELLID→住所）。ホバーと塗りのふわっと
  // 表示で共有し、同じセルへの再問い合わせを防ぐ。map 初期化 effect 内のホバー処理も同じ Map を使う。
  const revGeoCacheRef = useRef<Map<number, string>>(new Map());
  // ── 塗った瞬間に地名＋経験値を画面 UI としてふわっと上に出す（float-text）。──
  // 地図に貼り付けるのではなく、画面に重ねる UI として表示し、上昇しながら薄れて消える。
  // 連続でとなり塗りすると複数が同時に出る（古いものから順に消える）。
  const floatKeyRef = useRef(0);
  const [floats, setFloats] = useState<Array<{ key: number; name: string; exp: number; dx: number }>>(
    []
  );
  const spawnFloatText = useCallback((name: string, exp: number): number => {
    const key = (floatKeyRef.current += 1);
    // 同時に複数出たとき重ならないよう、キーから決まる小さな横ずれを付ける（±50px）。
    const dx = ((key * 47) % 100) - 50;
    setFloats((prev) => [...prev, { key, name, exp, dx }]);
    window.setTimeout(() => {
      setFloats((prev) => prev.filter((f) => f.key !== key));
    }, 2000);
    return key;
  }, []);
  // ふわっと表示の地名を後から差し替える（逆ジオコーダが町丁目を返したとき）。
  const updateFloatName = useCallback((key: number, name: string) => {
    setFloats((prev) => prev.map((f) => (f.key === key ? { ...f, name } : f)));
  }, []);

  // アンマウント時に rAF と残った波紋を片付ける
  useEffect(() => {
    return () => {
      if (fxRafRef.current !== null) cancelAnimationFrame(fxRafRef.current);
      for (const it of fxItemsRef.current) it.marker.remove();
      fxItemsRef.current = [];
    };
  }, []);

  // 新規セルが塗られた瞬間に呼ぶハンドラ（波紋・コンボ・制覇判定）。
  // map 初期化 effect 内の commitLocalPaint から最新クロージャを呼べるよう ref 経由にする。
  const onCellPaintedRef = useRef<
    (id: number, muniKey: string | null, mode: PaintMode, name?: string) => void
  >(() => {});

  const [debugMoving, setDebugMoving] = useState(false);
  // デバッグ用：マウスで塗った場所を消すモード。ON の間はクリックで塗らずに消す
  // （現地塗り・となり塗り問わず消せる）。クリックハンドラから同期参照するため ref も持つ。
  const [eraseMode, setEraseMode] = useState(false);
  const eraseModeRef = useRef(false);
  // デバッグ用：マウスオーバーしただけで塗るモード（ポイント消費なし・無料）。
  // ON の間はクリック不要でカーソルが通ったセルを次々に塗る。mousemove から同期参照するため ref も持つ。
  const [hoverPaintMode, setHoverPaintMode] = useState(false);
  const hoverPaintModeRef = useRef(false);
  const debugCleanupRef = useRef<(() => void) | null>(null);
  const addressMarkerRef = useRef<maplibregl.Marker | null>(null); // 現在地の住所ラベル
  const gpsAddressEnabledRef = useRef(true); // 現在地の住所ラベル表示 ON/OFF（設定・既定 ON）
  // 塗り方の操作モード。genchi=現地塗り（GPSの現在地のみ自動で塗る）/
  // tonari=となり塗り（マウスで隣接セルを塗れる）/ nazori=なぞり塗り（マウスオーバー・
  // スワイプで隣接セルを連続塗り・地図はスクロールしない）。GPS自動塗りは全モード共通。
  // map init effect 内のクリックハンドラから同期参照するため ref も持つ。
  type PaintOpMode = 'genchi' | 'tonari' | 'nazori';
  const [paintMode, setPaintMode] = useState<PaintOpMode>('genchi');
  const paintModeRef = useRef<PaintOpMode>('genchi');
  // 地名検索ダイアログ
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // カスタムコントロール（map init effect）から最新の open ハンドラを呼ぶための ref
  const openSearchRef = useRef<() => void>(() => {});
  // デバッグメニュー（右からスライドするパネル）
  const [debugOpen, setDebugOpen] = useState(false);
  // 「塗りを全部消す」の確認ダイアログ
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  // 「ユーザーデータをリセット」の確認ダイアログ（塗り＋レベル・経験値を初期化）
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const openDebugRef = useRef<() => void>(() => {});
  // データ詳細（右からスライドするパネル）。自分の塗り実績を集計して見せる。
  const [statsOpen, setStatsOpen] = useState(false);
  // データ詳細パネルの表示モード（home＝自国・world＝国ごとの塗り％）。
  // home は自国が日本なら都道府県、日本以外ならその国の州・県（admin_1）内訳を出す。
  const [statsView, setStatsView] = useState<'home' | 'world'>('home');
  const openStatsRef = useRef<() => void>(() => {});
  // ランキング（右からスライドするパネル）。開発者を除いた各種ランキングをバックエンドから取得して見せる。
  const [rankingsOpen, setRankingsOpen] = useState(false);
  const [rankingsTab, setRankingsTab] = useState<RankingMetric>('painted');
  const [rankingsPeriod, setRankingsPeriod] = useState<RankingPeriod>('all');
  const [rankingsData, setRankingsData] = useState<RankingsResponse | null>(null);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const openRankingsRef = useRef<() => void>(() => {});
  const { data: session, isPending } = useSession();
  // 言語（ゲーム画面の用語・地名のローマ字表示）。effect 内の同期参照用に ref も持つ。
  const { t, lang } = useLocale();
  const tRef = useRef<TFunc>(t);
  tRef.current = t;
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;
  const userId = session?.user?.id ?? null;
  const userIdRef = useRef<string | null>(null);
  // 自国の国コード（adm0_a3）。毎セッション、初回 GPS 取得時に現在地から判定して入れる。
  // 自国は1マスずつ、それ以外（外国）は 10×10 ブロックでまとめ塗りにする。未判定（GPS 前・
  // 不許可）の間は外国扱いにせず従来どおり1マス塗りで動かす。
  const homeCountryRef = useRef<string | null>(null);
  // 直近に DB へ反映した所在国（adm0_a3）。GPS で判定した国がこれと変われば user.country を更新する。
  // homeCountry（=塗り方の自国判定・1セッション固定）とは別管理で、移動して国が変わるたび追従する。
  const reportedCountryRef = useRef<string | null>(null);
  // 自国コードを UI（データ詳細パネルの自国タブのラベル・内訳の分岐）へ反映する用の state。
  // ref と同じ値を持つが、判定が決まった時にパネルを再描画させるために別途持つ。
  const [homeCountry, setHomeCountry] = useState<string | null>(null);
  // 開発者だけがデバッグメニューを使える。一般ユーザーには表示しない。
  const isDeveloper =
    (session?.user as { role?: string } | undefined)?.role === 'developer';
  // クリックハンドラ（map init effect 内・同期参照）から権限を見るための ref
  const isDeveloperRef = useRef(false);
  isDeveloperRef.current = isDeveloper;
  // デバッグメニュー（レンチ）コントロールは権限に応じて後から付け外しする
  const debugControlRef = useRef<DebugControl | null>(null);

  const showToast = (message: string) => {
    if (!message) return;
    setToast(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2500);
  };

  // 塗りポイントの残高だけを ref と state へ反映（クライアント側の時間回復・楽観更新用）。
  const applyPointsState = useCallback((p: number, nextRegenAt: number | null) => {
    pointsRef.current = p;
    regenAtRef.current = nextRegenAt;
    setPoints(p);
    setRegenAt(nextRegenAt);
  }, []);

  // レベルアップ演出を一時表示する（3秒で自動的に消える）。
  const showLevelUp = useCallback((to: number) => {
    setLevelUp({ to });
    playLevelUp();
    if (levelUpTimerRef.current !== null) {
      window.clearTimeout(levelUpTimerRef.current);
    }
    levelUpTimerRef.current = window.setTimeout(() => {
      setLevelUp(null);
      levelUpTimerRef.current = null;
    }, 3500);
  }, []);

  // サーバーの権威的な塗りポイント状態（残高・最大値・レベル・経験値）をまとめて反映する。
  // レベルが上がっていたら演出を出す（初回取得時は演出しない）。
  const applyServerPoints = useCallback(
    (s: ServerPoints) => {
      applyPointsState(s.points, s.regenAt);
      maxPointsRef.current = s.max;
      setMaxPoints(s.max);
      setLevel(s.level);
      setExp(s.exp);
      setExpToNext(s.expToNext);
      setTotalExp(s.totalExp);
      setPlayTimeSec(s.playTimeSec);
      const prevLevel = levelRef.current;
      levelRef.current = s.level;
      if (prevLevel !== null && s.level > prevLevel) {
        showLevelUp(s.level);
      }
    },
    [applyPointsState, showLevelUp]
  );

  // 自動再生ポリシー対策：最初のユーザー操作で AudioContext を resume し、
  // BGM が ON なら再生を開始する。一度動いたらリスナーは外す。
  useEffect(() => {
    const onGesture = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, []);

  // 動画リワードの利用可否（残り回数・クールダウン）をサーバーから取得する。
  const refreshRewardStatus = useCallback(async () => {
    if (!userIdRef.current) return;
    try {
      const res = await fetch(`${POINTS_API}/reward/video`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      setRewardStatus((await res.json()) as VideoRewardStatus);
    } catch (err) {
      console.warn('failed to load video reward status', err);
    }
  }, []);

  // 動画リワードの一連の流れ：
  //  1) backend に nonce を要求する（クールダウン・1日上限はここで弾かれる）
  //  2) GPT のリワード広告を表示し、視聴完了（granted）を待つ
  //  3) granted なら nonce 付きで報酬を請求し、残高へ反映する
  // 各段でエラー・未充填・途中離脱はトーストで案内し、フェーズを片付ける。
  const openVideoReward = useCallback(async () => {
    if (!userIdRef.current) {
      showToast(tRef.current('needLoginVideo'));
      return;
    }
    if (videoBusyRef.current) return; // 二重起動防止
    videoBusyRef.current = true;
    setVideoPhase('loading');
    // ボタン押下（視聴フロー開始）を記録。以降の各段階も video_reward で残す。
    logEvent('video_reward', { meta: { event: 'start' } });
    try {
      // 1) nonce 発行（視聴前のクールダウン・上限チェックを兼ねる）
      const nonceRes = await fetch(`${POINTS_API}/reward/video/nonce`, {
        method: 'POST',
        credentials: 'include',
      });
      const nonceData = (await nonceRes.json().catch(() => null)) as
        | { nonce?: string; status?: VideoRewardStatus; error?: string }
        | null;
      if (!nonceRes.ok || !nonceData?.nonce) {
        if (nonceData?.status) setRewardStatus(nonceData.status);
        const reason = nonceData?.error;
        // クールダウン/1日上限/その他で nonce 発行に失敗（広告は表示していない）。
        logEvent('video_reward', {
          meta: {
            event:
              reason === 'cooldown' || reason === 'daily_limit'
                ? reason
                : 'nonce_error',
          },
        });
        showToast(
          reason === 'cooldown'
            ? tRef.current('videoNotYet')
            : reason === 'daily_limit'
              ? tRef.current('rewardDailyLimit')
              : tRef.current('recoverFailed')
        );
        return;
      }

      // 2) 広告表示（広告 UI は GPT が全画面で描画する）
      const { outcome, detail } = await showRewardedAd(REWARDED_AD_UNIT_PATH);
      if (outcome !== 'granted') {
        // 途中キャンセル（dismissed）・在庫なし/非対応（unavailable）・エラー（error）。
        // detail に具体的な失敗理由（gpt_load_failed / ready_timeout 等）を残す。
        logEvent('video_reward', {
          meta: { event: outcome, ...(detail ? { detail } : {}) },
        });
        showToast(
          outcome === 'dismissed'
            ? tRef.current('videoDismissed')
            : tRef.current('videoUnavailable')
        );
        return;
      }

      // 3) 報酬請求（nonce を添えてサーバーで照合してから付与される）
      setVideoPhase('claiming');
      const res = await fetch(`${POINTS_API}/reward/video`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: nonceData.nonce }),
      });
      const data = (await res.json().catch(() => null)) as
        | { points?: ServerPoints; granted?: number; status?: VideoRewardStatus }
        | { error?: string; status?: VideoRewardStatus }
        | null;
      if (!res.ok) {
        if (data?.status) setRewardStatus(data.status);
        const reason = (data as { error?: string } | null)?.error;
        // 視聴は完了したが報酬請求が失敗した（nonce 不正・クールダウン・上限など）。
        logEvent('video_reward', {
          meta: { event: 'claim_failed', reason: reason ?? null },
        });
        showToast(
          reason === 'cooldown'
            ? tRef.current('videoNotYet')
            : reason === 'daily_limit'
              ? tRef.current('rewardDailyLimit')
              : tRef.current('recoverFailed')
        );
        return;
      }
      const ok = data as {
        points?: ServerPoints;
        granted?: number;
        status?: VideoRewardStatus;
      };
      if (ok.points) applyServerPoints(ok.points);
      if (ok.status) setRewardStatus(ok.status);
      // 視聴完了＋報酬付与まで成功。回復量を meta に残す。
      logEvent('video_reward', {
        meta: { event: 'granted', granted: ok.granted ?? 0 },
      });
      showToast(tRef.current('recovered', (ok.granted ?? 0) as never));
    } catch (err) {
      console.warn('video reward failed', err);
      logEvent('video_reward', { meta: { event: 'error' } });
      showToast(tRef.current('recoverFailed'));
    } finally {
      setVideoPhase(null);
      videoBusyRef.current = false;
    }
  }, [applyServerPoints]);

  // 離れた場所（10ポイント）の確認ダイアログで「塗る」を押したとき
  const confirmFarPaint = useCallback(() => {
    setConfirmPaint((pending) => {
      if (pending) {
        doManualPaintRef.current(pending.id, pending.muniKey, pending.region, pending.address, pending.cost);
      }
      return null;
    });
  }, []);

  // 検索ダイアログを開く（カスタムコントロールから呼ばれる）
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // 開いた直後に入力欄へフォーカス
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);
  useEffect(() => {
    openSearchRef.current = openSearch;
  }, [openSearch]);

  // デバッグメニューを開く（カスタムコントロールから呼ばれる）
  const openDebug = useCallback(() => {
    setDebugOpen(true);
  }, []);
  useEffect(() => {
    openDebugRef.current = openDebug;
  }, [openDebug]);

  // データ詳細パネルを開く（カスタムコントロールから呼ばれる）
  const openStats = useCallback(() => {
    setStatsOpen(true);
  }, []);
  useEffect(() => {
    openStatsRef.current = openStats;
  }, [openStats]);

  // ランキングパネルを開く（カスタムコントロールから呼ばれる）
  const openRankings = useCallback(() => {
    setRankingsOpen(true);
  }, []);
  useEffect(() => {
    openRankingsRef.current = openRankings;
  }, [openRankings]);

  // パネルを開いている間、期間を変えるたびにランキングをバックエンドから取得する。
  useEffect(() => {
    if (!rankingsOpen) return;
    let cancelled = false;
    setRankingsLoading(true);
    (async () => {
      try {
        const url = `${RANKINGS_API}?period=${rankingsPeriod}`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`rankings ${res.status}`);
        const data = (await res.json()) as RankingsResponse;
        if (!cancelled) setRankingsData(data);
      } catch {
        if (!cancelled) setRankingsData(null);
      } finally {
        if (!cancelled) setRankingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rankingsOpen, rankingsPeriod]);

  // デバッグ用：塗りポイント残高を指定値にセットする（MAX を超える値も可）。
  const setDebugPoints = useCallback(
    async (value: number) => {
      if (!userIdRef.current) {
        showToast('ログインするとポイントを変更できます');
        return;
      }
      try {
        const res = await fetch(`${POINTS_API}/debug/set`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: value }),
        });
        if (!res.ok) {
          showToast('ポイントの変更に失敗しました');
          return;
        }
        const data = (await res.json()) as ServerPoints;
        applyServerPoints(data);
        showToast(`塗りポイントを ${data.points} にしました`);
      } catch (err) {
        console.warn('failed to set debug points', err);
        showToast('ポイントの変更に失敗しました');
      }
    },
    [applyServerPoints]
  );

  // 地名/住所を検索（日本＝国土地理院・細かい／世界＝Nominatim・粗い を並列で引いて統合）。
  const runSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (!query) return;
    logEvent('search', { meta: { query } });
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const [jp, world] = await Promise.all([
        searchJapan(query),
        searchWorld(query, langRef.current),
      ]);
      // 日本は国土地理院が細かいので優先。世界結果のうち日本 bbox 内は重複なので落とす
      // （ただし国土地理院が何も返さなかった時は世界結果をそのまま使う）。
      const worldFiltered =
        jp.length > 0 ? world.filter((h) => !isInJapanBounds(h.lng, h.lat)) : world;
      const merged = [...jp.slice(0, 8), ...worldFiltered].slice(0, 12);
      if (merged.length === 0) {
        setSearchError(tRef.current('searchNotFound'));
        return;
      }
      setSearchResults(merged);
    } catch (err) {
      console.warn('geocode failed', err);
      setSearchError(tRef.current('searchFailed'));
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // 検索結果の地点へ移動（メッシュが見える zoom 12 まで寄せる）
  const flyToResult = useCallback((r: SearchHit) => {
    const map = mapRef.current;
    if (!map) return;
    const { lng, lat } = r;
    map.flyTo({ center: [lng, lat], zoom: 12, duration: 1500 });
    setSearchOpen(false);
    setSearchResults([]);
    setSearchError(null);
    setSearchQuery('');
  }, []);

  // データ詳細パネルで都道府県名を押したとき、その県の塗ったセル全体が収まる範囲へ寄せる。
  const flyToPref = useCallback((prefName: string) => {
    const map = mapRef.current;
    if (!map) return;
    const lookup = muniByPaintedCellRef.current;
    const bounds = new maplibregl.LngLatBounds();
    let found = false;
    for (const key of Object.keys(paintedRef.current)) {
      const [layer, idStr] = key.split(':');
      if (layer !== 'mesh') continue;
      const muni = lookup.get(Number(idStr));
      if (!muni || muni.split('|')[0] !== prefName) continue;
      const ring = meshCellRing(Number(idStr));
      for (const [lng, lat] of ring) bounds.extend([lng, lat]);
      found = true;
    }
    if (!found) return;
    map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 1200 });
    setStatsOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      if (labelRefreshTimerRef.current !== null) {
        window.clearTimeout(labelRefreshTimerRef.current);
        labelRefreshTimerRef.current = null;
      }
      if (levelUpTimerRef.current !== null) {
        window.clearTimeout(levelUpTimerRef.current);
        levelUpTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    eraseModeRef.current = eraseMode;
  }, [eraseMode]);

  useEffect(() => {
    hoverPaintModeRef.current = hoverPaintMode;
  }, [hoverPaintMode]);

  // 地理院オーバーレイ ON/OFF を設定メニューから受け取る。ON で初めてレイヤー＋ソースを足し
  // （=その時だけタイルを取得し始める）、OFF で消す（OFF 時はデータを一切読み込まない）。
  useEffect(() => {
    return onBasemapChange((on) => {
      const map = mapRef.current;
      if (!map) return;
      if (on) addGsiOverlay(map);
      else removeGsiOverlay(map);
    });
  }, []);

  // 地理院オーバーレイの不透明度を設定スライダーから受け取る（CARTO 世界地図は常に不透明で固定）。
  useEffect(() => {
    return onBasemapOpacityChange((v) => {
      const map = mapRef.current;
      if (!map) return;
      for (const region of GSI_OVERLAY_REGIONS) {
        const id = `gsi-std-overlay-${region.id}`;
        if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', v);
      }
    });
  }, []);

  // 右上の各種アイコンのサイズ（小／中／大）を設定メニューから受け取る。地図コンテナの
  // data-icon-size 属性へ反映し、実寸の拡大は globals.css のセレクタが担当する。
  useEffect(() => {
    const apply = (size: string) => {
      containerRef.current?.setAttribute('data-icon-size', size);
    };
    apply(getIconSize());
    return onIconSizeChange(apply);
  }, []);

  // 現在地の住所ラベル ON/OFF を設定メニューから受け取る。初期値を同期し、
  // OFF にしたら表示中のラベルを消す。
  useEffect(() => {
    gpsAddressEnabledRef.current = isGpsAddressEnabled();
    return onGpsAddressChange((on) => {
      gpsAddressEnabledRef.current = on;
      if (!on) {
        addressMarkerRef.current?.remove();
        addressMarkerRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    paintModeRef.current = paintMode;
    // 現在地の住所ラベルは現地塗りモード専用。となり塗り・なぞり塗りに切り替えたら消す。
    if (paintMode !== 'genchi') {
      addressMarkerRef.current?.remove();
      addressMarkerRef.current = null;
    }
    // なぞり塗り中は地図をスクロールさせない（スワイプ＝塗り操作にする）。
    // 1本指パン（マウスドラッグ＋タッチパン）を止める。ピンチズームは残す。
    const map = mapRef.current;
    if (map) {
      if (paintMode === 'nazori') map.dragPan.disable();
      else map.dragPan.enable();
    }
  }, [paintMode]);

  // ログイン時に塗りポイント残高を取得。ログアウト時は 0 にリセット。
  useEffect(() => {
    if (!userId) {
      // ログアウト：残高・レベルを初期表示に戻す（レベルアップ検出もリセット）
      applyPointsState(0, null);
      maxPointsRef.current = DEFAULT_MAX_POINTS;
      setMaxPoints(DEFAULT_MAX_POINTS);
      setLevel(1);
      setExp(0);
      setExpToNext(0);
      setPlayTimeSec(0);
      levelRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(POINTS_API, { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as ServerPoints;
        if (cancelled) return;
        applyServerPoints(data);
      } catch (err) {
        console.warn('failed to load paint points', err);
      }
    })();
    // 動画リワードの利用可否も取得（ボタンの残り回数・クールダウン表示用）
    refreshRewardStatus();
    return () => {
      cancelled = true;
    };
  }, [userId, applyPointsState, applyServerPoints, refreshRewardStatus]);

  // ログアウト時は動画リワードの状態もクリアする。
  useEffect(() => {
    if (!userId) setRewardStatus(null);
  }, [userId]);

  // 塗りポイントの時間回復（クライアント側）。1秒ごとに回復時刻を過ぎていれば加算し、
  // カウントダウン表示用に nowTick も更新する。サーバーが権威なので塗り時に再同期される。
  useEffect(() => {
    if (!userId) return;
    const iv = window.setInterval(() => {
      const now = Date.now();
      let r = regenAtRef.current;
      if (r !== null && now >= r) {
        let p = pointsRef.current;
        const max = maxPointsRef.current;
        while (r !== null && now >= r && p < max) {
          p += 1;
          r = p >= max ? null : r + REGEN_INTERVAL_MS;
        }
        applyPointsState(p, r);
      }
      setNowTick(now);
    }, 1000);
    return () => window.clearInterval(iv);
  }, [userId, applyPointsState]);

  // 合計プレイ時間の計測。前回計上からの経過秒をサーバーへ送って加算する。
  // 約1分ごと（HEARTBEAT_INTERVAL_MS）＋タブを離れる／閉じるときに送る。
  // タブが非表示の間は計上しない（経過分は破棄してアンカーを進める）。
  useEffect(() => {
    if (!userId) return;
    lastBeatRef.current = Date.now();

    // 経過秒をサーバーへ送って合計プレイ時間に加算する。
    // useBeacon=true は離脱時用（fetch だと中断されうるため sendBeacon を使う）。
    const flush = (useBeacon = false) => {
      const now = Date.now();
      const deltaSec = Math.floor((now - lastBeatRef.current) / 1000);
      lastBeatRef.current = now;
      // 非表示中の経過は計上しない（裏で開きっぱなしの時間を除く）
      if (document.visibilityState !== 'visible') return;
      if (deltaSec <= 0) return;
      const body = JSON.stringify({ deltaSec });
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          `${POINTS_API}/heartbeat`,
          new Blob([body], { type: 'application/json' })
        );
        return;
      }
      fetch(`${POINTS_API}/heartbeat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: ServerPoints | null) => {
          if (data) setPlayTimeSec(data.playTimeSec);
        })
        .catch((err) => console.warn('failed to send playtime heartbeat', err));
    };

    const iv = window.setInterval(() => flush(false), HEARTBEAT_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush(true); // 離脱直前の分を計上
      } else {
        lastBeatRef.current = Date.now(); // 復帰：ここから再計測
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flush(true); // アンマウント時（ログアウト・ページ遷移）も計上
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId]);

  useEffect(() => {
    onHoverAddressChangeRef.current = onHoverAddressChange;
  }, [onHoverAddressChange]);

  // meshcode の所属市区町村キー（"PREF|CITY"）を求める。
  // タイル由来の properties があればそれを優先し、無ければロード済みの対応表を引く。
  // 既に塗ったセルの市区町村キー（"PREF|CITY"）。新規塗り時のキーは塗りハンドラ側が
  // municipalities レイヤーへの問い合わせで求めて muniByPaintedCellRef に入れる。
  const muniKeyFor = useCallback(
    (id: number): string | null => muniByPaintedCellRef.current.get(id) ?? null,
    []
  );

  // セル（CELLID）の所属市区町村を共有ポリゴン（muni-classify）のセル中心 PiP で判定する。
  // 分母 build-muni-stats と同一基準なので、塗り％の分子がズーム非依存で分母と一致する。
  // 判定用ポリゴン未ロード時は null（呼び出し側がタイル判定にフォールバック）。
  const classifyMuniAt = useCallback(
    (id: number): { key: string; address: string } | null => {
      const feats = muniPolysRef.current;
      if (feats.length === 0) return null;
      const [ri, ci] = gridFromMeshCode(id);
      return classifyMuniCell(
        feats,
        muniIndexRef.current,
        (ci + 0.5) / MESH_LON_DIV,
        (ri + 0.5) / MESH_LAT_DIV
      );
    },
    []
  );

  // ホバー中の塗り％を組み立てて state に反映。日本（市区町村）と世界（国・州/県）の
  // どちらか — 日本の muni キーがあれば日本式、無ければホバー中の adm1_code で世界式。
  const refreshHoverStat = useCallback(() => {
    const key = hoverKeyRef.current;
    if (key) {
      const city = key.split('|')[1] || key;
      const total = totalByMuniRef.current.get(key);
      if (total === undefined) {
        setHoverStat(
          totalByMuniRef.current.size === 0 ? tRef.current('hoverMeasuring', city as never) : null
        );
        return;
      }
      const paintedCount = paintedByMuniRef.current.get(key) ?? 0;
      const pct = total > 0 ? Math.round((paintedCount / total) * 100) : 0;
      setHoverStat(
        tRef.current('hoverStat', city as never, String(pct) as never, paintedCount as never, total as never)
      );
      return;
    }
    // ── 世界（日本の外）：国％と州・県％を2段で出す ──
    const rk = hoverRegionRef.current;
    if (!rk) {
      setHoverStat(null);
      return;
    }
    const en = langRef.current === 'en';
    const meta = stateMetaRef.current.get(rk);
    // 分母が巨大なので整数丸めで 0% になる小さい値は小数（<0.1%）で見せる
    const pctText = (painted: number, total: number) => {
      if (total <= 0) return '0%';
      const raw = (painted / total) * 100;
      const r = Math.round(raw);
      if (r === 0 && raw > 0) return raw < 0.1 ? '<0.1%' : `${raw.toFixed(1)}%`;
      return `${r}%`;
    };
    const lines: string[] = [];
    const a3 = meta?.adm0_a3 ?? '';
    const cMeta = countryMetaRef.current.get(a3);
    const cTotal = totalByCountryRef.current.get(a3);
    if (cMeta && cTotal !== undefined) {
      const cName = (en ? cMeta.name : cMeta.name_ja) || cMeta.name || a3;
      const cPainted = paintedByCountryRef.current.get(a3) ?? 0;
      lines.push(`${cName} ${pctText(cPainted, cTotal)}（${cPainted}/${cTotal}）`);
    }
    const sTotal = totalByStateRef.current.get(rk);
    if (meta && sTotal !== undefined) {
      const sName = (en ? meta.name : meta.name_ja) || meta.name || rk;
      const sPainted = paintedByStateRef.current.get(rk) ?? 0;
      lines.push(`${sName} ${pctText(sPainted, sTotal)}（${sPainted}/${sTotal}）`);
    }
    setHoverStat(
      lines.length > 0
        ? lines.join('\n')
        : totalByStateRef.current.size === 0
          ? tRef.current('hoverMeasuring', (meta?.name_ja || meta?.name || '') as never)
          : null
    );
  }, []);

  // 塗り状態から市区町村ごとの塗りセル数を作り直す（対応表ロード時・DB復元時に呼ぶ）
  // 制覇した市区町村の金枠グローを地図に反映する（完了キー集合 → フィルタ）。
  const applyConquerGlow = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('muni-complete-glow')) return;
    const filter = muniGlowFilter([...completedMuniRef.current]);
    map.setFilter('muni-complete-glow', filter);
    if (map.getLayer('muni-complete-glow-blur')) map.setFilter('muni-complete-glow-blur', filter);
  }, []);

  // 塗り数と分母から「制覇した市区町村／完全制覇した都道府県」を作り直す（演出なし）。
  // データ復元・分母ロード時に呼ぶ。グローとカウンタも更新する。
  const recomputeCompleted = useCallback(() => {
    const totals = totalByMuniRef.current;
    const paintedC = paintedByMuniRef.current;
    const doneMuni = new Set<string>();
    for (const [key, total] of totals) {
      if (total > 0 && (paintedC.get(key) ?? 0) >= total) doneMuni.add(key);
    }
    completedMuniRef.current = doneMuni;
    // 完全制覇した都道府県（その県のすべての市区町村キーが完了）
    const prefTotal = new Map<string, number>();
    const prefDone = new Map<string, number>();
    for (const [key] of totals) {
      const pref = key.split('|')[0];
      prefTotal.set(pref, (prefTotal.get(pref) ?? 0) + 1);
      if (doneMuni.has(key)) prefDone.set(pref, (prefDone.get(pref) ?? 0) + 1);
    }
    const donePref = new Set<string>();
    for (const [pref, tot] of prefTotal) {
      if (tot > 0 && (prefDone.get(pref) ?? 0) >= tot) donePref.add(pref);
    }
    completedPrefRef.current = donePref;
    applyConquerGlow();
    setConqueredCount(doneMuni.size);
  }, [applyConquerGlow]);

  // 制覇バナーを一定時間だけ出す。
  const showConquer = useCallback((message: string) => {
    setConquer(message);
    if (conquerTimerRef.current !== null) window.clearTimeout(conquerTimerRef.current);
    conquerTimerRef.current = window.setTimeout(() => {
      setConquer(null);
      conquerTimerRef.current = null;
    }, 2600);
  }, []);

  // 新規セルが塗られた瞬間の演出：波紋（paint-ripple）・地名＋経験値のふわっと表示・コンボ・制覇判定。
  const handleCellPainted = useCallback(
    (id: number, muniKey: string | null, mode: PaintMode, name?: string) => {
      const [ri, ci] = gridFromMeshCode(id);
      const lng = (ci + 0.5) / MESH_LON_DIV;
      const lat = (ri + 0.5) / MESH_LAT_DIV;
      // 波紋：塗ったセル中心（地理座標）に地図追従の波紋を出す（黄色半透明・派手に大きく広げる）
      spawnRipple(lng, lat, 'rgba(250, 204, 21, 0.55)');
      // 地名＋経験値を画面 UI としてふわっと上に出す。まず手元の市区町村名で即出し、日本では
      // 逆ジオコーダ（町丁目まで）で詳しい住所に差し替える（キャッシュ済みなら最初から詳しく出す）。
      {
        const cached = muniKey ? revGeoCacheRef.current.get(id) : undefined;
        const fallback = name?.trim() || (muniKey ? muniKey.split('|')[1] || muniKey : '');
        const label = cached || fallback;
        if (label) {
          const exp = mode === 'gps' ? EXP_VISIT : EXP_PAINT;
          const key = spawnFloatText(label, exp);
          // 日本（muniKey あり）でキャッシュが無ければ町丁目まで取りに行って差し替える。
          if (muniKey && !cached) {
            reverseGeocode(lng, lat).then((full) => {
              if (full) {
                revGeoCacheRef.current.set(id, full);
                updateFloatName(key, full);
              }
            });
          }
        }
      }
      // コンボ：一定間隔内に塗り続けると連鎖数が伸びる
      const now = Date.now();
      comboRef.current =
        now - lastPaintAtRef.current <= COMBO_WINDOW_MS ? comboRef.current + 1 : 1;
      lastPaintAtRef.current = now;
      comboKeyRef.current += 1;
      setCombo(comboRef.current);
      if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
      comboTimerRef.current = window.setTimeout(() => {
        comboRef.current = 0;
        setCombo(0);
        comboTimerRef.current = null;
      }, COMBO_WINDOW_MS);
      // 塗り音（連鎖が伸びるほど音程が上がる）
      playPaint(comboRef.current);
      // スマホの触覚フィードバック（現地塗り・となり塗りでビビッ。設定OFF・非対応端末では無視）
      vibratePaint();

      // 制覇判定（市区町村 → 都道府県）。塗り数は commitLocalPaint で加算済み。
      if (muniKey && !completedMuniRef.current.has(muniKey)) {
        const total = totalByMuniRef.current.get(muniKey);
        const cnt = paintedByMuniRef.current.get(muniKey) ?? 0;
        if (total && total > 0 && cnt >= total) {
          const prefsBefore = completedPrefRef.current.size;
          recomputeCompleted(); // 集合・グロー・カウンタを更新
          const pref = muniKey.split('|')[0];
          if (completedPrefRef.current.size > prefsBefore && completedPrefRef.current.has(pref)) {
            showConquer(tRef.current('prefConquered', pref as never));
          } else {
            const city = muniKey.split('|')[1] || muniKey;
            showConquer(tRef.current('muniConquered', city as never));
          }
          playConquer();
        }
      }
    },
    [recomputeCompleted, showConquer, spawnRipple, spawnFloatText, updateFloatName]
  );

  // commitLocalPaint（map 初期化 effect 内・mount 時クロージャ）から最新版を呼べるよう ref に保持
  useEffect(() => {
    onCellPaintedRef.current = handleCellPainted;
  }, [handleCellPainted]);

  const rebuildPaintedByMuni = useCallback(() => {
    const counts = new Map<string, number>();
    const lookup = muniByPaintedCellRef.current;
    for (const key of Object.keys(paintedRef.current)) {
      const [layer, idStr] = key.split(':');
      if (layer !== 'mesh') continue;
      const muni = lookup.get(Number(idStr));
      if (!muni) continue;
      counts.set(muni, (counts.get(muni) ?? 0) + 1);
    }
    paintedByMuniRef.current = counts;
    refreshHoverStat();
    recomputeCompleted(); // 制覇した市区町村・都道府県とグローを作り直す
  }, [refreshHoverStat, recomputeCompleted]);

  // 判定用ポリゴン（muni-classify）ロード後、既存の塗りセルの市区町村帰属を共有ポリゴンの
  // セル中心 PiP で全て付け直す。DB 保存の市区町村（旧・ズーム依存の判定）ではなく分母と
  // 同じ判定で数え直すので、既存の塗りも分母と厳密一致し正しい％になる。
  const reclassifyPaintedMuni = useCallback(() => {
    if (muniPolysRef.current.length === 0) return;
    const lookup = new Map<number, string>();
    for (const key of Object.keys(paintedRef.current)) {
      const [layer, idStr] = key.split(':');
      if (layer !== 'mesh') continue;
      const id = Number(idStr);
      const m = classifyMuniAt(id);
      if (m) lookup.set(id, m.key);
    }
    muniByPaintedCellRef.current = lookup;
    rebuildPaintedByMuni();
  }, [classifyMuniAt, rebuildPaintedByMuni]);

  // 塗り状態から州・県／国ごとの塗りセル数を作り直す（world-stats ロード時・DB復元時に呼ぶ）。
  // 国は state メタの adm0_a3 から導出する。
  const rebuildPaintedByRegion = useCallback(() => {
    const byState = new Map<string, number>();
    const byCountry = new Map<string, number>();
    const lookup = regionByPaintedCellRef.current;
    const meta = stateMetaRef.current;
    for (const pkey of Object.keys(paintedRef.current)) {
      const [layer, idStr] = pkey.split(':');
      if (layer !== 'mesh') continue;
      const adm1 = lookup.get(Number(idStr));
      if (!adm1) continue;
      byState.set(adm1, (byState.get(adm1) ?? 0) + 1);
      const a3 = meta.get(adm1)?.adm0_a3;
      if (a3) byCountry.set(a3, (byCountry.get(a3) ?? 0) + 1);
    }
    paintedByStateRef.current = byState;
    paintedByCountryRef.current = byCountry;
    refreshHoverStat();
  }, [refreshHoverStat]);

  // デバッグ用：自分の塗りを全消去する（地図・state・サーバーすべて）。ポイントは返金しない。
  const clearAllPaint = useCallback(async () => {
    // 塗りの描画は painted-overlay（painted state 駆動）なので state を空にすれば消える。
    paintedRef.current = {};
    setPainted({});
    paintedAtRef.current = new Map();
    muniByPaintedCellRef.current = new Map();
    paintedByMuniRef.current = new Map();
    regionByPaintedCellRef.current = new Map();
    paintedByStateRef.current = new Map();
    paintedByCountryRef.current = new Map();
    completedMuniRef.current = new Set();
    completedPrefRef.current = new Set();
    setConqueredCount(0);
    applyConquerGlow();
    refreshHoverStat();

    if (!userIdRef.current) return;
    try {
      const res = await fetch(`${PAINT_API}/all`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        showToast('塗りの全消去に失敗しました');
        return;
      }
      showToast('塗りをすべて消しました');
    } catch (err) {
      console.warn('failed to clear all painted regions', err);
      showToast('塗りの全消去に失敗しました');
    }
  }, [refreshHoverStat, applyConquerGlow]);

  // デバッグ用：ユーザーデータを丸ごと初期化する（塗りを全消去し、レベル・経験値・残高を初期状態に戻す）。
  const resetUserData = useCallback(async () => {
    if (!userIdRef.current) {
      showToast('ログインするとリセットできます');
      return;
    }
    // まず塗りをすべて消す（地図・state・サーバー）。
    await clearAllPaint();
    // 次にレベル・経験値・残高を初期状態に戻す。
    try {
      const res = await fetch(`${POINTS_API}/debug/reset`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        showToast('ユーザーデータのリセットに失敗しました');
        return;
      }
      const data = (await res.json()) as ServerPoints;
      // 初期化なのでレベルアップ演出が出ないよう、検出基準も初期レベルにそろえる。
      levelRef.current = data.level;
      applyServerPoints(data);
      showToast('ユーザーデータを初期状態に戻しました');
    } catch (err) {
      console.warn('failed to reset user data', err);
      showToast('ユーザーデータのリセットに失敗しました');
    }
  }, [clearAllPaint, applyServerPoints]);

  // ラベル（市区町村・政令市・都道府県）のテキストに塗り％を差し込んで再描画する。
  // 市区町村キー（"PREF|CITY"）の総数・塗り数を走査して、政令市・都道府県は合算する。
  const applyLabelStats = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const en = langRef.current === 'en'; // 英語版は地名をローマ字で見せる
    const totals = totalByMuniRef.current;
    const paintedC = paintedByMuniRef.current;
    const hasStats = totals.size > 0;

    // 都道府県・政令市は配下の市区町村キーを合算して集計する
    const prefAgg = new Map<string, [number, number]>(); // "PREF" → [塗り, 総数]
    const cityAgg = new Map<string, [number, number]>(); // "PREF|市名" → [塗り, 総数]
    const cityPrefixes = cityKeyPrefixesRef.current;
    for (const [key, total] of totals) {
      const painted = paintedC.get(key) ?? 0;
      const bar = key.indexOf('|');
      const pref = bar >= 0 ? key.slice(0, bar) : key;
      const pa = prefAgg.get(pref);
      if (pa) {
        pa[0] += painted;
        pa[1] += total;
      } else {
        prefAgg.set(pref, [painted, total]);
      }
      // "PREF|市名…区" のように市名プレフィックスに区が続くものを政令市として合算
      for (const cp of cityPrefixes) {
        if (key.length > cp.length && key.startsWith(cp)) {
          const ca = cityAgg.get(cp);
          if (ca) {
            ca[0] += painted;
            ca[1] += total;
          } else {
            cityAgg.set(cp, [painted, total]);
          }
          break;
        }
      }
    }

    // 都道府県のように分母が巨大だと整数丸めで 0% になってしまうため、
    // 整数では 0% になる小さい値だけ小数（または <0.1%）で見せる。
    const pctSuffix = (painted: number, total: number) => {
      if (total <= 0) return '';
      const raw = (painted / total) * 100;
      const r = Math.round(raw);
      if (r === 0 && raw > 0) return raw < 0.1 ? ' <0.1%' : ` ${raw.toFixed(1)}%`;
      return ` ${r}%`;
    };

    // 名前の下に添える読み仮名を改行付きで返す（無ければ空文字）
    const yomiLine = (yomi: string | undefined) => (yomi ? `\n${yomi}` : '');

    // 市区町村ラベル（区名があれば区名、なければ市区町村名）
    const muniFC = muniLabelFCRef.current;
    if (muniFC) {
      for (const f of muniFC.features) {
        const p = f.properties ?? {};
        const jaName = (p.N03_005 as string) || (p.N03_004 as string) || '';
        const kana = kanaByCodeRef.current[p.N03_007 as string];
        // 英語版はローマ字（読みが無ければ日本語名のまま）。読み仮名の添え字は出さない。
        const name = en ? kanaToRomaji(kana) || jaName : jaName;
        const key = `${p.N03_001 ?? ''}|${p.N03_004 ?? ''}${p.N03_005 ?? ''}`;
        const total = totals.get(key);
        const painted = paintedC.get(key) ?? 0;
        f.properties = {
          ...p,
          nm: name + (hasStats && total ? pctSuffix(painted, total) : ''),
          ym: en ? '' : yomiLine(kana),
        };
      }
      (map.getSource('muni-labels') as maplibregl.GeoJSONSource | undefined)?.setData(muniFC);
    }

    // 政令指定都市ラベル（市全体＝配下の区の合算）
    const cityFC = cityLabelFCRef.current;
    if (cityFC) {
      for (const f of cityFC.features) {
        const p = f.properties ?? {};
        const jaName = (p.N03_004 as string) || '';
        const cp = `${p.N03_001 ?? ''}|${p.N03_004 ?? ''}`;
        const kana = kanaByCityRef.current[cp];
        const name = en ? kanaToRomaji(kana) || jaName : jaName;
        const agg = cityAgg.get(cp);
        f.properties = {
          ...p,
          nm: name + (hasStats && agg ? pctSuffix(agg[0], agg[1]) : ''),
          ym: en ? '' : yomiLine(kana),
        };
      }
      (map.getSource('city-labels') as maplibregl.GeoJSONSource | undefined)?.setData(cityFC);
    }

    // 都道府県ラベル（都道府県全体の合算）
    const prefFC = prefLabelFCRef.current;
    if (prefFC) {
      for (const f of prefFC.features) {
        const p = f.properties ?? {};
        const name = (p.nam_ja as string) || '';
        const agg = prefAgg.get(name);
        // 集計キーは日本語名のまま。表示だけ英語版でローマ字にする。
        const display = en ? prefRomaji(name) : name;
        f.properties = {
          ...p,
          lbl: display + (hasStats && agg ? pctSuffix(agg[0], agg[1]) : ''),
        };
      }
      (map.getSource('pref-labels') as maplibregl.GeoJSONSource | undefined)?.setData(prefFC);
    }
  }, []);

  // 連続塗り（GPS追跡・マウス）で多発する更新をまとめるためのデバウンス版
  const scheduleLabelRefresh = useCallback(() => {
    if (labelRefreshTimerRef.current !== null) return;
    labelRefreshTimerRef.current = window.setTimeout(() => {
      labelRefreshTimerRef.current = null;
      applyLabelStats();
    }, 250);
  }, [applyLabelStats]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    // PMTilesプロトコルを登録
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BLANK_STYLE,
      center: [136.5, 37],
      zoom: 4.5,
      localIdeographFontFamily: "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif",
      attributionControl: false,
    });

    // Shift+ドラッグの矩形ズームを無効化（Shift+クリックのデバッグ塗りと競合するため）
    map.boxZoom.disable();

    // ダブルクリック／スマホのダブルタップでのズームインを無効化（塗り操作と競合するため）
    map.doubleClickZoom.disable();

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      fitBoundsOptions: { maxZoom: 11 },
    });
    map.addControl(geolocate, 'top-right');

    // 位置情報アイコンの下に虫眼鏡（地名検索）ボタンを積む
    map.addControl(new SearchControl(() => openSearchRef.current()), 'top-right');

    // 検索ボタンの下にデータ詳細（棒グラフ）ボタンを積む
    map.addControl(new StatsControl(() => openStatsRef.current()), 'top-right');

    // データ詳細ボタンの下にランキング（トロフィー）ボタンを積む
    map.addControl(
      new RankingsControl(() => openRankingsRef.current()),
      'top-right'
    );

    // デバッグメニュー（レンチ）は開発者のみ表示。下の useEffect で権限に応じて付け外しする。

    map.on('zoom', () => {
      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = map.getZoom().toFixed(1);
      }
    });

    map.on('load', () => {
      // 初期化時にコンテナ高さが未確定だった場合に備え、load 直後に正しいサイズへ合わせる。
      map.resize();
      // PMTilesソースを1つ追加（全レイヤーが1ファイルに入っている）
      map.addSource('japan', {
        type: 'vector',
        url: 'pmtiles:///tiles/japan',
        attribution: '© 国土交通省 国土数値情報 / e-Stat',
      });

      // 都道府県境界の元データ（赤の太線・全ズームで表示）。
      // PMTiles の prefectures レイヤーは z4–8 でしか焼かれていないため、
      // 高ズームでも消えないよう軽量な GeoJSON を直接読み込んでオーバーレイする。
      // 実際の line レイヤーは塗りの上に出すよう後段（cities-border の後）で追加する。
      map.addSource('prefectures-geojson', {
        type: 'geojson',
        data: '/data/prefectures.geojson',
      });

      // 世界の下地（国＝countries／州・県＝states）。日本版 japan.pmtiles と同じく
      // PMTiles をタイル単位で range 取得するので、80MB 級でも一括ロードしない。
      // 最初に追加して最下層に置くので、日本の白地図（municipalities-fill）が上を覆う。
      // 塗りの単位は日本と同じ約1kmメッシュ（Map.tsx が数式生成）。states/countries は
      // 下地・境界・ラベルと、ホバー時の地名解決（queryRenderedFeatures）に使う。
      // states は z8 までしか焼いていないが、MapLibre が高ズームをオーバーズーム表示・
      // クエリするので塗りズーム（z10+）でも州・県を解決できる（build-world.mjs 参照）。
      map.addSource('world', {
        type: 'vector',
        url: 'pmtiles:///tiles/world',
        attribution: '© Natural Earth',
      });
      // 陸地の白下地（国ポリゴン）。日本の白地図（municipalities-fill）と同じ白で揃える。
      map.addLayer({
        id: 'world-countries-fill',
        type: 'fill',
        source: 'world',
        'source-layer': 'countries',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 1 },
      });
      // 州・県の塗りつぶし（不可視・queryRenderedFeatures での地名解決専用）。
      // fill-opacity 0 でも MapLibre のクエリ対象には含まれる。
      map.addLayer({
        id: 'world-states-fill',
        type: 'fill',
        source: 'world',
        'source-layer': 'states',
        paint: { 'fill-color': '#000000', 'fill-opacity': 0 },
      });
      // 全世界の地図画像（下地）。どのズーム・どの地域でも常に本物の地図を表示する。
      // CARTO Voyager（ラベルなし）を使い、文字は自前の赤ラベル（国名/州名）と競合させない。
      // この上に国境線・ラベル・塗り・（日本ズーム時の）地理院タイルを重ねる。
      // 白地図フィル（world-countries-fill / municipalities-fill）はこのラスターの下に潜らせ、
      // 陸地判定の queryRenderedFeatures 用としてのみ残す（見た目はこのラスターが担う）。
      map.addSource('world-basemap', {
        type: 'raster',
        tiles: ['https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> contributors, <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">© CARTO</a>',
      });
      map.addLayer({
        id: 'world-basemap',
        type: 'raster',
        source: 'world-basemap',
        // CARTO 世界地図は常に不透明で表示（スライダー非対象）。塗ったセルは上のオーバーレイで描く。
        paint: { 'raster-opacity': 1 },
      });
      // 州・県境（細線・z4 以上で薄く）。
      map.addLayer({
        id: 'world-states-border',
        type: 'line',
        source: 'world',
        'source-layer': 'states',
        minzoom: 4,
        paint: {
          'line-color': '#bcbcb2',
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.2, 8, 0.8],
          'line-opacity': 0.8,
        },
      });
      // 国境（国どうしの境界線・赤く太く・国名ラベルの赤に揃える）。
      // 日本は別途 prefectures-border（国土数値情報の細かい海岸線）で描くので、
      // ここでは日本を除外して二重の輪郭線（粗い NE 海岸線）が出ないようにする。
      map.addLayer({
        id: 'world-countries-outline',
        type: 'line',
        source: 'world',
        'source-layer': 'countries',
        filter: ['!=', ['get', 'ADM0_A3'], 'JPN'],
        paint: {
          'line-color': '#dc2626',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.5, 6, 3],
        },
      });
      // 国名ラベル（日本語名・無ければ英名）。
      map.addLayer({
        id: 'world-countries-label',
        type: 'symbol',
        source: 'world',
        'source-layer': 'countries',
        layout: {
          'text-field':
            langRef.current === 'en'
              ? ['coalesce', ['get', 'NAME'], ['get', 'NAME_JA']]
              : ['coalesce', ['get', 'NAME_JA'], ['get', 'NAME']],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 14],
          'text-font': ['Open Sans Regular'],
          'text-max-width': 6,
          'symbol-placement': 'point',
        },
        paint: {
          // 画像地図（GSI）の上でも読めるよう赤文字＋白フチ。
          'text-color': '#dc2626',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.6,
        },
      });
      // 州・県名ラベル（z5 以上・日本語名優先）。国名より小さく薄く。
      map.addLayer({
        id: 'world-states-label',
        type: 'symbol',
        source: 'world',
        'source-layer': 'states',
        minzoom: 5,
        layout: {
          'text-field':
            langRef.current === 'en'
              ? ['coalesce', ['get', 'name'], ['get', 'name_ja']]
              : ['coalesce', ['get', 'name_ja'], ['get', 'name']],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9, 9, 12],
          'text-font': ['Open Sans Regular'],
          'text-max-width': 6,
          'symbol-placement': 'point',
        },
        paint: {
          // 画像地図（GSI）の上でも読めるよう赤文字＋白フチ（国名より少し薄い赤）。
          'text-color': '#e05656',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.4,
        },
      });

      // 市区町村フィル（白地図のベース。塗りはメッシュ側で行う）
      map.addLayer({
        id: 'municipalities-fill',
        type: 'fill',
        source: 'japan',
        'source-layer': 'municipalities',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.85 },
      });

      map.addLayer({
        id: 'municipalities-border',
        type: 'line',
        source: 'japan',
        'source-layer': 'municipalities',
        paint: {
          // ズーム9以上では区画毎の境界線をはっきり表示する
          'line-color': ['step', ['zoom'], '#aaaaaa', 9, '#888888'],
          'line-width': ['step', ['zoom'], 1, 9, 1.8],
        },
      });

      // レイヤーの重ね順を整える。下→上で：
      //   白地図フィル（world-countries-fill / world-states-fill / municipalities-fill）
      //   → 世界の地図画像（world-basemap・全ズーム全世界・常に不透明）
      //   → 地理院タイル（gsi-std-overlay-*・ON 時かつ日本ズーム時のみ addGsiOverlay で上乗せ）
      //   → 国境/州境/ラベル/市区町村境界（地図画像の上に出して隠れないように）
      //   → （この後 addLayer される 塗り/メッシュ/政令市枠/県境/日本のラベル）
      map.moveLayer('municipalities-fill', 'world-basemap'); // 日本の白塗りを世界画像の下へ
      // 地理院「標準地図」オーバーレイは既定 OFF。CARTO 世界地図（world-basemap）と二重に
      // 見えるのを避けるため、設定で ON のときだけ addGsiOverlay でレイヤー＋ソースを足す
      // （=その時だけタイルを取得する）。OFF のときはデータを一切読み込まない。
      if (isBasemapEnabled()) addGsiOverlay(map);

      // 塗りオーバーレイ。塗ったセルをクライアント生成の矩形で全ズーム描画する。
      // mesh は PMTiles に焼かず数式生成するので、塗りの色付けはこのオーバーレイが一手に担う。
      map.addSource('painted-overlay', {
        type: 'geojson',
        data: buildPaintedOverlay(paintedRef.current),
      });
      map.addLayer({
        id: 'painted-overlay-fill',
        type: 'fill',
        source: 'painted-overlay',
        minzoom: PAINTED_OVERLAY_MIN_ZOOM,
        paint: {
          'fill-color': ['match', ['get', 'mode'], 'gps', COLOR_GPS, 'manual', COLOR_MANUAL, '#ffffff'],
          'fill-opacity': 0.55,
        },
      });

      // 1kmメッシュの格子線。PMTiles に焼かず、表示範囲のセルを moveend で数式生成する。
      map.addSource('mesh-grid', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'mesh-border',
        type: 'line',
        source: 'mesh-grid',
        minzoom: MESH_MIN_ZOOM,
        paint: {
          'line-color': '#f87171',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 13, 0.6],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 12, 0.7],
        },
      });

      // 政令指定都市の外周枠線（区の境界線は残しつつ、市全体を別色＆太めで強調）
      map.addLayer({
        id: 'cities-border',
        type: 'line',
        source: 'japan',
        'source-layer': 'cities',
        minzoom: 6,
        paint: {
          'line-color': '#1d4ed8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 2.6],
        },
      });

      // 制覇（市区町村を100%塗った）境界の金枠グロー。下に太いぼかし＋上に細い実線の
      // 2枚重ねで「ここは制覇済み」を一目で分かるようにする。完了キー集合でフィルタし、
      // recomputeCompleted から setFilter で更新する（pulse は別 effect で line-opacity を揺らす）。
      map.addLayer({
        id: 'muni-complete-glow-blur',
        type: 'line',
        source: 'japan',
        'source-layer': 'municipalities',
        minzoom: 6,
        filter: muniGlowFilter([]),
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': COLOR_CONQUER,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 9],
          'line-opacity': 0.5,
          'line-blur': ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 6],
        },
      });
      map.addLayer({
        id: 'muni-complete-glow',
        type: 'line',
        source: 'japan',
        'source-layer': 'municipalities',
        minzoom: 6,
        filter: muniGlowFilter([]),
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#fde68a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 12, 2.8],
          'line-opacity': 0.95,
        },
      });

      // 都道府県境界（赤の太線・全ズームレベルで表示）。塗りの上に重ねる。
      map.addLayer({
        id: 'prefectures-border',
        type: 'line',
        source: 'prefectures-geojson',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#e03131', 'line-width': 3.6 },
      });

      // 都道府県名・市区町村名・政令市名のラベルは、塗り％を横に差し込めるよう
      // クライアント側 GeoJSON ソースとして mapReady 後に別 effect で追加する。

      // ホバーレイヤー（メッシュ）。ホバー中の1セルだけを矩形で描く（feature-state 不要）。
      map.addSource('mesh-hover', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'mesh-hover',
        type: 'fill',
        source: 'mesh-hover',
        minzoom: MESH_MIN_ZOOM,
        paint: { 'fill-color': '#000000', 'fill-opacity': 0.12 },
      });

      // 表示中の「陸」セル（CELLID）の集合。mesh をベイクしなくなったので、表示中の
      // 陸地ポリゴンに対しグリッドセル中心を点内外判定して陸地セルを割り出す。
      // 日本は市区町村ポリゴン（municipalities-fill）、日本の外は国ポリゴン
      // （world-countries-fill）で判定する。海外でも水色グリッドを出すため両方を見る。
      // 格子描画（海上は出さない）と海越え隣接判定の両方でこれを使う。
      const collectVisibleLand = () => {
        const set = new Set<number>();
        const munis = map.queryRenderedFeatures({
          layers: ['municipalities-fill', 'world-countries-fill'],
        });
        if (munis.length === 0) return set;
        const b = map.getBounds();
        const riMin = Math.floor(b.getSouth() * MESH_LAT_DIV);
        const riMax = Math.floor(b.getNorth() * MESH_LAT_DIV);
        const ciMin = Math.floor(b.getWest() * MESH_LON_DIV);
        const ciMax = Math.floor(b.getEast() * MESH_LON_DIV);
        if ((riMax - riMin + 1) * (ciMax - ciMin + 1) > GRID_MAX_CELLS) return set;
        const polys = munis.flatMap((f) => polysWithBbox(f.geometry));
        for (let ri = riMin; ri <= riMax; ri++) {
          const lat = (ri + 0.5) / MESH_LAT_DIV;
          for (let ci = ciMin; ci <= ciMax; ci++) {
            const lng = (ci + 0.5) / MESH_LON_DIV;
            for (const { rings, bbox } of polys) {
              if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
              if (pointInRings(lng, lat, rings)) {
                set.add(meshCodeFromGrid(ri, ci));
                break;
              }
            }
          }
        }
        return set;
      };

      // ── メッシュ格子をビューポートに合わせて数式生成（mesh をベイクしない代替）──
      // 陸地セルだけを矩形化するので、海上（塗れない所）には格子線が出ない。
      const refreshGrid = () => {
        const src = map.getSource('mesh-grid') as maplibregl.GeoJSONSource | undefined;
        if (!src) return;
        if (map.getZoom() < MESH_MIN_ZOOM) {
          src.setData(EMPTY_FC);
          return;
        }
        const features: GeoJSON.Feature[] = [];
        for (const code of collectVisibleLand()) features.push(cellFeature(code));
        src.setData({ type: 'FeatureCollection', features });
      };
      let gridTimer: number | null = null;
      const scheduleGrid = () => {
        if (gridTimer !== null) return;
        gridTimer = window.setTimeout(() => {
          gridTimer = null;
          refreshGrid();
        }, 120);
      };
      map.on('moveend', scheduleGrid);
      map.on('zoomend', scheduleGrid);
      // 下地タイル（日本=japan・海外=world）が遅れて読み込まれた時も格子を埋め直す
      // （自前ソースの更新では発火しない）。海外でも water 色グリッドが出るよう world も見る。
      map.on('sourcedata', (e) => {
        if (
          (e.sourceId === 'japan' || e.sourceId === 'world') &&
          e.isSourceLoaded &&
          map.getZoom() >= MESH_MIN_ZOOM
        ) {
          scheduleGrid();
        }
      });
      refreshGrid();

      // ── インタラクション ────────────────────────
      const meshHoverSrc = () =>
        map.getSource('mesh-hover') as maplibregl.GeoJSONSource | undefined;

      // 画面上の点 → その地点の市区町村情報（陸地判定も兼ねる）。海上など muni が無ければ null。
      // キーは "N03_001 | (N03_004 + N03_005)"。build-muni-stats / 保存する municipality と同一規則。
      const muniInfoAt = (
        point: maplibregl.PointLike
      ): { key: string; address: string } | null => {
        const feats = map.queryRenderedFeatures(point, { layers: ['municipalities-fill'] });
        const p = feats[0]?.properties;
        if (!p) return null;
        const pref = typeof p.N03_001 === 'string' ? p.N03_001 : '';
        const c4 = typeof p.N03_004 === 'string' ? p.N03_004 : '';
        const c5 = typeof p.N03_005 === 'string' ? p.N03_005 : '';
        const city = c4 + c5;
        if (!city) return null;
        return { key: `${pref}|${city}`, address: pref + city };
      };

      // 画面上の点 → 世界の州・県情報（adm1_code・国コード・表示名）。海上など無ければ null。
      // world-states-fill は不可視（opacity 0）だが queryRenderedFeatures の対象になる。
      // 日本国内でも prefecture を返す（japan の白地図に覆われていてもクエリは通る）。
      const stateInfoAt = (
        point: maplibregl.PointLike
      ): { key: string; a3: string; address: string } | null => {
        const feats = map.queryRenderedFeatures(point, { layers: ['world-states-fill'] });
        const p = feats[0]?.properties;
        if (!p || typeof p.adm1_code !== 'string' || !p.adm1_code) return null;
        const a3 = typeof p.adm0_a3 === 'string' ? p.adm0_a3 : '';
        const en = langRef.current === 'en';
        const a3meta = countryMetaRef.current.get(a3);
        const cName = (en ? a3meta?.name : a3meta?.name_ja) || a3meta?.name || (typeof p.admin === 'string' ? p.admin : '');
        const sName = (en ? (p.name as string) : (p.name_ja as string)) || (p.name as string) || '';
        return { key: p.adm1_code, a3, address: [cName, sName].filter(Boolean).join(' ') };
      };

      // セル中心の画面座標。塗り％の分母（muni-stats / world-stats）は「セル中心が
      // どの市区町村・州県に入るか」で数える。塗ったセルの帰属もクリック／GPS 位置では
      // なくセル中心で判定して基準点を合わせる（セル端をクリックすると隣の自治体に
      // 乗ってしまい、全部塗っても塗り％が 100% に届かない／超える原因になっていた）。
      const cellCenterPoint = (id: number): maplibregl.PointLike => {
        const [ri, ci] = gridFromMeshCode(id);
        return map.project([(ci + 0.5) / MESH_LON_DIV, (ri + 0.5) / MESH_LAT_DIV]);
      };

      // 外国（自国以外）か。自国（homeCountryRef）が未判定の間や国コード不明の間は
      // false（＝従来どおり1マス塗り）にする。
      const isForeign = (a3: string | null | undefined): boolean =>
        !!homeCountryRef.current && !!a3 && a3 !== homeCountryRef.current;

      // ホバー住所のキャッシュ（CELLID→町丁目入り住所）と逆ジオコーダのデバウンス
      // ホバーの逆ジオコーダ結果は塗りのふわっと表示と同じキャッシュを共有する（再問い合わせ防止）。
      const hoverAddrCache = revGeoCacheRef.current;
      let hoverGeocodeTimer: number | null = null;
      let hoverId: number | null = null;

      const clearHover = () => {
        if (hoverId === null) return;
        hoverId = null;
        meshHoverSrc()?.setData(EMPTY_FC);
        setForeignHover(false);
        onHoverAddressChangeRef.current?.('');
        hoverKeyRef.current = null;
        hoverRegionRef.current = null;
        refreshHoverStat();
        if (hoverGeocodeTimer !== null) {
          clearTimeout(hoverGeocodeTimer);
          hoverGeocodeTimer = null;
        }
      };

      // muniKey は日本の市区町村キー（無ければ null＝日本の外）。region は世界の州・県。
      const setHover = (
        id: number,
        muniKey: string | null,
        region: { key: string; a3: string } | null,
        address: string
      ) => {
        if (hoverId === id) return;
        hoverId = id;
        // 外国は 10×10 ブロックを半透明プレビュー、自国は1マス。
        const foreign = isForeign(region?.a3);
        meshHoverSrc()?.setData({
          type: 'FeatureCollection',
          features: foreign ? blockCellFeatures(id) : [cellFeature(id)],
        });
        setForeignHover(foreign);
        map.getCanvas().style.cursor = 'pointer';
        hoverKeyRef.current = muniKey;
        hoverRegionRef.current = region?.key ?? null;
        refreshHoverStat();
        // 自分が塗ったセルなら地名の後ろに塗った日時を添える（その場塗りは now で上書き済み）。
        const withPaintedAt = (text: string): string => {
          if (!paintedRef.current[`mesh:${id}`]) return text;
          const stamp = formatPaintedAt(paintedAtRef.current.get(id));
          return stamp ? `${text}（${stamp}）` : text;
        };
        const cached = hoverAddrCache.get(id);
        onHoverAddressChangeRef.current?.(withPaintedAt(cached ?? address));
        if (hoverGeocodeTimer !== null) {
          clearTimeout(hoverGeocodeTimer);
          hoverGeocodeTimer = null;
        }
        // 逆ジオコーダ（町丁目まで補う）は日本専用。日本の外（muniKey なし）では呼ばない。
        if (muniKey && cached === undefined) {
          const [ri, ci] = gridFromMeshCode(id);
          const lng = (ci + 0.5) / MESH_LON_DIV;
          const lat = (ri + 0.5) / MESH_LAT_DIV;
          hoverGeocodeTimer = window.setTimeout(() => {
            reverseGeocode(lng, lat).then((full) => {
              if (full) hoverAddrCache.set(id, full);
              if (hoverId === id && full) onHoverAddressChangeRef.current?.(withPaintedAt(full));
            });
          }, 250);
        }
      };

      map.on('mousemove', (e) => {
        if (map.getZoom() >= MESH_MIN_ZOOM) {
          const info = muniInfoAt(e.point);     // 日本の市区町村（無ければ null）
          const region = stateInfoAt(e.point);  // 世界の州・県（全球・日本含む）
          if (info || region) {
            const id = meshCodeAt(e.lngLat.lng, e.lngLat.lat);
            // 表示住所は日本なら市区町村、無ければ世界の「国 州/県」
            setHover(id, info?.key ?? null, region, info?.address ?? region?.address ?? '');
            // デバッグ：マウスオーバー塗りモードはカーソルが通ったセルを無料で塗る。
            if (
              hoverPaintModeRef.current &&
              !eraseModeRef.current &&
              paintedRef.current[`mesh:${id}`] !== 'gps'
            ) {
              // 帰属はカーソル位置ではなく共有ポリゴンのセル中心 PiP（分母と厳密一致・ズーム非依存）。
              const c = cellCenterPoint(id);
              const cMuni = muniPolysRef.current.length > 0 ? classifyMuniAt(id) : muniInfoAt(c);
              const cSt = stateInfoAt(c);
              const cRegion = cSt ? { key: cSt.key, a3: cSt.a3 } : null;
              const result = commitLocalPaint(id, 'manual', cMuni?.key ?? null, cRegion, cMuni?.address ?? cSt?.address ?? '', true);
              if (result !== 'skip') syncPaint('POST', id, 'manual', cRegion);
            } else if (paintModeRef.current === 'nazori' && !eraseModeRef.current) {
              // なぞり塗り：マウスオーバーで隣接セルを 1pt 消費しながら塗る。
              nazoriPaintAt(e);
            }
            return;
          }
        }
        clearHover();
        map.getCanvas().style.cursor = '';
      });

      map.on('mouseleave', () => {
        clearHover();
        map.getCanvas().style.cursor = '';
      });

      const syncPaint = (
        method: 'POST' | 'DELETE',
        id: number,
        mode?: PaintMode,
        region?: { key: string; a3: string } | null,
        revisit = false,
        bulk = false
      ) => {
        if (!userIdRef.current) return;
        // POST のときは塗った位置の文脈（セル中心の緯度経度・市区町村・州県コード）を添える。
        // ip/ua はサーバー側で取得する。DELETE には付けない。
        // bulk=true は外国まとめ塗りの残りセル（代表1セルが課金＆経験値を得て、残りは無料・経験値なし）。
        const ctx: {
          lat?: number;
          lng?: number;
          municipality?: string | null;
          region?: string | null;
          country?: string | null;
        } = {};
        if (method === 'POST') {
          const [ri, ci] = gridFromMeshCode(id);
          ctx.lat = (ri + 0.5) / MESH_LAT_DIV;
          ctx.lng = (ci + 0.5) / MESH_LON_DIV;
          ctx.municipality = muniKeyFor(id);
          ctx.region = region?.key ?? regionByPaintedCellRef.current.get(id) ?? null;
          // 国コード（adm0_a3）。GPS かどうかに関わらず「そのタイルの所属国」を必ず付ける。
          // 呼び出し側が持っている a3 を最優先（stateMeta 未ロードでも確実）。無ければ州県コード
          // から導出、それも無く市区町村があれば日本＝"JPN"。
          ctx.country =
            region?.a3 ??
            (ctx.region ? stateMetaRef.current.get(ctx.region)?.adm0_a3 : null) ??
            (ctx.municipality ? 'JPN' : null);
        }
        fetch(PAINT_API, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceLayer: 'mesh', keyCode: String(id), mode, ...(bulk ? { bulk: true } : {}), ...ctx }),
        })
          .then(async (res) => {
            // POST（GPS塗り・なぞり塗り）はサーバーが経験値・レベルを返す。反映してレベルアップ演出も出す。
            if (method !== 'POST' || !res.ok) return;
            // 外国まとめ塗りの残りセル（bulk）は無料・経験値なし。サーバーは ensurePoints の
            // 現在残高を返すが、これは代表セルの spendPoints と並走し「消費前の残高」を返すことが
            // 多い。bulk 応答（約99件）が代表セルの応答に競り勝って applyServerPoints すると、
            // 減算したばかりの残高を元に戻してしまう（＝海外で塗りポイントが減らない不具合）。
            // bulk は残高・経験値を一切反映しない。
            if (bulk) return;
            const data = (await res.json().catch(() => null)) as {
              points?: ServerPoints;
              gainedExp?: number;
            } | null;
            if (data?.points) applyServerPoints(data.points);
            // 新規塗りの経験値は塗ったセルのふわっと表示（spawnFloatText）で見せる。ここで出すのは
            // 再訪（既訪セルへ入り直して時間経過ボーナスが入った）ときだけ。再訪は新規塗りではないので
            // ふわっと表示が出ず、トーストと波紋で知らせる。
            if (revisit && data?.gainedExp && data.gainedExp > 0) {
              showToast(tRef.current('expRevisit', data.gainedExp as never));
              const [ri, ci] = gridFromMeshCode(id);
              spawnRippleRef.current(
                (ci + 0.5) / MESH_LON_DIV,
                (ri + 0.5) / MESH_LAT_DIV,
                'rgba(250, 204, 21, 0.55)'
              );
            }
          })
          .catch((err) => {
            console.warn('failed to sync painted region', err);
          });
      };

      // 指定モードでローカル（state）にだけ塗る。サーバー同期はしない。塗りの描画は
      // painted-overlay（painted state 駆動）が担うので feature-state は使わない。
      // 優先度 gps > manual（manual は gps を上書きしない）。戻り値で塗りの結果を返す。
      // muniKey は塗ったセルの "PREF|CITY"（陸地判定済みのハンドラ側で求めて渡す）。
      // muniKey は日本の "PREF|CITY"（無ければ null）。region は世界の州・県（adm1_code＋adm0_a3）。
      // どちらも陸地判定済みのハンドラ側で求めて渡す。日本では muni、日本の外では region が入る。
      const commitLocalPaint = (
        id: number,
        mode: PaintMode,
        muniKey: string | null,
        region: { key: string; a3: string } | null,
        address?: string,
        silent = false,
        // 波紋・ふわっと表示などの演出は出すが、住所トーストだけは抑止する。
        // 外国まとめ塗りの代表セルで使い、最後にまとめて「場所＋マス数」を1回だけ出す。
        quietToast = false
      ): 'new' | 'promoted' | 'skip' => {
        const key = `mesh:${id}`;
        const current = paintedRef.current;
        const existing = current[key];
        if (existing === mode) return 'skip'; // 変化なし
        if (existing === 'gps' && mode === 'manual') return 'skip'; // 降格は禁止

        paintedRef.current = { ...current, [key]: mode };
        setPainted(paintedRef.current);

        if (!existing) {
          // その場で塗った日時を記録（DB 復元値より優先＝実際に塗った日時を表示する）。
          paintedAtRef.current.set(id, new Date().toISOString());
          if (!silent && !quietToast && address) showToast(address);
          // 新規セルのみカウントを +1（gps への昇格では増やさない）
          let changed = false;
          if (muniKey) {
            muniByPaintedCellRef.current.set(id, muniKey);
            paintedByMuniRef.current.set(muniKey, (paintedByMuniRef.current.get(muniKey) ?? 0) + 1);
            changed = true;
          }
          // 世界の州・県／国カウント（日本の外。日本内でも prefecture が取れれば加算される）
          if (region) {
            regionByPaintedCellRef.current.set(id, region.key);
            paintedByStateRef.current.set(region.key, (paintedByStateRef.current.get(region.key) ?? 0) + 1);
            if (region.a3) paintedByCountryRef.current.set(region.a3, (paintedByCountryRef.current.get(region.a3) ?? 0) + 1);
            changed = true;
          }
          if (changed) refreshHoverStat();
          // 新規セルの演出（波紋・地名＋経験値・コンボ・制覇判定・塗り音）。silent はまとめ塗り等で抑止。
          if (!silent) onCellPaintedRef.current?.(id, muniKey, mode, address);
        }
        return existing ? 'promoted' : 'new';
      };

      // GPS（実際の移動）塗り。無料なのでローカル反映＋同期のみ。
      const applyPaint = (
        id: number,
        mode: PaintMode,
        muniKey: string | null,
        region: { key: string; a3: string } | null
      ) => {
        const result = commitLocalPaint(id, mode, muniKey, region);
        if (result !== 'skip') syncPaint('POST', id, mode, region);
      };

      // ローカルの塗りを取り消す（state のみ。サーバー同期はしない）
      const removeLocalPaint = (id: number) => {
        const key = `mesh:${id}`;
        const current = paintedRef.current;
        if (!current[key]) return false;
        const next = { ...current };
        delete next[key];
        paintedRef.current = next;
        setPainted(next);
        paintedAtRef.current.delete(id);
        let changed = false;
        const muni = muniByPaintedCellRef.current.get(id);
        if (muni) {
          const n = (paintedByMuniRef.current.get(muni) ?? 0) - 1;
          if (n > 0) paintedByMuniRef.current.set(muni, n);
          else paintedByMuniRef.current.delete(muni);
          muniByPaintedCellRef.current.delete(id);
          changed = true;
        }
        const adm1 = regionByPaintedCellRef.current.get(id);
        if (adm1) {
          const ns = (paintedByStateRef.current.get(adm1) ?? 0) - 1;
          if (ns > 0) paintedByStateRef.current.set(adm1, ns);
          else paintedByStateRef.current.delete(adm1);
          const a3 = stateMetaRef.current.get(adm1)?.adm0_a3;
          if (a3) {
            const nc = (paintedByCountryRef.current.get(a3) ?? 0) - 1;
            if (nc > 0) paintedByCountryRef.current.set(a3, nc);
            else paintedByCountryRef.current.delete(a3);
          }
          regionByPaintedCellRef.current.delete(id);
          changed = true;
        }
        if (changed) refreshHoverStat();
        return true;
      };

      // 塗りの取り消し（ローカル＋サーバー）。ポイントは返金しない。
      // 通常クリックでは manual のみ消すが、デバッグ消しモードでは gps も消せる。
      const removePaint = (id: number) => {
        if (removeLocalPaint(id)) {
          syncPaint('DELETE', id);
        }
      };

      // 手動塗り（隣接=1pt / 離れた場所=10pt）。楽観的に塗ってからサーバーで残高を確定し、
      // 残高不足（402）なら塗りとポイントを巻き戻す。cost===0 は Shift+クリックの無料デバッグ塗り。
      const doManualPaint = async (
        id: number,
        muniKey: string | null,
        region: { key: string; a3: string } | null,
        address: string,
        cost: number,
        // 外国まとめ塗りの代表セルでは住所トーストを抑止し、呼び出し側が最後に
        // 「場所＋マス数」を1回だけ出す（波紋・ふわっと表示は出す）。
        quietToast = false
      ) => {
        if (!userIdRef.current) {
          showToast(tRef.current('needLoginPaint'));
          return;
        }
        if (commitLocalPaint(id, 'manual', muniKey, region, address, false, quietToast) === 'skip') return;
        // 塗り音・波紋・コンボは commitLocalPaint→onCellPainted が鳴らす（連鎖で音程上昇）

        const prevPoints = pointsRef.current;
        const prevRegenAt = regenAtRef.current;
        if (cost > 0) {
          // 楽観的にポイントを減算。満タンから消費したら回復時計を今から開始する。
          const wasFull = prevPoints >= maxPointsRef.current;
          applyPointsState(
            Math.max(0, prevPoints - cost),
            wasFull ? Date.now() + REGEN_INTERVAL_MS : prevRegenAt
          );
        }

        try {
          // 塗った位置の文脈（セル中心の緯度経度・市区町村）を添える。ip/ua はサーバー側で取得。
          const [ri, ci] = gridFromMeshCode(id);
          const res = await fetch(PAINT_API, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceLayer: 'mesh',
              keyCode: String(id),
              mode: 'manual',
              cost,
              lat: (ri + 0.5) / MESH_LAT_DIV,
              lng: (ci + 0.5) / MESH_LON_DIV,
              municipality: muniKey,
              region: region?.key ?? null,
            }),
          });
          const data = (await res.json().catch(() => null)) as {
            points?: ServerPoints;
            gainedExp?: number;
          } | null;

          if (res.status === 402) {
            // 残高不足：塗りとポイントを巻き戻す
            removeLocalPaint(id);
            if (data?.points) applyServerPoints(data.points);
            else applyPointsState(prevPoints, prevRegenAt);
            showToast(tRef.current('notEnoughPoints'));
            return;
          }
          if (!res.ok) {
            console.warn('failed to sync painted region', res.status);
            return;
          }
          // サーバーの確定値（残高・レベル・経験値）で同期。経験値が貯まればレベルアップ演出も出る。
          if (data?.points) applyServerPoints(data.points);
          // 経験値の獲得は塗ったセルのふわっと表示（spawnFloatText）で見せるのでトーストは出さない。
        } catch (err) {
          console.warn('failed to sync painted region', err);
        }
      };
      doManualPaintRef.current = doManualPaint;

      // 均一グリッドなので隣接判定は8近傍のメッシュコードを見るだけでよい
      const isAdjacentToPainted = (id: number) => {
        const [ri, ci] = gridFromMeshCode(id);
        for (let dri = -1; dri <= 1; dri++) {
          for (let dci = -1; dci <= 1; dci++) {
            if (dri === 0 && dci === 0) continue;
            const nb = meshCodeFromGrid(ri + dri, ci + dci);
            if (paintedRef.current[`mesh:${nb}`]) return true;
          }
        }
        return false;
      };

      // 海をまたいだ隣接判定。target から8方向へ直進し、海（=メッシュの無いセル）は
      // 何セル離れていても越えて、途中で塗り済みセルに到達すれば隣接とみなす。
      // 塗っていない「陸」セルが間にあると、その方向は遮られる（陸の飛び石は不可）。
      // 陸/海の判別は「現在表示中のメッシュ（陸）」＋「塗り済み（=陸）」で行う。
      const SEA_BRIDGE_MAX = 2000; // 安全上限（事実上の無制限）
      // collectVisibleLand（表示中の陸地セル集合）は格子生成と共用（上で定義済み）。
      const isAdjacentAcrossSea = (id: number) => {
        const landSet = collectVisibleLand();
        const [ri, ci] = gridFromMeshCode(id);
        const dirs = [
          [-1, -1], [-1, 0], [-1, 1], [0, -1],
          [0, 1], [1, -1], [1, 0], [1, 1],
        ];
        for (const [dri, dci] of dirs) {
          for (let step = 1; step <= SEA_BRIDGE_MAX; step++) {
            const code = meshCodeFromGrid(ri + dri * step, ci + dci * step);
            if (paintedRef.current[`mesh:${code}`]) return true; // 塗り済みに到達
            if (landSet.has(code)) break; // 未塗りの陸 → この方向は遮られる
            // それ以外は海（or 画面外で不明）→ さらに先へ進む
          }
        }
        return false;
      };

      // 塗り済みに隣接しているか（8近傍 or 海越え）。コスト判定に使う。
      const isAdjacent = (id: number) =>
        isAdjacentToPainted(id) || isAdjacentAcrossSea(id);

      // クリック地点のメッシュセルを取得（zoom が足りない or 海上＝陸地でない時は null）。
      // CELLID は経緯度から数式で求め、陸地判定は日本＝muniInfoAt、世界＝stateInfoAt で行う。
      // 日本なら muniKey が入り、日本の外でも世界の州・県（region）が取れれば塗れる。
      const pickFeatureAt = (e: maplibregl.MapMouseEvent) => {
        if (map.getZoom() < MESH_MIN_ZOOM) return null;
        const id = meshCodeAt(e.lngLat.lng, e.lngLat.lat);
        const center = cellCenterPoint(id);
        const info = muniInfoAt(center);     // 可視陸地の判定＆判定ポリゴン未ロード時のフォールバック
        const region = stateInfoAt(center);
        // 帰属（塗り％の分子）は共有ポリゴンのセル中心 PiP を最優先（分母 muni-stats と厳密一致・ズーム非依存）。
        const muni = muniPolysRef.current.length > 0 ? classifyMuniAt(id) : info;
        // 分母に入るセル（muni あり）は必ず塗れるようにする。可視陸地（info）/世界（region）でも塗れる。
        if (!muni && !info && !region) return null; // 海上など陸地でない
        return {
          id,
          muniKey: muni?.key ?? null,
          region: region ? { key: region.key, a3: region.a3 } : null,
          address: muni?.address ?? info?.address ?? region?.address ?? '',
        };
      };

      // なぞり塗り：マウスオーバー／スワイプで通ったセルを連続で塗る。
      // ・隣接した箇所しか塗れない（最初の1セルだけ自由）／・1マス COST_ADJACENT 消費。
      // 塗れない時（未ログイン・低ズーム・海上・非隣接・塗り済み・残高不足）は静かにスキップ。
      const nazoriPaintAt = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
        if (!userIdRef.current) return;
        if (map.getZoom() < MESH_MIN_ZOOM) return;
        const picked = pickFeatureAt(e as maplibregl.MapMouseEvent);
        if (!picked) return;
        const { id, muniKey, region, address } = picked;
        if (paintedRef.current[`mesh:${id}`]) return; // 塗り済み（gps/manual）はそのまま
        const isFirstPaint = Object.keys(paintedRef.current).length === 0;
        if (!isAdjacent(id) && !isFirstPaint) return; // 隣接した箇所しか塗れない
        if (pointsRef.current < COST_ADJACENT) return; // 残高不足は静かにスキップ
        doManualPaint(id, muniKey, region, address, COST_ADJACENT);
      };

      // スマホはスワイプ（touchmove）で塗る。なぞり塗り中のみ・1本指のみ（ピンチは塗らない）。
      map.on('touchmove', (e) => {
        if (paintModeRef.current !== 'nazori') return;
        if (e.points && e.points.length > 1) return; // 2本指（ズーム）は塗り対象外
        nazoriPaintAt(e);
      });

      // クリックしたセル中心の 10×10 ブロックのうち、まだ塗っていない陸地セルだけを集める。
      // セル中心を画面座標へ投影して陸地判定＋地名解決する（海上・画面外は除外）。
      // 外国まとめ塗り（doForeignBlockPaint）と開発者デバッグ塗り（doBulkDebugPaint）で共用。
      type BlockCell = {
        id: number;
        muniKey: string | null;
        reg: { key: string; a3: string } | null;
        address: string;
      };
      const collectBlockCells = (centerId: number): BlockCell[] => {
        const out: BlockCell[] = [];
        for (const [ri, ci] of foreignBlockGrid(centerId)) {
          const id = meshCodeFromGrid(ri, ci);
          if (paintedRef.current[`mesh:${id}`]) continue; // 既に塗ってある（gps/manual）はそのまま
          const lng = (ci + 0.5) / MESH_LON_DIV;
          const lat = (ri + 0.5) / MESH_LAT_DIV;
          const pt = map.project([lng, lat]);
          const info = muniInfoAt(pt);
          const region = stateInfoAt(pt);
          // 帰属は共有ポリゴンのセル中心 PiP（分母と厳密一致・ズーム非依存）。未ロード時はタイル判定。
          const muni = muniPolysRef.current.length > 0 ? classifyMuniAt(id) : info;
          if (!muni && !info && !region) continue; // 塗れない箇所（海上など）はスキップ
          out.push({
            id,
            muniKey: muni?.key ?? null,
            reg: region ? { key: region.key, a3: region.a3 } : null,
            address: muni?.address ?? info?.address ?? region?.address ?? '',
          });
        }
        return out;
      };

      // ブロック内のセルをローカル反映＋サーバー同期する（無料ぶん）。塗れた数を返す。
      // skipId に渡したセルだけは呼び出し側が別途（有料で）処理するのでここでは扱わない。
      const paintBlockCells = (cells: BlockCell[], skipId?: number): number => {
        let painted = 0;
        for (const c of cells) {
          if (c.id === skipId) continue;
          if (commitLocalPaint(c.id, 'manual', c.muniKey, c.reg, c.address, true) === 'skip') continue;
          // bulk=true：代表1セル（doManualPaint）だけが課金＆経験値を得る。残りは無料・経験値なし。
          syncPaint('POST', c.id, 'manual', c.reg, false, true);
          painted++;
        }
        return painted;
      };

      // 外国まとめ塗り：クリックしたセル中心の 10×10 を、塗れる陸地だけまとめて塗る。
      // 1ブロック固定コスト（COST_FOREIGN_BLOCK）。代表1セルを有料 POST（doManualPaint）で
      // 課金＆残高確定し、残りは無料 POST で同期する。隣接条件・確認ダイアログはなし。
      const doForeignBlockPaint = (centerId: number) => {
        if (!userIdRef.current) {
          showToast(tRef.current('needLoginPaint'));
          return;
        }
        const cells = collectBlockCells(centerId);
        if (cells.length === 0) return; // 海上・既に塗り済みなど、塗れるセルなし
        if (pointsRef.current < COST_FOREIGN_BLOCK) {
          showToast(tRef.current('notEnoughPointsLeft', pointsRef.current as never));
          return;
        }
        // 代表セル（1つめ＝未塗り陸地が確定）を有料で塗り、残りは無料同期。
        // 代表セルの住所トーストは抑止し（quietToast）、波紋・ふわっと表示は1回だけ出す。
        // 最後に「場所＋マス数」を1回だけトーストする（演出・トーストとも1ブロック=1回）。
        const paid = cells[0];
        doManualPaint(paid.id, paid.muniKey, paid.reg, paid.address, COST_FOREIGN_BLOCK, true);
        const rest = paintBlockCells(cells, paid.id);
        showToast(tRef.current('foreignPainted', paid.address as never, (rest + 1) as never));
      };

      // 開発者デバッグ：Cmd（Mac）/Ctrl（Win）+クリックで、クリックしたセルを中心に
      // 10×10マスの矩形を、塗れる箇所（陸地）だけまとめて無料で塗る。
      const doBulkDebugPaint = (centerId: number) => {
        const painted = paintBlockCells(collectBlockCells(centerId));
        if (painted > 0) {
          playPaint();
          showToast(`まとめて${painted}マス塗りました`);
        }
      };

      // 世界表示（塗りズーム未満）で国をタップしたら、その国全体が収まるように飛ぶ。
      // 読み込み済みタイル（世界表示では全タイル）から同じ国のポリゴンを集めて bbox を作る。
      const flyToCountryAt = (point: maplibregl.PointLike): boolean => {
        const hit = map.queryRenderedFeatures(point, { layers: ['world-countries-fill'] })[0];
        const a3 = hit?.properties?.ADM0_A3;
        if (typeof a3 !== 'string' || !a3) return false;
        const parts = map.querySourceFeatures('world', {
          sourceLayer: 'countries',
          filter: ['==', 'ADM0_A3', a3],
        });
        const feats = parts.length ? parts : [hit];
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        // 日付変更線をまたぐ国（ロシア等）に備え、経度を 0..360 に寄せた幅も別に持つ。
        let shiftMin = Infinity, shiftMax = -Infinity;
        const scan = (coords: unknown): void => {
          if (typeof (coords as number[])[0] === 'number') {
            const [lng, lat] = coords as number[];
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            const s = lng < 0 ? lng + 360 : lng;
            if (s < shiftMin) shiftMin = s;
            if (s > shiftMax) shiftMax = s;
          } else {
            for (const c of coords as unknown[]) scan(c);
          }
        };
        for (const f of feats) scan((f.geometry as GeoJSON.Polygon).coordinates);
        if (!isFinite(minLat)) return false;
        // 通常幅と日付変更線シフト幅の狭い方を採用（広域にズームアウトしすぎるのを防ぐ）。
        let west = minLng, east = maxLng;
        if (maxLng - minLng > shiftMax - shiftMin) {
          west = shiftMin;
          east = shiftMax;
        }
        const bounds = new maplibregl.LngLatBounds([west, minLat], [east, maxLat]);
        map.fitBounds(bounds, { padding: 60, maxZoom: 7, duration: 1200 });
        return true;
      };

      map.on('click', (e) => {
        // 世界表示（塗りズーム未満）でのタップは、まずその国へ寄せる（海上なら通常処理へ）。
        if (map.getZoom() < MESH_MIN_ZOOM && flyToCountryAt(e.point)) return;
        // デバッグの消しモード：クリックしたセルの塗りを消す（現地・となり問わず）。
        if (eraseModeRef.current) {
          if (map.getZoom() < MESH_MIN_ZOOM) {
            showToast('もっとズームすると消せます');
            return;
          }
          const picked = pickFeatureAt(e);
          if (!picked) return;
          if (!paintedRef.current[`mesh:${picked.id}`]) return; // 未塗りは何もしない
          removePaint(picked.id);
          showToast('塗りを消しました');
          return;
        }
        // 開発者デバッグ：Cmd/Ctrl+クリックで上下左右10マスをまとめて無料塗り。
        const metaHeld =
          (e.originalEvent as MouseEvent | undefined)?.metaKey ||
          (e.originalEvent as MouseEvent | undefined)?.ctrlKey ||
          false;
        if (metaHeld && isDeveloperRef.current) {
          if (map.getZoom() < MESH_MIN_ZOOM) {
            showToast(tRef.current('zoomToPaint'));
            return;
          }
          if (!userIdRef.current) {
            showToast(tRef.current('needLoginPaint'));
            return;
          }
          const picked = pickFeatureAt(e);
          if (!picked) return;
          doBulkDebugPaint(picked.id);
          return;
        }
        // なぞり塗り中はタップ（スワイプせず1点だけ触れた場合）でもそのセルを塗る。
        if (paintModeRef.current === 'nazori') {
          if (map.getZoom() < MESH_MIN_ZOOM) {
            showToast(tRef.current('zoomToPaint'));
            return;
          }
          if (!userIdRef.current) {
            showToast(tRef.current('needLoginPaint'));
            return;
          }
          nazoriPaintAt(e);
          return;
        }
        // となり塗り（マウスでの塗り）はとなり塗りモード時のみ。
        // Shift+クリックの無料デバッグ塗りはモードを無視して許可する。
        const shiftHeld = (e.originalEvent as MouseEvent | undefined)?.shiftKey ?? false;
        if (paintModeRef.current !== 'tonari' && !shiftHeld) {
          showToast(tRef.current('switchTonari'));
          return;
        }
        if (map.getZoom() < MESH_MIN_ZOOM) {
          showToast(tRef.current('zoomToPaint'));
          return;
        }
        const picked = pickFeatureAt(e);
        if (!picked) return;
        const { id, muniKey, region, address } = picked;
        const existing = paintedRef.current[`mesh:${id}`];

        if (existing === 'gps') {
          showToast(tRef.current('gpsLocked'));
          return;
        }
        if (existing === 'manual') {
          // 塗り済みを再クリックしても消さない（消すのはデバッグの消しモードのみ）。
          return;
        }
        // 未塗り → 塗りポイントを使って塗る（ログイン必須）。
        //   隣接（海越え可）= COST_ADJACENT / 離れた場所 = COST_FAR（確認ダイアログ）。
        // Shift を押しながらだと隣接判定もコストも無視して無料で塗れる（開発者のデバッグ用）。
        if (!userIdRef.current) {
          showToast(tRef.current('needLoginPaint'));
          return;
        }
        const freeDebug = shiftHeld && isDeveloperRef.current;
        // 外国（自国＝GPS判定の adm0_a3 以外）は 10×10 ブロックでまとめ塗り。
        // 固定コスト・隣接条件なし・確認ダイアログなし。デバッグ無料塗りは従来どおり無料の一括塗り。
        if (region && isForeign(region.a3)) {
          if (freeDebug) doBulkDebugPaint(id);
          else doForeignBlockPaint(id);
          return;
        }
        // 1個目（まだ何も塗っていない）はどこでもコスト1・確認ダイアログなしで塗れる。
        // 本来は GPS で現在地が塗られる想定だが、それが間に合わない時の救済。
        const isFirstPaint = Object.keys(paintedRef.current).length === 0;
        const cost = freeDebug ? 0 : isAdjacent(id) || isFirstPaint ? COST_ADJACENT : COST_FAR;
        if (cost > 0 && pointsRef.current < cost) {
          showToast(tRef.current('notEnoughPointsLeft', pointsRef.current as never));
          return;
        }
        if (cost >= COST_FAR) {
          // 離れた場所は確認ダイアログを出してから塗る
          setConfirmPaint({ id, cost, muniKey, region, address });
          return;
        }
        doManualPaint(id, muniKey, region, address, cost);
      });

      // ── 現在地の住所ラベル（青い点の真下に正確な住所を表示）──────────
      const createAddressLabelEl = () => {
        const el = document.createElement('div');
        el.style.marginTop = '6px'; // 青い点と重ならないよう少し下げる
        el.style.padding = '2px 8px';
        el.style.background = 'rgba(255,255,255,0.9)';
        el.style.border = '1px solid rgba(0,0,0,0.15)';
        el.style.borderRadius = '6px';
        el.style.fontSize = '12px';
        el.style.fontWeight = '600';
        el.style.color = '#1f2937';
        el.style.whiteSpace = 'nowrap';
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
        el.style.pointerEvents = 'none';
        return el;
      };
      const showCurrentAddress = (lngLat: [number, number], address: string) => {
        if (!addressMarkerRef.current) {
          // anchor:'top' で要素の上端を現在地に合わせる＝青い点の下に表示される
          addressMarkerRef.current = new maplibregl.Marker({
            element: createAddressLabelEl(),
            anchor: 'top',
          })
            .setLngLat(lngLat)
            .addTo(map);
        } else {
          addressMarkerRef.current.setLngLat(lngLat);
        }
        addressMarkerRef.current.getElement().textContent = address;
      };

      // ── GPS 自動塗り（移動中も追跡して現在地を黄色く塗る）──────────
      // メッシュコードは座標から数式で求まるので、タイル未ロードでも塗れる。
      let lastGeocodedId: number | null = null; // 逆ジオコーダの連打防止（セルが変わった時だけ）
      let lastGpsCellId: number | null = null; // 直前にGPSで居たセル（再訪検出・静止中の連投防止）
      const paintGpsAt = (lngLat: [number, number]) => {
        const id = meshCodeAt(lngLat[0], lngLat[1]);
        // 別セルから入り直したか（静止中は同じセルなので false → 再訪POSTを連投しない）。
        const enteredNewCell = id !== lastGpsCellId;
        lastGpsCellId = id;
        // 市区町村キー（塗り％用）は表示中なら municipalities から拾う。ズームが浅い／
        // 画面外なら null（GPS塗り自体は数式で成立するのでセルは塗れる）。
        let muniKey: string | null = null;
        let region: { key: string; a3: string } | null = null;
        if (map.getZoom() >= MESH_MIN_ZOOM) {
          const pt = cellCenterPoint(id);
          // 帰属は共有ポリゴンのセル中心 PiP（分母と厳密一致・ズーム非依存）。未ロード時はタイル判定。
          muniKey = (muniPolysRef.current.length > 0 ? classifyMuniAt(id) : muniInfoAt(pt))?.key ?? null;
          const st = stateInfoAt(pt);
          region = st ? { key: st.key, a3: st.a3 } : null;
        }
        if (paintedRef.current[`mesh:${id}`] === 'gps') {
          // 既に訪問済み（黄）のセル。別セルから入り直した時だけ再訪EXPをサーバーに問い合わせる。
          // サーバーが前回訪問からのクールダウン（1時間）を判定し、満たせば +100 を返す。
          if (enteredNewCell) syncPaint('POST', id, 'gps', region, true);
        } else {
          // 新規セル or となり塗り→gps 昇格：従来どおりローカル反映＋サーバー同期。
          applyPaint(id, 'gps', muniKey, region);
        }
        // 現地塗りモードでは、グリッド内の近似住所ではなく現在地の正確な住所を表示する。
        // 同じメッシュセル内では再取得しない（移動して別セルに入った時だけ問い合わせる）。
        if (paintModeRef.current === 'genchi' && gpsAddressEnabledRef.current && id !== lastGeocodedId) {
          lastGeocodedId = id;
          reverseGeocode(lngLat[0], lngLat[1]).then((address) => {
            // 取得待ちの間に別セルへ移動していたら反映しない（古い結果の上書き防止）
            if (address && lastGeocodedId === id) {
              showCurrentAddress(lngLat, address);
            }
          });
        }
      };
      // 自国（adm0_a3）を現在地から判定する。GPS の trackUserLocation は現在地へ地図を
      // 寄せるので、その点を world-states-fill へクエリすれば国コードが取れる。タイル未ロード
      // で取れなければ次の idle で1回だけ再試行する。1セッション1回だけ確定する。
      const resolveHomeCountry = (lng: number, lat: number) => {
        if (homeCountryRef.current) return;
        const tryResolve = () => {
          if (homeCountryRef.current) return true;
          const a3 = stateInfoAt(map.project([lng, lat]))?.a3;
          if (a3) {
            homeCountryRef.current = a3;
            setHomeCountry(a3);
            return true;
          }
          return false;
        };
        if (!tryResolve()) map.once('idle', tryResolve);
      };
      // 現在地の国（adm0_a3）を判定し、前回 DB に反映した値と変わっていれば user.country を更新する。
      // 国境の解決には world-states タイルが要るので、取れなければ次の idle で1回だけ再試行する。
      const reportCountry = (lng: number, lat: number) => {
        if (!userIdRef.current) return; // 未ログインは送らない（保存先が無い）
        const tryReport = () => {
          const a3 = stateInfoAt(map.project([lng, lat]))?.a3;
          if (!a3) return false;
          if (a3 !== reportedCountryRef.current) {
            reportedCountryRef.current = a3;
            updateMyCountry(a3);
          }
          return true;
        };
        if (!tryReport()) map.once('idle', tryReport);
      };
      let firstGpsLogged = false;
      geolocate.on('geolocate', (pos: GeolocationPosition) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        paintGpsAt([lng, lat]);
        resolveHomeCountry(lng, lat);
        reportCountry(lng, lat);
        // 直近の現在地を共有（塗り以外のアクションのログ位置に best-effort で使う）。
        const municipality = muniKeyFor(meshCodeAt(lng, lat));
        setLastKnownLocation({ lat, lng, municipality });
        // 現在地の最初の取得を1回だけ記録する。
        if (!firstGpsLogged) {
          firstGpsLogged = true;
          logEvent('gps', { lat, lng, municipality });
        }
      });
      geolocate.on('error', (err: GeolocationPositionError) => {
        const msg =
          err?.code === 1
            ? tRef.current('geoDenied')
            : err?.code === 3
              ? tRef.current('geoTimeout')
              : tRef.current('geoFailed');
        showToast(msg);
        console.warn('geolocation error', { code: err?.code, message: err?.message });
      });

      // ── デバッグ用：十字キーで現在地を動かして塗る ──────────────
      // 十字キーで仮想の現在地を移動（GPS と同じ黄色で塗る）。スペースで移動モード解除。
      let debugMarker: maplibregl.Marker | null = null;
      let debugPos: [number, number] | null = null;

      const createDebugMarkerEl = () => {
        const el = document.createElement('div');
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.borderRadius = '50%';
        el.style.background = '#2563eb';
        el.style.border = '3px solid #ffffff';
        el.style.boxShadow = '0 0 0 2px rgba(37,99,235,0.4)';
        return el;
      };

      const moveDebugPosition = (pos: [number, number]) => {
        debugPos = pos;
        if (!debugMarker) {
          debugMarker = new maplibregl.Marker({ element: createDebugMarkerEl() })
            .setLngLat(pos)
            .addTo(map);
        } else {
          debugMarker.setLngLat(pos);
        }
        map.easeTo({ center: pos, duration: 200 });
        paintGpsAt(pos); // 現在地として黄色く塗る
      };

      const exitDebugMove = () => {
        if (!debugPos) return;
        debugMarker?.remove();
        debugMarker = null;
        debugPos = null;
        setDebugMoving(false);
        showToast('移動モードを解除しました');
      };

      const onDebugKeyDown = (e: KeyboardEvent) => {
        // 十字キーの疑似GPS移動は開発者だけのデバッグ機能。
        if (!isDeveloperRef.current) return;
        if (e.code === 'Space') {
          if (!debugPos) return;
          e.preventDefault();
          exitDebugMove();
          return;
        }
        const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (!arrows.includes(e.key)) return;
        e.preventDefault();

        // 初回は地図中心から開始
        let start = debugPos;
        if (!start) {
          const c = map.getCenter();
          start = [c.lng, c.lat];
          setDebugMoving(true);
          showToast('移動モード：十字キーで移動 / スペースで解除');
        }
        const bounds = map.getBounds();
        const stepLng = (bounds.getEast() - bounds.getWest()) * 0.15;
        const stepLat = (bounds.getNorth() - bounds.getSouth()) * 0.15;
        let [lng, lat] = start;
        if (e.key === 'ArrowUp') lat += stepLat;
        else if (e.key === 'ArrowDown') lat -= stepLat;
        else if (e.key === 'ArrowLeft') lng -= stepLng;
        else if (e.key === 'ArrowRight') lng += stepLng;
        moveDebugPosition([lng, lat]);
      };

      window.addEventListener('keydown', onDebugKeyDown);
      debugCleanupRef.current = () => {
        window.removeEventListener('keydown', onDebugKeyDown);
        debugMarker?.remove();
        debugMarker = null;
        debugPos = null;
        addressMarkerRef.current?.remove();
        addressMarkerRef.current = null;
      };

      // 読み込み完了後に自動で位置取得を開始（許可されれば現在地を黄色く塗る）。
      // GeolocateControl の内部準備は非同期なので、準備完了までリトライする
      let triggerAttempts = 0;
      const tryTrigger = () => {
        if (cancelled) return;
        if (geolocate.trigger()) return; // 起動成功
        if (triggerAttempts++ < 25) {
          window.setTimeout(tryTrigger, 200);
        }
      };
      tryTrigger();

      setMapReady(true);
    });

    mapRef.current = map;

    // iOS（Chrome/Safari=WebKit）はアドレスバーのアニメーションで 100dvh の確定が遅れ、
    // 地図初期化時のコンテナ高さが 0／間違った値になり地図・グリッドが描画されないことがある
    // （手動リロードすると直る症状の原因）。コンテナのサイズ変化を監視して map.resize() を
    // 呼び、dvh 確定後にリロード無しで自動的に正しいサイズで描き直す。
    const resizeObserver = new ResizeObserver(() => {
      if (!cancelled) map.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      debugCleanupRef.current?.();
      debugCleanupRef.current = null;
      map.remove();
      maplibregl.removeProtocol('pmtiles');
      mapRef.current = null;
      debugControlRef.current = null; // map.remove() で除去済み。ref も戻して再マウントに備える
      setMapReady(false);
    };
  }, []);

  // デバッグメニュー（レンチ）コントロールは開発者だけに表示する。
  // session は非同期で確定するため、権限が分かった時点で付け外しする。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (isDeveloper && !debugControlRef.current) {
      const ctrl = new DebugControl(() => openDebugRef.current());
      map.addControl(ctrl, 'top-right');
      debugControlRef.current = ctrl;
    } else if (!isDeveloper && debugControlRef.current) {
      map.removeControl(debugControlRef.current);
      debugControlRef.current = null;
      setDebugOpen(false);
    }
  }, [isDeveloper, mapReady]);

  // ログイン状態に応じて DB から復元 / ログアウト時にクリア
  useEffect(() => {
    if (isPending || !mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    const clearAll = () => {
      // 描画は painted-overlay（painted state 駆動）なので state を空にすれば消える。
      paintedRef.current = {};
      setPainted({});
      paintedAtRef.current = new Map();
      muniByPaintedCellRef.current = new Map();
      paintedByMuniRef.current = new Map();
      regionByPaintedCellRef.current = new Map();
      paintedByStateRef.current = new Map();
      paintedByCountryRef.current = new Map();
      refreshHoverStat();
    };

    if (!userId) {
      clearAll();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(PAINT_API, { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as {
          painted: {
            sourceLayer: string;
            keyCode: string;
            mode?: string;
            municipality?: string | null;
            region?: string | null;
            paintedAt?: string | null;
          }[];
        };
        if (cancelled) return;

        clearAll();
        const next: PaintedState = {};
        for (const row of data.painted) {
          if (row.sourceLayer !== 'mesh') continue;
          const id = Number(row.keyCode);
          if (!Number.isFinite(id)) continue;
          const mode: PaintMode = row.mode === 'gps' ? 'gps' : 'manual';
          next[`mesh:${id}`] = mode;
          // 塗り％集計用に cell→市区町村 / cell→州県 を保存時の値から復元する
          if (row.municipality) muniByPaintedCellRef.current.set(id, row.municipality);
          if (row.region) regionByPaintedCellRef.current.set(id, row.region);
          if (row.paintedAt) paintedAtRef.current.set(id, row.paintedAt);
        }
        paintedRef.current = next;
        setPainted(next);
        // 判定用ポリゴンがロード済みなら DB の保存市区町村ではなく共有ポリゴンのセル中心 PiP で
        // 数え直す（分母と厳密一致）。未ロードなら一旦 DB 値で集計し、ロード時に数え直される。
        if (muniPolysRef.current.length > 0) reclassifyPaintedMuni();
        else rebuildPaintedByMuni(); // 復元した塗りを市区町村ごとに集計し直す
        rebuildPaintedByRegion(); // 同じく州・県／国ごとに集計し直す
      } catch (err) {
        console.warn('failed to load painted regions', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, isPending, mapReady, refreshHoverStat, rebuildPaintedByMuni, reclassifyPaintedMuni, rebuildPaintedByRegion]);

  // 塗り状態が変わったら低ズーム用オーバーレイを更新
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('painted-overlay') as maplibregl.GeoJSONSource | undefined;
    src?.setData(buildPaintedOverlay(painted));
    scheduleLabelRefresh(); // 塗りが変わったらラベルの％も更新（デバウンス）
  }, [painted, mapReady, scheduleLabelRefresh]);

  // ラベル（都道府県・市区町村・政令市）をクライアント側 GeoJSON で追加し、
  // 塗り％をテキストに差し込めるようにする。PMTiles のラベルは静的なので使わない。
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map || map.getSource('muni-labels')) return;
    let cancelled = false;
    (async () => {
      try {
        const [muni, city, pref, kana] = await Promise.all([
          fetch('/data/municipalities.geojson').then((r) => r.json()),
          fetch('/data/designated_cities.geojson').then((r) => r.json()),
          fetch('/data/prefectures.geojson').then((r) => r.json()),
          fetch('/data/muni-kana.json').then((r) => r.json()),
        ]);
        if (cancelled || !mapRef.current || map.getSource('muni-labels')) return;
        muniLabelFCRef.current = muni as GeoJSON.FeatureCollection;
        cityLabelFCRef.current = city as GeoJSON.FeatureCollection;
        prefLabelFCRef.current = pref as GeoJSON.FeatureCollection;
        kanaByCodeRef.current = (kana as { byCode?: Record<string, string> }).byCode ?? {};
        kanaByCityRef.current = (kana as { byCity?: Record<string, string> }).byCity ?? {};
        cityKeyPrefixesRef.current = cityLabelFCRef.current.features.map(
          (f) => `${f.properties?.N03_001 ?? ''}|${f.properties?.N03_004 ?? ''}`
        );

        map.addSource('muni-labels', { type: 'geojson', data: muni });
        map.addSource('city-labels', { type: 'geojson', data: city });
        map.addSource('pref-labels', { type: 'geojson', data: pref });

        // 都道府県名ラベル。6未満は濃いグレーで主役、6以上は赤の半透明で
        // 市区町村名と併存させる（地名の邪魔をしないオーバーレイ）。
        map.addLayer({
          id: 'prefecture-label',
          type: 'symbol',
          source: 'pref-labels',
          layout: {
            'text-field': ['get', 'lbl'],
            'text-font': ['Open Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 6, 15, 10, 18],
            'text-allow-overlap': ['step', ['zoom'], false, 6, true],
            'text-ignore-placement': ['step', ['zoom'], false, 6, true],
          },
          paint: {
            'text-color': ['step', ['zoom'], '#333333', 6, '#e03131'],
            'text-opacity': ['step', ['zoom'], 1, 6, 0.5],
            'text-halo-color': 'rgba(255,255,255,0.85)',
            'text-halo-width': 1.5,
          },
        });

        // 市区町村名ラベル
        map.addLayer({
          id: 'municipality-label',
          type: 'symbol',
          source: 'muni-labels',
          minzoom: 6,
          layout: {
            // 市区町村名（nm）の下に小さく読み仮名（ym, 改行付き）を添える
            'text-field': [
              'format',
              ['get', 'nm'], {},
              ['get', 'ym'], { 'font-scale': 0.7, 'text-color': '#888888' },
            ],
            'text-font': ['Open Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 9, 10, 13],
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': '#333333',
            'text-halo-color': 'rgba(255,255,255,0.8)',
            'text-halo-width': 1.5,
          },
        });

        // 政令指定都市名ラベル（市名を枠線と同じ色で強調表示）
        map.addLayer({
          id: 'cities-label',
          type: 'symbol',
          source: 'city-labels',
          minzoom: 6,
          layout: {
            // 政令市名（nm）の下に小さく読み仮名（ym, 改行付き）を添える
            'text-field': [
              'format',
              ['get', 'nm'], {},
              ['get', 'ym'], { 'font-scale': 0.65, 'text-color': '#3b6fd4' },
            ],
            'text-font': ['Open Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 10, 17],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#1d4ed8',
            'text-halo-color': 'rgba(255,255,255,0.9)',
            'text-halo-width': 2,
          },
        });

        applyLabelStats(); // 現在の塗り状況を反映（統計未ロードなら名前のみ）
      } catch (err) {
        console.warn('failed to load label layers', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, applyLabelStats]);

  // 市区町村ごとの塗り％の分母（総セル数）を遅延ロード。mesh はベイクしないので
  // cell→市区町村の対応は持たず、分母（"PREF|CITY"→n）だけを読む（数KB）。
  useEffect(() => {
    if (!mapReady || totalByMuniRef.current.size > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(MUNI_STATS_URL);
        if (!res.ok) return;
        const data = (await res.json()) as { munis: { k: string; n: number }[] };
        if (cancelled) return;
        const totals = new Map<string, number>();
        for (const { k, n } of data.munis) totals.set(k, n);
        totalByMuniRef.current = totals;
        rebuildPaintedByMuni(); // 既に復元済みの塗りを集計
        applyLabelStats(); // 統計が揃ったのでラベルに％を反映
      } catch (err) {
        console.warn('failed to load muni stats', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, rebuildPaintedByMuni, applyLabelStats]);

  // 塗りセルの市区町村帰属を判定する共有ポリゴン（muni-classify.geojson・gzip約1.5MB）を
  // 遅延ロードする。build-muni-stats（分母）と同一ファイル・同一 PiP で判定するため、
  // 塗り％の分子＝分母が厳密一致し、どのズームで塗っても必ず 100% に到達する。
  // ロード後は既存の塗りも新判定で数え直す（reclassifyPaintedMuni）。
  useEffect(() => {
    if (!mapReady || muniPolysRef.current.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(MUNI_CLASSIFY_URL);
        if (!res.ok) return;
        const data = (await res.json()) as { features: GeoJSON.Feature[] };
        if (cancelled) return;
        const feats: MuniPoly[] = [];
        for (const f of data.features) {
          const p = (f.properties ?? {}) as Record<string, string>;
          const pref = p.N03_001 ?? '';
          const city = `${p.N03_004 ?? ''}${p.N03_005 ?? ''}`;
          if (!city) continue;
          const parts = polysWithBbox(f.geometry);
          if (parts.length === 0) continue;
          feats.push({ key: `${pref}|${city}`, address: `${pref}${city}`, parts });
        }
        if (cancelled) return;
        muniPolysRef.current = feats;
        muniIndexRef.current = buildMuniIndex(feats);
        reclassifyPaintedMuni(); // 既存の塗りを新判定で数え直す
      } catch (err) {
        console.warn('failed to load muni classify', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, reclassifyPaintedMuni]);

  // 世界版の塗り％の分母（州・県／国ごとの総セル数）と地名メタを遅延ロード（約500KB）。
  // build-world-stats.mjs が生成。日本の muni-stats と独立に扱う。
  useEffect(() => {
    if (!mapReady || totalByStateRef.current.size > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(WORLD_STATS_URL);
        if (!res.ok) return;
        const data = (await res.json()) as {
          states: Record<string, number>;
          countries: Record<string, number>;
          stateMeta: Record<string, { name: string; name_ja: string; admin: string; adm0_a3: string }>;
          countryMeta: Record<string, { name: string; name_ja: string }>;
        };
        if (cancelled) return;
        totalByStateRef.current = new Map(Object.entries(data.states));
        totalByCountryRef.current = new Map(Object.entries(data.countries));
        stateMetaRef.current = new Map(Object.entries(data.stateMeta ?? {}));
        countryMetaRef.current = new Map(Object.entries(data.countryMeta ?? {}));
        rebuildPaintedByRegion(); // 既に復元済みの塗りを州・県／国ごとに集計
      } catch (err) {
        console.warn('failed to load world stats', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, rebuildPaintedByRegion]);

  // 言語を切り替えたらラベル（地名のローマ字／日本語）とホバー％を作り直す。
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    // 世界の国名・州名ラベル（PMTiles の属性）を言語に合わせて切り替える。
    if (map) {
      const en = lang === 'en';
      if (map.getLayer('world-countries-label')) {
        map.setLayoutProperty(
          'world-countries-label',
          'text-field',
          en
            ? ['coalesce', ['get', 'NAME'], ['get', 'NAME_JA']]
            : ['coalesce', ['get', 'NAME_JA'], ['get', 'NAME']],
        );
      }
      if (map.getLayer('world-states-label')) {
        map.setLayoutProperty(
          'world-states-label',
          'text-field',
          en
            ? ['coalesce', ['get', 'name'], ['get', 'name_ja']]
            : ['coalesce', ['get', 'name_ja'], ['get', 'name']],
        );
      }
    }
    applyLabelStats();
    refreshHoverStat();
  }, [lang, mapReady, applyLabelStats, refreshHoverStat]);

  // 制覇した境界の金枠グローをゆっくり明滅させる（制覇が1つ以上あるときだけ動かす）。
  useEffect(() => {
    if (!mapReady || conqueredCount === 0) return;
    const map = mapRef.current;
    if (!map) return;
    let raf = 0;
    let start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const phase = ((ts - start) / 1400) * Math.PI * 2; // 約1.4秒周期
      const o = 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(phase));
      if (map.getLayer('muni-complete-glow-blur')) {
        map.setPaintProperty('muni-complete-glow-blur', 'line-opacity', o);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapReady, conqueredCount]);


  const modes = Object.values(painted);
  const count = modes.length;
  const gpsCount = modes.filter((m) => m === 'gps').length;
  const manualCount = count - gpsCount;

  // データ詳細パネル用の集計（パネルを開いている間だけ計算する）。
  // 塗り済みメッシュを市区町村→都道府県に辿って、訪れた都道府県・市区町村数と
  // 都道府県ごとの塗り％（多い順）を作る。muni-stats.json 未ロード時は地域内訳は空。
  const TOTAL_PREFS = 47;
  const stats = statsOpen
    ? (() => {
        const lookup = muniByPaintedCellRef.current;
        const paintedByPref = new Map<string, number>();
        const visitedMuni = new Set<string>();
        for (const key of Object.keys(painted)) {
          const [layer, idStr] = key.split(':');
          if (layer !== 'mesh') continue;
          const muni = lookup.get(Number(idStr));
          if (!muni) continue;
          visitedMuni.add(muni);
          const pref = muni.split('|')[0];
          paintedByPref.set(pref, (paintedByPref.get(pref) ?? 0) + 1);
        }
        const totalByPref = new Map<string, number>();
        let nationTotal = 0; // 日本全体のメッシュ総数（塗り％の分母）
        for (const [key, t] of totalByMuniRef.current) {
          const pref = key.split('|')[0];
          totalByPref.set(pref, (totalByPref.get(pref) ?? 0) + t);
          nationTotal += t;
        }
        const prefs = [...paintedByPref.entries()]
          .map(([name, p]) => ({ name, painted: p, total: totalByPref.get(name) ?? 0 }))
          .sort((a, b) => b.painted - a.painted);
        // 制覇コレクション：100%塗った市区町村（表示名）と完全制覇した都道府県。
        // recomputeCompleted と同じ判定を分母・分子から直接出す（ref に依存しない）。
        const conqueredMunis: string[] = [];
        const prefDone = new Map<string, number>();
        for (const [key, tot] of totalByMuniRef.current) {
          if (tot > 0 && (paintedByMuniRef.current.get(key) ?? 0) >= tot) {
            conqueredMunis.push(key.split('|')[1] || key);
            const pref = key.split('|')[0];
            prefDone.set(pref, (prefDone.get(pref) ?? 0) + 1);
          }
        }
        const prefMuniCount = new Map<string, number>();
        for (const [key] of totalByMuniRef.current) {
          const pref = key.split('|')[0];
          prefMuniCount.set(pref, (prefMuniCount.get(pref) ?? 0) + 1);
        }
        const conqueredPrefs = [...prefMuniCount.entries()]
          .filter(([pref, tot]) => tot > 0 && (prefDone.get(pref) ?? 0) >= tot)
          .map(([pref]) => pref);
        conqueredMunis.sort();
        return {
          prefVisited: paintedByPref.size,
          muniVisited: visitedMuni.size,
          nationTotal,
          prefs,
          conqueredMunis,
          conqueredPrefs,
        };
      })()
    : null;

  // 世界版の集計（世界モードで開いている間だけ計算）。塗り済みメッシュを
  // adm1_code（regionByPaintedCellRef）→ 国（stateMeta.adm0_a3）へ辿り、
  // 国ごとの塗りセル数（多い順）を作る。分母は world-stats の国別総セル数。
  const worldStats =
    statsOpen && statsView === 'world'
      ? (() => {
          const lookup = regionByPaintedCellRef.current;
          const meta = stateMetaRef.current;
          const paintedByCountry = new Map<string, number>();
          for (const key of Object.keys(painted)) {
            const [layer, idStr] = key.split(':');
            if (layer !== 'mesh') continue;
            const adm1 = lookup.get(Number(idStr));
            if (!adm1) continue;
            const a3 = meta.get(adm1)?.adm0_a3;
            if (!a3) continue;
            paintedByCountry.set(a3, (paintedByCountry.get(a3) ?? 0) + 1);
          }
          const countries = [...paintedByCountry.entries()]
            .map(([a3, p]) => {
              const cm = countryMetaRef.current.get(a3);
              const name = cm ? (lang === 'en' ? cm.name : cm.name_ja) || cm.name || a3 : a3;
              return { a3, name, painted: p, total: totalByCountryRef.current.get(a3) ?? 0 };
            })
            .sort((a, b) => b.painted - a.painted);
          return { countries };
        })()
      : null;

  // 自国が日本かどうか（未判定＝null は日本扱い。日本中心のアプリなので既定は日本）。
  const isJapanHome = !homeCountry || homeCountry === 'JPN';
  // 自国タブのラベル（日本＝「日本」、それ以外＝その国名）。
  const homeCountryName = isJapanHome
    ? t('viewJapan')
    : (() => {
        const cm = countryMetaRef.current.get(homeCountry);
        return (cm && ((lang === 'en' ? cm.name : cm.name_ja) || cm.name)) || homeCountry;
      })();

  // 自国が日本以外のとき、その国の州・県（admin_1）ごとの塗り％（多い順）を作る。
  // 分母は world-stats の州別総セル数、分子は塗ったセルから集計する。
  const homeStateStats =
    statsOpen && statsView === 'home' && !isJapanHome
      ? (() => {
          const a3 = homeCountry;
          const lookup = regionByPaintedCellRef.current;
          const meta = stateMetaRef.current;
          const paintedByState = new Map<string, number>();
          for (const key of Object.keys(painted)) {
            const [layer, idStr] = key.split(':');
            if (layer !== 'mesh') continue;
            const adm1 = lookup.get(Number(idStr));
            if (!adm1) continue;
            if (meta.get(adm1)?.adm0_a3 !== a3) continue;
            paintedByState.set(adm1, (paintedByState.get(adm1) ?? 0) + 1);
          }
          const states = [...paintedByState.entries()]
            .map(([rk, p]) => {
              const m = meta.get(rk);
              const name = (m && ((lang === 'en' ? m.name : m.name_ja) || m.name)) || rk;
              return { rk, name, painted: p, total: totalByStateRef.current.get(rk) ?? 0 };
            })
            .sort((a, b) => b.painted - a.painted);
          return { states };
        })()
      : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* 塗りの瞬間の波紋（paint-ripple）は MapLibre の Marker として地図に直接貼り付ける（spawnRipple が生成）。 */}

      {/* 塗った地名のふわっと表示。各要素を絶対配置で独立して上昇させる（積み替えで起きる
          ガタつきを避ける）。画面中央あたりから一番上まですーっと上がりながら薄れて消える。 */}
      {floats.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden>
          {floats.map((f) => (
            <div
              key={f.key}
              className="paint-float-item flex items-baseline gap-2 rounded-full bg-black/55 px-3.5 py-1.5 backdrop-blur-sm"
              style={{ ['--dx' as string]: `${f.dx}px` }}
            >
              <span className="paint-float-name">{f.name}</span>
              {f.exp > 0 && <span className="paint-float-exp">{t('expFloat', f.exp as never)}</span>}
            </div>
          ))}
        </div>
      )}

      {/* コンボ（連鎖塗り）表示。2連鎖以上で中央上に大きく出す。 */}
      {combo >= 2 && (
        <div
          key={comboKeyRef.current}
          className="combo-pop pointer-events-none absolute left-1/2 top-24 z-20 -translate-x-1/2 select-none text-center"
        >
          <div
            className="text-5xl font-black tracking-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
            style={{ color: COLOR_GPS, WebkitTextStroke: '1.5px #b45309' }}
          >
            {combo}
          </div>
          <div className="text-xs font-bold text-amber-700 drop-shadow">{t('combo', combo as never)}</div>
        </div>
      )}

      {/* 制覇バナー（市区町村100% / 都道府県完全制覇）。 */}
      {conquer && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/3 z-30 -translate-x-1/2"
          role="status"
          aria-live="polite"
        >
          <div className="conquer-pop flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-3 text-lg font-black text-white shadow-2xl ring-4 ring-amber-200">
            {conquer}
          </div>
        </div>
      )}

      {/* 塗り方モード切り替え（左上・タイトルバーの下）。
          現地塗り＝GPSの現在地のみ自動で塗る / となり塗り＝マウスで隣接セルを塗れる。 */}
      <div className="absolute top-4 left-4 flex flex-col items-start gap-2 select-none">
        <div className="flex rounded-lg shadow overflow-hidden text-sm font-medium">
          <button
            type="button"
            aria-pressed={paintMode === 'genchi'}
            onClick={() => setPaintMode('genchi')}
            className={`px-3 py-2 transition-colors ${
              paintMode === 'genchi'
                ? 'bg-yellow-400 text-gray-900'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t('modeGenchi')}
          </button>
          <button
            type="button"
            aria-pressed={paintMode === 'tonari'}
            onClick={() => setPaintMode('tonari')}
            className={`px-3 py-2 transition-colors ${
              paintMode === 'tonari'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
            style={paintMode === 'tonari' ? { background: COLOR_MANUAL } : undefined}
          >
            {t('modeTonari')}
          </button>
          <button
            type="button"
            aria-pressed={paintMode === 'nazori'}
            onClick={() => setPaintMode('nazori')}
            className={`px-3 py-2 transition-colors ${
              paintMode === 'nazori'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
            style={paintMode === 'nazori' ? { background: COLOR_MANUAL } : undefined}
          >
            {t('modeNazori')}
          </button>
        </div>
        {/* 塗りポイント残高（赤字・白ふち）。モード切り替えの下に表示。 */}
        {userId && (
          <div
            className="text-base font-black text-red-600"
            style={{
              WebkitTextStroke: '3px #fff',
              paintOrder: 'stroke fill',
            }}
          >
            {t('paintPoints', points as never, maxPoints as never)}
          </div>
        )}
        {/* なぞり塗り中の注意点（塗りポイント表示の下・なぞり塗りモード時のみ）。 */}
        {paintMode === 'nazori' && (
          <div className="max-w-[15rem] whitespace-pre-line rounded-lg bg-white/90 px-3 py-2 text-xs font-medium leading-relaxed text-gray-700 shadow">
            {t('nazoriHint')}
          </div>
        )}
      </div>

      {(hoverStat || userId) && (
        <div className="absolute bottom-4 left-4 bg-white rounded-lg px-4 py-2 shadow text-sm font-medium text-gray-700 space-y-1">
          {hoverStat && (
            <div className="text-gray-900 font-semibold whitespace-pre-line">
              {hoverStat}
            </div>
          )}
          {userId && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-yellow-400 px-2 py-0.5 text-xs font-bold text-gray-900">
                  Lv.{level}
                </span>
                <div className="h-2 flex-1 min-w-[80px] overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-yellow-400 transition-[width] duration-500"
                    style={{
                      width: expToNext > 0 ? `${Math.min(100, (exp / expToNext) * 100)}%` : '0%',
                    }}
                  />
                </div>
              </div>
              <div className="text-[10px] text-gray-500">
                {t('expLabel', exp as never, expToNext as never)}
              </div>
              <div className="text-[10px] text-gray-500">
                {t('totalExpLabel', totalExp.toLocaleString() as never)}
              </div>
              <div
                className={`font-semibold ${
                  points > maxPoints ? 'text-red-600' : 'text-gray-900'
                }`}
              >
                {t('paintPoints', points as never, maxPoints as never)}
              </div>
              {regenAt !== null && points < maxPoints && (
                <div className="text-xs text-gray-500">
                  {t('regenIn', formatCountdown(regenAt - nowTick, t) as never)}
                </div>
              )}
              {/* 動画リワード：動画を見てそのレベルの満タン分を回復。
                  クールダウン中・1日上限はボタンを無効化して理由を表示する。 */}
              {(() => {
                const cooldownLeft =
                  rewardStatus?.nextAvailableAt != null
                    ? rewardStatus.nextAvailableAt - nowTick
                    : 0;
                const onCooldown = cooldownLeft > 0;
                const dailyLimit =
                  rewardStatus != null && rewardStatus.remainingToday <= 0;
                const disabled = onCooldown || dailyLimit || videoPhase !== null;
                return (
                  <button
                    type="button"
                    onClick={openVideoReward}
                    disabled={disabled}
                    className={`mt-1 w-full rounded-md px-2 py-1.5 text-xs font-bold text-white transition-colors ${
                      disabled
                        ? 'cursor-not-allowed bg-gray-300'
                        : 'bg-emerald-500 hover:bg-emerald-600'
                    }`}
                  >
                    {onCooldown
                      ? t('rewardCooldown', formatCountdown(cooldownLeft, t) as never)
                      : dailyLimit
                        ? t('rewardDailyLimit')
                        : t('rewardWatch', (rewardStatus ? rewardStatus.remainingToday : undefined) as never)}
                  </button>
                );
              })()}
            </div>
          )}
        </div>
      )}
      <div className="absolute bottom-4 right-4 bg-white rounded-lg px-3 py-2 shadow text-sm font-mono text-gray-600">
        zoom: <span ref={zoomLabelRef}>4.5</span>
      </div>
      {debugMoving && (
        <div className="absolute top-4 right-4 bg-blue-600 text-white rounded-lg px-3 py-2 shadow text-xs font-medium flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-white" />
          移動モード（十字キー：移動 / Space：解除）
        </div>
      )}
      {eraseMode && (
        <button
          type="button"
          onClick={() => setEraseMode(false)}
          className="absolute top-4 right-4 z-10 bg-red-600 text-white rounded-lg px-3 py-2 shadow text-xs font-medium flex items-center gap-1.5 hover:bg-red-700"
        >
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-white" />
          消しモード（クリックで塗りを消す / タップで解除）
        </button>
      )}
      {hoverPaintMode && (
        <button
          type="button"
          onClick={() => setHoverPaintMode(false)}
          style={{ background: COLOR_MANUAL }}
          className="absolute top-4 right-4 z-10 text-white rounded-lg px-3 py-2 shadow text-xs font-medium flex items-center gap-1.5 hover:opacity-90"
        >
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-white" />
          デバッグ無料なぞり塗り（マウスオーバーで塗る / タップで解除）
        </button>
      )}
      {toast && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900/85 text-white rounded-lg px-4 py-2 shadow text-sm font-medium pointer-events-none"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
      {foreignHover && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-emerald-600 text-white rounded-full px-4 py-1.5 shadow-lg text-sm font-bold pointer-events-none animate-pulse">
          {t('foreignBulkHint')}
        </div>
      )}
      {levelUp && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <div className="level-up-pop flex flex-col items-center gap-1 rounded-2xl bg-gradient-to-b from-yellow-400 to-amber-500 px-8 py-5 text-center shadow-2xl ring-4 ring-yellow-200">
            <span className="text-xs font-bold tracking-widest text-amber-900">
              {t('levelUp')}
            </span>
            <span className="text-4xl font-black text-white drop-shadow">
              Lv.{levelUp.to}
            </span>
            <span className="text-xs font-semibold text-amber-900">
              {t('maxPointPlus')}
            </span>
          </div>
        </div>
      )}
      {/* 広告本体（全画面）は GPT が描画する。ここは前後のローディング表示のみ。 */}
      {videoPhase !== null && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/50"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white px-6 py-5 shadow-xl">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            <span className="text-sm font-medium text-gray-700">
              {videoPhase === 'claiming'
                ? t('videoClaiming')
                : t('videoLoading')}
            </span>
          </div>
        </div>
      )}
      {confirmPaint && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/30"
          onClick={() => setConfirmPaint(null)}
        >
          <div
            className="w-[90%] max-w-sm bg-white rounded-xl shadow-xl p-5"
            role="dialog"
            aria-label={t('confirmFarTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-gray-800 mb-2">
              {t('confirmFarTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-4 whitespace-pre-line">
              {t('confirmFarBody', confirmPaint.cost as never, points as never)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-100"
                onClick={() => setConfirmPaint(null)}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                onClick={confirmFarPaint}
              >
                {t('confirmFarPaint', confirmPaint.cost as never)}
              </button>
            </div>
          </div>
        </div>
      )}
      {searchOpen && (
        <div
          className="absolute inset-0 z-10 flex items-start justify-center bg-black/30 pt-24"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-[90%] max-w-md bg-white rounded-xl shadow-xl p-4"
            role="dialog"
            aria-label={t('searchTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-800">{t('searchTitle')}</h2>
              <button
                type="button"
                aria-label={t('close')}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                onClick={() => setSearchOpen(false)}
              >
                ×
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runSearch(searchQuery);
              }}
              className="flex gap-2"
            >
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                type="submit"
                disabled={searchLoading || !searchQuery.trim()}
                className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
              >
                {searchLoading ? t('searching') : t('searchButton')}
              </button>
            </form>
            {searchError && (
              <p className="mt-3 text-sm text-gray-500">{searchError}</p>
            )}
            {searchResults.length > 0 && (
              <ul className="mt-3 max-h-72 overflow-y-auto divide-y divide-gray-100">
                {searchResults.map((r, i) => (
                  <li key={`${r.title}-${i}`}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 px-2 py-2 text-left text-sm text-gray-800 hover:bg-gray-50 rounded"
                      onClick={() => flyToResult(r)}
                    >
                      <span
                        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          r.scope === 'jp'
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-emerald-50 text-emerald-600'
                        }`}
                      >
                        {t(r.scope === 'jp' ? 'searchScopeJp' : 'searchScopeWorld')}
                      </span>
                      <span className="flex-1">{r.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {debugOpen && isDeveloper && (
        <div
          className="absolute inset-0 z-10 flex justify-end bg-black/30"
          onClick={() => setDebugOpen(false)}
        >
          <div
            className="w-72 max-w-[85%] h-full bg-white shadow-xl p-4 overflow-y-auto"
            role="dialog"
            aria-label="デバッグメニュー"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-800">デバッグメニュー</h2>
              <button
                type="button"
                aria-label="閉じる"
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                onClick={() => setDebugOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">実行モード</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${RUN_MODE_BADGE[RUN_MODE]}`}
                >
                  {RUN_MODE_LABEL[RUN_MODE]}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-gray-400">
                {typeof window !== 'undefined' ? window.location.host : ''}
              </div>
            </div>
            <div className="space-y-2">
              <a
                href="/admin"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                管理画面を開く（別タブ）
              </a>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm font-medium text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50"
                onClick={() => setDebugPoints(100)}
              >
                塗りポイントを100にする
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm font-medium text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50"
                onClick={() => setDebugPoints(1)}
              >
                塗りポイントを1にする
              </button>
              <button
                type="button"
                aria-pressed={eraseMode}
                className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg border ${
                  eraseMode
                    ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                    : 'text-gray-800 border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => {
                  setEraseMode((v) => !v);
                  setHoverPaintMode(false);
                  setDebugOpen(false);
                }}
              >
                {eraseMode ? '消しモードを解除する' : 'マウスで塗りを消すモード'}
              </button>
              <button
                type="button"
                aria-pressed={hoverPaintMode}
                className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg border ${
                  hoverPaintMode
                    ? 'text-white border-transparent hover:opacity-90'
                    : 'text-gray-800 border-gray-200 hover:bg-gray-50'
                }`}
                style={hoverPaintMode ? { background: COLOR_MANUAL } : undefined}
                onClick={() => {
                  setHoverPaintMode((v) => !v);
                  setEraseMode(false);
                  setDebugOpen(false);
                }}
              >
                {hoverPaintMode ? 'デバッグ無料なぞり塗りを解除する' : 'デバッグ無料なぞり塗り（マウスオーバー）'}
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                onClick={() => {
                  setDebugOpen(false);
                  setConfirmClearAll(true);
                }}
              >
                塗りを全部消す
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm font-medium text-white bg-red-600 border border-red-600 rounded-lg hover:bg-red-700"
                onClick={() => {
                  setDebugOpen(false);
                  setConfirmResetAll(true);
                }}
              >
                ユーザーデータをリセット
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmClearAll && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConfirmClearAll(false)}
        >
          <div
            className="w-80 max-w-full rounded-xl bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="塗りの全消去の確認"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900">塗りを全部消す</h2>
            <p className="mt-2 text-sm text-gray-600">
              塗った場所をすべて消します。この操作は元に戻せません。よろしいですか？
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                onClick={() => setConfirmClearAll(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
                onClick={() => {
                  setConfirmClearAll(false);
                  clearAllPaint();
                }}
              >
                全部消す
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmResetAll && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConfirmResetAll(false)}
        >
          <div
            className="w-80 max-w-full rounded-xl bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="ユーザーデータのリセットの確認"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900">
              ユーザーデータをリセット
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              塗った場所をすべて消し、レベル・経験値・塗りポイントを初期状態に戻します。この操作は元に戻せません。よろしいですか？
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                onClick={() => setConfirmResetAll(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
                onClick={() => {
                  setConfirmResetAll(false);
                  resetUserData();
                }}
              >
                リセットする
              </button>
            </div>
          </div>
        </div>
      )}
      {statsOpen && (
        <div
          className="absolute inset-0 z-10 flex justify-end bg-black/30"
          onClick={() => setStatsOpen(false)}
        >
          <div
            className="w-80 max-w-[85%] h-full bg-white shadow-xl p-4 overflow-y-auto"
            role="dialog"
            aria-label={t('statsTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-800">{t('statsTitle')}</h2>
              <button
                type="button"
                aria-label={t('close')}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                onClick={() => setStatsOpen(false)}
              >
                ×
              </button>
            </div>

            {/* 自国／世界 切り替え。自国は日本なら都道府県、それ以外はその国の州・県内訳。
                世界は各国の塗り％だけを出す。 */}
            <div className="flex rounded-lg bg-gray-100 p-0.5 mb-4 text-sm font-medium select-none">
              <button
                type="button"
                aria-pressed={statsView === 'home'}
                onClick={() => setStatsView('home')}
                className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
                  statsView === 'home'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {homeCountryName}
              </button>
              <button
                type="button"
                aria-pressed={statsView === 'world'}
                onClick={() => setStatsView('world')}
                className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
                  statsView === 'world'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('viewWorld')}
              </button>
            </div>

            {statsView === 'home' && (
              <>
            {userId && (
              <div className="mb-4 rounded-lg bg-yellow-50 px-3 py-2 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-yellow-400 px-2 py-0.5 text-xs font-bold text-gray-900">
                    Lv.{level}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-yellow-200">
                    <div
                      className="h-full rounded-full bg-yellow-500 transition-[width] duration-500"
                      style={{
                        width: expToNext > 0 ? `${Math.min(100, (exp / expToNext) * 100)}%` : '0%',
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500 whitespace-nowrap">
                    {exp} / {expToNext}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-gray-500">{t('totalExpShort')}</span>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">
                    {totalExp.toLocaleString()}
                  </span>
                </div>
                <div className="text-sm font-semibold text-gray-900">
                  {t('paintPoints', points as never, maxPoints as never)}
                </div>
                {regenAt !== null && points < maxPoints && (
                  <div className="text-xs text-gray-500">
                    {t('regenIn', formatCountdown(regenAt - nowTick, t) as never)}
                  </div>
                )}
              </div>
            )}

            {/* 合計プレイ時間（パネル表示中は前回計上からの経過秒を足して秒単位でリアルタイム更新） */}
            {userId && (
              <div className="mb-4 flex items-baseline justify-between rounded-lg bg-gray-50 px-3 py-2">
                <span className="text-[11px] text-gray-500">{t('playTime')}</span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatPlayTime(
                    playTimeSec +
                      (lastBeatRef.current > 0
                        ? Math.max(0, Math.floor((nowTick - lastBeatRef.current) / 1000))
                        : 0),
                    t
                  )}
                </span>
              </div>
            )}

            {/* 塗りの合計 */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="rounded-lg bg-gray-50 px-2 py-2 text-center">
                <div className="text-lg font-bold text-gray-900">{count}</div>
                <div className="text-[11px] text-gray-500">{t('paintedRegions')}</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-2 text-center">
                <div className="text-lg font-bold" style={{ color: COLOR_GPS }}>
                  {gpsCount}
                </div>
                <div className="text-[11px] text-gray-500">{t('visitedGps')}</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-2 text-center">
                <div className="text-lg font-bold" style={{ color: COLOR_MANUAL }}>
                  {manualCount}
                </div>
                <div className="text-[11px] text-gray-500">{t('adjacentPaint')}</div>
              </div>
            </div>

            {/* 自国が日本：訪れた都道府県・市区町村数＋都道府県内訳 */}
            {isJapanHome && (
              <>
            {/* 訪れた都道府県・市区町村数 */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="text-sm font-bold text-gray-900">
                  {stats ? stats.prefVisited : 0}
                  <span className="text-xs font-normal text-gray-400"> / {TOTAL_PREFS}</span>
                </div>
                <div className="text-[11px] text-gray-500">{t('prefVisited')}</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="text-sm font-bold text-gray-900">
                  {stats ? stats.muniVisited : 0}
                </div>
                <div className="text-[11px] text-gray-500">{t('muniVisited')}</div>
              </div>
            </div>

            {/* 日本全体の塗り％ */}
            <div className="mb-4 rounded-lg border border-gray-200 px-3 py-2.5">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-bold text-gray-800">{t('japanWhole')}</span>
                <span className="text-sm text-gray-600">
                  {(() => {
                    const nt = stats?.nationTotal ?? 0;
                    if (nt <= 0) return count === 0 ? '0%' : t('calculating');
                    const pct = (count / nt) * 100;
                    const label =
                      pct > 0 && pct < 0.1 ? '<0.1%' : `${pct < 10 ? pct.toFixed(2) : Math.round(pct)}%`;
                    return (
                      <>
                        <span className="font-bold text-gray-900">{label}</span>
                        <span className="text-gray-400">（{count}/{nt}）</span>
                      </>
                    );
                  })()}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: (() => {
                      const nt = stats?.nationTotal ?? 0;
                      if (nt <= 0) return '0%';
                      const pct = (count / nt) * 100;
                      return `${Math.min(100, Math.max(pct, pct > 0 ? 2 : 0))}%`;
                    })(),
                    background: COLOR_GPS,
                  }}
                />
              </div>
            </div>

            {/* 都道府県ごとの塗り％（多い順） */}
            <h3 className="text-xs font-semibold text-gray-600 mb-2">{t('perPrefTitle')}</h3>
            {stats && stats.prefs.length > 0 ? (
              <ul className="space-y-2">
                {stats.prefs.map((p) => {
                  const pct = p.total > 0 ? (p.painted / p.total) * 100 : 0;
                  const pctLabel =
                    pct > 0 && pct < 0.1 ? '<0.1%' : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
                  return (
                    <li key={p.name}>
                      <button
                        type="button"
                        onClick={() => flyToPref(p.name)}
                        className="w-full text-left -mx-1 px-1 py-0.5 rounded-md hover:bg-gray-100 transition-colors cursor-pointer"
                        title={t('flyToPref')}
                      >
                        <div className="flex items-baseline justify-between text-xs mb-0.5">
                          <span className="font-medium text-gray-800">
                            {lang === 'en' ? prefRomaji(p.name) : p.name}
                          </span>
                          <span className="text-gray-500">
                            {pctLabel}
                            <span className="text-gray-400">（{p.painted}/{p.total}）</span>
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, Math.max(pct, pct > 0 ? 2 : 0))}%`,
                              background: COLOR_GPS,
                            }}
                          />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">
                {count === 0 ? t('noPainted') : t('calcBreakdown')}
              </p>
            )}

            {/* 制覇コレクション（100%塗った市区町村・完全制覇した都道府県）。一番下に表示する。 */}
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-sm font-bold text-amber-800">🏆 {t('conquered')}</span>
                <span className="text-sm font-black text-amber-700 tabular-nums">
                  {stats ? stats.conqueredMunis.length : conqueredCount}
                </span>
              </div>
              {stats && stats.conqueredPrefs.length > 0 && (
                <div className="mb-1.5">
                  <div className="text-[11px] text-amber-700/80">{t('conqueredPref')}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.conqueredPrefs.map((p) => (
                      <span
                        key={p}
                        className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-900"
                      >
                        👑 {lang === 'en' ? prefRomaji(p) : p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {stats && stats.conqueredMunis.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {stats.conqueredMunis.map((m, i) => (
                    <span
                      key={`${m}-${i}`}
                      className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-amber-700/70">{t('noConquered')}</p>
              )}
            </div>
              </>
            )}

            {/* 自国が日本以外：その国の州・県（admin_1）ごとの塗り％（多い順） */}
            {!isJapanHome && (
              <>
                <h3 className="text-xs font-semibold text-gray-600 mb-2">{homeCountryName}</h3>
                {homeStateStats && homeStateStats.states.length > 0 ? (
                  <ul className="space-y-2">
                    {homeStateStats.states.map((s) => {
                      const pct = s.total > 0 ? (s.painted / s.total) * 100 : 0;
                      const pctLabel =
                        pct > 0 && pct < 0.1
                          ? '<0.1%'
                          : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
                      return (
                        <li key={s.rk}>
                          <div className="flex items-baseline justify-between text-xs mb-0.5">
                            <span className="font-medium text-gray-800">{s.name}</span>
                            <span className="text-gray-500">
                              {pctLabel}
                              <span className="text-gray-400">（{s.painted}/{s.total}）</span>
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(pct, pct > 0 ? 2 : 0))}%`,
                                background: COLOR_GPS,
                              }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400">
                    {count === 0 ? t('noPainted') : t('calcBreakdown')}
                  </p>
                )}
              </>
            )}
              </>
            )}

            {/* 世界モード：各国の塗り％（多い順）だけを表示 */}
            {statsView === 'world' && (
              <>
                <h3 className="text-xs font-semibold text-gray-600 mb-2">{t('perCountryTitle')}</h3>
                {worldStats && worldStats.countries.length > 0 ? (
                  <ul className="space-y-2">
                    {worldStats.countries.map((c) => {
                      const pct = c.total > 0 ? (c.painted / c.total) * 100 : 0;
                      const pctLabel =
                        pct > 0 && pct < 0.1
                          ? '<0.1%'
                          : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
                      return (
                        <li key={c.a3}>
                          <div className="flex items-baseline justify-between text-xs mb-0.5">
                            <span className="font-medium text-gray-800">{c.name}</span>
                            <span className="text-gray-500">
                              {pctLabel}
                              <span className="text-gray-400">（{c.painted}/{c.total}）</span>
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(pct, pct > 0 ? 2 : 0))}%`,
                                background: COLOR_GPS,
                              }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400">
                    {count === 0 ? t('noPainted') : t('calcBreakdown')}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ランキング（開発者を除く各種ランキング。右からスライドするパネル） */}
      {rankingsOpen && (
        <div
          className="absolute inset-0 z-10 flex justify-end bg-black/30"
          onClick={() => setRankingsOpen(false)}
        >
          <div
            className="w-80 max-w-[85%] h-full bg-white shadow-xl p-4 overflow-y-auto"
            role="dialog"
            aria-label={t('rankingsTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-800">{t('rankingsTitle')}</h2>
              <button
                type="button"
                aria-label={t('close')}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                onClick={() => setRankingsOpen(false)}
              >
                ×
              </button>
            </div>

            {/* 集計期間（全期間／月間／週間）。塗り由来のランキングにだけ効く。 */}
            <div className="flex rounded-lg bg-gray-100 p-0.5 mb-2 text-xs font-medium select-none">
              {(
                [
                  ['all', t('rankPeriodAll')],
                  ['month', t('rankPeriodMonth')],
                  ['week', t('rankPeriodWeek')],
                ] as [RankingPeriod, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={rankingsPeriod === key}
                  onClick={() => setRankingsPeriod(key)}
                  className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
                    rankingsPeriod === key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ランキングの種類タブ */}
            <div className="flex rounded-lg bg-gray-100 p-0.5 mb-4 text-xs font-medium select-none">
              {(
                [
                  ['painted', t('rankPainted')],
                  ['gps', t('rankGps')],
                  ['muni', t('rankMuni')],
                  ['level', t('rankLevel')],
                ] as [RankingMetric, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={rankingsTab === key}
                  onClick={() => setRankingsTab(key)}
                  className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
                    rankingsTab === key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {rankingsLoading ? (
              <p className="text-xs text-gray-400">{t('rankLoading')}</p>
            ) : (() => {
              const board = rankingsData?.boards?.[rankingsTab];
              const unit =
                rankingsTab === 'muni'
                  ? t('rankUnitMuni')
                  : rankingsTab === 'level'
                    ? ''
                    : t('rankUnitCells');
              const fmt = (v: number) =>
                rankingsTab === 'level'
                  ? `${t('rankUnitLevel')}.${v}`
                  : `${v.toLocaleString()} ${unit}`;
              if (!board || board.top.length === 0) {
                return <p className="text-xs text-gray-400">{t('rankEmpty')}</p>;
              }
              const meInTop = board.me
                ? board.top.some((e) => e.userId === board.me!.userId)
                : false;
              const medal = (rank: number) =>
                rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
              const row = (e: RankingEntry) => {
                const isMe = userId != null && e.userId === userId;
                return (
                  <li
                    key={e.userId}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                      isMe ? 'bg-yellow-50 ring-1 ring-yellow-300' : ''
                    }`}
                  >
                    <span className="w-7 shrink-0 text-center text-sm font-bold text-gray-700 tabular-nums">
                      {medal(e.rank) || e.rank}
                    </span>
                    <span className="flex-1 truncate text-sm text-gray-800">
                      {e.name}
                      {isMe && (
                        <span className="ml-1 text-[10px] text-yellow-600">
                          （{t('rankYou')}）
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-gray-900 tabular-nums">
                      {fmt(e.value)}
                    </span>
                  </li>
                );
              };
              return (
                <>
                  {rankingsTab === 'level' && rankingsPeriod !== 'all' && (
                    <p className="mb-2 text-[11px] text-gray-400">
                      {t('rankLevelAllOnly')}
                    </p>
                  )}
                  <ul className="space-y-0.5">{board.top.map(row)}</ul>
                  {board.me && !meInTop && (
                    <div className="mt-3 border-t border-gray-100 pt-2">
                      <ul className="space-y-0.5">{row(board.me)}</ul>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
