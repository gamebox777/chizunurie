# イメージは GitHub Actions（標準 Docker）でビルドして ghcr.io に push する。
# Coolify はこのイメージを pull するだけ（Coolify のビルド環境は使わない）。
# typescript / @types/node は dependencies に置いている（過去の経緯・害は無い）。
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

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
