'use client';

// 右上の各種コントロール（ズーム・現在地・検索・データ詳細・ランキング等）のアイコンサイズ。
// - 小（既定・MapLibre 標準の 29px）／中／大 の3段階。localStorage に保存。
// - 設定メニュー（SettingsMenu）で切り替える。
// - Map.tsx に即時反映するため、変更時に window へ CustomEvent を投げる。Map 側は
//   onIconSizeChange で購読し、地図コンテナの data-icon-size 属性を書き換える
//   （実寸の拡大は globals.css の [data-icon-size] セレクタが担当する）。

export type IconSize = 'small' | 'medium' | 'large';

const ICON_SIZE_KEY = 'chizunurie:icon-size'; // アイコンサイズ（既定 small）
const ICON_SIZE_EVENT = 'chizunurie:icon-size-change';

export const DEFAULT_ICON_SIZE: IconSize = 'small';

const isBrowser = () => typeof window !== 'undefined';

function normalize(v: string | null): IconSize {
  return v === 'medium' || v === 'large' ? v : DEFAULT_ICON_SIZE;
}

// ── サイズ設定（localStorage 永続化） ──────────────────────────────
export function getIconSize(): IconSize {
  if (!isBrowser()) return DEFAULT_ICON_SIZE;
  return normalize(localStorage.getItem(ICON_SIZE_KEY));
}
export function setIconSize(size: IconSize): void {
  if (!isBrowser()) return;
  localStorage.setItem(ICON_SIZE_KEY, size);
  window.dispatchEvent(new CustomEvent(ICON_SIZE_EVENT, { detail: size }));
}

// 変更を購読する。返り値を呼ぶと購読解除。
export function onIconSizeChange(cb: (size: IconSize) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<IconSize>).detail);
  window.addEventListener(ICON_SIZE_EVENT, handler);
  return () => window.removeEventListener(ICON_SIZE_EVENT, handler);
}
