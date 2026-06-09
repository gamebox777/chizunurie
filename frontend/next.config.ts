import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
