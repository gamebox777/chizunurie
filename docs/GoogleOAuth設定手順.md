# Google OAuth 設定手順

このアプリでGoogleアカウントでのログインを有効にするための手順です。

---

## 1. GCP プロジェクトを用意する

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセスしてGoogleアカウントでサインイン
2. 画面上部のプロジェクト選択ドロップダウンをクリック
3. **「新しいプロジェクト」** をクリック
   - プロジェクト名：`chizunurie`（任意）
   - 作成後、そのプロジェクトを選択した状態にする

---

## 2. OAuth 同意画面を設定する

左メニューから **「APIとサービス」→「OAuth 同意画面」** を開く。

1. ユーザーの種類：**「外部」** を選択して「作成」
2. 以下を入力：
   - **アプリ名**：白地図ゲーム
   - **ユーザーサポートメール**：自分のGmailアドレス
   - **デベロッパーの連絡先情報**：同上
3. 「保存して次へ」を3回クリックして完了
4. **テストユーザー** の画面で、開発中にログインしたいGmailアドレスを追加しておく（本番公開前は必須）

> **注意**：ステータスが「テスト」のままでも開発には問題ありません。本番公開時に「本番環境に公開」を押してGoogleの審査を受けます。

---

## 3. OAuth 2.0 クライアントIDを作成する

左メニューから **「APIとサービス」→「認証情報」** を開く。

1. 上部の **「+ 認証情報を作成」→「OAuth クライアントID」** をクリック
2. アプリケーションの種類：**「ウェブアプリケーション」** を選択
3. 名前：`chizunurie-dev`（任意）
4. **「承認済みのリダイレクトURI」** に以下を追加：

   ```
   http://localhost:3001/api/auth/callback/google
   ```

   > 本番環境では別途 `https://your-domain.com/api/auth/callback/google` も追加する

5. 「作成」をクリック

作成完了後、ダイアログに **クライアントID** と **クライアントシークレット** が表示される。
このダイアログを閉じると再表示できないので、すぐにコピーしておく（後から「認証情報」画面で確認も可）。

---

## 4. backend/.env に設定を追記する

`backend/.env` ファイルを開いて（なければ `backend/.env.example` をコピーして作成）、以下を追記：

```env
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx
```

- `GOOGLE_CLIENT_ID`：手順3でコピーしたクライアントID
- `GOOGLE_CLIENT_SECRET`：手順3でコピーしたクライアントシークレット

---

## 5. バックエンドを再起動する

```bash
# backend/ ディレクトリで
npm run dev
```

または Docker を使っている場合：

```bash
docker compose down && docker compose up -d
```

---

## 6. 動作確認

1. フロントエンド（`http://localhost:3000`）を開く
2. ヘッダーの「ログイン」または「新規登録」をクリック
3. **「Googleでログイン」** ボタンをクリック
4. Googleのアカウント選択画面にリダイレクトされる
5. アカウントを選択するとアプリに戻り、ログイン完了

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| `redirect_uri_mismatch` エラー | リダイレクトURIが一致しない | GCPコンソールのリダイレクトURIと `BETTER_AUTH_URL` が一致しているか確認 |
| `Access blocked: This app's request is invalid` | 同意画面が未設定 | 手順2を再確認 |
| Googleの画面に進めず500エラー | 環境変数が読めていない | バックエンドを再起動、`.env` のパスと内容を確認 |
| テストユーザー以外がログインできない | 同意画面がテスト状態 | 手順2でテストユーザーに追加するか、本番公開する |

---

## 本番環境での追加設定

本番デプロイ時は以下も追加対応が必要：

1. GCPコンソールの「承認済みのリダイレクトURI」に本番URLを追加
   ```
   https://your-domain.com/api/auth/callback/google
   ```
2. 「承認済みのJavaScript生成元」に本番のフロントエンドURLを追加
   ```
   https://your-domain.com
   ```
3. OAuth 同意画面のステータスを「本番環境に公開」にしてGoogleの審査を受ける
