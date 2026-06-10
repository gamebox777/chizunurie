import type { CapacitorConfig } from "@capacitor/cli";

// ── Capacitor（リモートURL方式）の設定 ───────────────────────────────
// ネイティブの WebView が「本番デプロイ済みサイト」or「ローカルDev」をそのまま開く。
// frontend/backend のコードは一切変更しないので、ブラウザ版は無影響。
//
// 開発(ローカルDev)を見るには CAP_DEV=1 を付けてビルドする：
//   cd mobile && npm run play:dev      （= CAP_DEV=1 で本スクリプトを解決）
// このとき WebView は http://localhost:3000 を開く。run-emu.sh が `adb reverse tcp:3000`
// で端末の localhost:3000 を「ホストMacの localhost:3000」へ転送するので、エミュから Mac の
// dev サーバに届く。
//   - なぜ 10.0.2.2 ではなく localhost か：GPS(geolocation) 等のセキュアコンテキスト限定の
//     Web API は http の 10.0.2.2 では "Only secure origins are allowed" でブロックされる。
//     localhost は Chromium がセキュアコンテキスト扱いするので http のままでも GPS が使える。
//   - Mac 側で `npm run dev`（frontend:3000 + backend:3001）を起動しておくこと。
//   - 実機を同一LANで使う等で別URLにしたいときは CAP_DEV_URL=http://192.168.x.x:3000 で上書き
//     （ただし http の生IPは非セキュアなので GPS は使えない。GPS も要るなら adb reverse 方式か https）。
// 本番ビルド（CAP_DEV なし）では https://chizunurie.gamebox777.org を開く。
//
// 注意：この url は `cap sync`/`cap copy` 実行時に評価されて native へ焼き込まれる。
// よって CAP_DEV は「ビルド時」に必要（npm run apk が中で cap sync を呼ぶのでそこに効く）。
const DEV = process.env.CAP_DEV === "1" || process.env.CAP_DEV === "true";
const DEV_URL = process.env.CAP_DEV_URL ?? "http://localhost:3000";
const PROD_URL = "https://chizunurie.gamebox777.org";

const config: CapacitorConfig = {
  appId: "jp.chizunurie.app", // ← ストア用の一意ID（逆ドメイン）。確定後に変更
  appName: "ちず塗り絵",
  webDir: "www", // server.url を使うのでほぼダミー（オフライン時のフォールバック）
  server: {
    url: DEV ? DEV_URL : PROD_URL,
    // 本番(https)は http を読ませない。Dev(http://10.0.2.2)は cleartext を許可する必要がある。
    cleartext: DEV,
    // Google OAuth の認証画面(accounts.google.com)を「外部ブラウザに飛ばさず WebView 内で
    // 開く」ことを許可する。これがないと Capacitor が server.url ドメイン外への遷移を
    // 自動でChromeに送り、Cookieが分離してアプリが未ログインのままになる。
    // accounts.google.com で認証→ /api/auth/callback/google（自ドメイン）へ戻り Cookie が
    // WebView に入る。overrideUserAgent と併用して Google の WebView 拒否も回避する。
    // accounts.youtube.com：Cookie が空の「初回」サインインだけ Google がドメイン横断の
    // Cookie 同期で経由するホスト。*.google.com に一致しないため、これが無いとそのホップが
    // 外部 Chrome に飛ばされ、ワンタイム URL を Cookie 無しで開いて Google の一般 400
    // （"It should not be retried"）になる（2回目以降はホップ自体が無いので成功していた）。
    allowNavigation: ["accounts.google.com", "*.google.com", "accounts.youtube.com"],
  },
  android: {
    // WebView の User-Agent から "; wv"（WebView印）を消し、通常の Chrome として
    // 振る舞わせる。これがないと Google が埋め込みWebViewを検知して OAuth を拒否する
    // （disallowed_useragent）。Google ログインを WebView 内で完結させるための回避策。
    overrideUserAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  },
};

export default config;
