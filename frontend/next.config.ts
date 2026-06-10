import type { NextConfig } from "next";

// Web 側の「バージョン」として設定メニュー最下部に出すビルド日時（JST）。
// `next build` 実行時（dev では dev サーバー起動時）に評価されて焼き込まれる。
// 例: "2026-06-10 23:45"（sv-SE ロケールは "YYYY-MM-DD HH:mm:ss" 形式なので先頭16文字を使う）
const buildTime = new Date()
  .toLocaleString("sv-SE", { timeZone: "Asia/Tokyo", hour12: false })
  .slice(0, 16);

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  turbopack: {
    root: __dirname,
  },
  // 開発時、Capacitor アプリ(mobile/)を `npm run play:dev` で動かすと WebView は
  // http://10.0.2.2:3000（エミュから見たホストMacの localhost）を開く。Next.js 16 は
  // 既定でこの「別ホスト」からの dev リソース(/_next/*・HMR)アクセスをブロックするため、
  // マップ等のチャンクが読めず画面が出ない。dev で許可するホストを明示する（本番は無影響）。
  allowedDevOrigins: ["10.0.2.2"],
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3001";
    return [
      {
        source: "/api/auth/:path*",
        destination: `${backendUrl}/api/auth/:path*`,
      },
      {
        source: "/api/backend/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
