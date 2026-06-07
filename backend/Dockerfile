FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# ビルドには tsc(typescript) など devDependencies が必要。Coolify のビルド環境では
# NODE_ENV=production が効いて npm ci が devDeps を省く（→ `tsc: not found` / exit 127）ため、
# --include=dev で必ず devDeps も入れる。
RUN npm ci --include=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
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
