-- user に居住国 country と、ユーザー設定を保持する settings(jsonb・既定 {}) を追加する。
ALTER TABLE "user" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;