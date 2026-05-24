'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

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

export default function Map() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [painted, setPainted] = useState<PaintedState>({});
  const paintedRef = useRef<PaintedState>({});
  const zoomLabelRef = useRef<HTMLSpanElement>(null);

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
        showUserHeading: true,
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

      const togglePaint = (source: string, sourceLayer: string, id: string | number) => {
        const key = `${sourceLayer}:${id}`;
        const current = paintedRef.current;
        if (current[key]) {
          map.setFeatureState({ source, sourceLayer, id }, { painted: false });
          const next = { ...current };
          delete next[key];
          paintedRef.current = next;
          setPainted(next);
        } else {
          map.setFeatureState({ source, sourceLayer, id }, { painted: true });
          const next = { ...current, [key]: true };
          paintedRef.current = next;
          setPainted(next);
        }
      };

      map.on('click', (e) => {
        const chocho = map.queryRenderedFeatures(e.point, { layers: ['chocho-fill'] });
        if (chocho.length > 0 && chocho[0].id !== undefined) {
          togglePaint('japan', 'chocho', chocho[0].id as number);
          return;
        }
        const muni = map.queryRenderedFeatures(e.point, { layers: ['municipalities-fill'] });
        if (muni.length > 0 && muni[0].id !== undefined) {
          togglePaint('japan', 'municipalities', muni[0].id as number);
        }
      });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      maplibregl.removeProtocol('pmtiles');
      mapRef.current = null;
    };
  }, []);

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
    </div>
  );
}
