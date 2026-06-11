// ネイティブアプリ（mobile/ の Capacitor ラッパー）内で、画面OFF・アプリ裏でも現在地を
// 受け取り続けるためのブリッジ。実体は @capgo/background-geolocation（mobile/ に導入済み・
// Android はフォアグラウンドサービス＋通知で位置を流し続ける）で、Capacitor がリモートURLの
// WebView に注入する window.Capacitor.Plugins.BackgroundGeolocation 経由で呼ぶ。
//
// ブラウザ／PWA の watchPosition は画面OFF・バックグラウンドで止まる（Map.tsx は Wake Lock で
// 画面を点けたままにする緩和策のみ）。アプリ版はこのブリッジで「ポケットに入れて歩いても
// 塗れる」を実現する。Web 版・プラグイン未搭載の旧 APK では no-op（isAvailable()=false）。

// プラグインが流してくる位置（@capgo/background-geolocation の Location の使う範囲だけ）。
type BgLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  simulated?: boolean;
  time?: number | null;
};

type BgError = { message?: string; code?: string };

// BackgroundGeolocationPlugin（使う範囲だけの最小型）。start は RETURN_CALLBACK 方式で、
// 最後の引数に渡した関数へ位置／エラーを繰り返し届ける（stop() まで続く・単一ウォッチ）。
type BackgroundGeolocationPlugin = {
  start: (
    options: {
      backgroundTitle?: string; // Android のフォアグラウンドサービス通知のタイトル
      backgroundMessage?: string; // 同・本文（これが有るとバックグラウンドでも更新が続く）
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number; // この距離[m]動くまで次の更新を出さない（電池・通信の節約）
    },
    callback: (position?: BgLocation, error?: BgError) => void
  ) => Promise<void>;
  stop: () => Promise<void>;
  openSettings: () => Promise<void>;
};

function getPlugin(): BackgroundGeolocationPlugin | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (
    window as unknown as {
      Capacitor?: {
        Plugins?: { BackgroundGeolocation?: BackgroundGeolocationPlugin };
      };
    }
  ).Capacitor;
  return cap?.Plugins?.BackgroundGeolocation;
}

/** アプリ内でバックグラウンド位置情報プラグインが使えるか（Web・旧 APK では false）。 */
export function isNativeBgGeoAvailable(): boolean {
  return !!getPlugin();
}

// プラグインは単一ウォッチ（start/stop）なので、二重 start を防ぐフラグを持つ。
let active = false;

/**
 * バックグラウンド位置追跡を開始する。届いた位置は onLocation(lng, lat) へ流す
 * （経度・緯度の順＝Map.tsx の paintGpsAt と同じ）。開始できたら true。
 * 権限拒否などのエラーは onError へ渡す（追跡自体は stop されるまで生きている）。
 */
export async function startNativeBgGeo(opts: {
  backgroundTitle: string;
  backgroundMessage: string;
  distanceFilter?: number;
  onLocation: (lng: number, lat: number) => void;
  onError?: (error: BgError) => void;
}): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin || active) return false;
  active = true;
  try {
    await plugin.start(
      {
        backgroundTitle: opts.backgroundTitle,
        backgroundMessage: opts.backgroundMessage,
        requestPermissions: true,
        // GPS 取得直後の古い位置は使わない（歩き塗りで過去の場所を誤塗りしない）。
        stale: false,
        distanceFilter: opts.distanceFilter ?? 25,
      },
      (position, error) => {
        if (!active) return; // stop 後に残った配信は捨てる
        if (error) {
          console.warn("background geolocation error", error);
          opts.onError?.(error);
          return;
        }
        if (position) opts.onLocation(position.longitude, position.latitude);
      }
    );
    return true;
  } catch (e) {
    console.warn("background geolocation start failed", e);
    active = false;
    return false;
  }
}

/** バックグラウンド位置追跡を止める（未開始・Web では何もしない）。 */
export async function stopNativeBgGeo(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin || !active) return;
  active = false;
  try {
    await plugin.stop();
  } catch (e) {
    console.warn("background geolocation stop failed", e);
  }
}
