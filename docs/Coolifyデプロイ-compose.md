# Coolify で Docker Compose をデプロイする（推奨・全部1リソース）

Coolify は **Docker Compose ファイルをそのまま読んで、フロント・バック・DB をまとめて
1リソースとしてデプロイ**できる。サービスを3つ個別に作る方法（[デプロイ手順.md](デプロイ手順.md)）
より設定が少なく、ドメイン・TLS・DBパスワード・認証シークレットは Coolify が自動で面倒を見る。

使う compose ファイル: **[docker-compose.coolify.yml](../docker-compose.coolify.yml)**

```
            https://chizunurie.gamebox777.org  （Coolify が TLS 自動取得）
ブラウザ ─────────▶ Coolify のプロキシ(Traefik) ─▶ frontend(Next.js):3000
                                                      │  rewrites() で /api/* を中継
                                                      ▼
                                                  backend(Hono):3001  ← 内部のみ
                                                      ▼
                                                  postgres            ← 内部のみ
```

ブラウザは frontend の公開ドメイン1つだけを叩く。backend / db は公開ドメインを持たず、
compose の内部ネットワークでサービス名（`backend` / `db`）で繋がる。

---

## 0. 事前準備（Google OAuth）

このアプリは Google ログインを**開発・本番の両方で使う**。同じ OAuth クライアントを使い回し、
「承認済みのリダイレクト URI」に開発用と本番用の**両方**を登録する。

Google Cloud Console → OAuth クライアントの「承認済みのリダイレクト URI」：

```
http://localhost:3001/api/auth/callback/google      ← 開発用（残す）
https://chizunurie.gamebox777.org/api/auth/callback/google   ← 本番用（追加）
```

> 同じ `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を開発の `.env` と本番（Coolify の
> Environment Variables）で共有する。リダイレクト URI は実際にアクセスするドメインごとに
> 列挙が必要なので、両方を登録しておくこと。

---

## 1. GitHub にコードをアップする（本番は `main` ブランチ）

Coolify は GitHub のリポジトリを見てデプロイする。**本番は `main` ブランチを使う**ので、
日頃の作業ブランチ（`develop`）の内容を `main` に反映して push する。

リポジトリ: `git@github.com:gamebox777/chizunurie.git`

> 現状：リモートの `main` は最初の自動生成コミットしか無く、`develop` がそれより先に
> 進んでいる（`develop` が `main` を完全に含む）。ローカルには `main` ブランチがまだ無い。
> このため `develop` → `main` のマージは **fast-forward**（衝突なし）で綺麗に進む。

### 1-1. まず作業ブランチ(develop)をコミットして push

```bash
git checkout develop
git add -A
git commit -m "デプロイ用の変更"
git push origin develop
```

`docker-compose.coolify.yml` や `japan.pmtiles` など、デプロイに必要なファイルが
ちゃんとコミット・push されていることを確認する（`git status` がクリーンならOK）。

### 1-2. ローカルに `main` ブランチを用意する（初回だけ）

ローカルにはまだ `main` が無いので作る。リモート(`origin/main`)は存在するので、それを
追跡するローカル `main` を作成する：

```bash
git fetch origin
git checkout main          # origin/main を追跡するローカル main が作られる
```

> もし `origin/main` も無い環境なら、代わりに `git checkout -b main`（develop から新規作成）
> で main を作り、`git push -u origin main` で初回 push する。今回は origin/main があるので上でよい。

### 1-3. develop を main にマージして push（← Coolify が見るのはこの main）

```bash
git merge develop          # develop の内容を main に取り込む（今回は fast-forward）
git push origin main
```

これで GitHub の `main` が最新になり、Coolify がこの `main` をデプロイできる。

### 以降の更新（2回目から）

ローカル `main` は作成済みなので、本番反映は毎回これだけ：

```bash
git checkout main
git merge develop
git push origin main
git checkout develop       # 作業ブランチに戻る
```

> 初回だけ：GitHub と Coolify の連携（GitHub App か Deploy Key）を Coolify 側で設定しておく。
> プライベートリポジトリの場合はこの連携が無いと Coolify がクローンできない。

---

## 2. Coolify でリソースを作成

1. Coolify → プロジェクト作成（例：`chizunurie`）→ 「+ New Resource」
2. **Docker Compose** を選ぶ（"Docker Compose Based" / Git リポジトリ連携）
3. このリポジトリ（`gamebox777/chizunurie`）を連携し、ブランチに **`main`** を選ぶ（本番ブランチ）
4. **Docker Compose Location** に `docker-compose.coolify.yml` を指定する
   （リポジトリ直下にあるので `/docker-compose.coolify.yml`）
5. 保存すると Coolify が compose を解析し、`frontend` / `backend` / `db` の3サービスを認識する

---

## 3. ドメインを設定

`docker-compose.coolify.yml` に `SERVICE_FQDN_FRONTEND_3000` を書いてあるので、Coolify は
**frontend に公開ドメインを自動割り当て**し、TLS を Let's Encrypt で取得し、:3000 へ
ルーティングする。

- 最初は Coolify が自動生成のドメイン（`*.sslip.io` 等）を割り当てる。
- 独自ドメインにするには、Coolify の **frontend サービスの Domains 欄**を
  `https://chizunurie.gamebox777.org` に変更する（DNS の A レコードをVPSに向けておくこと）。

backend / db にはドメインを設定しない（内部利用のみ）。

---

## 4. 環境変数を設定

`docker-compose.coolify.yml` の大半は **Coolify のマジック変数で自動**に決まる：

| 変数 | どうなる |
|---|---|
| `SERVICE_FQDN_FRONTEND_3000` | frontend の公開ドメイン＋TLS＋ルーティングを自動設定 |
| `SERVICE_URL_FRONTEND` | `https://<公開ドメイン>`。`BETTER_AUTH_URL` / `FRONTEND_URL` に入る |
| `SERVICE_PASSWORD_POSTGRES` | DBパスワードを自動生成（db と backend の DATABASE_URL で共有） |
| `SERVICE_PASSWORD_64_AUTH` | `BETTER_AUTH_SECRET` を自動生成（64文字） |

**手動で設定するのは Google OAuth の2つだけ**（このアプリは本番でも Google ログインを使う）。
Coolify の Environment Variables 画面で：

| 変数 | 値 |
|---|---|
| `GOOGLE_CLIENT_ID` | 開発と同じ値 |
| `GOOGLE_CLIENT_SECRET` | 開発と同じ値 |

> 手順0 で本番用リダイレクト URI（`https://chizunurie.gamebox777.org/api/auth/callback/google`）を
> Google 側に登録済みであること。未登録だとログイン後に `redirect_uri_mismatch` で失敗する。

---

## 5. デプロイ

1. Coolify の **Deploy** を押す
2. Coolify が3サービスのイメージをビルド（frontend / backend は repo の Dockerfile から）し、
   db を起動して、全部を内部ネットワークで繋ぐ
3. **DBマイグレーションは backend 起動時に自動適用**される（`backend/docker-entrypoint.sh` が
   `node dist/migrate.js` → サーバー起動 の順で実行）。空のDBでも初回デプロイでテーブルが揃う。

---

## 6. 動作確認

1. `https://chizunurie.gamebox777.org/` が表示され、地図が出る
2. メール／パスワードで新規登録・ログインでき、塗りが保存できる
3. （Google を設定したなら）Google ログイン後に公開ドメインへ戻り、セッションが保持される
4. リロードしてもログイン状態が維持される（Secure Cookie が効いている）

ログを見るには Coolify の各サービスの Logs を開く。backend のログに
`[migrate] 完了` → `backend listening on ...` が出ていれば起動成功。

---

## 更新（再デプロイ）

本番へ反映するときは **`main` ブランチに push** する（手順1の「以降の更新」と同じ）：

```bash
git checkout main
git merge develop
git push origin main
git checkout develop       # 作業ブランチに戻る
```

その後 Coolify で **Deploy** を押す（**Auto Deploy** を有効にしておけば `main` への push で
自動デプロイされる）。スキーマを変えたときは `cd backend && npm run db:generate` で新SQLを
生成・コミットしてから push すれば、次回デプロイで自動適用される（手動マイグレーション不要）。

---

## トラブルシューティング

- **Google ログイン後に redirect_uri_mismatch**：手順0の本番リダイレクトURIが Google 側に
  登録されているか、公開ドメインが `https://chizunurie.gamebox777.org/api/auth/callback/google`
  と一致しているか確認。`BETTER_AUTH_URL` はマジック変数 `SERVICE_URL_FRONTEND` から
  自動で公開ドメインになる。
- **ログインできるがリロードでセッションが消える**：公開ドメインが https になっているか
  （Secure Cookie は https のときだけ有効）。frontend の Domains が `https://` か確認。
- **フロントから API に繋がらない（502）**：`BACKEND_URL`（build args）が `http://backend:3001`
  になっているか。サービス名を compose から変えたら build args も合わせて `--build` で焼き直す。
- **DBに繋がらない**：`SERVICE_PASSWORD_POSTGRES` は db と backend で同じ変数を参照しているので
  自動で一致する。手動で `DATABASE_URL` を上書きしていないか確認。
- **地図データ(PMTiles)が出ない**：`japan.pmtiles` は git 管理されており `frontend/public/` に
  含まれる（`git ls-files frontend/public/data/japan.pmtiles` で確認）。

---

## どちらの方法を使う？

| | Docker Compose（このページ） | サービス3つを個別作成（[デプロイ手順.md](デプロイ手順.md)） |
|---|---|---|
| 設定量 | 少ない（1リソース・マジック変数で自動） | 多い（3リソースを個別設定） |
| ドメイン/TLS | 自動 | 手動でフロントに設定 |
| 個別スケール・再起動 | まとめて | サービス単位で柔軟 |
| おすすめ | **通常はこちら** | サービスを細かく分けて運用したいとき |
