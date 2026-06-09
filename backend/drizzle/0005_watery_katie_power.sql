-- painted_regions から IP/UA 列を削除する（塗り記録には個人特定情報を残さない方針へ変更）。
ALTER TABLE "painted_regions" DROP COLUMN "ip_address";--> statement-breakpoint
ALTER TABLE "painted_regions" DROP COLUMN "user_agent";