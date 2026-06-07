FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
# next build にも devDependencies が必要。NODE_ENV=production でも devDeps を省かせない。
RUN npm ci --include=dev

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# rewrites() の中継先はビルド時に焼き込まれるため Build Arg で受け取る。
# Coolify の「Build Variable」に BACKEND_URL を設定する。
ARG BACKEND_URL=http://chizunurie-backend:3001
ENV BACKEND_URL=$BACKEND_URL
# 実行モード表示用（デバッグメニュー）。NEXT_PUBLIC_* はビルド時にバンドルへ埋め込まれる。
# 既定は本番(production)。フル Docker 版は compose 側で 'docker' を渡す。
ARG NEXT_PUBLIC_APP_ENV=production
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
# standalone サーバーを 0.0.0.0 で待ち受ける（コンテナ外から到達可能にする）
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
