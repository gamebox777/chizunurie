# App Store 申請素材一式（mobile/app-store）

「ちずぬりえ」（`jp.chizunurie.app`）を **Apple App Store** にリリース・審査申請するための
文言・画像・申告回答をまとめたフォルダ。日本語（ja）と英語（en）の両方を用意している。
Google Play 用の `mobile/play-store/` の iOS 版にあたる。

> 画像は**ブランド配色のデザイン入りプレースホルダー**（必要解像度ちょうど）。
> そのまま申請も通せるが、ストア映えを上げたい場合は実機スクショに差し替え推奨。
> 文言中の **[運営者名]・Copyright・プライバシーポリシー URL** は公開前に要記入。

> ⚠️ **iOS 版は Unity Ads（動画リワード＋バナー広告）を搭載**している。Android の初回
> リリース（広告なし申告）とは違い、App Store では**広告あり**として申告すること
> （`privacy/app-privacy-*.md` 参照）。

---

## フォルダ構成

```
app-store/
├── README.md                         このファイル（申請チェックリスト）
├── listing/
│   ├── listing-ja.md                 App名・サブタイトル・プロモ文・説明・キーワード・新機能（日本語）
│   └── listing-en.md                 同上（英語）
├── privacy/
│   ├── app-privacy-ja.md             App のプライバシー（栄養表示）・年齢制限・ATT/広告の回答（日本語）
│   └── app-privacy-en.md             同上（英語）
├── graphics/
│   ├── icon/icon-1024.png            App Store アイコン 1024×1024（アルファ無し・実機アイコンと同一）
│   └── screenshots/
│       ├── iphone-6.9/{ja,en}/0N.png  1290×2796（6.9型 iPhone・★必須・各5枚）
│       ├── iphone-6.5/{ja,en}/0N.png  1242×2688（6.5型 iPhone・任意・各5枚）
│       └── ipad-13/{ja,en}/0N.png     2048×2732（13型 iPad・iPad対応のため必須・各2枚）
└── tools/
    └── build-graphics.mjs            スクショ（仮）を全解像度で再生成するスクリプト
```

> プライバシーポリシー本文は Play 版と共通の公開ページ
> **https://chizunurie.unitygamebox.com/privacy** を使う（`mobile/play-store/privacy-policy/`
> にも本文・ホスティング用 HTML がある）。App Store には同じ URL を登録する。

### 画像を作り直す / 文言を変えたとき

```bash
cd mobile/app-store/tools
node build-graphics.mjs     # graphics/screenshots/ 以下を全部作り直す（headless Chrome 使用）
```

- キャプションは `build-graphics.mjs` 内の `CAPTIONS` を編集。
- 出力サイズ・端末は `DEVICES` を編集（出力後に sips で解像度ちょうどに正規化する）。
- アイコンは生成せず、実機の `ios/.../AppIcon.appiconset/AppIcon-512@2x.png`（1024×1024・
  アルファ無し）を `graphics/icon/icon-1024.png` にコピーして使う。

### 実機の本物スクショに差し替えたいとき

- Xcode のシミュレータ（iPhone 16 Pro Max = 6.9型 / iPad Pro 13型）で本番URLを開き
  スクリーンショット（⌘S）→ 解像度がストア要件と一致する。
- `mobile/run-sim.sh` でシミュレータ起動の手順あり。

---

## App Store Connect 提出チェックリスト

### A. App 情報・各言語メタデータ
- [ ] 日本語(ja): `listing/listing-ja.md` を貼付（App名・サブタイトル・プロモ・説明・キーワード・新機能）
- [ ] 英語(en-US): `listing/listing-en.md` を貼付
- [ ] App アイコン: `graphics/icon/icon-1024.png`（1024×1024・**アルファ無し**＝App Store 要件）
- [ ] iPhone 6.9型スクショ: `graphics/screenshots/iphone-6.9/{ja,en}/`（**必須**・最大10枚）
- [ ] （任意）iPhone 6.5型: `graphics/screenshots/iphone-6.5/{ja,en}/`
- [ ] iPad 13型スクショ: `graphics/screenshots/ipad-13/{ja,en}/`（**iPad対応なら必須**）
- [ ] カテゴリ: ゲーム ＞ カジュアル（セカンダリ任意）／価格: 無料

### B. App のプライバシー・年齢制限（申告）
- [ ] App のプライバシー（栄養表示）を入力（`privacy/app-privacy-*.md` の表のとおり）
- [ ] **広告: あり**（Unity Ads・動画リワード＋バナー）として申告
- [ ] トラッキング方針を確定（SKAdNetwork のみ=ATTなし / IDFA=ATTあり）→ 申告と Info.plist を一致
- [ ] プライバシーポリシー URL を登録: https://chizunurie.unitygamebox.com/privacy
- [ ] 年齢制限アンケートに回答（暴力等なし・広告ありを反映＝4+ 相当の見込み）
- [ ] データ削除手段を申告（App 内 `/delete-account`・連絡先メール）
- [ ] キッズカテゴリには登録しない

### C. リリース（技術面・別途必要）
- [ ] Apple Developer Program 登録（年額・$99）
- [ ] App Store Connect で App を作成（Bundle ID `jp.chizunurie.app`）
- [ ] 署名（Distribution 証明書＋App Store 用プロビジョニング）を用意
      ／Xcode の自動署名（`DEVELOPMENT_TEAM` 設定済み）でも可
- [ ] `MARKETING_VERSION`（現 1.0）/ `CURRENT_PROJECT_VERSION`（現 2）を確認
- [ ] Xcode で Archive → Organizer から App Store Connect にアップロード
      （または `xcodebuild -workspace ... archive` ＋ `xcrun altool`/`notarytool`）
- [ ] TestFlight（内部/外部テスト）→ 製品版申請の順で進める
- [ ] 審査ノートに「位置情報＝現地塗り・バックグラウンドは歩行中の継続塗り」「広告＝Unity Ads」
      「ゲストで全機能を試せる（ログイン任意）」を記載

#### Archive / アップロードの例（参考）
```bash
cd mobile && npx cap sync ios
open ios/App/App.xcworkspace
# Xcode: Product > Archive → Distribute App > App Store Connect
```

---

## ⚠️ 公開前に必ず差し替える / 確認する項目

| 項目 | 現在の仮値 / 状態 | 対応先 |
|---|---|---|
| 運営者名 / Copyright | `[運営者名を記入]` | listing/*, App Store Connect |
| プライバシーポリシー URL | https://chizunurie.unitygamebox.com/privacy | listing/*, App Store Connect |
| Unity Ads のトラッキング方針 | 未確定（SKAdNetwork のみ前提で記述） | `privacy/app-privacy-*.md`, Info.plist, Unity Dashboard |
| ATT 文言 | `NSUserTrackingUsageDescription` 未設定 | IDFA を使うなら Info.plist に追加 |
| App ID | `jp.chizunurie.app`（確定後は変更不可） | capacitor.config.ts, Xcode |

---

## English summary

This folder contains everything to submit **Color the Map** (`jp.chizunurie.app`) to the
**Apple App Store**, in Japanese (ja) and English (en) — the iOS counterpart of
`mobile/play-store/`.

- **Listing text**: `listing/listing-en.md` (name / subtitle / promo / description / keywords / what's new)
- **App Privacy & Age Rating**: `privacy/app-privacy-en.md`. Unlike Android, the iOS build
  **contains ads** (Unity Ads rewarded + banner) — declare ads and the related data
  collection. Decide SKAdNetwork-only (no ATT) vs IDFA (ATT) and keep it consistent with
  `Info.plist` and the Unity Dashboard.
- **Graphics** (exact required sizes): `graphics/`
  - icon 1024×1024 (no alpha; same as the shipped app icon)
  - iPhone 6.9" 1290×2796 (required, ×5), iPhone 6.5" 1242×2688 (optional, ×5),
    iPad 13" 2048×2732 (required for iPad, ×2)
  - Regenerate screenshots with `node tools/build-graphics.mjs`; swap in real simulator
    shots for better store appeal.
- **Privacy policy**: register the same live URL as Android —
  https://chizunurie.unitygamebox.com/privacy
- **Before publishing**, fill in operator name / copyright and confirm the ad tracking
  policy. The on-device display name is already unified to `ちずぬりえ` (iOS Info.plist,
  capacitor.config.ts, Android strings.xml).
