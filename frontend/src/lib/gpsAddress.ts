'use client';

// 現地塗り中、現在地（青い点）の真下に出る「正確な住所ラベル」の ON/OFF。
// - 国土地理院の逆ジオコーダで取得した住所を表示する機能。
// - ON/OFF は localStorage に保存（既定 ON）。設定メニュー（SettingsMenu）で切り替える。
// - 切り替えを Map.tsx に即時反映するため、変更時に window へ CustomEvent を投げる。

const GPS_ADDR_KEY = 'chizunurie:gps-address'; // 住所ラベル ON/OFF（既定 ON）
const GPS_ADDR_EVENT = 'chizunurie:gps-address-change';

const isBrowser = () => typeof window !== 'undefined';

// ── ON/OFF 設定（localStorage 永続化） ──────────────────────────────
export function isGpsAddressEnabled(): boolean {
  if (!isBrowser()) return true; // 既定 ON
  return localStorage.getItem(GPS_ADDR_KEY) !== '0';
}
export function setGpsAddressEnabled(on: boolean): void {
  if (!isBrowser()) return;
  localStorage.setItem(GPS_ADDR_KEY, on ? '1' : '0');
  window.dispatchEvent(new CustomEvent(GPS_ADDR_EVENT, { detail: on }));
}

// 変更を購読する。返り値を呼ぶと購読解除。
export function onGpsAddressChange(cb: (on: boolean) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<boolean>).detail);
  window.addEventListener(GPS_ADDR_EVENT, handler);
  return () => window.removeEventListener(GPS_ADDR_EVENT, handler);
}
