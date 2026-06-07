'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useSession } from '@/lib/auth-client';
import { logEvent, setLastKnownLocation } from '@/lib/userlog';
import { RUN_MODE, RUN_MODE_LABEL, RUN_MODE_BADGE } from '@/lib/runtime-env';
import { useLocale, type Lang, type TFunc } from '@/lib/i18n';
import { kanaToRomaji, prefRomaji } from '@/lib/romaji';

const PAINT_API = '/api/backend/painted';
const POINTS_API = '/api/backend/points';
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

// 動画リワード：モック動画の長さ（秒）。視聴完了するとサーバーへ報酬を請求する。
// 実広告SDK導入時は、この秒数カウントの代わりに広告の完了コールバックで請求する。
const VIDEO_REWARD_DURATION_SEC = 10;

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
// それより引いた状態では市区町村の白地図として見せる。
const MESH_MIN_ZOOM = 10;

// 塗った箇所を描く painted-overlay の表示開始ズーム（mesh はベイクしないので全ズーム
// この1レイヤーが塗りの色付けを担う）。これ未満は塗りも非表示。
const PAINTED_OVERLAY_MIN_ZOOM = 6;

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
async function searchJapan(query: string): Promise<SearchHit[]> {
  try {
    const res = await fetch(`${GEOCODE_URL}?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as GeocodeResult[];
    if (!Array.isArray(data)) return [];
    return data.map((r) => ({
      title: r.properties.title,
      lng: r.geometry.coordinates[0],
      lat: r.geometry.coordinates[1],
      scope: 'jp' as const,
    }));
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

type PaintedState = Record<string, PaintMode>;

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
  const [videoOpen, setVideoOpen] = useState(false); // モック動画モーダルの表示
  // 'watching'=再生中（カウントダウン）/ 'claiming'=報酬請求中 / 'error'=請求失敗
  const [videoPhase, setVideoPhase] = useState<'watching' | 'claiming' | 'error'>(
    'watching'
  );
  const [videoLeftSec, setVideoLeftSec] = useState(VIDEO_REWARD_DURATION_SEC);
  const videoTimerRef = useRef<number | null>(null);
  // 市区町村ごとの塗り％表示用
  const [hoverStat, setHoverStat] = useState<string | null>(null); // ホバー中市区町村の「市名 35%（n/N）」
  // 塗ったセルの CELLID → "PREF|CITY"。塗り時に求めた値を保持し、復元時は backend の
  // municipality 列から埋める。mesh をベイクしなくなったので「全セルの cell→市」表は持たない。
  const muniByPaintedCellRef = useRef<Map<number, string>>(new Map());
  const totalByMuniRef = useRef<Map<string, number>>(new Map()); // "PREF|CITY" → 総セル数（分母）
  const paintedByMuniRef = useRef<Map<string, number>>(new Map()); // "PREF|CITY" → 塗ったセル数（分子）
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
  // 塗り方の操作モード。genchi=現地塗り（GPSの現在地のみ自動で塗る）/
  // tonari=となり塗り（マウスで隣接セルを塗れる）。GPS自動塗りは両モード共通。
  // map init effect 内のクリックハンドラから同期参照するため ref も持つ。
  const [paintMode, setPaintMode] = useState<'genchi' | 'tonari'>('genchi');
  const paintModeRef = useRef<'genchi' | 'tonari'>('genchi');
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
  const openDebugRef = useRef<() => void>(() => {});
  // データ詳細（右からスライドするパネル）。自分の塗り実績を集計して見せる。
  const [statsOpen, setStatsOpen] = useState(false);
  const openStatsRef = useRef<() => void>(() => {});
  const { data: session, isPending } = useSession();
  // 言語（ゲーム画面の用語・地名のローマ字表示）。effect 内の同期参照用に ref も持つ。
  const { t, lang } = useLocale();
  const tRef = useRef<TFunc>(t);
  tRef.current = t;
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;
  const userId = session?.user?.id ?? null;
  const userIdRef = useRef<string | null>(null);
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

  // モック動画モーダルを開いて視聴カウントダウンを開始する。
  const openVideoReward = useCallback(() => {
    if (!userIdRef.current) {
      showToast(tRef.current('needLoginVideo'));
      return;
    }
    setVideoPhase('watching');
    setVideoLeftSec(VIDEO_REWARD_DURATION_SEC);
    setVideoOpen(true);
  }, []);

  // モーダルを閉じてカウントダウンタイマーを止める。
  const closeVideoReward = useCallback(() => {
    if (videoTimerRef.current !== null) {
      window.clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }
    setVideoOpen(false);
  }, []);

  // 視聴完了後にサーバーへ報酬を請求し、残高に反映する。
  // クールダウン中・1日上限（429）は理由をトーストで知らせる。
  const claimVideoReward = useCallback(async () => {
    setVideoPhase('claiming');
    try {
      const res = await fetch(`${POINTS_API}/reward/video`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => null)) as
        | { points?: ServerPoints; granted?: number; status?: VideoRewardStatus }
        | { error?: string; status?: VideoRewardStatus }
        | null;
      if (!res.ok) {
        if (data?.status) setRewardStatus(data.status);
        const reason = (data as { error?: string } | null)?.error;
        showToast(
          reason === 'cooldown'
            ? tRef.current('videoNotYet')
            : reason === 'daily_limit'
              ? tRef.current('rewardDailyLimit')
              : tRef.current('recoverFailed')
        );
        closeVideoReward();
        return;
      }
      const ok = data as { points?: ServerPoints; granted?: number; status?: VideoRewardStatus };
      if (ok.points) applyServerPoints(ok.points);
      if (ok.status) setRewardStatus(ok.status);
      closeVideoReward();
      showToast(tRef.current('recovered', (ok.granted ?? 0) as never));
    } catch (err) {
      console.warn('failed to claim video reward', err);
      setVideoPhase('error');
    }
  }, [applyServerPoints, closeVideoReward]);

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

  useEffect(() => {
    paintModeRef.current = paintMode;
    // 現在地の住所ラベルは現地塗りモード専用。となり塗りに切り替えたら消す。
    if (paintMode !== 'genchi') {
      addressMarkerRef.current?.remove();
      addressMarkerRef.current = null;
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

  // モック動画の視聴カウントダウン。0 になったら自動で報酬を請求する。
  useEffect(() => {
    if (!videoOpen || videoPhase !== 'watching') return;
    videoTimerRef.current = window.setInterval(() => {
      setVideoLeftSec((s) => {
        if (s <= 1) {
          if (videoTimerRef.current !== null) {
            window.clearInterval(videoTimerRef.current);
            videoTimerRef.current = null;
          }
          claimVideoReward();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (videoTimerRef.current !== null) {
        window.clearInterval(videoTimerRef.current);
        videoTimerRef.current = null;
      }
    };
  }, [videoOpen, videoPhase, claimVideoReward]);

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
  }, [refreshHoverStat]);

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
    muniByPaintedCellRef.current = new Map();
    paintedByMuniRef.current = new Map();
    regionByPaintedCellRef.current = new Map();
    paintedByStateRef.current = new Map();
    paintedByCountryRef.current = new Map();
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
  }, [refreshHoverStat]);

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

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    });
    map.addControl(geolocate, 'top-right');

    // 位置情報アイコンの下に虫眼鏡（地名検索）ボタンを積む
    map.addControl(new SearchControl(() => openSearchRef.current()), 'top-right');

    // 検索ボタンの下にデータ詳細（棒グラフ）ボタンを積む
    map.addControl(new StatsControl(() => openStatsRef.current()), 'top-right');

    // デバッグメニュー（レンチ）は開発者のみ表示。下の useEffect で権限に応じて付け外しする。

    map.on('zoom', () => {
      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = map.getZoom().toFixed(1);
      }
    });

    map.on('load', () => {
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
      // 国境（国どうしの境界線・州境より濃く太く）。
      map.addLayer({
        id: 'world-countries-outline',
        type: 'line',
        source: 'world',
        'source-layer': 'countries',
        paint: { 'line-color': '#a8a89f', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.2] },
      });
      // 国名ラベル（日本語名・無ければ英名）。
      map.addLayer({
        id: 'world-countries-label',
        type: 'symbol',
        source: 'world',
        'source-layer': 'countries',
        layout: {
          'text-field': ['coalesce', ['get', 'NAME_JA'], ['get', 'NAME']],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 14],
          'text-font': ['Open Sans Regular'],
          'text-max-width': 6,
          'symbol-placement': 'point',
        },
        paint: {
          'text-color': '#6b6b63',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
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
          'text-field': ['coalesce', ['get', 'name_ja'], ['get', 'name']],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9, 9, 12],
          'text-font': ['Open Sans Regular'],
          'text-max-width': 6,
          'symbol-placement': 'point',
        },
        paint: {
          'text-color': '#8a8a80',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
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
          'line-width': ['step', ['zoom'], 0.6, 9, 1.2],
        },
      });

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
          'fill-opacity': 0.85,
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
          'line-color': '#7dd3fc',
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

      // 都道府県境界（赤の太線・全ズームレベルで表示）。塗りの上に重ねる。
      map.addLayer({
        id: 'prefectures-border',
        type: 'line',
        source: 'prefectures-geojson',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#e03131', 'line-width': 2.5 },
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
      // 市区町村ポリゴンに対しグリッドセル中心を点内外判定して陸地セルを割り出す。
      // 格子描画（海上は出さない）と海越え隣接判定の両方でこれを使う。
      const collectVisibleLand = () => {
        const set = new Set<number>();
        const munis = map.queryRenderedFeatures({ layers: ['municipalities-fill'] });
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
      // 市区町村タイルが遅れて読み込まれた時も格子を埋め直す（自前ソースの更新では発火しない）
      map.on('sourcedata', (e) => {
        if (e.sourceId === 'japan' && e.isSourceLoaded && map.getZoom() >= MESH_MIN_ZOOM) {
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

      // ホバー住所のキャッシュ（CELLID→町丁目入り住所）と逆ジオコーダのデバウンス
      const hoverAddrCache = new Map<number, string>();
      let hoverGeocodeTimer: number | null = null;
      let hoverId: number | null = null;

      const clearHover = () => {
        if (hoverId === null) return;
        hoverId = null;
        meshHoverSrc()?.setData(EMPTY_FC);
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
        meshHoverSrc()?.setData({ type: 'FeatureCollection', features: [cellFeature(id)] });
        map.getCanvas().style.cursor = 'pointer';
        hoverKeyRef.current = muniKey;
        hoverRegionRef.current = region?.key ?? null;
        refreshHoverStat();
        const cached = hoverAddrCache.get(id);
        onHoverAddressChangeRef.current?.(cached ?? address);
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
              if (hoverId === id && full) onHoverAddressChangeRef.current?.(full);
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
              const result = commitLocalPaint(id, 'manual', info?.key ?? null, region, info?.address ?? region?.address ?? '', true);
              if (result !== 'skip') syncPaint('POST', id, 'manual', region?.key ?? null);
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
        regionKey?: string | null
      ) => {
        if (!userIdRef.current) return;
        // POST のときは塗った位置の文脈（セル中心の緯度経度・市区町村・州県コード）を添える。
        // ip/ua はサーバー側で取得する。DELETE には付けない。
        const ctx: { lat?: number; lng?: number; municipality?: string | null; region?: string | null } = {};
        if (method === 'POST') {
          const [ri, ci] = gridFromMeshCode(id);
          ctx.lat = (ri + 0.5) / MESH_LAT_DIV;
          ctx.lng = (ci + 0.5) / MESH_LON_DIV;
          ctx.municipality = muniKeyFor(id);
          ctx.region = regionKey ?? regionByPaintedCellRef.current.get(id) ?? null;
        }
        fetch(PAINT_API, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceLayer: 'mesh', keyCode: String(id), mode, ...ctx }),
        })
          .then(async (res) => {
            // POST（GPS塗り・なぞり塗り）はサーバーが経験値・レベルを返す。反映してレベルアップ演出も出す。
            if (method !== 'POST' || !res.ok) return;
            const data = (await res.json().catch(() => null)) as {
              points?: ServerPoints;
            } | null;
            if (data?.points) applyServerPoints(data.points);
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
        silent = false
      ): 'new' | 'promoted' | 'skip' => {
        const key = `mesh:${id}`;
        const current = paintedRef.current;
        const existing = current[key];
        if (existing === mode) return 'skip'; // 変化なし
        if (existing === 'gps' && mode === 'manual') return 'skip'; // 降格は禁止

        paintedRef.current = { ...current, [key]: mode };
        setPainted(paintedRef.current);

        if (!existing) {
          if (!silent && address) showToast(address);
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
        if (result !== 'skip') syncPaint('POST', id, mode, region?.key ?? null);
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
        cost: number
      ) => {
        if (!userIdRef.current) {
          showToast(tRef.current('needLoginPaint'));
          return;
        }
        if (commitLocalPaint(id, 'manual', muniKey, region, address) === 'skip') return;

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
        const info = muniInfoAt(e.point);
        const region = stateInfoAt(e.point);
        if (!info && !region) return null; // 海上など陸地でない
        return {
          id: meshCodeAt(e.lngLat.lng, e.lngLat.lat),
          muniKey: info?.key ?? null,
          region: region ? { key: region.key, a3: region.a3 } : null,
          address: info?.address ?? region?.address ?? '',
        };
      };

      map.on('click', (e) => {
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
        const cost = freeDebug ? 0 : isAdjacent(id) ? COST_ADJACENT : COST_FAR;
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
      const paintGpsAt = (lngLat: [number, number]) => {
        const id = meshCodeAt(lngLat[0], lngLat[1]);
        // 市区町村キー（塗り％用）は表示中なら municipalities から拾う。ズームが浅い／
        // 画面外なら null（GPS塗り自体は数式で成立するのでセルは塗れる）。
        let muniKey: string | null = null;
        let region: { key: string; a3: string } | null = null;
        if (map.getZoom() >= MESH_MIN_ZOOM) {
          const pt = map.project(lngLat);
          muniKey = muniInfoAt(pt)?.key ?? null;
          const st = stateInfoAt(pt);
          region = st ? { key: st.key, a3: st.a3 } : null;
        }
        applyPaint(id, 'gps', muniKey, region);
        // 現地塗りモードでは、グリッド内の近似住所ではなく現在地の正確な住所を表示する。
        // 同じメッシュセル内では再取得しない（移動して別セルに入った時だけ問い合わせる）。
        if (paintModeRef.current === 'genchi' && id !== lastGeocodedId) {
          lastGeocodedId = id;
          reverseGeocode(lngLat[0], lngLat[1]).then((address) => {
            // 取得待ちの間に別セルへ移動していたら反映しない（古い結果の上書き防止）
            if (address && lastGeocodedId === id) {
              showCurrentAddress(lngLat, address);
            }
          });
        }
      };
      let firstGpsLogged = false;
      geolocate.on('geolocate', (pos: GeolocationPosition) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        paintGpsAt([lng, lat]);
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
    return () => {
      cancelled = true;
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
        }
        paintedRef.current = next;
        setPainted(next);
        rebuildPaintedByMuni(); // 復元した塗りを市区町村ごとに集計し直す
        rebuildPaintedByRegion(); // 同じく州・県／国ごとに集計し直す
      } catch (err) {
        console.warn('failed to load painted regions', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, isPending, mapReady, refreshHoverStat, rebuildPaintedByMuni, rebuildPaintedByRegion]);

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
    applyLabelStats();
    refreshHoverStat();
  }, [lang, mapReady, applyLabelStats, refreshHoverStat]);

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
        return {
          prefVisited: paintedByPref.size,
          muniVisited: visitedMuni.size,
          nationTotal,
          prefs,
        };
      })()
    : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* 塗り方モード切り替え（左上・タイトルバーの下）。
          現地塗り＝GPSの現在地のみ自動で塗る / となり塗り＝マウスで隣接セルを塗れる。 */}
      <div className="absolute top-4 left-4 flex rounded-lg shadow overflow-hidden text-sm font-medium select-none">
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
              {/* 動画リワード：動画を見てそのレベルの満タン分を回復 */}
              {(() => {
                const cooldownLeft =
                  rewardStatus?.nextAvailableAt != null
                    ? rewardStatus.nextAvailableAt - nowTick
                    : 0;
                const onCooldown = cooldownLeft > 0;
                const dailyLimit =
                  rewardStatus != null && rewardStatus.remainingToday <= 0;
                const disabled = onCooldown || dailyLimit;
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
          なぞり塗りモード（マウスオーバーで塗る / タップで解除）
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
      {videoOpen && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/50"
          // 視聴中は背景クリックで閉じさせない（最後まで見せる）。請求中も閉じない。
        >
          <div
            className="w-[90%] max-w-md rounded-xl bg-white p-5 shadow-xl"
            role="dialog"
            aria-label={t('videoTitle')}
          >
            <h2 className="mb-3 text-sm font-semibold text-gray-800">
              {t('videoTitle')}
            </h2>
            {/* モック動画プレースホルダ（実広告SDK導入時はここを差し替える） */}
            <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-gray-900">
              <span className="text-5xl text-white/80">▶</span>
              <span className="absolute bottom-2 right-3 rounded bg-black/60 px-2 py-0.5 text-xs font-mono text-white">
                {videoPhase === 'watching'
                  ? `00:${String(videoLeftSec).padStart(2, '0')}`
                  : '00:00'}
              </span>
              <span className="absolute left-3 top-2 rounded bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white">
                {t('videoAdSample')}
              </span>
            </div>
            {/* 進捗バー */}
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                style={{
                  width: `${
                    ((VIDEO_REWARD_DURATION_SEC - videoLeftSec) /
                      VIDEO_REWARD_DURATION_SEC) *
                    100
                  }%`,
                }}
              />
            </div>
            <div className="mt-3 text-center text-sm text-gray-600">
              {videoPhase === 'watching' &&
                t('videoWatching', videoLeftSec as never)}
              {videoPhase === 'claiming' && t('videoClaiming')}
              {videoPhase === 'error' && (
                <span className="text-red-600">
                  {t('videoError')}
                </span>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {videoPhase === 'error' ? (
                <>
                  <button
                    type="button"
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                    onClick={closeVideoReward}
                  >
                    {t('close')}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
                    onClick={claimVideoReward}
                  >
                    {t('retry')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                  onClick={closeVideoReward}
                  disabled={videoPhase === 'claiming'}
                >
                  {videoPhase === 'watching' ? t('stop') : t('close')}
                </button>
              )}
            </div>
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
                {hoverPaintMode ? 'なぞり塗りを解除する' : 'マウスオーバーで塗るモード'}
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
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">
                {count === 0 ? t('noPainted') : t('calcBreakdown')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
