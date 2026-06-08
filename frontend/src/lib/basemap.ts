'use client';

// 地理院「標準地図」を白地図の上にうっすら重ねるオーバーレイの ON/OFF。
// - 自前データは持たず、表示範囲のタイルだけ地理院サーバーから都度取得する（出典表記が必須）。
// - ON/OFF は localStorage に保存（既定 OFF）。設定メニュー（SettingsMenu）で切り替える。
//   CARTO 世界地図（world-basemap・常時不透明）と二重に見えるのを避けるため既定 OFF。
// - 切り替えを Map.tsx に即時反映するため、変更時に window へ CustomEvent を投げ、
//   Map 側は onBasemapChange で購読してレイヤーを追加/削除する（OFF 時はタイルを取得しない）。

const BASEMAP_KEY = 'chizunurie:basemap'; // 地理院オーバーレイ ON/OFF（既定 OFF）
const BASEMAP_EVENT = 'chizunurie:basemap-change';

const OPACITY_KEY = 'chizunurie:basemap-opacity'; // 絵付きの地図（ラスター）の不透明度（既定 0.5）
const OPACITY_EVENT = 'chizunurie:basemap-opacity-change';
export const DEFAULT_BASEMAP_OPACITY = 0.5; // 既定は半透明（塗ったセルを目立たせる）

const isBrowser = () => typeof window !== 'undefined';

// ── ON/OFF 設定（localStorage 永続化） ──────────────────────────────
export function isBasemapEnabled(): boolean {
  if (!isBrowser()) return false; // 既定 OFF
  return localStorage.getItem(BASEMAP_KEY) === '1';
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

// ── 絵付きの地図（world-basemap / 地理院ラスター）の不透明度（0〜1・既定 0.5） ────
// 塗っていないセルで地図画像をどれだけ透かすか。設定メニューのスライダーで調整する。
export function getBasemapOpacity(): number {
  if (!isBrowser()) return DEFAULT_BASEMAP_OPACITY;
  const raw = localStorage.getItem(OPACITY_KEY);
  if (raw === null) return DEFAULT_BASEMAP_OPACITY;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_BASEMAP_OPACITY;
}
export function setBasemapOpacity(v: number): void {
  if (!isBrowser()) return;
  const clamped = Math.min(1, Math.max(0, v));
  localStorage.setItem(OPACITY_KEY, String(clamped));
  window.dispatchEvent(new CustomEvent(OPACITY_EVENT, { detail: clamped }));
}

// 不透明度の変更を購読する。返り値を呼ぶと購読解除。
export function onBasemapOpacityChange(cb: (v: number) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<number>).detail);
  window.addEventListener(OPACITY_EVENT, handler);
  return () => window.removeEventListener(OPACITY_EVENT, handler);
}
