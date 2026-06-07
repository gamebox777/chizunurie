# build と deps を1ステージにまとめる。
# 以前は deps ステージで npm ci → builder ステージへ COPY node_modules していたが、
# Coolify 環境でのみ `npm run build`(tsc) が exit 127 で落ちていた（ローカルでは再現せず）。
# クロスステージ COPY を排除し、同一ステージで install→検証→build する。
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# devDependencies(tsc など)も必ず入れる（NODE_ENV/omit 設定に左右されないよう --include=dev）。
RUN npm ci --include=dev
# 診断＆ガード：ここで tsc が無ければ install 段階の問題と分かる（build まで進まず明示的に失敗）。
RUN node --version && npm --version && echo "PATH=$PATH" \
 && ls -la node_modules/.bin/ | grep -iE 'tsc|tsx' || true
RUN ./node_modules/.bin/tsc --version
COPY . .
# npm run build ではなく直接 tsc を叩く（PATH 解決に依存しない）。
RUN ./node_modules/.bin/tsc

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
