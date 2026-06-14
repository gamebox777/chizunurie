'use client';

// スマホの触覚フィードバック（バイブ）。
// - 現地塗り・となり塗りなど、新規セルを塗った瞬間にビビッと振動させる。
// - ネイティブアプリ（Capacitor）では @capacitor/haptics（iOS の Taptic Engine /
//   Android の Vibrator）を優先して使う。これが無い Web/PWA では Web Vibration API
//   （navigator.vibrate）にフォールバックする。
//   ※ iOS Safari / WKWebView は navigator.vibrate を持たないため、iOS で振動を出すには
//     ネイティブプラグイン経由が必須。これがネイティブ機能を使う意味でもある。
// - ON/OFF は localStorage に保存（既定 ON）。設定メニュー（SettingsMenu）で切り替える。
// - 非対応端末では何もしない。

const VIBRATE_KEY = 'chizunurie:haptics'; // バイブ ON/OFF（既定 ON）

const isBrowser = () => typeof window !== 'undefined';

// ── 触覚の種類（管理画面の体験ボタン・塗りフィードバックで使う） ──────────
// impact 系（衝撃の強弱）と notification 系（成功/警告/エラー）。
export type HapticKind =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error';

// Web Vibration API 用のフォールバックパターン（ネイティブが無いとき）。
const WEB_PATTERN: Record<HapticKind, number | number[]> = {
  light: 20,
  medium: 35,
  heavy: [0, 60],
  success: [0, 30, 50, 30],
  warning: [0, 40, 40, 40],
  error: [0, 80, 50, 80],
};

// @capacitor/haptics の使う範囲だけの最小型（window.Capacitor.Plugins 経由で呼ぶ）。
// style/type は文字列の enum 値（'LIGHT' など）をそのまま渡せる。
type NativeHapticsPlugin = {
  impact?: (options: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }) => Promise<void>;
  notification?: (options: {
    type: 'SUCCESS' | 'WARNING' | 'ERROR';
  }) => Promise<void>;
  vibrate?: (options: { duration: number }) => Promise<void>;
};

function getNativeHaptics(): NativeHapticsPlugin | undefined {
  if (typeof window === 'undefined') return undefined;
  const cap = (
    window as unknown as {
      Capacitor?: { Plugins?: { Haptics?: NativeHapticsPlugin } };
    }
  ).Capacitor;
  return cap?.Plugins?.Haptics;
}

/** ネイティブアプリの触覚プラグインが使えるか（Web・旧 APK では false）。 */
export function isNativeHapticsAvailable(): boolean {
  return !!getNativeHaptics();
}

// 端末が触覚に対応しているか（ネイティブ or Web Vibration のどちらか）。
export function isHapticsSupported(): boolean {
  if (isNativeHapticsAvailable()) return true;
  return isBrowser() && typeof navigator !== 'undefined' && 'vibrate' in navigator;
}

// ── ON/OFF 設定（localStorage 永続化） ──────────────────────────────
export function isHapticsEnabled(): boolean {
  if (!isBrowser()) return true;
  return localStorage.getItem(VIBRATE_KEY) !== '0'; // 既定 ON
}
export function setHapticsEnabled(on: boolean): void {
  if (!isBrowser()) return;
  localStorage.setItem(VIBRATE_KEY, on ? '1' : '0');
}

// 指定種類の触覚を鳴らす内部実装。ネイティブがあればそれを、無ければ Web Vibration。
function fire(kind: HapticKind): void {
  const native = getNativeHaptics();
  if (native) {
    try {
      if (kind === 'success' || kind === 'warning' || kind === 'error') {
        native.notification?.({ type: kind.toUpperCase() as 'SUCCESS' });
      } else {
        native.impact?.({ style: kind.toUpperCase() as 'LIGHT' });
      }
      return;
    } catch {
      // ネイティブ呼び出しに失敗したら Web フォールバックへ落ちる。
    }
  }
  if (isBrowser() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(WEB_PATTERN[kind]);
    } catch {
      // 一部端末ではユーザー操作前に呼ぶと例外になる。握りつぶす。
    }
  }
}

/**
 * 触覚フィードバックを鳴らす。
 * - 既定では設定 OFF・非対応端末では無視する。
 * - opts.force=true のときは ON/OFF 設定を無視して必ず鳴らす（管理画面の体験ボタン用）。
 */
export function playHaptic(kind: HapticKind, opts?: { force?: boolean }): void {
  if (!isHapticsSupported()) return;
  if (!opts?.force && !isHapticsEnabled()) return;
  fire(kind);
}

// 新規セルを塗った瞬間の「ビビッ」。短い単発（Light）。
export function vibratePaint(): void {
  playHaptic('light');
}
