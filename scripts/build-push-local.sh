#!/usr/bin/env bash
#
# 自分の PC で frontend / backend のイメージをビルドして ghcr.io に push する。
# GitHub Actions の代わりに「急ぎで反映したい」とき用。push 後に Coolify で Deploy する。
#
# 事前に1度だけ: docker login ghcr.io（PAT に write:packages 権限）
# 使い方: プロジェクトルートで `npm run deploy:local`
#
# Coolify サーバーは arm64 なので arm64 のみビルドする（自分の Mac も arm64＝ネイティブで速い）。
set -euo pipefail

OWNER="gamebox777"
PLATFORM="linux/arm64"        # Coolify サーバーのアーキ
TAG="main"
FE="ghcr.io/${OWNER}/chizunurie-frontend:${TAG}"
BE="ghcr.io/${OWNER}/chizunurie-backend:${TAG}"

cd "$(git rev-parse --show-toplevel)"

echo "→ backend をビルド ($PLATFORM)"
docker build --platform "$PLATFORM" -t "$BE" ./backend

echo "→ frontend をビルド ($PLATFORM)"
# rewrites() の中継先はビルド時に焼き込まれる。compose のサービス名は backend。
docker build --platform "$PLATFORM" --build-arg BACKEND_URL=http://backend:3001 -t "$FE" ./frontend

echo "→ push"
docker push "$BE"
docker push "$FE"

echo "✓ push 完了:"
echo "    $BE"
echo "    $FE"
echo "  → このあと Coolify で Deploy（image を pull して再起動）"
