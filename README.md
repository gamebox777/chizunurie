# 地図塗りゲーム（chizunurie）

日本の行政区域をクリックして色を塗る白地図塗りゲームのWebアプリです。

## 必要環境

- Node.js 18以上
- npm

## セットアップ

```bash
# リポジトリのクローン
git clone https://github.com/ccb-shinro/chizunurie.git
cd chizunurie

# スクリプト用依存関係のインストール（プロジェクトルートで実行）
npm install

# フロントエンド用依存関係のインストール
cd frontend && npm install
```

## 開発サーバーの起動

```bash
cd frontend
npm run dev
```

ブラウザで http://localhost:3000 を開くと地図が表示されます。

## ビルド・本番起動

```bash
cd frontend
npm run build
npm run start
```

## データの更新

地図データ（GeoJSON）を変更した場合は、PMTilesファイルを再生成してください。

```bash
# プロジェクトルートで実行
node scripts/build-pmtiles.mjs
```

## 都道府県データの追加

1. [e-Stat](https://www.e-stat.go.jp/gis/) から対象都道府県のShapefileをダウンロード
2. `mapshaper` でGeoJSONに変換・簡略化：
   ```bash
   mapshaper r2kaXX.shp -simplify 8% -filter-fields KEY_CODE,PREF_NAME,CITY_NAME,S_NAME \
     -o format=geojson frontend/public/data/XX_chocho.geojson
   ```
   （`XX` は都道府県コード2桁）
3. `scripts/build-pmtiles.mjs` の `LAYERS` 配列に追加
4. PMTilesを再生成：
   ```bash
   node scripts/build-pmtiles.mjs
   ```

## プロジェクト構造

```
chizunurie/
├── frontend/          # Next.js フロントエンドアプリ
│   ├── src/           #   Reactコンポーネント・ページ
│   ├── public/data/   #   GeoJSON・PMTilesデータ
│   ├── package.json
│   └── next.config.ts
├── scripts/           # データ処理スクリプト
│   └── build-pmtiles.mjs
├── backend/           # バックエンド（将来追加予定）
└── pmtiles.exe        # go-pmtiles v1.30.2 Windows版
```

## 技術スタック

- **フロントエンド**: Next.js (App Router) + TypeScript
- **地図**: MapLibre GL JS + PMTiles
- **地図データ**: e-Stat / 国土数値情報（Shapefile → GeoJSON → PMTiles）
