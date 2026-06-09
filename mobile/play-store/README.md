# Play ストア申請素材一式（mobile/play-store）

「ちずぬりえ」（`jp.chizunurie.app`）を **Google Play** にリリース・審査申請するための
文言・画像・申告回答をまとめたフォルダ。日本語版（ja）と英語版（en）の両方を用意している。

> 画像は**ブランド配色のデザイン入りプレースホルダー**（必要解像度ちょうど）。
> そのまま申請も通せるが、ストア映えを上げたい場合は実機スクショに差し替え推奨。
> 文言中の **[運営者名]・[連絡先]・プライバシーポリシー URL** は公開前に要記入。

---

## フォルダ構成

```
play-store/
├── README.md                         このファイル（申請チェックリスト）
├── listing/
│   ├── listing-ja.md                 アプリ名・簡単な説明・詳しい説明・リリースノート（日本語）
│   └── listing-en.md                 同上（英語）
├── privacy-policy/
│   ├── index.html                    ホスティング用（JA/EN 切替・自己完結）★Play にこの URL を登録
│   ├── privacy-policy-ja.md          プライバシーポリシー本文（日本語）
│   └── privacy-policy-en.md          同上（英語）
├── policy/
│   ├── app-content-ja.md             データセーフティ・コンテンツレーティング・広告・対象年齢の回答（日本語）
│   └── app-content-en.md             同上（英語）
├── graphics/
│   ├── icon/icon-512.png             アプリアイコン 512×512（言語非依存・必須）
│   ├── feature/feature-1024x500-ja.png, -en.png   フィーチャーグラフィック（必須）
│   └── screenshots/
│       ├── phone/{ja,en}/01..05.png      スマホ 1080×1920（各5枚・最低2枚必須）
│       ├── tablet7/{ja,en}/01..02.png    7型タブレット 1200×1920（任意）
│       └── tablet10/{ja,en}/01..02.png   10型タブレット 1600×2560（任意）
└── tools/
    ├── build-graphics.mjs            画像（仮）を全解像度で再生成するスクリプト
    └── capture.mjs                   本番サイトを実機解像度でキャプチャ（実スクショ差し替え用）
```

### 画像を作り直す / 文言を変えたとき

```bash
cd mobile/play-store/tools
node build-graphics.mjs     # graphics/ 以下を全部作り直す（headless Chrome 使用）
```

キャプション等は `build-graphics.mjs` 内の `CAPTIONS` を編集。

### 実機の本物スクショに差し替えたいとき

```bash
cd mobile/play-store/tools
node capture.mjs            # 本番サイトを 1080×1920 でキャプチャ → graphics/screenshots/raw/
# もしくはエミュ実機で撮る: ../README.md の run-emu.sh 手順 → adb exec-out screencap
```

---

## Play Console 提出チェックリスト

### A. ストアの掲載情報（言語ごと）
- [ ] 日本語(ja-JP): `listing/listing-ja.md` を貼付
- [ ] 英語(en-US): `listing/listing-en.md` を貼付
- [ ] アプリアイコン: `graphics/icon/icon-512.png`
- [ ] フィーチャーグラフィック: `graphics/feature/feature-1024x500-{ja,en}.png`
- [ ] スマホのスクショ: `graphics/screenshots/phone/{ja,en}/` から最低2枚（推奨5枚）
- [ ] （任意）タブレットのスクショ: `graphics/screenshots/tablet7/`, `tablet10/`

### B. アプリのコンテンツ（申告）
- [ ] プライバシーポリシー URL を登録（`privacy-policy/index.html` を公開した URL）
- [ ] **広告: なし**（初回リリースはアプリ内で広告非表示。リワードボタンは `!isNativeApp()` で隠れ、広告SDK gpt.js もアプリでは未ロード）→ `policy/app-content-*.md` 参照
- [ ] データセーフティを入力（位置情報・メール・分析… 表のとおり。広告IDなし）
- [ ] コンテンツレーティング(IARC) アンケートに回答（暴力等なし＝全年齢相当）
- [ ] 対象ユーザー: 13歳以上 /「子ども向け」ではない
- [ ] データ削除リクエスト手段（連絡先メール、可能なら削除リクエスト URL）

### C. リリース（技術面・別途必要）
- [ ] **署名付き AAB を用意**（Play は AAB 必須・現状の `npm run apk` は debug APK のみ）
- [ ] アップロード鍵を作成し Play App Signing を有効化（下記コマンド例）
- [ ] `versionCode`/`versionName` を確認（現在 1 / 1.0）→ 更新ごとに versionCode を増やす
- [ ] ターゲット API レベル: 35（要件を満たす）
- [ ] 位置情報権限の用途: 既に Manifest 宣言済み（`ACCESS_FINE/COARSE_LOCATION`）。
      データセーフティと整合させる
- [ ] 内部テスト → クローズドテスト → 製品版 の順で公開トラックを進める

#### 署名付き AAB のビルド例（参考）
```bash
# 1) アップロード鍵を作成（初回のみ・安全に保管）
keytool -genkey -v -keystore upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 9125

# 2) android/app/build.gradle に signingConfigs を追加して release に紐付け
#    （または Android Studio の Build > Generate Signed Bundle で AAB を作成）

# 3) AAB をビルド
cd mobile/android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew bundleRelease
#  → app/build/outputs/bundle/release/app-release.aab を Play Console にアップロード
```

---

## ⚠️ 公開前に必ず差し替える項目

| 項目 | 現在の仮値 | 置き換え先ファイル |
|---|---|---|
| 運営者名 | `[運営者名を記入]` | privacy-policy/*, policy/* |
| 問い合わせメール | rin7studio@gmail.com（公開される） | listing/*, privacy-policy/* |
| プライバシーポリシー URL | 例 .../privacy | listing/*, Play Console |
| アプリID | `jp.chizunurie.app`（確定後は変更不可） | capacitor.config.ts, build.gradle |

---

## English summary

This folder contains everything to submit **Color the Map** (`jp.chizunurie.app`) to
Google Play, in both Japanese (ja) and English (en).

- **Listing text**: `listing/listing-en.md` (name / short / full / release notes)
- **Privacy policy**: host `privacy-policy/index.html` and register its URL
- **App content / Data safety / Rating**: `policy/app-content-en.md`
  (the app is a WebView wrapper; Google **Analytics, Sign-In, GPS** apply, but the
  **app shows no ads** in the initial release — declare **"Contains ads: No"**.
  The rewarded-ad button is hidden via `!isNativeApp()` and gpt.js never loads in
  the app; the browser version still has ads.)
- **Graphics** (exact required sizes, placeholders): `graphics/`
  - icon 512×512, feature 1024×500, phone 1080×1920 ×5, tablet 7"/10" optional
  - Regenerate with `node tools/build-graphics.mjs`; swap in real shots via `tools/capture.mjs`
- **Before publishing**, fill in operator name, contact email, and privacy URL,
  and build a **signed AAB** (Play requires AAB; `npm run apk` only makes a debug APK).
