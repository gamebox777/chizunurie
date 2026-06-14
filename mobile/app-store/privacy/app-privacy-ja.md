# App のプライバシー・年齢制限の申告（App Store Connect 回答集）/ 日本語

App Store Connect の「App のプライバシー（App Privacy / プライバシー栄養表示）」と
「年齢制限指定（Age Rating）」で求められる申告の回答案。

> **重要：iOS 版は Unity Ads を組み込んでおり、広告（動画リワード＋バナー）を表示する。**
> Android の初回リリース（広告なし申告）とは異なり、iOS では**広告あり**として
> データ収集・トラッキングを正しく申告する必要がある。
> （根拠: `mobile/ios/.../Info.plist` の `SKAdNetworkItems`、frontend の
> `lib/nativeRewardedAd.ts` / `lib/nativeBannerAd.ts`、Map.tsx の `isNativeApp()` 分岐）

---

## 0. 前提（このアプリの構成）

- 本番サイト（https://chizunurie.unitygamebox.com）を WebView で表示する Capacitor ラッパー。
- サイト側で **Google ログイン（任意）・GPS（現地塗り）・Google Analytics** を使用。
- ネイティブ側で **Unity Ads（動画リワード／バナー広告）** を表示。
- ゲスト（未ログイン）でも遊べる。ログインしなければメール・氏名は取得しない。

---

## 1. App のプライバシー（収集するデータの種類）

App Store Connect では「データの種類 → 用途 → ユーザーに紐づくか／トラッキングに使うか」を申告する。

| データの種類 | 収集 | 用途 | ユーザーに紐づく | トラッキング | 備考 |
|---|---|---|---|---|---|
| **位置情報（正確な位置）** | ○ | App の機能 | ○（ログイン時） | × | 現地塗り。許可制 |
| **メールアドレス** | ○ | App の機能 / アカウント | ○ | × | Google ログイン時のみ |
| **氏名（表示名）** | ○ | App の機能 / アカウント | ○ | × | Google ログイン時のみ |
| **ユーザーID** | ○ | App の機能 / 分析 | ○ | × | アカウント識別 |
| **使用状況データ（操作・ゲーム進行）** | ○ | App の機能 / 分析 | ○ | × | 塗り・ポイント・レベル |
| **診断（クラッシュ・パフォーマンス・ログ）** | ○ | 分析 / 不正防止 | △ | × | 行動監査ログ |
| **デバイスID / 識別子** | ○ | 分析 / **第三者広告** | △ | **○（可能性あり）** | GA・Unity Ads |
| **広告データ（広告とのやり取り）** | ○ | **第三者広告** | △ | **○（可能性あり）** | Unity Ads |
| **おおよその位置（広告由来）** | △ | 第三者広告 | × | ○（可能性あり） | Unity Ads が IP 等から推定する場合 |

> **トラッキング（App Tracking Transparency）について**
> - Unity Ads は **SKAdNetwork のみのモード**なら IDFA を使わず ATT 同意も不要にできる。
>   その場合「トラッキング」は「いいえ」で申告できる（推奨・審査が軽い）。
> - もし IDFA を使う（パーソナライズ広告）構成なら、`NSUserTrackingUsageDescription` を
>   `Info.plist` に追加し ATT プロンプトを出したうえで、上表の「トラッキングに使用」を
>   **はい**で申告すること。**現状 `Info.plist` に `NSUserTrackingUsageDescription` は無い**
>   ので、ATT を出さない（IDFA を使わない）前提なら追加不要。
> - Unity Dashboard の「Data Privacy」設定（COPPA / 同意フラグ）と申告を必ず一致させる。

### 第三者 SDK / 共有先
- **Unity Ads（Unity Technologies）**: 広告配信。デバイス識別子・広告とのやり取り・
  おおよその位置を扱う場合がある。
- **Google Analytics（Google）**: 利用状況・識別子（分析目的）。
- **Google Sign-In（Google）**: 認証（メール・氏名）。

### セキュリティ等
- 送信時の暗号化（HTTPS）: **はい**（本番は https）。
- データ削除の手段: **あり**（アプリ内 `/delete-account` で `authClient.deleteUser()`・
  連絡先メールでも受付）。App 内のアカウント削除導線を「アカウント削除」要件として申告。

---

## 2. 年齢制限指定（Age Rating アンケート）

- 暴力・性的表現・刺激物・ギャンブル等: **すべて「なし」**
- **広告**: あり（第三者広告を表示）→ アンケートの該当項目を正しく回答
- ユーザー生成コンテンツ・無制限の Web アクセス: チャット等の自由交流は無し。
  WebView は自社サイト中心（OAuth 等の限定ナビゲーションのみ許可）。
- 想定レーティング: **4+ 相当**（広告ありでも年齢区分自体は上がらない見込み。
  アンケートは正確に回答すること）。

---

## 3. 対象年齢・キッズカテゴリ

- **キッズカテゴリには登録しない**（位置情報・第三者広告・分析を含むため）。
- 主に 13 歳以上を想定。子どもを意図的な対象にしていない。

---

## 4. 位置情報の用途（App Review 向け補足・Info.plist と整合）

- `NSLocationWhenInUseUsageDescription`: 「歩いた場所を地図に塗るため、現在地を使用します。」
- `NSLocationAlwaysAndWhenInUseUsageDescription`: 「画面を消していても歩いた場所を塗り続けるため、
  バックグラウンドでも現在地を使用します。」（`UIBackgroundModes=location`）
- **バックグラウンド位置情報の根拠**: GPS 追跡中、画面消灯/バックグラウンドでも歩いた
  約125mセルを塗り続けるため（`@capgo/background-geolocation`）。審査ノートにこの用途を明記する。
- 位置情報を許可しなくても、手動（なぞり・となり塗り）で遊べる。

---

## 5. 公開前に揃える項目

| 項目 | 状態 / 対応 |
|---|---|
| 運営者名 / Copyright | `[運営者名を記入]`（listing/* と整合） |
| プライバシーポリシー URL | https://chizunurie.unitygamebox.com/privacy（公開済みを確認） |
| Unity Ads のトラッキング方針 | SKAdNetwork のみ or IDFA(ATT) を決め、申告と Info.plist を一致 |
| ATT 文言 | IDFA を使うなら `NSUserTrackingUsageDescription` を追加 |
| データ削除 | App 内 `/delete-account` の導線を「アカウント削除」要件として申告 |
