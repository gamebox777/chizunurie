-- painted_regions に最終訪問日時 last_visit_at を追加（塗ったセルへの再訪を記録する）。
ALTER TABLE "painted_regions" ADD COLUMN "last_visit_at" timestamp with time zone;