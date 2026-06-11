// 実行環境がネイティブアプリ（mobile/ の Capacitor ラッパー）内かどうかを判定する。
//
// アプリはリモートURL方式で本番サイト（このフロント）をそのまま WebView に表示するため、
// ブラウザ版とまったく同じコードが動く。「アプリ内だけ挙動を変えたい」場面（例：動画リワードの
// 出し分け）でこの判定を使う。Capacitor はリモートURLの WebView にも `window.Capacitor` を
// 注入するので、その有無・API で判定できる（通常のブラウザでは undefined → false）。
//
// 動作確認：Android 実機(エミュ)で window.Capacitor.isNativePlatform()===true /
// getPlatform()==='android' を確認済み。

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    // @capacitor/app（mobile/ に導入済み）。アプリ自身の versionName/versionCode を返す。
    App?: { getInfo?: () => Promise<{ version?: string; build?: string }> };
  };
};

function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** Capacitor ネイティブアプリ（iOS/Android）内で動いているか。ブラウザでは false。 */
export function isNativeApp(): boolean {
  return !!getCapacitor()?.isNativePlatform?.();
}

/** 実行プラットフォーム。アプリ内なら 'ios' / 'android'、ブラウザなら 'web'。 */
export function nativePlatform(): "ios" | "android" | "web" {
  const p = getCapacitor()?.getPlatform?.();
  return p === "ios" || p === "android" ? p : "web";
}

/** PWA（ホーム画面に追加して standalone 表示）として動いているか。アプリ内・通常タブでは false。 */
export function isPwa(): boolean {
  if (typeof window === "undefined" || isNativeApp()) return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    // iOS Safari の「ホーム画面に追加」は display-mode を返さず navigator.standalone を立てる
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** ログ記録用のプラットフォーム種別。アプリ内は OS 名、ブラウザは PWA かどうかで分ける。 */
export function appPlatform(): "web" | "pwa" | "ios" | "android" {
  const p = nativePlatform();
  if (p !== "web") return p;
  return isPwa() ? "pwa" : "web";
}

/**
 * ログ記録用のバージョン表記（SettingsMenu の表示と同じ情報源を1文字列にしたもの）。
 * Web は build 時に焼き込んだ NEXT_PUBLIC_BUILD_TIME、アプリ内はネイティブ版
 * （versionName (versionCode)）を併記する（リモートURL方式で APK と Web の版は独立に上がるため）。
 * 例: web "web 2026-06-10 23:45" ／ アプリ "app 1.3 (4) / web 2026-06-10 23:45"
 */
let versionPromise: Promise<string | null> | null = null;
export function appVersionString(): Promise<string | null> {
  if (versionPromise) return versionPromise;
  versionPromise = (async () => {
    const web = process.env.NEXT_PUBLIC_BUILD_TIME
      ? `web ${process.env.NEXT_PUBLIC_BUILD_TIME}`
      : null;
    const native = await nativeAppVersion();
    if (native) return web ? `app ${native} / ${web}` : `app ${native}`;
    return web;
  })();
  return versionPromise;
}

/**
 * ネイティブアプリのバージョン表記（例 "1.3 (4)" = versionName (versionCode)）。
 * アプリ外・@capacitor/app 未搭載の旧 APK では null。
 */
export async function nativeAppVersion(): Promise<string | null> {
  const getInfo = getCapacitor()?.Plugins?.App?.getInfo;
  if (!isNativeApp() || !getInfo) return null;
  try {
    const info = await getInfo();
    if (!info?.version) return null;
    return info.build ? `${info.version} (${info.build})` : info.version;
  } catch {
    return null;
  }
}
