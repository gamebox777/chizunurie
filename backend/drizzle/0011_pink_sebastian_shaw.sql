-- ユーザーログにクライアント環境の列を追加する。
-- platform: 実行プラットフォーム（web / pwa / ios / android・クライアント申告）
-- app_version: バージョン表記（例 "app 1.3 (4) / web 2026-06-10 23:45"・アプリ版は APK と Web の版を併記）
ALTER TABLE "user_logs" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "user_logs" ADD COLUMN "app_version" text;
