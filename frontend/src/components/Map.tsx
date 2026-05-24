'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useSession } from '@/lib/auth-client';

const PAINT_API = '/api/backend/painted';

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

const CHOCHO_SOURCE_IDS = ['chocho'] as const;

type PaintedState = Record<string, boolean>;

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
  if (sourceLayer === 'chocho') {
    return [get('PREF_NAME'), get('CITY_NAME'), get('S_NAME')].filter(Boolean).join('');
  }
  return '';
}

export default function Map() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [painted, setPainted] = useState<PaintedState>({});
  const paintedRef = useRef<PaintedState>({});
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
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

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

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

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right'
    );

    map.on('zoom', () => {
      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = map.getZoom().toFixed(1);
      }
    });

    map.on('load', () => {
      // PMTilesソースを1つ追加（全レイヤーが1ファイルに入っている）
      map.addSource('japan', {
        type: 'vector',
        url: 'pmtiles:///data/japan.pmtiles',
        attribution: '© 国土交通省 国土数値情報 / e-Stat',
      });

      // 都道府県境界（太線）
      map.addLayer({
        id: 'prefectures-border',
        type: 'line',
        source: 'japan',
        'source-layer': 'prefectures',
        paint: { 'line-color': '#888888', 'line-width': 1.5 },
      });

      // 市区町村フィル
      map.addLayer({
        id: 'municipalities-fill',
        type: 'fill',
        source: 'japan',
        'source-layer': 'municipalities',
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'painted'], false], '#4a90d9',
            '#ffffff',
          ],
          'fill-opacity': 0.85,
        },
      });

      map.addLayer({
        id: 'municipalities-border',
        type: 'line',
        source: 'japan',
        'source-layer': 'municipalities',
        paint: { 'line-color': '#aaaaaa', 'line-width': 0.6 },
      });

      // 町丁目フィル（zoom8以上）
      map.addLayer({
        id: 'chocho-fill',
        type: 'fill',
        source: 'japan',
        'source-layer': 'chocho',
        minzoom: 8,
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'painted'], false], '#4a90d9',
            '#ffffff',
          ],
          'fill-opacity': [
            'interpolate', ['linear'], ['zoom'],
            8, 0,
            9, ['case', ['boolean', ['feature-state', 'painted'], false], 0.85, 0],
          ],
        },
      });

      map.addLayer({
        id: 'chocho-border',
        type: 'line',
        source: 'japan',
        'source-layer': 'chocho',
        minzoom: 8,
        paint: {
          'line-color': '#cccccc',
          'line-width': 0.4,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 9, 1],
        },
      });

      // ホバーレイヤー
      map.addLayer({
        id: 'municipalities-hover',
        type: 'fill',
        source: 'japan',
        'source-layer': 'municipalities',
        paint: {
          'fill-color': '#000000',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.12, 0],
        },
      });

      map.addLayer({
        id: 'chocho-hover',
        type: 'fill',
        source: 'japan',
        'source-layer': 'chocho',
        minzoom: 8,
        paint: {
          'fill-color': '#000000',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.12, 0],
        },
      });

      // 市区町村名ラベル
      map.addLayer({
        id: 'municipality-label',
        type: 'symbol',
        source: 'japan',
        'source-layer': 'labels',
        minzoom: 6,
        layout: {
          'text-field': ['case',
            ['!=', ['get', 'N03_005'], ''], ['get', 'N03_005'],
            ['get', 'N03_004'],
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

      // ── インタラクション ────────────────────────
      let hovered: { source: string; id: string | number; sourceLayer: string } | null = null;

      const clearHover = () => {
        if (hovered) {
          map.setFeatureState(
            { source: hovered.source, sourceLayer: hovered.sourceLayer, id: hovered.id },
            { hover: false }
          );
          hovered = null;
        }
      };

      const setHover = (source: string, sourceLayer: string, id: string | number) => {
        if (hovered?.id === id && hovered?.sourceLayer === sourceLayer) return;
        clearHover();
        map.setFeatureState({ source, sourceLayer, id }, { hover: true });
        hovered = { source, sourceLayer, id };
        map.getCanvas().style.cursor = 'pointer';
      };

      map.on('mousemove', (e) => {
        const chocho = map.queryRenderedFeatures(e.point, { layers: ['chocho-fill'] });
        if (chocho.length > 0 && chocho[0].id !== undefined) {
          setHover('japan', 'chocho', chocho[0].id as number);
          return;
        }
        const muni = map.queryRenderedFeatures(e.point, { layers: ['municipalities-fill'] });
        if (muni.length > 0 && muni[0].id !== undefined) {
          setHover('japan', 'municipalities', muni[0].id as number);
          return;
        }
        clearHover();
        map.getCanvas().style.cursor = '';
      });

      map.on('mouseleave', () => {
        clearHover();
        map.getCanvas().style.cursor = '';
      });

      const togglePaint = (
        source: string,
        sourceLayer: string,
        id: string | number,
        properties: Record<string, unknown> | null | undefined
      ) => {
        const key = `${sourceLayer}:${id}`;
        const current = paintedRef.current;
        const willPaint = !current[key];

        map.setFeatureState({ source, sourceLayer, id }, { painted: willPaint });
        const next = { ...current };
        if (willPaint) next[key] = true;
        else delete next[key];
        paintedRef.current = next;
        setPainted(next);

        if (willPaint) {
          showToast(formatAddress(sourceLayer, properties));
        }

        if (userIdRef.current) {
          const keyCode = String(id);
          fetch(PAINT_API, {
            method: willPaint ? 'POST' : 'DELETE',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceLayer, keyCode }),
          }).catch((err) => {
            console.warn('failed to sync painted region', err);
          });
        }
      };

      map.on('click', (e) => {
        const chocho = map.queryRenderedFeatures(e.point, { layers: ['chocho-fill'] });
        if (chocho.length > 0 && chocho[0].id !== undefined) {
          togglePaint('japan', 'chocho', chocho[0].id as number, chocho[0].properties);
          return;
        }
        const muni = map.queryRenderedFeatures(e.point, { layers: ['municipalities-fill'] });
        if (muni.length > 0 && muni[0].id !== undefined) {
          togglePaint('japan', 'municipalities', muni[0].id as number, muni[0].properties);
        }
      });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
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
          { painted: false }
        );
      }
      paintedRef.current = {};
      setPainted({});
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
          painted: { sourceLayer: string; keyCode: string }[];
        };
        if (cancelled) return;

        clearAll();
        const next: PaintedState = {};
        for (const row of data.painted) {
          const id = Number(row.keyCode);
          if (!Number.isFinite(id)) continue;
          map.setFeatureState(
            { source: 'japan', sourceLayer: row.sourceLayer, id },
            { painted: true }
          );
          next[`${row.sourceLayer}:${id}`] = true;
        }
        paintedRef.current = next;
        setPainted(next);
      } catch (err) {
        console.warn('failed to load painted regions', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, isPending, mapReady]);

  const count = Object.keys(painted).length;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div className="absolute bottom-4 left-4 bg-white rounded-lg px-4 py-2 shadow text-sm font-medium text-gray-700">
        塗った地域: {count}
      </div>
      <div className="absolute bottom-4 right-4 bg-white rounded-lg px-3 py-2 shadow text-sm font-mono text-gray-600">
        zoom: <span ref={zoomLabelRef}>4.5</span>
      </div>
      {toast && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900/85 text-white rounded-lg px-4 py-2 shadow text-sm font-medium pointer-events-none"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
