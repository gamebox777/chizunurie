# mobile/ — Capacitor（リモートURL方式）

既存の本番Webサイトを iOS / Android のネイティブ WebView に包むだけのプロジェクト。
`frontend` / `backend` のコードには一切触らないため、**ブラウザ版の挙動は完全に同一**。

## 仕組み

`capacitor.config.ts` の `server.url` に本番の公開URLを指定し、アプリ起動時にその
サイトを WebView で開く。Web は二重メンテ不要（ブラウザもアプリも同じデプロイを見る）。

## セットアップ手順

```bash
cd mobile
npm install

# 1) 本番ドメインを設定（capacitor.config.ts の server.url を実URLに置換）
#    例: url: "https://chizunurie.example.com"

# 2) ネイティブプロジェクトを生成（iOS は Xcode + CocoaPods、Android は Android Studio 必須）
npm run add:ios       # = cap add ios
npm run add:android   # = cap add android

# 3) 設定変更を反映（server.url や権限を変えるたびに実行）
npm run sync          # = cap sync

# 4) IDE で開いて実機/シミュレータ実行・署名・ストア申請
npm run ios           # = cap open ios（Xcode が開く）
npm run android       # = cap open android（Android Studio が開く）
```

## 日々のビルド・実行（Android・コマンドだけで完結）

初回セットアップ後は、これだけでビルド〜エミュ実行まで回せる：

```bash
cd mobile

npm run apk      # ① ビルドのみ。cap sync → JDK21 で assembleDebug
                 #   生成物: android/app/build/outputs/apk/debug/app-debug.apk

npm run play     # ② ビルド＋エミュ起動＋APKインストール＋アプリ起動を一発で
                 #   （エミュが既に起動中なら起動はスキップして入れ替えだけ）

bash run-emu.sh  # ③ ビルドせず「今あるAPKを入れ直して起動」だけ
```

### 開発時：アプリでローカルDevを見る

`:dev` を付けてビルドすると、本番URLの代わりに **ローカルDev（`http://localhost:3000`）** を開く。
`run-emu.sh` が `adb reverse tcp:3000`（と 3001）で端末の `localhost` をホストMacへ転送するので、
エミュから Mac の dev サーバに届く。**`localhost` を使う理由は GPS**：http の生IP（10.0.2.2 等）は
非セキュアオリジンで `navigator.geolocation` がブロックされる（"Only secure origins are allowed"）。
`localhost` は Chromium がセキュアコンテキスト扱いするので、http のままでも GPS が使える。

```bash
# 別ターミナルで Mac 側の dev を起動しておく（frontend:3000 + backend:3001 + DB）
cd .. && npm run dev

# mobile/ で dev 向きのAPKをビルド＆エミュ起動（adb reverse も自動で張る）
cd mobile
npm run play:dev    # = CAP_DEV=1。WebView が http://localhost:3000 を開く
```

- 本番URLに戻すときは通常の `npm run play`（CAP_DEV なし）で再ビルドするだけ。
- `next.config.ts` に `allowedDevOrigins: ["10.0.2.2"]` を入れてある（10.0.2.2 方式に切り替えた場合の
  HMR/チャンクのクロスオリジンブロック対策。localhost 方式なら同一オリジンなので不要だが無害）。
- 実機を同一LANで使う等で別URLにしたいときは `CAP_DEV_URL` で上書き：
  `CAP_DEV_URL=http://192.168.1.50:3000 npm run play:dev`（ただし http の生IPは GPS 不可）。
- `next dev` がホスト外から見えない場合は `-H 0.0.0.0` で全インターフェースにバインド。
- dev は http なので `cleartext` を自動で許可している（本番 https では無効）。
- 注意：dev で Google ログイン/Cookie まで試すなら、backend の `FRONTEND_URL`/`trustedOrigins` に
  `http://localhost:3000` を足す必要がある（ボタン表示確認など認証不要の動作は不要）。

### エミュレータで GPS（現在地）を使う

エミュには実GPSが無いので、位置を注入して使う。**dev は `localhost` 方式なので http でも GPS が効く**
（上記の理由）。

```bash
cd mobile
bash geo.sh 35.6812 139.7671   # 緯度 経度 の順で現在地を設定（例：東京駅）
bash geo.sh                    # 引数省略で東京駅
bash geo.sh 34.6873 135.5259   # 例：大阪城
```

- `geo.sh` は位置情報権限の付与も内部で行う（`adb shell pm grant ... ACCESS_FINE/COARSE_LOCATION`）。
- 設定後、アプリの「現在地ボタン」や GPS塗りに反映される。動作確認済み（getCurrentPosition が注入座標を返す）。
- GUI 派は Android Studio エミュの **Extended Controls(`…`) → Location** でも設定できる。

- 前提：`adb` / `emulator` が PATH にあること（`~/.zshrc` に
  `export ANDROID_HOME="$HOME/Library/Android/sdk"` と
  `export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"` を追加済み）。
- `npm run apk` が `JAVA_HOME` に Android Studio 同梱の JDK21 を指定しているのは、システム既定が
  Java 8 で gradle が動かないため（意識不要・スクリプトに埋め込み済み）。
- GUI で実機/エミュ実行したいときは `npm run android`（Android Studio が開く）。

素のコマンドで手動実行する場合の内訳:

| ステップ | コマンド |
|---|---|
| ビルド | `cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug` |
| エミュ起動 | `emulator -avd chizunurie_pixel -no-snapshot -dns-server 8.8.8.8 -gpu auto &` |
| ブート待ち | `adb wait-for-device` |
| インストール | `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` |
| アプリ起動 | `adb shell am start -n jp.chizunurie.app/.MainActivity` |

## 申請前に必ず潰すこと

- **GPS の権限文言**
  - iOS: `ios/App/App/Info.plist` に `NSLocationWhenInUseUsageDescription`（日本語の用途説明）を追加
  - Android: `android/app/src/main/AndroidManifest.xml` に `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`
- **Apple 審査リスク（ガイドライン 4.2「ガワアプリ」）**: 単なるWebラッパーはリジェクトされやすい。
  GPS連動やプッシュ通知など“ネイティブらしさ”を1つ足すと通りやすい（Capacitor の
  `@capacitor/geolocation` / `@capacitor/push-notifications` プラグイン）。Google Play はほぼ問題なし。
- **Google OAuth ログイン**: WebView 内で完結させるため `capacitor.config.ts` に2つの設定を入れている（Android・エミュで動作確認済み）：
  1. `android.overrideUserAgent` … WebView の UA から `; wv`（WebView印）を消し通常Chromeに見せる。
     これがないと Google が埋め込みWebViewを拒否（`disallowed_useragent`）する。
  2. `server.allowNavigation: ["accounts.google.com", "*.google.com"]` … 認証画面を外部ブラウザに
     飛ばさず WebView 内で開く。これがないと Capacitor が自ドメイン外への遷移をChromeに送り、
     Cookie が分離してアプリが未ログインのままになる（＝「ブラウザでゲームが動き出す」症状）。
  - 認証後は `/api/auth/callback/google`（自ドメイン）へ戻り Cookie が WebView に入りログイン成立。
  - 注意：Google はポリシー上、埋め込みWebViewでのOAuthを推奨していない。現状は通るが将来
    弾かれた場合は Custom Tab(`@capacitor/browser`)＋ディープリンク＋トークン受け渡しに切り替える。
- **iOS は未対応**：上記2設定のうち UA上書きは iOS でも `ios.overrideUserAgent` で同様に効くが、
  iOS の WKWebView は OAuth 周りの挙動が別。iOS 対応時に実機で要確認。

## エミュレータでのデバッグ Tips（Android）

- **物理キーボードで入力**：AVDの `~/.android/avd/<name>.avd/config.ini` で `hw.keyboard = yes`
  にしてコールドブート（`emulator -avd <name> -no-snapshot`）すると Mac のキーボードで打てる。
- **API通信が全部 `Failed to fetch` になる**：エミュのネットワーク/DNS不調。`-dns-server 8.8.8.8`
  付きでコールドブートし直すと直る（`adb shell ping` は ICMP がNATで通らないだけなので、
  DNS解決できていれば実害なし）。
- **WebView内をJSで操作・確認**：デバッグAPKは WebView デバッグ有効。
  `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` → `http://localhost:9222/json/list`
  で Chrome DevTools プロトコルに繋がる（PC版Chromeの `chrome://inspect` でも可）。

> `mobile/ios`・`mobile/android`・`mobile/node_modules` は .gitignore 済み（`cap add` で再生成可）。
