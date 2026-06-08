'use client';

// スマホの触覚フィードバック（バイブ）。Vibration API（navigator.vibrate）を使う。
// - 現地塗り・となり塗りなど、新規セルを塗った瞬間にビビッと振動させる。
// - ON/OFF は localStorage に保存（既定 ON）。設定メニュー（SettingsMenu）で切り替える。
// - 非対応端末（iOS Safari など navigator.vibrate が無い環境）では何もしない。

const VIBRATE_KEY = 'chizunurie:haptics'; // バイブ ON/OFF（既定 ON）

const isBrowser = () => typeof window !== 'undefined';

// 端末が Vibration API に対応しているか。
export function isHapticsSupported(): boolean {
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

// 振動を鳴らす。pattern は navigator.vibrate と同じ（ms、または ms 配列）。
// 設定 OFF・非対応端末では無視する。
export function vibrate(pattern: number | number[] = 20): void {
  if (!isHapticsSupported() || !isHapticsEnabled()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // 一部端末ではユーザー操作前に呼ぶと例外になる。握りつぶす。
  }
}

// 新規セルを塗った瞬間の「ビビッ」。短い単発。
export function vibratePaint(): void {
  vibrate(20);
}
