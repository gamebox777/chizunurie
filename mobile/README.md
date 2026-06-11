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

> `mobile/ios`・`mobile/node_modules` は .gitignore 済み（`cap add` で再生成可）。
> **`mobile/android` はコミット対象**：ネイティブの手書きコード（`UnityAdsPlugin.java`・
> `MainActivity.java`・`app/build.gradle`・`AndroidManifest.xml` 等）を含み `cap add` では
> 再生成できないため。ビルド生成物・`keystore.properties` は `android/.gitignore` が除外する。

## Unity Ads（リワード動画）

アプリ内の「▶ 広告を見て回復」は Web 版 GPT ではなく **Unity Ads SDK** で出す
（事前審査不要。経緯は [docs/スマホアプリ広告-審査不要ネットワーク比較.md](../docs/スマホアプリ広告-審査不要ネットワーク比較.md)）。

- ネイティブ側：`android/app/src/main/java/jp/chizunurie/app/UnityAdsPlugin.java`
  （Capacitor プラグイン `UnityAds`・`showRewarded()`/`showBanner()`/`hideBanner()`/
  `getRewardedStatus()`/`getAdTestMode()`/`setAdTestMode()`/`getAdDebugInfo()`）。
  `MainActivity` で登録、依存は `app/build.gradle` の `com.unity3d.ads:unity-ads`。
- フロント側：`frontend/src/lib/nativeRewardedAd.ts` が `window.Capacitor.Plugins.UnityAds`
  を呼び、Web 版（`rewardedAd.ts`）と同じ `{ outcome, detail? }` を返す。`Map.tsx` の
  `openVideoReward` が `isNativeApp()` で出し分け。報酬付与は Web 版と同じ backend の
  nonce 方式（アプリ側に固有のサーバー処理は無い）。
- **リワードはプリロード制**：プラグインがアプリ起動時から1本ロードしておき、在庫の有無を
  `getRewardedStatus()` と `rewardedStatus` イベント（`notifyListeners`）で frontend へ通知。
  `Map.tsx` は在庫が準備できるまで「広告を見て回復」ボタンを非活性（「広告を準備中…」）にする。
  視聴・失敗のたびに次の1本を自動ロード、在庫なしは30秒おきに再試行。backend の視聴
  クールダウンは **Web 版のみ**適用（既定5分・`app_settings` の `videoReward` キーで
  管理画面から変更可）。アプリは 0 のまま＝このプリロード制御と1日上限に任せる
  （platform はクライアント自己申告で送る）。
- **フッターバナー**：`showBanner()` が 320x50 の `BannerView` を画面下中央に表示し、
  **WebView を bottomMargin で持ち上げて場所を確保**（Web 側の CSS 調整不要）。フロントは
  `frontend/src/lib/nativeBannerAd.ts` ＋ `Map.tsx` がアプリ内のみマウント時に自動表示。
  あわせてアプリ内では地図トップのサイトフッター（`SiteFooter` variant="bar"）を非表示にした。
- **テスト広告/本広告は実行時切り替え**：既定は debug ビルド＝テスト広告・release＝本広告
  （実機で実広告を自分で視聴するとポリシー違反になり得るため）。開発者デバッグメニュー
  （レンチ→「広告モード」）から `setAdTestMode()` でどちらのビルドでも切り替えられ、
  SharedPreferences（`unity_ads.test_mode`）に永続化される。Unity Ads SDK は同一プロセスで
  一度しか initialize できないため、**SDK 初期化後の切り替えはアプリ再起動後に反映**
  （`requiresRestart`・デバッグメニューに注記が出る）。
- **広告ステータス詳細**：デバッグメニューの「広告ステータス」が `getAdDebugInfo()` で
  SDK 初期化状態（init エラー含む）・Game ID/Placement・リワード在庫（load 試行回数・
  最終試行時刻・直近の load エラー）・バナー表示状態（直近エラー）を表示する。
  本広告で在庫が来ない（本番 Game ID 6133603 の「Network error」等）の切り分けに使う。
  「バナー表示を再試行」ボタン付き。取得ついでに止まっていたプリロードも再起動する。
- Game ID `6133603`（Android）・Placement `Rewarded_Android` は UnityAdsPlugin.java に定数で記載。

## バックグラウンドGPS塗り（Android）

アプリ版のみ、画面OFF・アプリ裏でも歩いた場所を塗れる（Web/PWA の `watchPosition` は
バックグラウンドで止まるため Web 版は Wake Lock＝画面点けっぱなしの緩和策のみ）。

- プラグイン：`@capgo/background-geolocation`（mobile/ に npm 導入・`cap sync` で自動登録）。
  Android は**フォアグラウンドサービス＋通知方式**で、`ACCESS_BACKGROUND_LOCATION` 権限は
  不要（Play の重い背景位置情報審査を回避できる）。必要な権限・service 宣言はプラグインの
  マニフェストが自動マージされる（手書きの `AndroidManifest.xml` への追記は無し）。
- フロント側：`frontend/src/lib/nativeBackgroundGeolocation.ts` が
  `window.Capacitor.Plugins.BackgroundGeolocation` の `start(options, callback)`/`stop()` を
  呼ぶ。`Map.tsx` が GPS 追跡の開始/終了（`trackuserlocationstart`/`end`）に合わせて並走させ、
  届いた位置は実GPSと同じ `handleGpsPosition` → `paintGpsAt` に流す（`distanceFilter: 25m`・
  前面では watchPosition と二重に届くがセル・細セル単位の間引きで実害なし）。
- 追跡中は「現在地を記録中」の通知（i18n の `bgGeoTitle`/`bgGeoMessage`）が出る。
  Web 版・プラグイン未搭載の旧 APK では no-op。iOS は未対応（Info.plist 未設定）。
- 動作確認：`npm run play:dev` で起動 → GPSボタンで追跡開始 → ホームボタンでアプリを
  裏に回し `bash geo.sh <緯度> <経度>` で位置を動かす → アプリに戻ると塗られている。
