# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト構造

```
chizunurie/
├── frontend/          # Next.js フロントエンドアプリ
│   ├── src/           #   React コンポーネント・ページ
│   ├── public/        #   静的ファイル・GeoJSONデータ・PMTiles
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.ts
├── scripts/           # データ処理スクリプト（フロント・バック共通）
│   └── build-pmtiles.mjs
├── backend/           # バックエンド（将来追加予定）
├── pmtiles.exe        # go-pmtiles v1.30.2 Windows版
└── docs/
```

## Commands

```bash
# フロントエンド開発（frontend/ ディレクトリで実行）
cd frontend
npm run dev      # 開発サーバー起動 (localhost:3000)
npm run build    # 本番ビルド
npm run start    # 本番サーバー起動

# GeoJSONデータを変更した後にPMTilesを再生成（プロジェクトルートで実行）
npm run build-pmtiles   # または: node scripts/build-pmtiles.mjs

# 初回セットアップ（プロジェクトルートで実行）
npm install             # スクリプト用依存関係（better-sqlite3 等）
cd frontend && npm install  # フロントエンド用依存関係
```

## Architecture

白地図塗りゲームのWebアプリ。日本の行政区域をクリックして色を塗る。

### データフロー

```
e-Stat / 国土数値情報（Shapefile）
  ↓ mapshaper（変換・簡略化・フィールド絞り込み）
frontend/public/data/*.geojson
  ↓ scripts/build-pmtiles.mjs（geojson-vt + vt-pbf + pmtiles.exe）
frontend/public/data/japan.pmtiles（単一ファイル、複数ベクターレイヤー）
  ↓ MapLibre GL JS + pmtiles プロトコルハンドラ
ブラウザ（表示範囲のタイルのみ取得）
```

### PMTiles のベクターレイヤー構成

`frontend/public/data/japan.pmtiles` に以下のレイヤーが含まれる：

| source-layer | 内容 | zoom範囲 |
|---|---|---|
| `municipalities` | 市区町村ポリゴン（全国1905地域） | 4–10 |
| `chocho` | 町丁目ポリゴン（東京・北海道のみ） | 8–13 |
| `prefectures` | 都道府県境界線 | 4–8 |
| `labels` | 市区町村名ラベル用ポイント | 6–13 |

GeoJSONソース（`frontend/public/data/*.geojson`）は PMTiles 生成用の中間ファイルとして残している。MapLibreは PMTiles のみ使用する。

### Map.tsx のインタラクション設計

- **クリック優先順位**：`chocho` > `municipalities`（zoom 8以上では町丁目が優先）
- **塗り状態管理**：`feature-state`（MapLibre側）と `paintedRef` + `painted` state（React側）を二重管理
  - `paintedRef`：MapLibreのfeature-state更新時に同期的に参照
  - `painted` state：UIカウンター再描画トリガー専用
- **PaintedState のキー形式**：`"sourceLayer:featureId"`（例：`"chocho:1234"`）
- featureId は `generateId: true` によるgeojson-vtの生成ID（ページリロード後に変わりうる）
- zoom表示はReact stateではなくDOMを直接更新（`zoomLabelRef`）する。zoomイベントが毎フレーム発火するためstateバッチ処理と相性が悪い

### 都道府県データの追加手順

1. e-Stat からShapefileをダウンロード
   - URL: `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=XX&coordSys=1&format=shape&downloadType=5`（XXは都道府県コード2桁）
2. `mapshaper` で変換（簡略化8%、必要フィールドのみ残す）
   ```bash
   mapshaper r2kaXX.shp -simplify 8% -filter-fields KEY_CODE,PREF_NAME,CITY_NAME,S_NAME \
     -o format=geojson frontend/public/data/XX_chocho.geojson
   ```
3. `scripts/build-pmtiles.mjs` の `LAYERS` 配列に追加
4. プロジェクトルートで `node scripts/build-pmtiles.mjs` を実行

### 重要な制約

- `src/app/page.tsx` に `'use client'` が必要（`dynamic` + `ssr: false` を使うため）
- MapLibre GL JS はSSR不可。`dynamic(() => import(...), { ssr: false })` でクライアントのみロード
- 日本語ラベルは `localIdeographFontFamily` でシステムフォントを使用（グリフサーバー不要）
- React Strict Modeの二重実行対策：cleanup で `map.remove()` の後に `mapRef.current = null` が必須

### ツール

- `pmtiles` バイナリ（go-pmtiles）: MBTiles → PMTiles 変換用
  - Windows: プロジェクトルートの `pmtiles.exe`（v1.30.2 同梱）
  - Mac/Linux: https://github.com/protomaps/go-pmtiles/releases から取得して
    プロジェクトルートに `pmtiles` として配置（`.gitignore` 済み）
  - `scripts/build-pmtiles.mjs` の `resolvePmtilesBin()` がプラットフォーム判定して使い分ける
- `mapshaper`（npm global）: Shapefile/GeoJSON の変換・簡略化
