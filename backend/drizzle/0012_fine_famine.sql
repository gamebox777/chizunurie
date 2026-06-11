-- ユーザー個別の Web 広告配信の上書き設定（{ auto?: boolean, reward?: boolean }）を追加。
-- キーが無い項目は全体設定（app_settings.webAds）に従い、在れば全体設定より優先する。
-- ユーザー自身が書き換えられる user.settings とは別カラム（開発者の管理画面からのみ編集）。
ALTER TABLE "user" ADD COLUMN "ad_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
