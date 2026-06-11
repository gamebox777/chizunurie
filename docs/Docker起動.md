# Docker で環境を全部立ち上げる（フロント＋バック＋DB）

`docker-compose.prod.yml` 1ファイルで **フロント(Next.js)・バックエンド(Hono)・PostgreSQL**
を全部 Docker で起動する。Coolify のような外部サービスは不要で、ローカルPCでも単一VPSでも
同じコマンドで動く。**DBのテーブルは起動時に自動で作られる**（手動マイグレーション不要）。

## 必要なもの

- Docker（`docker compose` が使えること。`docker --version` で確認）

それだけ。Node.js もDBクライアントもローカルに入れる必要はない。

## 起動（これだけ）

プロジェクトルートで：

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

または同じことをする npm スクリプト：

```bash
npm run dev:docker     # host で動いている dev プロセスを止めてから上のコマンドを実行する
```

立ち上がったら **http://localhost:3000** をブラウザで開く。

- フロント： http://localhost:3000
- バックエンド（通常は直接叩かない）： http://localhost:3001/health → `{"status":"ok"}`
- ブラウザは **3000番だけ**を叩き、`/api/*` は Next.js が裏でバックエンド(3001)へ中継する
  （だから CORS や Cookie の問題が起きない）。

## 動作確認

```bash
# 3コンテナが healthy か
docker compose -f docker-compose.prod.yml ps

# バックエンド疎通（フロント経由の中継）
curl http://localhost:3000/api/backend/health      # → {"status":"ok"}
```

ブラウザで地図が表示され、メール／パスワードで新規登録・ログインでき、塗りが保存できればOK。

## 止める / 作り直す

```bash
docker compose -f docker-compose.prod.yml down       # 停止（DBデータは残る）
docker compose -f docker-compose.prod.yml down -v     # 停止＋DBデータも消す（まっさらに戻す）
npm run stop                                          # dev・フルDocker両方を止める
```

コードを変えたら `--build` を付けて再起動すれば反映される。

## 設定（任意）

既定値のまま `up` すれば **メール／パスワード認証まで含めて動く**。値を変えたいときだけ、
プロジェクトルートの `.env` に書く（compose が自動で読む）。

| 変数 | 既定 | 用途 |
|---|---|---|
| `POSTGRES_PASSWORD` | `devpassword` | DB パスワード |
| `BETTER_AUTH_SECRET` | （`.env` に生成済み） | セッション署名鍵。本番は `openssl rand -base64 32` で作り直す |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | （`.env` に設定） | Google ログイン用。開発・本番で同じ値を使う |
| `BETTER_AUTH_URL` / `FRONTEND_URL` | `http://localhost:3000` / `:3001` | 公開ドメインで動かすとき変更 |

### Google ログイン（開発でも使う）

`.env` に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（本番と同じ値）を設定し、Google Cloud
Console の「承認済みリダイレクト URI」に開発用の `http://localhost:3001/api/auth/callback/google`
が登録されていること。本番用 URI と同じクライアントに両方登録しておく。

## 公開ドメインで動かす（独自ドメイン・HTTPS）

ローカル検証ではなく公開する場合は、リバースプロキシ（Caddy / nginx / Traefik など）で
TLS を終端し、`http://フロント:3000` へ流す。あわせて `.env` を本番値にする：

```env
BETTER_AUTH_URL=https://chizunurie.unitygamebox.com
FRONTEND_URL=https://chizunurie.unitygamebox.com
BETTER_AUTH_SECRET=<openssl rand -base64 32 で新規生成>
POSTGRES_PASSWORD=<強いパスワード>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

> `BETTER_AUTH_URL` が `https://` だと Secure Cookie が自動で有効になる。
> 本番リダイレクト URI `https://chizunurie.unitygamebox.com/api/auth/callback/google` を
> Google 側に追加すること（開発用 `localhost:3001` の URI と同じクライアントに両方登録）。

> フロントの中継先 `BACKEND_URL` は Next.js の `rewrites()` が**ビルド時**に焼き込むため、
> `docker-compose.prod.yml` の frontend の `build.args` で `http://backend:3001`（compose の
> サービス名）を渡している。変える場合は build args 側を直し、`--build` で焼き直す。

## 仕組み（中身）

- 3サービスは Docker の内部ネットワークでサービス名（`backend` / `db`）で繋がる。DB は
  ホストに公開する必要はない（compose の `ports` はローカル確認用）。
- バックエンドのコンテナは起動時に `docker-entrypoint.sh` が
  `node dist/migrate.js`（drizzle マイグレーション適用）→ `node dist/index.js`（起動）の順で
  実行する。空のDBでも初回起動でテーブルが揃う。
- マイグレーションSQLは `backend/drizzle/*.sql`。スキーマを変えたら
  `cd backend && npm run db:generate` で新しいSQLを生成してコミットすれば、次回の
  `up --build` で自動適用される。
```
