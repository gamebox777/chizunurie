-- ゲーム全体で共有する共通設定テーブル app_settings を追加する。
-- ユーザーごとの user.settings とは別に、ゲーム全体で常に id=1 の1行だけを持ち、
-- デバッグ用の十字キー移動スピードなど開発者がゲーム全体に効かせたい設定を jsonb にまとめて入れる。
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
