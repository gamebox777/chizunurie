ALTER TABLE "user_points" ADD COLUMN "reward_nonce" text;--> statement-breakpoint
ALTER TABLE "user_points" ADD COLUMN "reward_nonce_at" timestamp with time zone;