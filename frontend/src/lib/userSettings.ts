// ユーザー設定（効果音・BGM・バイブ・地図オーバーレイ・現在地住所・言語）を1つの JSON に
// まとめてサーバー（user.settings jsonb）と同期する。各設定の実体は従来どおり localStorage 系の
// モジュール（sound / haptics / basemap / gpsAddress）と i18n が持ち、ここはその束ね役。
// 設定項目が増えても UserSettings に1キー足すだけで済む（DB はスキーマ変更不要）。

import {
  isSeEnabled,
  setSeEnabled,
  getBgmTrack,
  setBgmTrack,
  type BgmTrack,
} from './sound';
import { isHapticsEnabled, setHapticsEnabled } from './haptics';
import {
  isBasemapEnabled,
  setBasemapEnabled,
  getBasemapOpacity,
  setBasemapOpacity,
} from './basemap';
import { isGpsAddressEnabled, setGpsAddressEnabled } from './gpsAddress';
import type { Lang } from './i18n';
import { fetchMySettings, saveMySettings } from './userApi';

export type UserSettings = {
  se?: boolean; // 効果音 ON/OFF
  bgm?: BgmTrack; // BGM 曲番号（0=OFF）
  haptics?: boolean; // バイブ ON/OFF
  basemap?: boolean; // 地理院オーバーレイ ON/OFF
  basemapOpacity?: number; // 絵付きの地図（ラスター）の不透明度（0〜1）
  gpsAddress?: boolean; // 現在地の住所ラベル ON/OFF
  lang?: Lang; // 表示言語
};

// 現在のクライアント設定（localStorage 由来）を1つにまとめる。lang は i18n コンテキストから渡す。
export function collectSettings(lang: Lang): UserSettings {
  return {
    se: isSeEnabled(),
    bgm: getBgmTrack(),
    haptics: isHapticsEnabled(),
    basemap: isBasemapEnabled(),
    basemapOpacity: getBasemapOpacity(),
    gpsAddress: isGpsAddressEnabled(),
    lang,
  };
}

// サーバー設定を localStorage 系モジュールへ反映する（present なキーだけ）。
// lang は i18n コンテキストの setLang が必要なので呼び出し側で処理する。
export function applyLocalSettings(s: UserSettings): void {
  if (typeof s.se === 'boolean') setSeEnabled(s.se);
  if (s.bgm === 0 || s.bgm === 1 || s.bgm === 2 || s.bgm === 3) setBgmTrack(s.bgm);
  if (typeof s.haptics === 'boolean') setHapticsEnabled(s.haptics);
  if (typeof s.basemap === 'boolean') setBasemapEnabled(s.basemap);
  if (typeof s.basemapOpacity === 'number') setBasemapOpacity(s.basemapOpacity);
  if (typeof s.gpsAddress === 'boolean') setGpsAddressEnabled(s.gpsAddress);
}

// 現在のクライアント設定をサーバーへ保存する（fire-and-forget）。
export function pushSettings(lang: Lang): void {
  void saveMySettings(collectSettings(lang) as Record<string, unknown>);
}

// サーバー設定を取得して localStorage 系へ反映する。lang が含まれていれば applyLang で適用する。
// 取得できた設定オブジェクトを返す（呼び出し側でローカル state を再読込するため）。
export async function hydrateSettings(applyLang: (l: Lang) => void): Promise<UserSettings> {
  const s = (await fetchMySettings()) as UserSettings;
  applyLocalSettings(s);
  if (s.lang === 'ja' || s.lang === 'en') applyLang(s.lang);
  return s;
}
