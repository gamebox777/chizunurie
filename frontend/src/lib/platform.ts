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
