# 本番DBに DBeaver で接続する（Tailscale 経由）

本番 PostgreSQL を DBeaver（GUIクライアント）で覗くための手順。

- 本番 Postgres は外部非公開（`docker-compose.coolify.yml` の `db` は `expose` のみ）。
- DBeaver の **SSH トンネル**で VPS を踏み台にして接続する。SSH 先を VPS の
  **Tailscale IP** にするので、**Tailscale に繋がっている端末からしか接続できない**。

## 前提

- VPS（Coolify ホスト）が Tailscale に参加していること。
- VPS に **通常の SSH ログイン**（公開鍵 or パスワード）ができること。
  - ⚠️ DBeaver は自前の SSH クライアントを使うため、**Tailscale SSH（鍵レス認証）は使えない**。
    経路として Tailscale の IP を使うだけで、認証は VPS 側の SSH 鍵／パスワードが必要。

## DB の向き先を用意する（どちらか一方）

本番 Postgres はホストに 5432 を出していないので、トンネルの先を DB に届かせる方法を選ぶ。

### 方式A（おすすめ・安定）— ループバックにだけ 5432 を出す

`docker-compose.coolify.yml` の `db` サービスに以下を追加して再デプロイする。

```yaml
  db:
    image: postgres:16-alpine
    ...
    ports:
      - "127.0.0.1:5432:5432"   # VPS のローカルにだけ公開（インターネットには出ない）
```

- VPS の `127.0.0.1:5432` にだけバインドされるので、インターネットからは到達できない。
  SSH（＝Tailscale 経由）からのみ届く。
- DBeaver から見た DB ホストが常に `localhost` で安定する。

### 方式B（本番ファイル無変更）— コンテナ IP を直指定

本番ファイルを触りたくない場合。VPS で Postgres コンテナの IP を確認する。

```bash
docker inspect <pgコンテナ名> -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
# 例: 172.18.0.3
```

- DBeaver の Host にこの IP を入れる。
- ⚠️ コンテナを再作成すると IP が変わるので、その都度入れ直しが必要。

## DB の接続情報を調べる

DB パスワードは Coolify が自動生成している（`SERVICE_PASSWORD_POSTGRES`）。

- Coolify UI の該当 PostgreSQL リソース、または VPS で次を実行：

```bash
docker inspect <pgコンテナ名> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep POSTGRES_
# POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB が出る
```

既定値：ユーザー `postgres` ／ DB 名 `chizunurie`。

## DBeaver の設定

新規接続 → **PostgreSQL** を選び、2つのタブを設定する。

### Main タブ（DB そのものの情報）

| 項目 | 値 |
|---|---|
| Host | 方式A: `localhost` ／ 方式B: コンテナ IP |
| Port | `5432` |
| Database | `chizunurie` |
| Username | `postgres` |
| Password | 上で調べた `POSTGRES_PASSWORD` |

> Host/Port は **SSH 先（VPS）から見た DB の位置**を書く。手元 PC からではない。

### SSH タブ（Tailscale 越しの踏み台）

| 項目 | 値 |
|---|---|
| Use SSH Tunnel | ✅ ON |
| Host/IP | **VPS の Tailscale IP（100.x.y.z）or MagicDNS 名** |
| Port | `22` |
| User Name | VPS の SSH ユーザー |
| Authentication | Public Key（鍵ファイルを指定）または Password |

設定後、Main タブの「Test Connection」で疎通を確認する。

## トラブルシュート

- **トンネルは張れるが DB に繋がらない**：Main タブの Host/Port が「VPS から見た DB の位置」に
  なっているか確認（方式A なら `localhost:5432`）。方式A の `ports` 追加と再デプロイを忘れていないか。
- **SSH 認証で弾かれる**：Tailscale SSH ではなく、VPS 側の通常 SSH 鍵／パスワードが要る。
- **接続できるが Tailscale を切ると繋がらない**：意図どおり。Tailscale 接続中の端末からのみ到達できる。
