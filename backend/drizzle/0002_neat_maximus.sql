-- user_points に動画リワードの二重受け取り防止用 nonce（reward_nonce）と
-- その発行時刻 reward_nonce_at を追加する。
ALTER TABLE "user_points" ADD COLUMN "reward_nonce" text;--> statement-breakpoint
ALTER TABLE "user_points" ADD COLUMN "reward_nonce_at" timestamp with time zone;