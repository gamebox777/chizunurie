-- 匿名プレイ対応：user に匿名ユーザー判定フラグ is_anonymous（既定 false）を追加する。
ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;