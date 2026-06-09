-- user に最終アクセス時の IP(last_ip_address)・UA(last_user_agent) を追加する。
ALTER TABLE "user" ADD COLUMN "last_ip_address" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_user_agent" text;