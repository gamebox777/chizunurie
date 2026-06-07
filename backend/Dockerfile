# ビルドに必要な typescript / @types/node は dependencies に入れている。
# 理由: Coolify のビルド環境では npm ci が devDependencies を入れない（実機で確認）。
#       本番イメージのビルドに必要なものは dependencies 側に置く方針にした。
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# `npm run build`(→ tsc) は node_modules/.bin の symlink / PATH 経由で tsc を探すが、
# Coolify 環境ではこれが効かず exit 127 になる。typescript 本体を node で直接叩く。
RUN node ./node_modules/typescript/bin/tsc

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
