-- GPS歩き塗りの細セル（125m = 1kmを 8×8=64 分割）進捗を表す 64 ビットマスク列を追加する。
-- bit s（s = sr*8 + sc）が立っていれば、その1kmセル内の細セル(sr,sc)を実際に歩いた。
-- 0 = 全面塗り（手動塗り・旧GPS塗り・まとめ塗り・全64細セル踏破）でセル全体を描画する。
-- 既存行は DEFAULT 0（＝全面塗り）なので見え方は変わらず、データ移行は不要。
ALTER TABLE "painted_regions" ADD COLUMN "walked_mask" bigint DEFAULT 0 NOT NULL;
