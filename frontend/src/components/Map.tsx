'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useSession } from '@/lib/auth-client';

const PAINT_API = '/api/backend/painted';
const POINTS_API = '/api/backend/points';
// 市区町村ごとの総メッシュ数（塗り％の分母）と meshcode→市区町村 の対応表。
// 約37万セル分を含むため map 表示後に遅延ロードする（build-muni-stats.mjs が生成）。
const MUNI_STATS_URL = '/data/muni-stats.json';

// ── 塗りポイント（GPS移動は無料・それ以外の塗りはポイント消費） ──────────
// ※サーバー側（backend/src/lib/points.ts）と値を揃えること。今後バランス調整予定。
const MAX_PAINT_POINTS = 50; // 時間回復の上限（初期値10より多い固定値）。デバッグ等でこれを超える残高は許容する。
const REGEN_INTERVAL_MS = 60 * 60 * 1000; // 1時間で1ポイント回復
const COST_ADJACENT = 1; // 塗り済みに隣接する場所
const COST_FAR = 10; // 離れた場所（確認ダイアログ付き）

// 「+1まで mm:ss」表示用
function formatCountdown(ms: number): string {
  if (ms <= 0) return 'まもなく';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 塗り方モード。gps = 実際に訪問（最優先・黄）、manual = マウスで隣接塗り（茶）
type PaintMode = 'gps' | 'manual';

const COLOR_GPS = '#facc15'; // 黄色（一番強い）
const COLOR_MANUAL = '#a0522d'; // 茶色

const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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

// 塗った箇所を低ズーム（メッシュタイルが無い範囲）でも見せるための
// オーバーレイ表示開始ズーム。MESH_MIN_ZOOM 未満はオーバーレイ、以上は mesh-fill が担当。
const PAINTED_OVERLAY_MIN_ZOOM = 6;

// 約1kmの3次地域メッシュ = 緯度 1/120°・経度 1/80° の均一グリッド
const MESH_LAT_DIV = 120;
const MESH_LON_DIV = 80;

// グリッド整数 (ri, ci) → 8桁地域メッシュコード（数値ID）
function meshCodeFromGrid(ri: number, ci: number): number {
  const p = Math.floor(ri / 80);
  const q = Math.floor((ri - p * 80) / 10);
  const r = ri - p * 80 - q * 10;
  const uu = Math.floor(ci / 80);
  const u = uu - 100;
  const v = Math.floor((ci - uu * 80) / 10);
  const w = ci - uu * 80 - v * 10;
  return Number(`${p}${u}${q}${v}${r}${w}`);
}

// 経度・緯度 → メッシュコード（数値ID）
function meshCodeAt(lng: number, lat: number): number {
  const ri = Math.floor(lat * MESH_LAT_DIV);
  const ci = Math.floor(lng * MESH_LON_DIV);
  return meshCodeFromGrid(ri, ci);
}

// メッシュコード（数値ID）→ グリッド整数 [ri, ci]
function gridFromMeshCode(code: number): [number, number] {
  const s = String(code).padStart(8, '0');
  const p = Number(s.slice(0, 2));
  const u = Number(s.slice(2, 4));
  const q = Number(s[4]);
  const v = Number(s[5]);
  const r = Number(s[6]);
  const w = Number(s[7]);
  return [p * 80 + q * 10 + r, (u + 100) * 80 + v * 10 + w];
}

// メッシュコード（数値ID）→ セルの矩形ポリゴンの外周リング（[lng,lat] の5点）
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

// 国土地理院の住所検索API（キー不要・日本の地名/住所→経緯度）
const GEOCODE_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';

type GeocodeResult = {
  geometry: { coordinates: [number, number]; type: 'Point' };
  properties: { title: string };
};

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

function formatAddress(
  sourceLayer: string,
  properties: Record<string, unknown> | null | undefined
): string {
  if (!properties) return '';
  const get = (k: string) => {
    const v = properties[k];
    return typeof v === 'string' ? v : '';
  };
  if (sourceLayer === 'municipalities') {
    return [get('N03_001'), get('N03_004'), get('N03_005')].filter(Boolean).join('');
  }
  if (sourceLayer === 'mesh') {
    return [get('PREF_NAME'), get('CITY_NAME'), get('S_NAME')].filter(Boolean).join('');
  }
  return '';
}

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
  // 塗りポイント（ログインユーザーのみ）。ref は塗りハンドラ内から同期参照する。
  const [points, setPoints] = useState(0);
  const [regenAt, setRegenAt] = useState<number | null>(null); // 次の回復時刻(ms) / 満タンなら null
  const pointsRef = useRef(0);
  const regenAtRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now()); // カウントダウン再描画用
  // 離れた場所（10ポイント）の確認ダイアログ。map init の外（JSX）から確定させる。
  const [confirmPaint, setConfirmPaint] = useState<{
    id: number;
    cost: number;
    properties: Record<string, unknown> | null;
  } | null>(null);
  const doManualPaintRef = useRef<
    (id: number, properties: Record<string, unknown> | null, cost: number) => void
  >(() => {});
  // 市区町村ごとの塗り％表示用
  const [hoverStat, setHoverStat] = useState<string | null>(null); // ホバー中市区町村の「市名 35%（n/N）」
  const muniByMeshRef = useRef<Map<number, string> | null>(null); // meshcode → "PREF|CITY"
  const totalByMuniRef = useRef<Map<string, number>>(new Map()); // "PREF|CITY" → 総セル数（分母）
  const paintedByMuniRef = useRef<Map<string, number>>(new Map()); // "PREF|CITY" → 塗ったセル数（分子）
  const hoverKeyRef = useRef<string | null>(null); // 現在ホバー中の市区町村キー
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
  const debugCleanupRef = useRef<(() => void) | null>(null);
  // 地名検索ダイアログ
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // カスタムコントロール（map init effect）から最新の open ハンドラを呼ぶための ref
  const openSearchRef = useRef<() => void>(() => {});
  // デバッグメニュー（右からスライドするパネル）
  const [debugOpen, setDebugOpen] = useState(false);
  const openDebugRef = useRef<() => void>(() => {});
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id ?? null;
  const userIdRef = useRef<string | null>(null);

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

  // 塗りポイントの残高を ref と state の両方へ反映（ハンドラからの同期参照用 + 表示用）
  const applyPointsState = useCallback((p: number, nextRegenAt: number | null) => {
    pointsRef.current = p;
    regenAtRef.current = nextRegenAt;
    setPoints(p);
    setRegenAt(nextRegenAt);
  }, []);

  // 離れた場所（10ポイント）の確認ダイアログで「塗る」を押したとき
  const confirmFarPaint = useCallback(() => {
    setConfirmPaint((pending) => {
      if (pending) {
        doManualPaintRef.current(pending.id, pending.properties, pending.cost);
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
        const data = (await res.json()) as { points: number; regenAt: number | null };
        applyPointsState(data.points, data.regenAt);
        showToast(`塗りポイントを ${data.points} にしました`);
      } catch (err) {
        console.warn('failed to set debug points', err);
        showToast('ポイントの変更に失敗しました');
      }
    },
    [applyPointsState]
  );

  // 地名/住所を検索（国土地理院API）
  const runSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (!query) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const res = await fetch(`${GEOCODE_URL}?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GeocodeResult[];
      if (!Array.isArray(data) || data.length === 0) {
        setSearchError('見つかりませんでした');
        return;
      }
      setSearchResults(data.slice(0, 10));
    } catch (err) {
      console.warn('geocode failed', err);
      setSearchError('検索に失敗しました');
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // 検索結果の地点へ移動（メッシュが見える zoom 12 まで寄せる）
  const flyToResult = useCallback((r: GeocodeResult) => {
    const map = mapRef.current;
    if (!map) return;
    const [lng, lat] = r.geometry.coordinates;
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
    };
  }, []);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // ログイン時に塗りポイント残高を取得。ログアウト時は 0 にリセット。
  useEffect(() => {
    if (!userId) {
      applyPointsState(0, null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(POINTS_API, { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as { points: number; regenAt: number | null };
        if (cancelled) return;
        applyPointsState(data.points, data.regenAt);
      } catch (err) {
        console.warn('failed to load paint points', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, applyPointsState]);

  // 塗りポイントの時間回復（クライアント側）。1秒ごとに回復時刻を過ぎていれば加算し、
  // カウントダウン表示用に nowTick も更新する。サーバーが権威なので塗り時に再同期される。
  useEffect(() => {
    if (!userId) return;
    const iv = window.setInterval(() => {
      const now = Date.now();
      let r = regenAtRef.current;
      if (r !== null && now >= r) {
        let p = pointsRef.current;
        while (r !== null && now >= r && p < MAX_PAINT_POINTS) {
          p += 1;
          r = p >= MAX_PAINT_POINTS ? null : r + REGEN_INTERVAL_MS;
        }
        applyPointsState(p, r);
      }
      setNowTick(now);
    }, 1000);
    return () => window.clearInterval(iv);
  }, [userId, applyPointsState]);

  useEffect(() => {
    onHoverAddressChangeRef.current = onHoverAddressChange;
  }, [onHoverAddressChange]);

  // meshcode の所属市区町村キー（"PREF|CITY"）を求める。
  // タイル由来の properties があればそれを優先し、無ければロード済みの対応表を引く。
  const muniKeyFor = useCallback(
    (id: number, properties?: Record<string, unknown> | null): string | null => {
      if (properties) {
        const pref = typeof properties.PREF_NAME === 'string' ? properties.PREF_NAME : '';
        const city = typeof properties.CITY_NAME === 'string' ? properties.CITY_NAME : '';
        if (city) return `${pref}|${city}`;
      }
      return muniByMeshRef.current?.get(id) ?? null;
    },
    []
  );

  // ホバー中市区町村の塗り％を組み立てて state に反映
  const refreshHoverStat = useCallback(() => {
    const key = hoverKeyRef.current;
    if (!key) {
      setHoverStat(null);
      return;
    }
    const city = key.split('|')[1] || key;
    const total = totalByMuniRef.current.get(key);
    if (total === undefined) {
      // 統計ファイル未ロード or 対象外
      setHoverStat(totalByMuniRef.current.size === 0 ? `${city}：計測中…` : null);
      return;
    }
    const paintedCount = paintedByMuniRef.current.get(key) ?? 0;
    const pct = total > 0 ? Math.round((paintedCount / total) * 100) : 0;
    setHoverStat(`${city}　${pct}%（${paintedCount}/${total}）`);
  }, []);

  // 塗り状態から市区町村ごとの塗りセル数を作り直す（対応表ロード時・DB復元時に呼ぶ）
  const rebuildPaintedByMuni = useCallback(() => {
    const counts = new Map<string, number>();
    const lookup = muniByMeshRef.current;
    if (lookup) {
      for (const key of Object.keys(paintedRef.current)) {
        const [layer, idStr] = key.split(':');
        if (layer !== 'mesh') continue;
        const muni = lookup.get(Number(idStr));
        if (!muni) continue;
        counts.set(muni, (counts.get(muni) ?? 0) + 1);
      }
    }
    paintedByMuniRef.current = counts;
    refreshHoverStat();
  }, [refreshHoverStat]);

  // ラベル（市区町村・政令市・都道府県）のテキストに塗り％を差し込んで再描画する。
  // 市区町村キー（"PREF|CITY"）の総数・塗り数を走査して、政令市・都道府県は合算する。
  const applyLabelStats = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
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
        const name = (p.N03_005 as string) || (p.N03_004 as string) || '';
        const key = `${p.N03_001 ?? ''}|${p.N03_004 ?? ''}${p.N03_005 ?? ''}`;
        const total = totals.get(key);
        const painted = paintedC.get(key) ?? 0;
        f.properties = {
          ...p,
          nm: name + (hasStats && total ? pctSuffix(painted, total) : ''),
          ym: yomiLine(kanaByCodeRef.current[p.N03_007 as string]),
        };
      }
      (map.getSource('muni-labels') as maplibregl.GeoJSONSource | undefined)?.setData(muniFC);
    }

    // 政令指定都市ラベル（市全体＝配下の区の合算）
    const cityFC = cityLabelFCRef.current;
    if (cityFC) {
      for (const f of cityFC.features) {
        const p = f.properties ?? {};
        const name = (p.N03_004 as string) || '';
        const cp = `${p.N03_001 ?? ''}|${p.N03_004 ?? ''}`;
        const agg = cityAgg.get(cp);
        f.properties = {
          ...p,
          nm: name + (hasStats && agg ? pctSuffix(agg[0], agg[1]) : ''),
          ym: yomiLine(kanaByCityRef.current[cp]),
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
        f.properties = {
          ...p,
          lbl: name + (hasStats && agg ? pctSuffix(agg[0], agg[1]) : ''),
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

    // さらにその下にデバッグメニュー（レンチ）ボタンを積む
    map.addControl(new DebugControl(() => openDebugRef.current()), 'top-right');

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

      // 塗りオーバーレイ（低ズーム用）。塗ったセルをクライアント生成の矩形で描く。
      // mesh タイルが無い zoom 6〜MESH_MIN_ZOOM の範囲だけ表示し、以降は mesh-fill に任せる。
      map.addSource('painted-overlay', {
        type: 'geojson',
        data: buildPaintedOverlay(paintedRef.current),
      });
      map.addLayer({
        id: 'painted-overlay-fill',
        type: 'fill',
        source: 'painted-overlay',
        minzoom: PAINTED_OVERLAY_MIN_ZOOM,
        maxzoom: MESH_MIN_ZOOM,
        paint: {
          'fill-color': ['match', ['get', 'mode'], 'gps', COLOR_GPS, 'manual', COLOR_MANUAL, '#ffffff'],
          'fill-opacity': 0.85,
        },
      });

      // メッシュフィル（塗りの単位）。塗ったセルだけ色を出し、未塗りは透明。
      map.addLayer({
        id: 'mesh-fill',
        type: 'fill',
        source: 'japan',
        'source-layer': 'mesh',
        minzoom: MESH_MIN_ZOOM,
        paint: {
          'fill-color': [
            'case',
            ['==', ['feature-state', 'mode'], 'gps'], COLOR_GPS,
            ['==', ['feature-state', 'mode'], 'manual'], COLOR_MANUAL,
            '#ffffff',
          ],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'painted'], false], 0.85, 0],
        },
      });

      // 1kmメッシュの格子線。ズーム9から表示し、寄るほどはっきりさせる
      map.addLayer({
        id: 'mesh-border',
        type: 'line',
        source: 'japan',
        'source-layer': 'mesh',
        minzoom: 9,
        paint: {
          'line-color': '#7dd3fc',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.3, 13, 0.6],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 12, 0.7],
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

      // ホバーレイヤー（メッシュ）
      map.addLayer({
        id: 'mesh-hover',
        type: 'fill',
        source: 'japan',
        'source-layer': 'mesh',
        minzoom: MESH_MIN_ZOOM,
        paint: {
          'fill-color': '#000000',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.12, 0],
        },
      });

      // ── インタラクション ────────────────────────
      let hovered: { source: string; id: string | number; sourceLayer: string } | null = null;

      const clearHover = () => {
        if (hovered) {
          map.setFeatureState(
            { source: hovered.source, sourceLayer: hovered.sourceLayer, id: hovered.id },
            { hover: false }
          );
          hovered = null;
          onHoverAddressChangeRef.current?.('');
          hoverKeyRef.current = null;
          refreshHoverStat();
        }
      };

      const setHover = (
        source: string,
        sourceLayer: string,
        id: string | number,
        properties: Record<string, unknown> | null | undefined
      ) => {
        if (hovered?.id === id && hovered?.sourceLayer === sourceLayer) return;
        clearHover();
        map.setFeatureState({ source, sourceLayer, id }, { hover: true });
        hovered = { source, sourceLayer, id };
        map.getCanvas().style.cursor = 'pointer';
        onHoverAddressChangeRef.current?.(formatAddress(sourceLayer, properties));
        // ホバー中市区町村の塗り％を更新（メッシュのみ）
        hoverKeyRef.current =
          sourceLayer === 'mesh' ? muniKeyFor(Number(id), properties) : null;
        refreshHoverStat();
      };

      map.on('mousemove', (e) => {
        if (map.getZoom() >= MESH_MIN_ZOOM) {
          const mesh = map.queryRenderedFeatures(e.point, { layers: ['mesh-fill'] });
          if (mesh.length > 0 && mesh[0].id !== undefined) {
            setHover('japan', 'mesh', mesh[0].id as number, mesh[0].properties);
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
        sourceLayer: string,
        id: string | number,
        mode?: PaintMode
      ) => {
        if (!userIdRef.current) return;
        fetch(PAINT_API, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceLayer, keyCode: String(id), mode }),
        }).catch((err) => {
          console.warn('failed to sync painted region', err);
        });
      };

      // 指定モードでローカル（地図 + state）にだけ塗る。サーバー同期はしない。
      // 優先度 gps > manual（manual は gps を上書きしない）。戻り値で塗りの結果を返す。
      const commitLocalPaint = (
        source: string,
        sourceLayer: string,
        id: string | number,
        mode: PaintMode,
        properties?: Record<string, unknown> | null
      ): 'new' | 'promoted' | 'skip' => {
        const key = `${sourceLayer}:${id}`;
        const current = paintedRef.current;
        const existing = current[key];
        if (existing === mode) return 'skip'; // 変化なし
        if (existing === 'gps' && mode === 'manual') return 'skip'; // 降格は禁止

        map.setFeatureState({ source, sourceLayer, id }, { painted: true, mode });
        paintedRef.current = { ...current, [key]: mode };
        setPainted(paintedRef.current);

        if (!existing) {
          showToast(formatAddress(sourceLayer, properties));
          // 新規セルのみ市区町村カウントを +1（gps への昇格では増やさない）
          if (sourceLayer === 'mesh') {
            const muni = muniKeyFor(Number(id), properties);
            if (muni) {
              paintedByMuniRef.current.set(muni, (paintedByMuniRef.current.get(muni) ?? 0) + 1);
              refreshHoverStat();
            }
          }
        }
        return existing ? 'promoted' : 'new';
      };

      // GPS（実際の移動）塗り。無料なのでローカル反映＋同期のみ。
      const applyPaint = (
        source: string,
        sourceLayer: string,
        id: string | number,
        mode: PaintMode,
        properties?: Record<string, unknown> | null
      ) => {
        const result = commitLocalPaint(source, sourceLayer, id, mode, properties);
        if (result !== 'skip') syncPaint('POST', sourceLayer, id, mode);
      };

      // ローカルの塗りを取り消す（地図 + state のみ。サーバー同期はしない）
      const removeLocalPaint = (source: string, sourceLayer: string, id: string | number) => {
        const key = `${sourceLayer}:${id}`;
        const current = paintedRef.current;
        if (!current[key]) return false;
        map.setFeatureState({ source, sourceLayer, id }, { painted: false, mode: null });
        const next = { ...current };
        delete next[key];
        paintedRef.current = next;
        setPainted(next);
        if (sourceLayer === 'mesh') {
          const muni = muniKeyFor(Number(id));
          if (muni) {
            const n = (paintedByMuniRef.current.get(muni) ?? 0) - 1;
            if (n > 0) paintedByMuniRef.current.set(muni, n);
            else paintedByMuniRef.current.delete(muni);
            refreshHoverStat();
          }
        }
        return true;
      };

      // マウス塗りの取り消し（manual のみ）。ポイントは返金しない。
      const removePaint = (source: string, sourceLayer: string, id: string | number) => {
        if (removeLocalPaint(source, sourceLayer, id)) {
          syncPaint('DELETE', sourceLayer, id);
        }
      };

      // 手動塗り（隣接=1pt / 離れた場所=10pt）。楽観的に塗ってからサーバーで残高を確定し、
      // 残高不足（402）なら塗りとポイントを巻き戻す。cost===0 は Shift+クリックの無料デバッグ塗り。
      const doManualPaint = async (
        id: number,
        properties: Record<string, unknown> | null | undefined,
        cost: number
      ) => {
        if (!userIdRef.current) {
          showToast('ログインすると塗りポイントを使って塗れます');
          return;
        }
        if (commitLocalPaint('japan', 'mesh', id, 'manual', properties) === 'skip') return;

        const prevPoints = pointsRef.current;
        const prevRegenAt = regenAtRef.current;
        if (cost > 0) {
          // 楽観的にポイントを減算。満タンから消費したら回復時計を今から開始する。
          const wasFull = prevPoints >= MAX_PAINT_POINTS;
          applyPointsState(
            Math.max(0, prevPoints - cost),
            wasFull ? Date.now() + REGEN_INTERVAL_MS : prevRegenAt
          );
        }

        try {
          const res = await fetch(PAINT_API, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceLayer: 'mesh', keyCode: String(id), mode: 'manual', cost }),
          });
          const data = (await res.json().catch(() => null)) as {
            points?: { points: number; regenAt: number | null };
          } | null;

          if (res.status === 402) {
            // 残高不足：塗りとポイントを巻き戻す
            removeLocalPaint('japan', 'mesh', id);
            if (data?.points) applyPointsState(data.points.points, data.points.regenAt);
            else applyPointsState(prevPoints, prevRegenAt);
            showToast('塗りポイントが足りません');
            return;
          }
          if (!res.ok) {
            console.warn('failed to sync painted region', res.status);
            return;
          }
          // サーバーの確定値で同期
          if (data?.points) applyPointsState(data.points.points, data.points.regenAt);
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
      const collectVisibleLand = () => {
        const set = new Set<number>();
        for (const f of map.queryRenderedFeatures({ layers: ['mesh-fill'] })) {
          if (typeof f.id === 'number') set.add(f.id);
        }
        return set;
      };
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

      // クリック地点のメッシュセルを取得（zoom が足りない時は null）
      const pickFeatureAt = (point: maplibregl.PointLike) => {
        if (map.getZoom() < MESH_MIN_ZOOM) return null;
        const mesh = map.queryRenderedFeatures(point, { layers: ['mesh-fill'] });
        if (mesh.length > 0 && mesh[0].id !== undefined) {
          return { feature: mesh[0], sourceLayer: 'mesh' as const };
        }
        return null;
      };

      map.on('click', (e) => {
        if (map.getZoom() < MESH_MIN_ZOOM) {
          showToast('もっとズームすると塗れます');
          return;
        }
        const picked = pickFeatureAt(e.point);
        if (!picked) return;
        const { feature } = picked;
        const id = feature.id as number;
        const existing = paintedRef.current[`mesh:${id}`];

        if (existing === 'gps') {
          showToast('実際に訪れた場所です（マウスでは変更できません）');
          return;
        }
        if (existing === 'manual') {
          removePaint('japan', 'mesh', id);
          return;
        }
        // 未塗り → 塗りポイントを使って塗る（ログイン必須）。
        //   隣接（海越え可）= COST_ADJACENT / 離れた場所 = COST_FAR（確認ダイアログ）。
        // Shift を押しながらだと隣接判定もコストも無視して無料で塗れる（デバッグ用）。
        const shiftHeld = (e.originalEvent as MouseEvent | undefined)?.shiftKey ?? false;
        if (!userIdRef.current) {
          showToast('ログインすると塗りポイントを使って塗れます');
          return;
        }
        const cost = shiftHeld ? 0 : isAdjacent(id) ? COST_ADJACENT : COST_FAR;
        if (cost > 0 && pointsRef.current < cost) {
          showToast(`塗りポイントが足りません（残り ${pointsRef.current}）`);
          return;
        }
        if (cost >= COST_FAR) {
          // 離れた場所は確認ダイアログを出してから塗る
          setConfirmPaint({ id, cost, properties: feature.properties ?? null });
          return;
        }
        doManualPaint(id, feature.properties, cost);
      });

      // ── GPS 自動塗り（移動中も追跡して現在地を黄色く塗る）──────────
      // メッシュコードは座標から数式で求まるので、タイル未ロードでも塗れる。
      const paintGpsAt = (lngLat: [number, number]) => {
        const id = meshCodeAt(lngLat[0], lngLat[1]);
        // 表示用の地名は描画済みセルがあれば拾う（ズームが浅い時は省略）
        let props: Record<string, unknown> | null = null;
        if (map.getZoom() >= MESH_MIN_ZOOM) {
          const f = map.queryRenderedFeatures(map.project(lngLat), { layers: ['mesh-fill'] });
          if (f.length > 0) props = f[0].properties;
        }
        applyPaint('japan', 'mesh', id, 'gps', props);
      };
      geolocate.on('geolocate', (pos: GeolocationPosition) => {
        paintGpsAt([pos.coords.longitude, pos.coords.latitude]);
      });
      geolocate.on('error', (err: GeolocationPositionError) => {
        const msg =
          err?.code === 1
            ? '位置情報の利用が許可されていません（ブラウザの設定を確認してください）'
            : err?.code === 3
              ? '位置情報の取得がタイムアウトしました'
              : '位置情報を取得できませんでした';
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
      setMapReady(false);
    };
  }, []);

  // ログイン状態に応じて DB から復元 / ログアウト時にクリア
  useEffect(() => {
    if (isPending || !mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    const clearAll = () => {
      for (const key of Object.keys(paintedRef.current)) {
        const [sourceLayer, idStr] = key.split(':');
        const id = Number(idStr);
        if (!Number.isFinite(id)) continue;
        map.setFeatureState(
          { source: 'japan', sourceLayer, id },
          { painted: false, mode: null }
        );
      }
      paintedRef.current = {};
      setPainted({});
      paintedByMuniRef.current = new Map();
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
          painted: { sourceLayer: string; keyCode: string; mode?: string }[];
        };
        if (cancelled) return;

        clearAll();
        const next: PaintedState = {};
        for (const row of data.painted) {
          const id = Number(row.keyCode);
          if (!Number.isFinite(id)) continue;
          const mode: PaintMode = row.mode === 'gps' ? 'gps' : 'manual';
          map.setFeatureState(
            { source: 'japan', sourceLayer: row.sourceLayer, id },
            { painted: true, mode }
          );
          next[`${row.sourceLayer}:${id}`] = mode;
        }
        paintedRef.current = next;
        setPainted(next);
        rebuildPaintedByMuni(); // 復元した塗りを市区町村ごとに集計し直す
      } catch (err) {
        console.warn('failed to load painted regions', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, isPending, mapReady, refreshHoverStat, rebuildPaintedByMuni]);

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

  // 市区町村ごとの塗り％の元データ（総セル数・meshcode→市区町村）を遅延ロード
  useEffect(() => {
    if (!mapReady || muniByMeshRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(MUNI_STATS_URL);
        if (!res.ok) return;
        const data = (await res.json()) as { munis: { k: string; c: number[] }[] };
        if (cancelled) return;
        const byMesh = new Map<number, string>();
        const totals = new Map<string, number>();
        for (const { k, c } of data.munis) {
          totals.set(k, c.length);
          for (const code of c) byMesh.set(code, k);
        }
        muniByMeshRef.current = byMesh;
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

  const modes = Object.values(painted);
  const count = modes.length;
  const gpsCount = modes.filter((m) => m === 'gps').length;
  const manualCount = count - gpsCount;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div className="absolute bottom-4 left-4 bg-white rounded-lg px-4 py-2 shadow text-sm font-medium text-gray-700 space-y-1">
        {hoverStat && (
          <div className="text-gray-900 font-semibold border-b border-gray-200 pb-1 mb-1">
            {hoverStat}
          </div>
        )}
        {userId && (
          <div className="border-b border-gray-200 pb-1 mb-1">
            <div className="text-gray-900 font-semibold">
              塗りポイント: {points} / {MAX_PAINT_POINTS}
            </div>
            {regenAt !== null && points < MAX_PAINT_POINTS && (
              <div className="text-xs text-gray-500">
                +1まで {formatCountdown(regenAt - nowTick)}
              </div>
            )}
          </div>
        )}
        <div>塗った地域: {count}</div>
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_GPS }} />
          訪問 (GPS): {gpsCount}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_MANUAL }} />
          隣接塗り: {manualCount}
        </div>
      </div>
      <div className="absolute bottom-4 right-4 bg-white rounded-lg px-3 py-2 shadow text-sm font-mono text-gray-600">
        zoom: <span ref={zoomLabelRef}>4.5</span>
      </div>
      {debugMoving && (
        <div className="absolute top-4 right-4 bg-blue-600 text-white rounded-lg px-3 py-2 shadow text-xs font-medium flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-white" />
          移動モード（十字キー：移動 / Space：解除）
        </div>
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
      {confirmPaint && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/30"
          onClick={() => setConfirmPaint(null)}
        >
          <div
            className="w-[90%] max-w-sm bg-white rounded-xl shadow-xl p-5"
            role="dialog"
            aria-label="塗りの確認"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-gray-800 mb-2">
              離れた場所を塗りますか？
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              塗り済みエリアから離れているため、塗りポイントを {confirmPaint.cost} 消費します。
              <br />
              （残り {points} ポイント）
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-100"
                onClick={() => setConfirmPaint(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                onClick={confirmFarPaint}
              >
                {confirmPaint.cost}ポイント使って塗る
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
            aria-label="地名検索"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-800">地名を検索</h2>
              <button
                type="button"
                aria-label="閉じる"
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
                placeholder="例：東京都 / 横浜市 / 京都市左京区"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                type="submit"
                disabled={searchLoading || !searchQuery.trim()}
                className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
              >
                {searchLoading ? '検索中…' : '検索'}
              </button>
            </form>
            {searchError && (
              <p className="mt-3 text-sm text-gray-500">{searchError}</p>
            )}
            {searchResults.length > 0 && (
              <ul className="mt-3 max-h-72 overflow-y-auto divide-y divide-gray-100">
                {searchResults.map((r, i) => (
                  <li key={`${r.properties.title}-${i}`}>
                    <button
                      type="button"
                      className="w-full text-left px-2 py-2 text-sm text-gray-800 hover:bg-gray-50 rounded"
                      onClick={() => flyToResult(r)}
                    >
                      {r.properties.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {debugOpen && (
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
            <div className="space-y-2">
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm font-medium text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50"
                onClick={() => setDebugPoints(100)}
              >
                塗りポイントを100にする
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
