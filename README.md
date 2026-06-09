# 地図塗りゲーム（chizunurie）

日本の行政区域をクリックして色を塗る白地図塗りゲームのWebアプリです。

## 開発用URL

ルートで `npm run dev` を実行すると、以下が並列起動します。

| サービス | URL | 用途 |
|---|---|---|
| フロントエンド | http://localhost:3000 | Next.js アプリ |
| バックエンドAPI | http://localhost:3001 | Hono + better-auth |
| Drizzle Studio | https://local.drizzle.studio | DB GUI（テーブル閲覧・編集・SQL実行） |
| PostgreSQL | `postgresql://postgres:devpassword@localhost:5432/chizunurie` | Docker コンテナ（`docker compose up -d` で起動） |

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

このプロジェクトには2つの実行モードがあり、どちらも **3000(frontend) / 3001(backend) / 5432(db)** を使うため同時には動かせません。
モード別ランチャー（`scripts/start.sh`）が **競合する側を先に停止してから** 起動します。

```bash
npm run stop        # まず全部きれいにする（任意）

npm run dev:local   # ローカル dev に寄せる（frontend/backend/studio は host、db のみ Docker）
                    #   → backend が 3001 で正常起動
# または
npm run dev:docker  # フル Docker に寄せる（frontend/backend/db を全部 Docker で起動）
```

| コマンド | 何をするか |
|---|---|
| `npm run dev:local` | フル Docker 版の frontend/backend を停止 → host の残骸プロセス(3000/3001/3002/4983)を掃除 → `npm run dev` |
| `npm run dev:docker` | host の dev プロセスを停止して 3000/3001 を解放 → `docker compose -f docker-compose.prod.yml up -d --build` |
| `npm run stop` | 両モードを停止（コンテナ down ＋ host プロセス掃除） |

ブラウザで http://localhost:3000 を開くと地図が表示されます。

## 公開ページ

| ページ | パス | 内容 |
|---|---|---|
| 地図（ゲーム本体） | `/` | 白地図塗りゲーム |
| アカウント・データ削除 | `/delete-account` | ユーザーが自分でアカウントと関連データを削除できる公開ページ |

### アカウント・データ削除ページ（`/delete-account`）

Google Play「データセーフティ → アカウント削除用 URL」要件を満たす公開ページです。
本番では https://chizunurie.gamebox777.org/delete-account に公開します。

- **ログイン中**は、ページ内のカードから本人が **その場でアカウントを削除**できます
  （確認のため `delete` または `削除` と入力 → `authClient.deleteUser()` で `user` 行を削除 →
  cascade で塗りセル・ポイント・XP・ログ・セッションまで連鎖削除）。
- **ログインできない場合**（アンインストール済みなど）は、問い合わせ先メール
  （`rin7studio@gmail.com`）への削除依頼の手順を案内します。
- ページには **削除されるデータの種類**と**保持されるデータ・保持期間**を明記しています
  （Google Play の必須3条件：①アプリ/デベロッパー名 ②削除手順 ③削除・保持データの明記）。
- 実装：[`frontend/src/app/delete-account/page.tsx`](frontend/src/app/delete-account/page.tsx)（公開文面）＋
  [`DeleteAccountActions.tsx`](frontend/src/app/delete-account/DeleteAccountActions.tsx)（ログイン中の削除操作カード）。
- サーバー側は better-auth の `deleteUser` を有効化（[`backend/src/lib/auth.ts`](backend/src/lib/auth.ts)）。

> **`EADDRINUSE: address already in use :::3001` が出たら**
> ローカル dev とフル Docker が二重起動しています。`npm run stop` で一度止めてから、上のどちらかのモードで起動し直してください。
> （port を掴んでいる docker-proxy は誤って kill しないよう除外しているので、`npm run stop` で Docker 全体が落ちることはありません）

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

実行には `pmtiles` バイナリ（go-pmtiles）が必要です。

- **Windows**: プロジェクトルートの `pmtiles.exe` が使われます（追加作業不要）
- **Mac / Linux**: [Releases](https://github.com/protomaps/go-pmtiles/releases) から
  プラットフォームに合うバイナリをダウンロードし、プロジェクトルートに `pmtiles` という名前で配置してください。
  例（Apple Silicon, v1.30.2）:
  ```bash
  curl -L -o /tmp/pm.zip \
    https://github.com/protomaps/go-pmtiles/releases/download/v1.30.2/go-pmtiles-1.30.2_Darwin_arm64.zip
  unzip -o /tmp/pm.zip -d /tmp/pm && mv /tmp/pm/pmtiles ./pmtiles && chmod +x ./pmtiles
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
