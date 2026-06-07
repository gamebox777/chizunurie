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
frontend/public/data/*.geojson（市区町村・町丁目・都道府県）
  ├ scripts/build-pmtiles.mjs（geojson-vt + vt-pbf + pmtiles）
  │   → frontend/public/data/japan.pmtiles（市区町村・県境・ラベル・政令市。mesh は焼かない）
  └ scripts/build-muni-stats.mjs（市区町村ポリゴンに入る約1kmセル数を数える）
      → frontend/public/data/muni-stats.json（塗り％の分母・"PREF|CITY"→セル数・数KB）
  ↓ MapLibre GL JS + pmtiles プロトコルハンドラ
ブラウザ（表示範囲のタイルのみ取得）+ 約1kmメッシュは Map.tsx が表示範囲ぶんを数式生成
```

> 世界版への準備として、塗りの単位である**約1kmメッシュは PMTiles に焼かず、Map.tsx が
> 表示範囲のセルを数式（`meshCellRing`）でその場生成する**ようにした。`build-mesh.mjs` と
> `mesh.geojson`（約100MB）はこのパイプラインから外れた（ファイル自体は参考に残置・未使用）。
> セルIDも日本専用の8桁JIS地域メッシュコードから、全球で一意な `(ri,ci)` ベースの数値
> ID（CELLID）に変更済み。

市区町村名の読み仮名（ラベル下に小さく表示するひらがな）は mesh とは独立に生成する：

```
scripts/build-muni-kana.mjs（総務省コード由来の code4fukui/localgovjp を取得・N03_007 で結合）
  → frontend/public/data/muni-kana.json（{ byCode:{コード→読み}, byCity:{"PREF|市名"→読み} }）
```

- `byCode`：`N03_007`（5桁行政区域コード）→ 表示名（政令市は区名、それ以外は市区町村名）の読み。
- `byCity`：`"PREF|市名"` → 政令市ラベル（市全体）の読み。
- localgovjp に無い団体（北方領土6村・2024年新設の浜松市3区）は `MANUAL_BY_CODE` で補完。`所属未定地` は読みなし。
- 読み仮名データを更新したら `npm run build-muni-kana` を実行（ネット接続が必要・PMTiles 再生成は不要）。

### 塗りの単位は「約1kmの等面積メッシュ」

街と地方で行政区画の広さ・数が違いすぎる問題を避けるため、塗りの単位は**3次地域メッシュ（約1km四方の等面積グリッド・全国均一）**に統一している。

- メッシュは数学的に生成（データDL不要・ベイクもしない）。`Map.tsx` が表示範囲（zoom≥`MESH_MIN_ZOOM`=10）のセルを `buildGridForBounds` で矩形生成し `mesh-grid` ソースへ流す。塗り判定・GPS塗り・隣接判定も `meshCodeAt` の計算だけで動く。
- **約1kmグリッド = 緯度 1/120°・経度 1/80° の均一グリッド**。セルの安定ID（CELLID）はグリッド整数 `(ri, ci)` から数式で相互変換できる（`Map.tsx` の `meshCodeAt` / `gridFromMeshCode` / `meshCodeFromGrid`）。**CELLID は全球で一意**：`RI0=ri+10800`, `CI0=ci+14400`, `CELLID=RI0*30000+CI0`（旧8桁JISコードは経度100〜180前提で世界版では破綻するため廃止）。
- セルの**地名**はベイクせず実行時に解決：陸地判定・市区町村は `municipalities` レイヤーへの `queryRenderedFeatures`（`N03_001`＋`N03_004`+`N03_005`）、町丁目はホバー時に国土地理院の逆ジオコーダ（`reverseGeocode`・デバウンス＋CELLIDキャッシュ）でオンデマンド取得。世界版ではこの解決部を世界のデータ／ジオコーダに差し替える。
- CELLID は不変なので、リロードで塗りIDが変わる問題は無い。

### PMTiles のベクターレイヤー構成

`frontend/public/data/japan.pmtiles` に以下のレイヤーが含まれる：

| source-layer | 内容 | zoom範囲 |
|---|---|---|
| `municipalities` | 市区町村ポリゴン（白地図ベース・境界・全国1905地域） | 4–13 |
| `prefectures` | 都道府県境界線 | 4–8 |
| `labels` | 市区町村名ラベル用ポイント | 6–13 |
| `cities` | 政令指定都市の外周（区を市単位に dissolve・枠線＆市名ラベル用・全国20市） | 6–13 |

GeoJSONソース（`frontend/public/data/*.geojson`）は PMTiles 生成用の中間ファイルとして残している。MapLibreは PMTiles のみ使用する。

政令指定都市（札幌市・横浜市など全国20市）は N03 データ上「区」単位（`N03_004`=市名・`N03_005`=区名）に分かれているため、区の境界線は残しつつ市全体を別色・太線の枠＋市名ラベルで強調している。`cities` レイヤーの元データ `designated_cities.geojson` は区ポリゴンを市単位に dissolve して生成する：

```bash
npx mapshaper frontend/public/data/municipalities_poly.geojson \
  -filter "Boolean(N03_005)" -dissolve N03_004 copy-fields=N03_001 \
  -o format=geojson frontend/public/data/designated_cities.geojson
```

### Map.tsx のインタラクション設計

- **塗り対象**：`mesh` レイヤーのみ。`MESH_MIN_ZOOM`（=10）以上でメッシュを表示・操作対象にする。それより引いた状態は市区町村の白地図として見せる。
- **GPS塗り**：現在地の経緯度から `meshCodeAt` でメッシュコードを直接算出して塗るので、タイル未ロード（低ズーム）でも塗れる。
- **隣接塗り**：均一グリッドなので隣接判定は8近傍のメッシュコードを `paintedRef` で引くだけ（turf 不要）。最初の1セルは自由、以降は塗り済みセルに隣接する所のみ。
- **塗り状態管理**：`feature-state`（MapLibre側）と `paintedRef` + `painted` state（React側）を二重管理
  - `paintedRef`：MapLibreのfeature-state更新時に同期的に参照
  - `painted` state：UIカウンター再描画トリガー専用
- **PaintedState のキー形式**：`"mesh:featureId"`（featureId は8桁メッシュコード。例：`"mesh:53394600"`）
- **市区町村ごとの塗り％**：map 表示後に `muni-stats.json` を遅延ロードし、`meshCode→"PREF|CITY"`（`muniByMeshRef`）と市区町村ごとの総セル数（`totalByMuniRef`＝分母）を構築。塗り状態から市区町村ごとの塗りセル数（`paintedByMuniRef`＝分子）を集計し、ホバー中の市区町村に `市名 35%（n/N）` を左下パネルに表示する。塗り％は GPS・隣接塗りの両方を1セルとして数える。市区町村キーは PMTiles の `mesh` フィーチャの `PREF_NAME`/`CITY_NAME` と `muni-stats.json` の `k` が一致する前提（どちらも N03 由来）。
- zoom表示はReact stateではなくDOMを直接更新（`zoomLabelRef`）する。zoomイベントが毎フレーム発火するためstateバッチ処理と相性が悪い
- **ラベルの読み仮名**：市区町村名・政令市名のラベルは `text-field` を `format` 式にし、名前（`nm`＝名前＋塗り％）の下に小さいひらがな（`ym`＝改行付きの読み仮名）を `font-scale` を下げて灰色で添える。読みは `muni-kana.json` を遅延ロードして `kanaByCodeRef`（`N03_007`→読み）/`kanaByCityRef`（`PREF|市名`→読み）に保持し、`applyLabelStats` で各フィーチャの `ym` を埋める。**都道府県ラベルには読み仮名を付けない**（`lbl` のまま）。

### 町丁目（小地域）データの取得手順

全47都道府県の町丁目境界は e-Stat の小地域データ（国勢調査2020・A002005212020）から取得する。
`scripts/fetch-chocho.mjs` がダウンロード〜変換〜サイズガードまで自動で行う：

```bash
npm run fetch-chocho                       # 全47都道府県を取得（ネット接続が必要）
node scripts/fetch-chocho.mjs --only 13,01 # 指定コードのみ再取得（失敗時など）
```

- 取得元 URL: `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=XX&coordSys=1&format=shape&downloadType=5`（XXは都道府県コード2桁・coordSys=1=JGD2000緯度経度）
- 出力: `frontend/public/data/chocho/XX_chocho.geojson`（`KEY_CODE,PREF_NAME,CITY_NAME,S_NAME` のみ・既定 簡略化8%）
- GitHub のファイル容量制限を避けるため、1ファイルが目標上限（既定45MB）を超える県は自動でさらに簡略化する。
- これらの geojson はコミット対象（`japan.pmtiles` の中間ソース）。データ更新後は下の再生成が必要。

### データ更新後の再生成

市区町村データを変更したらプロジェクトルートで実行する：

```bash
npm run build-muni-stats && npm run build-pmtiles
```

（メッシュはベイクしないので `build-mesh` は不要になった。`build-muni-stats` は
 `municipalities_poly.geojson` を直接読み、各市区町村に入る約1kmセル数を数えて塗り％の
 分母 `muni-stats.json`（"PREF|CITY"→セル数・数KB）を生成する。`build-pmtiles` は
 mesh を除く市区町村・県境・ラベル・政令市レイヤーだけを焼く。メモリのため
 `--max-old-space-size=8192` 付き）

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
