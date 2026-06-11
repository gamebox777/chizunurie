# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト構造

```
chizunurie/
├── frontend/          # Next.js フロントエンドアプリ
│   ├── src/app/       #   ページ（/ ゲーム本体・/admin 管理画面・/tiles PMTiles配信・
│   │                  #   about/how-to-play/columns/news/privacy/contact/delete-account の静的ページ）
│   ├── src/components #   Map.tsx（地図・塗りの本体）ほか UI コンポーネント
│   ├── public/        #   静的ファイル・GeoJSONデータ・PMTiles
│   └── next.config.ts #   /api/auth・/api/backend を BACKEND_URL へ rewrite
├── backend/           # Hono + PostgreSQL + Drizzle ORM の API サーバー（実装済み）
│   ├── src/
│   │   ├── index.ts   #   Hono エントリ（ポート3001・CORS・ルート登録）
│   │   ├── db/        #   schema.ts（全テーブル）・Drizzle クライアント
│   │   ├── lib/       #   auth.ts（better-auth）・points.ts（ポイント/レベル/XP）
│   │   └── routes/    #   painted/points/rankings/admin/user/log/access/settings
│   └── drizzle/       #   マイグレーション SQL（0000〜・コミット対象）
├── mobile/            # Capacitor（リモートURL方式）の iOS/Android ラッパー
├── scripts/           # データ処理スクリプト（PMTiles・stats・kana・world）＋ start.sh/deploy
├── infra/cloudflare/  # Cloudflare Worker
├── docker-compose.yml         # 開発用（Postgres のみ）
├── docker-compose.prod.yml    # フル Docker 開発モード（dev:docker が使用）
├── docker-compose.coolify.yml # 本番（Coolify・ghcr.io イメージ）
├── .github/workflows/         # build-images.yml（arm64 イメージを ghcr へ push）
├── pmtiles.exe        # go-pmtiles v1.30.2 Windows版
└── docs/
```

## Commands

```bash
# フルスタック開発（プロジェクトルートで実行・推奨）
npm run dev      # predev で Postgres を docker compose で起動 → frontend(3000)・
                 # backend(3001)・Drizzle Studio を concurrently で同時起動

# モード別ランチャー（scripts/start.sh・2モードは 3000/3001/5432 を奪い合うため
# 競合する側を先に停止してから起動する。ポート競合・EADDRINUSE が出たらこちらを使う）
npm run dev:local    # ローカル dev（host で frontend/backend/studio・db のみ Docker）
npm run dev:docker   # フル Docker（docker-compose.prod.yml で frontend/backend/db を起動）
npm run stop         # 両モードを停止（コンテナ down ＋ host プロセス掃除）

# 個別起動
npm run dev:frontend   # = npm run dev --prefix frontend（localhost:3000）
npm run dev:backend    # = npm run dev --prefix backend（tsx watch・localhost:3001）
npm run dev:studio     # Drizzle Studio（DB GUI）

# DB マイグレーション（プロジェクトルート or backend/ で実行・--prefix backend を委譲）
npm run db:generate    # schema.ts の変更から新しいマイグレーション SQL を生成
npm run db:migrate     # マイグレーションを順に適用
npm run db:push        # schema.ts を直接 DB に反映（開発用の即時反映）

# フロントエンド単体（frontend/ ディレクトリで実行）
cd frontend
npm run build    # 本番ビルド    npm run start  # 本番サーバー

# GeoJSONデータを変更した後にPMTilesを再生成（プロジェクトルートで実行）
npm run build-pmtiles   # または: node scripts/build-pmtiles.mjs

# 本番デプロイ（ghcr.io へイメージ push → Coolify）
npm run deploy
npm run deploy:local   # ローカルでイメージ build → push（scripts/build-push-local.sh）

# Android アプリ（mobile/ ディレクトリで実行・詳細は mobile/README.md）
cd mobile
npm run apk        # cap sync → gradlew assembleDebug（debug APK 生成）
npm run play       # ビルド＋エミュ起動＋APKインストール＋起動を一発で
npm run play:dev   # CAP_DEV=1：WebView が本番URLでなく http://localhost:3000 を開く
bash geo.sh 35.68 139.76   # エミュに GPS 現在地を注入（緯度 経度の順・省略時は東京駅）

# 初回セットアップ（各ディレクトリで npm install）
npm install                    # ルート：データ処理スクリプト用（better-sqlite3 等）
cd frontend && npm install     # フロントエンド
cd backend && npm install      # バックエンド
```

> テスト/リント設定は未導入（frontend・backend とも test スクリプトは無い）。型チェックは
> backend が `npm run build`（`tsc`）、frontend は `next build` 時に行う。

## Architecture

白地図塗りゲームのWebアプリ。日本の行政区域をクリックして色を塗る。

### データフロー

```
e-Stat / 国土数値情報（Shapefile）
  ↓ mapshaper（変換・簡略化・フィールド絞り込み）
frontend/public/data/*.geojson（市区町村・町丁目・都道府県）
  ├ scripts/build-pmtiles.mjs（geojson-vt + vt-pbf + pmtiles）
  │   → frontend/public/data/japan.pmtiles（市区町村・県境・ラベル・政令市。mesh は焼かない）
  ├ npm run build-muni-classify（mapshaper で市区町村境界を簡略化・軽量化）
  │   → frontend/public/data/muni-classify.geojson（塗りセルの市区町村帰属判定用・約1.5MB gzip）
  └ scripts/build-muni-stats.mjs（muni-classify.geojson に入る約1kmセル数を数える）
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
- セルの**地名表示**（左下パネル・住所表示）はベイクせず実行時に解決：陸地判定は `municipalities` レイヤーへの `queryRenderedFeatures`、町丁目はホバー時に国土地理院の逆ジオコーダ（`reverseGeocode`・デバウンス＋CELLIDキャッシュ）でオンデマンド取得。世界版ではこの解決部を世界のデータ／ジオコーダに差し替える。
- セルの**市区町村帰属（塗り％の分子の集計キー）はズーム非依存の point-in-polygon で判定する**。`queryRenderedFeatures` はタイルが zoom ごとに簡略化が違い、塗ったセルの帰属が zoom で変わって塗り％が 100% に届かない/超える原因になっていた。そこで `muni-classify.geojson`（分母 `build-muni-stats` と同一ファイル）を遅延ロードし、`Map.tsx` の `classifyMuniAt`（セル中心 `(ci+0.5)/80, (ri+0.5)/120` を `pointInRings` で判定・粗いグリッド索引 `buildMuniIndex` で高速化）で帰属を決める。分子（クライアント）と分母（build-muni-stats）が**同一ジオメトリ・同一アルゴリズム・同一の「ファイル順で最初に含む市区町村」採用**なので、どのズームで塗っても市区町村は必ず 100% に到達する。ロード後は既存の塗りも `reclassifyPaintedMuni` でこの判定に付け替える（DB保存値は使わない）。
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

PMTiles の配信は `public/` の静的配信ではなく **Route Handler（`frontend/src/app/tiles/japan/route.ts`・`tiles/world/route.ts`）で自前の Range（Byte Serving）対応配信**をしている。Next（Turbopack）の静的配信は大きいファイルで Range を無視して 200 を返し、pmtiles.js が「content-length exceeding request」で失敗するため。地図スタイルの PMTiles URL は `/tiles/japan`・`/tiles/world` を指す。

政令指定都市（札幌市・横浜市など全国20市）は N03 データ上「区」単位（`N03_004`=市名・`N03_005`=区名）に分かれているため、区の境界線は残しつつ市全体を別色・太線の枠＋市名ラベルで強調している。`cities` レイヤーの元データ `designated_cities.geojson` は区ポリゴンを市単位に dissolve して生成する：

```bash
npx mapshaper frontend/public/data/municipalities_poly.geojson \
  -filter "Boolean(N03_005)" -dissolve N03_004 copy-fields=N03_001 \
  -o format=geojson frontend/public/data/designated_cities.geojson
```

### Map.tsx のインタラクション設計

- **塗り対象**：`mesh` レイヤーのみ。`MESH_MIN_ZOOM`（=10）以上でメッシュを表示・操作対象にする。それより引いた状態は市区町村の白地図として見せる。
- **GPS塗り**：現在地の経緯度から `meshCodeAt` でメッシュコードを直接算出して塗るので、タイル未ロード（低ズーム）でも塗れる。
- **歩きGPS塗りの125m細セル**：GPS で歩いた 1km セルは、内部を 8×8=64 分割した約125m細セル（`MESH_SUB_DIV`=8・`subIndexAt` で番号 0..63 を算出）単位で「実際に歩いた所」を記録する。サーバーは `painted_regions.walked_mask`（bigint・bit s = sr*8+sc）に蓄積し、クライアントは黄色の 1km セルの上に歩いた細セルだけを赤系（`COLOR_GPS_FINE`）で重ね描きする。`walked_mask = 0` は全面塗り（手動塗り・旧GPS塗り・全64踏破）を意味する。
- **隣接塗り**：均一グリッドなので隣接判定は8近傍のメッシュコードを `paintedRef` で引くだけ（turf 不要）。最初の1セルは自由、以降は塗り済みセルに隣接する所のみ。
- **塗り状態管理**：`feature-state`（MapLibre側）と `paintedRef` + `painted` state（React側）を二重管理
  - `paintedRef`：MapLibreのfeature-state更新時に同期的に参照
  - `painted` state：UIカウンター再描画トリガー専用
- **PaintedState のキー形式**：`"mesh:featureId"`（featureId は8桁メッシュコード。例：`"mesh:53394600"`）
- **市区町村ごとの塗り％**：map 表示後に分母 `muni-stats.json`（`totalByMuniRef`）と帰属判定用 `muni-classify.geojson`（`muniPolysRef`）を遅延ロードする。塗ったセルの市区町村（`muniByPaintedCellRef`＝CELLID→"PREF|CITY"）は `classifyMuniAt`（セル中心 point-in-polygon）で決め、そこから市区町村ごとの塗りセル数（`paintedByMuniRef`＝分子）を集計し、ホバー中の市区町村に `市名 35%（n/N）` を左下パネルに表示する。塗り％は GPS・隣接塗りの両方を1セルとして数える。**分子の判定（クライアント）と分母の集計（`build-muni-stats`）が同一ファイル・同一アルゴリズムなので、必ず分子＝分母（ズーム非依存で必ず 100% に到達）**。市区町村キーは `${N03_001}|${N03_004}${N03_005}` で `muni-stats.json` の `k` と一致する。
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
npm run build-muni-classify && npm run build-muni-stats && npm run build-pmtiles
```

（メッシュはベイクしないので `build-mesh` は不要になった。`build-muni-classify` は
 `municipalities_poly.geojson` を mapshaper で簡略化（`-simplify 60% keep-shapes`・
 `precision=0.00002`）して帰属判定用の軽量ポリゴン `muni-classify.geojson`（約1.5MB gzip・
 クライアントが遅延ロード）を作る。`build-muni-stats` は**この `muni-classify.geojson`**を読み、
 各市区町村に入る約1kmセル数を数えて塗り％の分母 `muni-stats.json`（"PREF|CITY"→セル数・数KB）を
 生成する。クライアントの帰属判定（分子）も同じ `muni-classify.geojson` を使うため、必ず分子＝分母に
 なる（→市区町村は必ず 100% に到達）。`build-muni-stats` を回す前に必ず `build-muni-classify` を
 先に実行すること。`build-pmtiles` は mesh を除く市区町村・県境・ラベル・政令市レイヤーだけを焼く。
 メモリのため `--max-old-space-size=8192` 付き）

### 世界版（国＋州・県）のデータパイプライン

日本の外も同じ約1kmメッシュ（`meshCodeAt`・全球で CELLID 一意）で塗れる。地名・塗り％の
集計単位だけ日本（市区町村）から **国（admin_0）＋州・県（admin_1）** に差し替える。
日本版の `japan.pmtiles + muni-stats + muni-kana + 地理院ジオコーダ` 一式に対応する世界版は
`world.pmtiles + world-stats + Natural Earth 10m`。下地・境界・ラベル・ホバー地名解決まで
日本版と同じ構造を踏襲する。

```bash
npm run build-world        # NE 10m の国(admin_0)＋州/県(admin_1)を取得・簡略化し world.pmtiles を焼く
npm run build-world-stats  # 州・県/国ごとの約1kmセル数（塗り％の分母）と地名メタを生成
```

データフロー：

```
Natural Earth Vector 10m（admin_0_countries / admin_1_states_provinces）
  ↓ mapshaper（属性絞り込み・小島除去・簡略化）
frontend/public/data/world-countries.geojson, world-states.geojson（中間ソース）
  ├ scripts/build-world.mjs（geojson-vt + vt-pbf + pmtiles）
  │   → frontend/public/data/world.pmtiles（layers: countries, states・zoom 0–9・約27MB）
  └ scripts/build-world-stats.mjs（scanline ラスタライザ）
      → frontend/public/data/world-stats.json（約500KB）
        { states:{adm1_code→セル数}, countries:{adm0_a3→セル数},
          stateMeta:{adm1_code→{name,name_ja,admin,adm0_a3}}, countryMeta:{adm0_a3→{name,name_ja}} }
```

ポイント（データ量・設計）：

- **塗りの単位は焼かない**：日本と同じく約1kmメッシュは PMTiles に焼かず `Map.tsx` が表示範囲を
  数式生成する。世界に広げても実行時コストは増えない（焼くと約100GB）。
- **states は z9 まで**しか焼かない。塗りズーム（z10+）では MapLibre が z9 タイルを
  **オーバーズーム**して表示・`queryRenderedFeatures` するので、地名解決が成立する。
  これで世界全域でもタイル数・`world.pmtiles` サイズ（約27MB）が現実的に収まる。
- **分母づくりは scanline 必須**：陸地は全球で約2億セル。`build-muni-stats` の per-cell
  point-in-polygon では非現実的なので、`build-world-stats.mjs` は行ごとにエッジ交点を求めて
  区間を一気に数える **scanline 方式**（セルを Set に貯めず O(総セル数)・低メモリ）。出力は約500KB。
- **高緯度の歪みは未補正**：緯度1/120°・経度1/80°の等角グリッドのため、極に近い国
  （ロシア・カナダ・グリーンランド等）はセル数が水増しされ % が低めに出る。仕様として割り切る。

`Map.tsx` の地名・塗り％（日本版との対応）：

- 下地・国境・州境・国名/州名ラベルは `world.pmtiles` の `countries`/`states` レイヤー。
  地名解決は不可視の `world-states-fill`（opacity 0・クエリ専用）への `queryRenderedFeatures`。
- 塗ったセルの州キー（`adm1_code`）は `regionByPaintedCellRef`（CELLID→adm1_code）に持ち、
  塗り時に backend の `painted_regions.region` 列へ保存（日本の `municipality` 列に相当）。
  国は `world-stats.json` の `stateMeta[adm1_code].adm0_a3` から導出する。
- ホバー時、日本（市区町村キーあり）は従来どおり市区町村％、日本の外は **国％と州・県％を2段**で
  左下パネルに表示する（`refreshHoverStat`）。分母 = `world-stats`、分子 = 塗りから集計（`rebuildPaintedByRegion`）。

> backend スキーマに `painted_regions.region`（text）を追加済み。マイグレーション
> （`backend/drizzle/`）を `npm run db:push`（または `db:migrate`）で適用すること。
> 旧 `build-world-land.mjs` / `world-land.geojson` は `world.pmtiles` に置き換わり未使用。

### 重要な制約

- `src/app/page.tsx` に `'use client'` が必要（`dynamic` + `ssr: false` を使うため）
- MapLibre GL JS はSSR不可。`dynamic(() => import(...), { ssr: false })` でクライアントのみロード
- 日本語ラベルは `localIdeographFontFamily` でシステムフォントを使用（グリフサーバー不要）
- React Strict Modeの二重実行対策：cleanup で `map.remove()` の後に `mapRef.current = null` が必須
- **Next.js は 16系**：学習データより新しい可能性がある。API・規約に迷ったら
  `frontend/node_modules/next/dist/docs/` のガイドを確認する（ルートの `AGENTS.md` 参照）

### ページ構成・PWA

- ゲーム本体は `/`（`Map.tsx`）。ほかに静的ページ `/about`・`/how-to-play`・`/columns`・
  `/news`・`/privacy`・`/contact` と、開発者用管理画面 `/admin`（role=developer のみ）がある。
- **`/delete-account`**：Google Play「アカウント削除用 URL」要件を満たす公開ページ。
  ログイン中は `authClient.deleteUser()` でその場で削除（cascade で塗り・ポイント・ログも削除）。
  問い合わせ先は `rin7studio@gmail.com` に統一。
- PWA 対応：`src/app/manifest.ts` ＋ `ServiceWorkerRegister.tsx`。`robots.ts`/`sitemap.ts` もある。

### ツール

- `pmtiles` バイナリ（go-pmtiles）: MBTiles → PMTiles 変換用
  - Windows: プロジェクトルートの `pmtiles.exe`（v1.30.2 同梱）
  - Mac/Linux: https://github.com/protomaps/go-pmtiles/releases から取得して
    プロジェクトルートに `pmtiles` として配置（`.gitignore` 済み）
  - `scripts/build-pmtiles.mjs` の `resolvePmtilesBin()` がプラットフォーム判定して使い分ける
- `mapshaper`（npm global）: Shapefile/GeoJSON の変換・簡略化

## バックエンド（API サーバー）

`backend/` は **Hono + PostgreSQL + Drizzle ORM** の API サーバー。塗り状態・ポイント・
ユーザー認証・ランキング・管理画面 API を持つ。フロントエンドは直接 backend を叩かず、
Next.js の rewrite（`frontend/next.config.ts`）経由でアクセスする：

```
ブラウザ /api/auth/**     → next.config rewrite → BACKEND_URL/api/auth/**（better-auth）
ブラウザ /api/backend/**  → next.config rewrite → BACKEND_URL/**（painted, points, …）
```

`backend/src/index.ts` がルートを登録（ポート3001・CORS は `FRONTEND_URL` 限定・
`credentials: true`）。各ルーターは `backend/src/routes/` にある：

| ルート | ファイル | 役割 |
|---|---|---|
| `/api/auth/**` | `lib/auth.ts`（better-auth） | Google OAuth・メール認証・**匿名（ゲスト）ログイン** |
| `/painted` | `routes/painted.ts` | 塗りセルの取得（GET）・塗り（POST・コスト/XP計算）・消す（DELETE） |
| `/points` | `routes/points.ts` | ポイント残高・プレイ時間 heartbeat・動画リワード |
| `/rankings` | `routes/rankings.ts` | 全体／地域別（県・国）ランキング |
| `/admin` | `routes/admin.ts` | 開発者専用（`role=developer`）：ユーザー・ログ・アクセス統計 |
| `/user` | `routes/user.ts` | ログイン中ユーザー自身の所在国・設定の更新 |
| `/log` | `routes/log.ts` | ユーザー行動ログ（login/gps/search 等）の記録 |
| `/access` | `routes/access.ts` | アクセス数カウント（未ログインも数える） |
| `/settings` | `routes/settings.ts` | ゲーム全体の共通設定（`app_settings` 単一行 id=1・取得/保存は開発者専用） |

### 認証（better-auth・匿名ログインが肝）

`backend/src/lib/auth.ts`。Drizzle アダプタ + Google OAuth。**初訪問で匿名ユーザーを自動発行**
し、ゲストのまま塗り・XP 取得ができる。サインアップ/ログイン時に `linkAnonymousData()` が
匿名アカウントの塗りセル・ポイントを本アカウントへ移行し、ゲストを削除する。`user.role` は
`user|developer`（admin API はこの判定）。`secure` cookie は baseURL が https のときだけ有効。

### ポイント・レベル・XP（`backend/src/lib/points.ts`）

ゲーム進行のコアロジック。主要定数：初期10pt・**10分で1pt 回復（遅延回復＝読み取り時に
`ensurePoints()` で経過時間から算出）**・レベルで最大pt増加（`10 + (level-1)`）・
隣接塗り1pt／遠距離塗り10pt・GPS訪問は無料で +100XP・手動塗り +50XP・動画リワードは
nonce で多重請求防止。`totalExp` は累積で減らない。

### 塗りの永続化（`backend/src/routes/painted.ts`）

- **mode**：`gps`（無料・最優先）／`manual`（ポイント消費）。GPS で既存 manual セルを踏むと
  gps へ昇格して XP 付与。既に gps なら `lastVisitAt` のクールダウン（1時間）で再訪問報酬。
- **sourceLayer**：`mesh`（現行）。`municipalities`/`chocho` は旧データ。
- ポイント不足は HTTP **402**（トランザクションごとロールバック）。
- 保存列：`municipality`（`"PREF|CITY"`・日本）／`region`（adm1_code・世界版）／`country`（adm0_a3）。
  クライアントの帰属判定（`classifyMuniAt`・`regionByPaintedCellRef`）の結果をそのまま保存する。

### DB スキーマ（`backend/src/db/schema.ts`・PostgreSQL）

better-auth の `user`/`session`/`account`/`verification` に加えて：

- **`painted_regions`**：塗りセル本体。`(userId, sourceLayer, keyCode)` がユニーク。
  `walked_mask`（bigint）は歩きGPS塗りの125m細セル進捗（0 = 全面塗り）。
- **`user_points`**：ポイント／レベル／XP／プレイ時間／動画リワード状態。
- **`user_logs`**：行動監査ログ（`(userId, createdAt)` インデックス）。
- **`site_visits`**：日次アクセス（`(date, visitor)` 複合PK・`visitor` は `u:`userId か `h:`ハッシュ）。
- **`app_settings`**：ゲーム全体の共通設定（常に id=1 の1行・jsonb・開発者のみ編集）。
- `user` には better-auth 標準列に加え `is_anonymous`（匿名ゲスト判定）・
  `last_ip_address`/`last_user_agent`（最終アクセス情報）を持つ。

マイグレーションは `backend/drizzle/*.sql`（**コミット対象**）。スキーマ変更時は
`npm run db:generate` で SQL を生成 →（開発は）`npm run db:push` または `db:migrate` で適用。
**各マイグレーション SQL の冒頭には日本語の概要コメントを付ける運用**（既存ファイルに倣う）。

### デプロイ

普段の開発ブランチは `develop`（既定ブランチ）。`.github/workflows/build-images.yml` が
`main` push で arm64 イメージ（`chizunurie-frontend`/`-backend`）を ghcr.io へ push。
本番は Coolify（`docker-compose.coolify.yml`）。
`npm run deploy`（`scripts/deploy-main.sh`）でイメージ push → デプロイ。開発の DB は
`docker compose up -d db`（`npm run dev` の predev が自動実行）。

### 環境変数

- backend（`backend/.env`）：`DATABASE_URL`・`BETTER_AUTH_URL`・`BETTER_AUTH_SECRET`・
  `FRONTEND_URL`・`PORT`（既定3001）。
- frontend：`BACKEND_URL`（`next.config.ts` の rewrite 先）・`NEXT_PUBLIC_APP_ENV`。

## モバイルアプリ（`mobile/`・Capacitor リモートURL方式）

ネイティブの WebView が本番サイト（`https://chizunurie.gamebox777.org`）をそのまま開くだけの
ラッパー。**frontend/backend のコードには一切触らない**ため、ブラウザ版と挙動は完全に同一。
詳細手順は `mobile/README.md`。

- `capacitor.config.ts` の `server.url` が開く先。**`CAP_DEV=1` を付けてビルド**すると
  `http://localhost:3000`（ローカルDev）を開く。`url` は `cap sync` 時に native へ焼き込まれる
  ので、CAP_DEV は「ビルド時」に効かせる（`npm run apk:dev` / `play:dev`）。
- Dev で `10.0.2.2` でなく `localhost` を使う理由は **GPS**：http の生IPは非セキュアオリジンで
  `navigator.geolocation` がブロックされる。`run-emu.sh` が `adb reverse tcp:3000`（と3001）で
  端末の localhost をホストMacへ転送する。
- **Google OAuth を WebView 内で完結させる回避策**が config に入っている：
  `allowNavigation`（accounts.google.com・*.google.com・accounts.youtube.com — 初回サインイン
  だけ経由する Cookie 同期ホップ）＋ `overrideUserAgent`（"; wv" を消して disallowed_useragent
  拒否を回避）。これらを外すとアプリ内ログインが壊れる。
- `geo.sh` でエミュに GPS 位置を注入（引数は「緯度 経度」順・内部で adb の「経度 緯度」順へ変換）。
- appId は `jp.chizunurie.app`・ストア素材は `mobile/play-store/`。
