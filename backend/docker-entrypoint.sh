#!/bin/sh
# バックエンドの起動エントリポイント。
# サーバーを立てる前に DB マイグレーションを適用するので、空の DB に対して
# `docker compose up` しただけでテーブルが揃い、そのまま動く。
set -e

echo "[entrypoint] DB マイグレーションを実行します"
node dist/migrate.js

echo "[entrypoint] バックエンドを起動します"
exec node dist/index.js
