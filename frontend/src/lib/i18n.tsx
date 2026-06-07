'use client';

// ゲーム画面の用語（日本語／英語）を一括管理するターミノロジーファイル。
// - 管理画面・デバッグメニューは対象外（日本語のまま）。
// - 日本語の地名は英語版ではローマ字で見せる（romaji.ts）。
// 使い方：<LocaleProvider> でアプリを包み、各コンポーネントで useLocale() の t() を呼ぶ。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type Lang = 'ja' | 'en';

const STORAGE_KEY = 'chizunurie:lang';

// 各エントリは「文字列」または「引数を受け取って文字列を返す関数」。
type Entry = string | ((...args: never[]) => string);
type Dict = Record<string, Entry>;

const ja: Dict = {
  // Header
  appTitle: 'ちずぬりえ',
  login: 'ログイン',
  register: '新規登録',

  // SettingsMenu
  settings: '設定',
  loggedIn: 'ログイン中',
  role: '権限',
  roleUser: '一般ユーザー',
  roleDeveloper: '開発者',
  editNickname: 'ニックネーム変更',
  adminPanel: '管理画面',
  logout: 'ログアウト',
  language: '言語',
  sound: 'サウンド',
  soundEffects: '効果音',
  bgm: 'BGM',
  bgmOff: 'OFF',
  bgmSong1: '曲1',
  bgmSong2: '曲2',
  bgmSong3: '曲3',

  // AuthModal
  googleLogin: 'Googleでログイン',
  orEmail: 'またはメールで',
  registerSubmit: '登録する',
  processing: '処理中...',
  guestNote: 'ログインしなくてもゲームをお試しいただけます',
  emailPlaceholder: 'メールアドレス',
  passwordPlaceholder: 'パスワード（8文字以上）',
  loginFailed: 'ログインに失敗しました',
  registerFailed: '登録に失敗しました',
  genericFailed: '失敗しました',
  googleFailed: 'Googleログインに失敗しました',

  // NicknameModal
  nicknameEditTitle: 'ニックネームを変更',
  nicknameSetTitle: 'ニックネームを決めてください',
  nicknameDesc: (min: number, max: number) =>
    `ゲーム内ではこのニックネームが表示されます（${min}〜${max}文字）。`,
  nicknamePlaceholder: 'ニックネーム',
  nicknameRegPlaceholder: (min: number, max: number) =>
    `ニックネーム（${min}〜${max}文字）`,
  cancel: 'キャンセル',
  save: '変更する',
  decide: '決定',
  saving: '保存中...',
  nicknameTooShort: (n: number) => `ニックネームは${n}文字以上で入力してください`,
  nicknameTooLong: (n: number) => `ニックネームは${n}文字以内で入力してください`,
  saveFailed: '保存に失敗しました',

  // Map: バナー・モード
  comingSoonTitle: '準備中 🚧',
  comingSoonBody: 'この地域はまだ開発中です',
  modeGenchi: '現地塗り',
  modeTonari: 'となり塗り',

  // Map: ポイント／レベルパネル
  expLabel: (a: number, b: number) => `経験値 ${a} / ${b}`,
  totalExpLabel: (n: string) => `累計獲得経験値 ${n}`,
  paintPoints: (a: number, b: number) => `塗りポイント: ${a} / ${b}`,
  regenIn: (t: string) => `+1まで ${t}`,
  countdownSoon: 'まもなく',
  rewardCooldown: (t: string) => `回復まで ${t}`,
  rewardDailyLimit: '本日の視聴上限に達しました',
  rewardWatch: (left?: number) =>
    `▶ 動画を見て回復${left != null ? `（残り${left}回）` : ''}`,

  // Map: レベルアップ演出
  levelUp: 'LEVEL UP!',
  maxPointPlus: '塗りポイント上限 +1',

  // Map: 動画リワードモーダル
  videoTitle: '動画を見て塗りポイントを回復',
  videoAdSample: '広告（サンプル）',
  videoWatching: (s: number) => `あと ${s} 秒で「そのレベルの満タン分」を回復します`,
  videoClaiming: 'ポイントを回復しています…',
  videoError: '回復に失敗しました。もう一度お試しください。',
  close: '閉じる',
  retry: 'もう一度受け取る',
  stop: 'やめる',

  // Map: 離れた場所の確認
  confirmFarTitle: '離れた場所を塗りますか？',
  confirmFarBody: (cost: number, points: number) =>
    `塗り済みエリアから離れているため、塗りポイントを ${cost} 消費します。\n（残り ${points} ポイント）`,
  confirmFarPaint: (cost: number) => `${cost}ポイント使って塗る`,

  // Map: 地名検索
  searchTitle: '地名を検索',
  searchPlaceholder: '例：東京都 / 横浜市 / パリ / フランス',
  searching: '検索中…',
  searchButton: '検索',
  searchNotFound: '見つかりませんでした',
  searchFailed: '検索に失敗しました',
  searchScopeJp: '国内',
  searchScopeWorld: '海外',

  // Map: データ詳細パネル
  statsTitle: 'データ詳細',
  totalExpShort: '累計獲得経験値',
  playTime: '⏱ 合計プレイ時間',
  paintedRegions: '塗った地域',
  visitedGps: '訪問(GPS)',
  adjacentPaint: '隣接塗り',
  prefVisited: '訪れた都道府県',
  muniVisited: '訪れた市区町村',
  japanWhole: '🗾 日本全体',
  calculating: '計算中…',
  perPrefTitle: '都道府県ごとの塗り',
  flyToPref: 'この都道府県の塗った場所へ移動',
  noPainted: 'まだ塗った地域がありません',
  calcBreakdown: '地域内訳を計算中…',
  viewJapan: '日本',
  viewWorld: '世界',
  perCountryTitle: '国ごとの塗り',

  // Map: トースト（ゲーム向け）
  needLoginVideo: 'ログインすると動画でポイントを回復できます',
  videoNotYet: 'まだ動画を見られません（クールダウン中）',
  recoverFailed: 'ポイントの回復に失敗しました',
  recovered: (n: number) => `動画視聴で塗りポイントを ${n} 回復しました`,
  needLoginPaint: 'ログインすると塗りポイントを使って塗れます',
  zoomToPaint: 'もっとズームすると塗れます',
  switchTonari: 'となり塗りモードにするとマウスで塗れます',
  gpsLocked: '実際に訪れた場所です（マウスでは変更できません）',
  notEnoughPoints: '塗りポイントが足りません',
  notEnoughPointsLeft: (n: number) => `塗りポイントが足りません（残り ${n}）`,
  foreignBulkHint: '🌏 外国は10×10まとめ塗り！',
  foreignPainted: (n: number) => `外国を${n}マスまとめ塗り！`,
  expGained: (n: number) => `経験値 +${n} 🎉`,
  expRevisit: (n: number) => `再訪ボーナス 経験値 +${n} 🎉`,
  geoDenied: '位置情報の利用が許可されていません（ブラウザの設定を確認してください）',
  geoTimeout: '位置情報の取得がタイムアウトしました',
  geoFailed: '位置情報を取得できませんでした',

  // Map: ホバー中の市区町村塗り％
  hoverStat: (city: string, pct: string, p: number, total: number) =>
    `${city}　${pct}%（${p}/${total}）`,
  hoverMeasuring: (city: string) => `${city}：計測中…`,

  // 合計プレイ時間の単位
  timeDay: (n: number) => `${n}日`,
  timeHour: (n: number) => `${n}時間`,
  timeMin: (n: number) => `${n}分`,
  timeSec: (n: number) => `${n}秒`,
};

const en: Dict = {
  // Header
  appTitle: 'Chizunurie',
  login: 'Log in',
  register: 'Sign up',

  // SettingsMenu
  settings: 'Settings',
  loggedIn: 'Signed in',
  role: 'Role',
  roleUser: 'User',
  roleDeveloper: 'Developer',
  editNickname: 'Change nickname',
  adminPanel: 'Admin',
  logout: 'Log out',
  language: 'Language',
  sound: 'Sound',
  soundEffects: 'Sound effects',
  bgm: 'BGM',
  bgmOff: 'Off',
  bgmSong1: 'Song 1',
  bgmSong2: 'Song 2',
  bgmSong3: 'Song 3',

  // AuthModal
  googleLogin: 'Sign in with Google',
  orEmail: 'or with email',
  registerSubmit: 'Register',
  processing: 'Processing...',
  guestNote: 'You can try the game without signing in',
  emailPlaceholder: 'Email address',
  passwordPlaceholder: 'Password (8+ characters)',
  loginFailed: 'Failed to log in',
  registerFailed: 'Failed to sign up',
  genericFailed: 'Something went wrong',
  googleFailed: 'Failed to sign in with Google',

  // NicknameModal
  nicknameEditTitle: 'Change nickname',
  nicknameSetTitle: 'Choose a nickname',
  nicknameDesc: (min: number, max: number) =>
    `This nickname is shown in the game (${min}–${max} characters).`,
  nicknamePlaceholder: 'Nickname',
  nicknameRegPlaceholder: (min: number, max: number) =>
    `Nickname (${min}–${max} characters)`,
  cancel: 'Cancel',
  save: 'Save',
  decide: 'Confirm',
  saving: 'Saving...',
  nicknameTooShort: (n: number) => `Nickname must be at least ${n} characters`,
  nicknameTooLong: (n: number) => `Nickname must be at most ${n} characters`,
  saveFailed: 'Failed to save',

  // Map: banners / modes
  comingSoonTitle: 'Coming soon 🚧',
  comingSoonBody: 'This area is still under development',
  modeGenchi: 'On-site',
  modeTonari: 'Adjacent',

  // Map: points / level panel
  expLabel: (a: number, b: number) => `EXP ${a} / ${b}`,
  totalExpLabel: (n: string) => `Total EXP ${n}`,
  paintPoints: (a: number, b: number) => `Paint points: ${a} / ${b}`,
  regenIn: (t: string) => `+1 in ${t}`,
  countdownSoon: 'soon',
  rewardCooldown: (t: string) => `Recover in ${t}`,
  rewardDailyLimit: "Today's limit reached",
  rewardWatch: (left?: number) =>
    `▶ Watch a video to recover${left != null ? ` (${left} left)` : ''}`,

  // Map: level up
  levelUp: 'LEVEL UP!',
  maxPointPlus: 'Max paint points +1',

  // Map: video reward modal
  videoTitle: 'Watch a video to recover paint points',
  videoAdSample: 'Ad (sample)',
  videoWatching: (s: number) =>
    `Recovering a full level's worth in ${s}s`,
  videoClaiming: 'Recovering points…',
  videoError: 'Recovery failed. Please try again.',
  close: 'Close',
  retry: 'Get it again',
  stop: 'Stop',

  // Map: far paint confirm
  confirmFarTitle: 'Paint this distant area?',
  confirmFarBody: (cost: number, points: number) =>
    `This is far from your painted area, so it costs ${cost} paint points.\n(${points} points left)`,
  confirmFarPaint: (cost: number) => `Use ${cost} points to paint`,

  // Map: place search
  searchTitle: 'Search a place',
  searchPlaceholder: 'e.g. Tokyo / Yokohama / Paris / France',
  searching: 'Searching…',
  searchButton: 'Search',
  searchNotFound: 'No results found',
  searchFailed: 'Search failed',
  searchScopeJp: 'Japan',
  searchScopeWorld: 'World',

  // Map: stats panel
  statsTitle: 'My stats',
  totalExpShort: 'Total EXP',
  playTime: '⏱ Total play time',
  paintedRegions: 'Painted areas',
  visitedGps: 'Visited (GPS)',
  adjacentPaint: 'Adjacent',
  prefVisited: 'Prefectures visited',
  muniVisited: 'Municipalities visited',
  japanWhole: '🗾 All Japan',
  calculating: 'Calculating…',
  perPrefTitle: 'Painted by prefecture',
  flyToPref: 'Jump to painted areas in this prefecture',
  noPainted: 'No painted areas yet',
  calcBreakdown: 'Calculating breakdown…',
  viewJapan: 'Japan',
  viewWorld: 'World',
  perCountryTitle: 'Painted by country',

  // Map: toasts (game)
  needLoginVideo: 'Sign in to recover points by watching videos',
  videoNotYet: 'Not available yet (cooldown)',
  recoverFailed: 'Failed to recover points',
  recovered: (n: number) => `Recovered ${n} paint points by watching a video`,
  needLoginPaint: 'Sign in to paint using paint points',
  zoomToPaint: 'Zoom in more to paint',
  switchTonari: 'Switch to Adjacent mode to paint with the mouse',
  gpsLocked: 'This is a place you actually visited (cannot be changed by mouse)',
  notEnoughPoints: 'Not enough paint points',
  notEnoughPointsLeft: (n: number) => `Not enough paint points (${n} left)`,
  foreignBulkHint: '🌏 Abroad paints 10×10 at once!',
  foreignPainted: (n: number) => `Painted ${n} cells abroad at once!`,
  expGained: (n: number) => `EXP +${n} 🎉`,
  expRevisit: (n: number) => `Revisit bonus  EXP +${n} 🎉`,
  geoDenied: 'Location access is not allowed (check your browser settings)',
  geoTimeout: 'Getting your location timed out',
  geoFailed: 'Could not get your location',

  // Map: hover municipality paint %
  hoverStat: (city: string, pct: string, p: number, total: number) =>
    `${city}  ${pct}% (${p}/${total})`,
  hoverMeasuring: (city: string) => `${city}: measuring…`,

  // total play time units
  timeDay: (n: number) => `${n}d `,
  timeHour: (n: number) => `${n}h `,
  timeMin: (n: number) => `${n}m `,
  timeSec: (n: number) => `${n}s`,
};

const TABLE: Record<Lang, Dict> = { ja, en };

export type TFunc = (key: keyof typeof ja, ...args: never[]) => string;

type LocaleValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFunc;
};

const LocaleContext = createContext<LocaleValue>({
  lang: 'ja',
  setLang: () => {},
  t: (key) => String(key),
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  // SSR と初回クライアント描画を一致させるため初期値は 'ja' 固定。
  // localStorage の保存値はマウント後の effect で反映する。
  const [lang, setLangState] = useState<Lang>('ja');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'ja' || saved === 'en') {
      setLangState(saved);
      document.documentElement.lang = saved;
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // localStorage 不可（プライベートモード等）でも言語切替自体は機能させる
    }
    document.documentElement.lang = l;
  }, []);

  const t = useCallback<TFunc>(
    (key, ...args) => {
      const entry = TABLE[lang][key] ?? ja[key];
      if (typeof entry === 'function') return (entry as (...a: never[]) => string)(...args);
      return entry ?? String(key);
    },
    [lang]
  );

  return (
    <LocaleContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}
