'use client';

// 地理院「標準地図」を白地図の上にうっすら重ねるオーバーレイの ON/OFF。
// - 自前データは持たず、表示範囲のタイルだけ地理院サーバーから都度取得する（出典表記が必須）。
// - ON/OFF は localStorage に保存（既定 ON）。設定メニュー（SettingsMenu）で切り替える。
// - 切り替えを Map.tsx に即時反映するため、変更時に window へ CustomEvent を投げ、
//   Map 側は onBasemapChange で購読してレイヤーの visibility を切り替える。

const BASEMAP_KEY = 'chizunurie:basemap'; // 地理院オーバーレイ ON/OFF（既定 ON）
const BASEMAP_EVENT = 'chizunurie:basemap-change';

const isBrowser = () => typeof window !== 'undefined';

// ── ON/OFF 設定（localStorage 永続化） ──────────────────────────────
export function isBasemapEnabled(): boolean {
  if (!isBrowser()) return true; // 既定 ON
  return localStorage.getItem(BASEMAP_KEY) !== '0';
}
export function setBasemapEnabled(on: boolean): void {
  if (!isBrowser()) return;
  localStorage.setItem(BASEMAP_KEY, on ? '1' : '0');
  window.dispatchEvent(new CustomEvent(BASEMAP_EVENT, { detail: on }));
}

// 変更を購読する。返り値を呼ぶと購読解除。
export function onBasemapChange(cb: (on: boolean) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<boolean>).detail);
  window.addEventListener(BASEMAP_EVENT, handler);
  return () => window.removeEventListener(BASEMAP_EVENT, handler);
}
