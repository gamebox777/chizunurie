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

## ビルド方式（重要）：イメージは GitHub Actions でビルドし、Coolify は pull だけ

Coolify 内蔵のビルド（`docker compose build`）は、この環境では `npm ci` が
devDependencies を入れない等で安定せず、`tsc`/`next build` が `exit 127` で落ちる事象が出た。
**ローカルや GitHub Actions の標準 Docker では同じ Dockerfile が問題なくビルドできる**ため、
ビルドを Coolify から切り離し、次の構成にした。

```
main へ push
  └─ GitHub Actions（.github/workflows/build-images.yml・標準 Docker でビルド）
       └─ ghcr.io へ push（2タグ）:
            ghcr.io/gamebox777/chizunurie-frontend:main        ← 可変（既定で使う）
            ghcr.io/gamebox777/chizunurie-frontend:<commit-sha> ← イミュータブル（固定/ロールバック用）
            （backend も同様）
  └─ Coolify（Tailscale 経由・非公開）で手動 Redeploy → image: ...:${IMAGE_TAG} を pull
```

### 古いまま問題への恒久対応（pull_policy: always ＋ SHA タグ）

以前は compose が可変タグ `:main` を指していたため、**Coolify サーバーに古い `:main` が
キャッシュされていると再 pull されず、ビルド成功・デプロイ成功でも本番が古いまま**になる
事象があった。これを根本的に直すため compose を次のようにした：

```yaml
image: ghcr.io/gamebox777/chizunurie-frontend:${IMAGE_TAG:-main}
pull_policy: always
```

- `pull_policy: always`：Coolify で Redeploy すると**毎回必ず最新を pull** する。可変タグ
  `:main` のままでも「キャッシュした古いイメージで起動」が起きなくなる（＝主因の解消）。
- `${IMAGE_TAG:-main}`：未設定なら `:main`。**特定コミットに固定したい / ロールバックしたい**
  時は Coolify の Environment Variables で `IMAGE_TAG=<commit-sha>` にして Redeploy するだけ
  （ghcr に全コミット分の `:<sha>` が残っている）。

> **デプロイは Coolify 上で手動**（Tailscale で接続して Redeploy）。Coolify は外部公開して
> いないので、GitHub クラウドのランナーからは API も webhook も到達できない＝CI からの自動
> デプロイはしない。CI はビルドして ghcr に push するところまで（`build-images.yml`）。
> push のたび Actions のログ最後に「IMAGE_TAG に使う commit-sha」が表示される。

### 初回だけ必要な設定

1. **ghcr.io のパッケージを Public にする**（Coolify が認証なしで pull できるように）
   - 初回の GitHub Actions 成功後、GitHub の
     `https://github.com/users/gamebox777/packages` に `chizunurie-frontend` /
     `chizunurie-backend` が出る。各パッケージ → **Package settings → Change visibility →
     Public**。
   - Private のままにする場合は、Coolify 側に ghcr のレジストリ認証情報
     （PAT: `read:packages`）を登録する。
2. **Coolify の Auto Deploy を OFF** にする。
   - push 直後に走ると、まだ新イメージが ghcr に無い（Actions ビルド中）ため旧イメージを掴む。
   - Actions のビルド完了を確認してから、下記 3 の手動 Redeploy をする（順序が正しい）。
3. **デプロイは手動**（Coolify は Tailscale 内・非公開なので CI からは到達不可）。
   - Tailscale で接続 → Coolify の該当リソースで **Redeploy** を押す。
   - `pull_policy: always` なので最新の `:main` が必ず pull される。特定コミットに固定/
     ロールバックしたい時だけ env `IMAGE_TAG=<commit-sha>` にして Redeploy。
   - もし将来 CI から自動デプロイしたくなったら、`tailscale/github-action` でランナーを
     一時的に Tailnet 参加させ Coolify API を叩く方式にできる（要 Tailscale OAuth＋ACL）。

> Coolify リソースは従来どおり「Docker Compose」で **docker-compose.coolify.yml** を指す。
> 変わるのは「Coolify がビルドする」→「ghcr のイメージを pull する」だけ。

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

本番へ反映するときは **`main` ブランチに push** する。`develop` → `main` のマージ＆push は
スクリプト1つで済む：

```bash
npm run deploy        # develop を main にマージして push（scripts/deploy-main.sh）
```

push すると **GitHub Actions が自動でイメージをビルドして ghcr.io に push** する
（数分。進捗は https://github.com/gamebox777/chizunurie/actions ）。

その**ビルド完了後**に本番反映する：

- `COOLIFY_DEPLOY_WEBHOOK` を設定済みなら Actions が自動で Coolify を Deploy する。
- 未設定なら、Actions 成功を確認してから Coolify で **Deploy** を押す（pull が走る）。

> **Auto Deploy は OFF のまま**にすること。push 直後に動くと、まだ新イメージが ghcr に
> 無い（Actions ビルド中）ため Coolify が旧イメージを掴む。

スキーマを変えたときは `cd backend && npm run db:generate` で新SQLを生成・コミットしてから
push すれば、次回デプロイで自動適用される（backend 起動時に migrate・手動不要）。

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
