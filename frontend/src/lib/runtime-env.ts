// アプリの実行モードを判定する。
//
// - npm run dev        : `next dev` なので NODE_ENV === 'development'
// - フル Docker / 本番 : どちらも本番ビルド（NODE_ENV=production）なので区別できない。
//                        ビルド時に渡す NEXT_PUBLIC_APP_ENV で見分ける。
//                          docker-compose.prod.yml → build args で 'docker'
//                          Coolify(本番)           → 既定 'production'
//
// NEXT_PUBLIC_* はビルド時にバンドルへ埋め込まれる（実行時 env では変わらない）点に注意。

export type RunMode = "dev" | "docker" | "production";

export function getRunMode(): RunMode {
  if (process.env.NODE_ENV === "development") return "dev";
  if (process.env.NEXT_PUBLIC_APP_ENV === "docker") return "docker";
  return "production";
}

export const RUN_MODE: RunMode = getRunMode();

export const RUN_MODE_LABEL: Record<RunMode, string> = {
  dev: "npm run dev（開発）",
  docker: "フル Docker",
  production: "本番",
};

// バッジの配色（Tailwind クラス）
export const RUN_MODE_BADGE: Record<RunMode, string> = {
  dev: "bg-green-100 text-green-700 border-green-300",
  docker: "bg-blue-100 text-blue-700 border-blue-300",
  production: "bg-red-100 text-red-700 border-red-300",
};
