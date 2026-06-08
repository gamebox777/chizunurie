ALTER TABLE "user" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;