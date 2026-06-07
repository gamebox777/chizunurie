#!/usr/bin/env bash
#
# モード別の起動スクリプト。競合する側を先に停止してから起動する。
#
#   scripts/start.sh local    ローカル dev（host で frontend/backend/studio、db のみ Docker）
#   scripts/start.sh docker   フル Docker（frontend/backend/db を全部 Docker）
#   scripts/start.sh stop     両モードを止める（コンテナ停止＋host プロセス掃除）
#
# npm からは: npm run dev:local / npm run dev:docker / npm run stop
#
set -euo pipefail
cd "$(dirname "$0")/.."

PROD_COMPOSE="docker-compose.prod.yml"
# dev/docker のどちらでも使われ得る host 側ポート
#   3000 frontend / 3001 backend / 3002 frontend のフォールバック / 4983 drizzle studio
HOST_PORTS=(3000 3001 3002 4983)

# 指定ポートを掴んでいる「host プロセス」を停止する。
# docker-proxy（com.docker / com.docke）は除外する（殺すと Docker 全体が落ちるため）。
free_host_port() {
  local port="$1" pids
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null \
    | awk 'NR>1 && $1 !~ /^com\.docke/ {print $2}' | sort -u || true)
  [ -z "$pids" ] && return 0
  echo "  port $port の host プロセスを停止: $pids"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null \
    | awk 'NR>1 && $1 !~ /^com\.docke/ {print $2}' | sort -u || true)
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

free_all_host_ports() {
  for p in "${HOST_PORTS[@]}"; do free_host_port "$p"; done
}

# フル Docker 版（frontend/backend）を停止して 3000/3001 を解放する。
stop_full_docker_app() {
  if docker compose -f "$PROD_COMPOSE" ps --status running 2>/dev/null | grep -qE 'frontend|backend'; then
    echo "  フル Docker 版の frontend/backend を停止します"
    docker compose -f "$PROD_COMPOSE" rm -sf frontend backend >/dev/null 2>&1 || true
  fi
}

case "${1:-}" in
  local)
    echo "▶ ローカル dev モードで起動します（host: frontend/backend/studio, Docker: db のみ）"
    stop_full_docker_app          # 3000/3001 を握っている Docker app を停止
    free_all_host_ports           # 前回 dev の残骸プロセスを掃除
    echo "▶ npm run dev を起動（predev で db を Docker 起動）"
    exec npm run dev
    ;;
  docker)
    echo "▶ フル Docker モードで起動します（frontend/backend/db を全部 Docker）"
    free_all_host_ports           # host の dev プロセスを停止して 3000/3001 を解放
    echo "▶ docker compose -f $PROD_COMPOSE up -d --build"
    exec docker compose -f "$PROD_COMPOSE" up -d --build
    ;;
  stop)
    echo "▶ 両モードを停止します"
    free_all_host_ports
    docker compose -f "$PROD_COMPOSE" down >/dev/null 2>&1 || true
    docker compose down >/dev/null 2>&1 || true
    echo "✓ 停止しました"
    ;;
  *)
    echo "usage: scripts/start.sh {local|docker|stop}" >&2
    exit 1
    ;;
esac
