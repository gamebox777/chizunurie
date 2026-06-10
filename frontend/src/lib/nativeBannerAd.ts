// ネイティブアプリ（mobile/ の Capacitor ラッパー）内のフッターバナー広告（Unity Ads）。
// 実体は mobile/android の UnityAdsPlugin.java（showBanner/hideBanner）。
// バナーは画面下中央にネイティブビューとして固定され、WebView 自体がバナーの高さぶん
// 縮む（持ち上がる）ので、Web 側のレイアウト調整は不要。
//
// ブラウザではプラグインが無いので何もしない（{ shown:false } を返す）。

type UnityAdsBannerPlugin = {
  showBanner?: () => Promise<{ shown?: boolean; detail?: string }>;
  hideBanner?: () => Promise<void>;
};

function getUnityAdsPlugin(): UnityAdsBannerPlugin | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (
    window as unknown as {
      Capacitor?: { Plugins?: { UnityAds?: UnityAdsBannerPlugin } };
    }
  ).Capacitor;
  return cap?.Plugins?.UnityAds;
}

/**
 * フッターバナーを表示する。表示できたら true。
 * 失敗（在庫なし・初期化失敗・プラグインなし）は false（致命的でないので呼び出し側は無視してよい）。
 */
export async function showNativeBanner(): Promise<boolean> {
  const plugin = getUnityAdsPlugin();
  if (!plugin?.showBanner) return false; // 旧 APK（バナー未実装）やブラウザ
  try {
    const ret = await plugin.showBanner();
    return ret?.shown === true;
  } catch (e) {
    console.warn("native banner failed", e);
    return false;
  }
}

/** フッターバナーを消す（現状未使用。全画面化などで使う想定）。 */
export async function hideNativeBanner(): Promise<void> {
  const plugin = getUnityAdsPlugin();
  if (!plugin?.hideBanner) return;
  try {
    await plugin.hideBanner();
  } catch (e) {
    console.warn("native banner hide failed", e);
  }
}
