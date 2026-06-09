-- 世界版対応：painted_regions に国コード country 列を追加（塗りセルの所属国を保存）。
ALTER TABLE "painted_regions" ADD COLUMN "country" text;