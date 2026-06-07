# build と deps を1ステージにまとめる。
# Coolify 環境でのみ `tsc` が exit 127（= ./node_modules/.bin/tsc が無い）で落ちる。
# ローカル(docker / docker compose build)では --include=dev で必ず devDeps が入り再現しない。
# → Coolify では npm ci 後に typescript(devDep) が入っていないと判断。
#   下で有無をログに出し、無ければ明示インストールして自己修復する。
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
# tsc(typescript) の有無を確認。無ければ明示的に入れる（ログで原因も分かる）。
RUN if [ -e node_modules/typescript/bin/tsc ]; then \
      echo ">>> typescript present after npm ci"; \
    else \
      echo ">>> typescript MISSING after npm ci (Coolify が devDeps を入れていない) — 明示インストールします"; \
      ls -la node_modules/.bin/ || true; \
      npm install --no-save typescript@5; \
    fi
COPY . .
# npx は node_modules のローカル tsc を使う（PATH 非依存）。
RUN npx tsc

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# 起動時マイグレーション用：SQL とジャーナル（drizzle/）と entrypoint を同梱する。
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3001
# entrypoint がマイグレーションを適用してから node dist/index.js を起動する。
CMD ["./docker-entrypoint.sh"]
