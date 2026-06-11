// バックエンドの実行環境を判定する。
//
// フロントエンド（frontend/src/lib/runtime-env.ts）と同じ3値を返すが、
// バックエンド固有の判定ロジックを使う。
//
//   dev        : NODE_ENV が未設定または 'development'（npm run dev）
//   docker     : NODE_ENV=production かつ DATABASE_URL がコンテナ内ホスト名
//                （docker-compose.prod.yml の backend サービス）
//   production : NODE_ENV=production（Coolify 本番）
export function getRunMode() {
    const nodeEnv = process.env.NODE_ENV;
    if (!nodeEnv || nodeEnv === "development")
        return "dev";
    // フル Docker（docker-compose.prod.yml）は DATABASE_URL のホストが db:5432。
    // Coolify 本番も db:5432 だが、APP_ENV 環境変数で明示的に区別できるようにする。
    // バックエンドの docker-compose に APP_ENV=docker を追加すれば区別できる。
    // 追加していない場合は production にフォールバック。
    if (process.env.APP_ENV === "docker")
        return "docker";
    return "production";
}
export const RUN_MODE = getRunMode();
