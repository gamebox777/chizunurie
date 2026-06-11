'use client';

// GPS の状態を Map.tsx → SettingsMenu.tsx など複数コンポーネント間で共有するモジュール。
// basemap.ts と同じ CustomEvent パターンを採用する。
// Map.tsx が位置取得・エラー・追跡終了のたびに setGpsStatus() を呼び、
// SettingsMenu.tsx が onGpsStatusChange() で購読してオフライン理由を表示する。

export type GpsStatusReason =
  | 'inactive' // 追跡停止・未開始（手動 OFF・初期状態）
  | 'denied' // 権限拒否（GeolocationPositionError.code === 1）
  | 'unavailable' // 位置取得不可（code 2）
  | 'timeout'; // タイムアウト（code 3）

export type GpsStatus =
  | { held: true }
  | { held: false; reason: GpsStatusReason };

const GPS_STATUS_EVENT = 'chizunurie:gps-status';

// モジュールスコープの現在値（SSR 安全）。
let _current: GpsStatus = { held: false, reason: 'inactive' };
const isBrowser = () => typeof window !== 'undefined';

export function setGpsStatus(s: GpsStatus): void {
  _current = s;
  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent(GPS_STATUS_EVENT, { detail: s }));
  }
}

export function getGpsStatus(): GpsStatus {
  return _current;
}

// 変更を購読する。返り値を呼ぶと購読解除。
export function onGpsStatusChange(cb: (s: GpsStatus) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<GpsStatus>).detail);
  window.addEventListener(GPS_STATUS_EVENT, handler);
  return () => window.removeEventListener(GPS_STATUS_EVENT, handler);
}
