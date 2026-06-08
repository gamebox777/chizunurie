-- site_visits を「日別カウンター」から「日 × 訪問者」単位の集計へ移行する。
-- 旧 0006（date PK + count の単一カウンター）は適用済みのため、データを保持したまま
-- visitor 列の追加と主キーの張り替えで新スキーマへ移す（既存行は 'h:legacy' として残す）。
ALTER TABLE "site_visits" ADD COLUMN "visitor" text NOT NULL DEFAULT 'h:legacy';
--> statement-breakpoint
ALTER TABLE "site_visits" ALTER COLUMN "visitor" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "site_visits" DROP CONSTRAINT "site_visits_pkey";
--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_date_visitor_pk" PRIMARY KEY("date","visitor");
