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

// ブラウザタブのタイトル（layout.tsx の静的 title と一致させる・言語で切替）
const DOC_TITLE: Record<Lang, string> = {
  ja: 'ちずぬりえ',
  en: 'Color the Map',
};

// 各エントリは「文字列」または「引数を受け取って文字列を返す関数」。
type Entry = string | ((...args: never[]) => string);
type Dict = Record<string, Entry>;

const ja: Dict = {
  // Header
  appTitle: 'ちずぬりえ',
  login: 'ログイン',
  register: '新規登録',
  guestNotice: 'ゲストとして塗っています。登録すると別の端末でも続きを塗れます',
  shareOnX: 'Xでシェア',
  shareText: '歩いた街が色になる白地図ゲーム「ちずぬりえ」🗾📍 GPSで現在地を塗って、市区町村→都道府県と"制覇"していくやつ。ブラウザですぐ遊べます👇',
  copyLink: 'リンクをコピー',
  linkCopied: 'コピーしました',

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
  vibration: 'バイブ',
  mapDisplay: '地図表示',
  baseMapOverlay: '地図を薄く表示',
  baseMapOpacity: '地図の濃さ',
  gpsAddressLabel: '現在地の住所を表示',
  iconSize: 'アイコンの大きさ',
  iconSizeSmall: '小',
  iconSizeMedium: '中',
  iconSizeLarge: '大',

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
  tonariHint:
    'となり塗り中\n・クリックで1マス、隣接した場所からドラッグ（スマホはスワイプ）で連続して塗れます\n・隣接した場所は塗りポイント1、離れた場所は10消費（確認あり）\n・となりじゃない場所をドラッグすると地図が動きます',

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
  videoLoading: '広告を準備しています…',
  videoDismissed: '最後まで視聴すると塗りポイントを回復できます',
  videoUnavailable: 'いま広告を表示できません。しばらくしてからお試しください',
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
  flyToCountry: 'この国の塗った場所へ移動',
  noPainted: 'まだ塗った地域がありません',
  calcBreakdown: '地域内訳を計算中…',
  viewJapan: '日本',
  viewWorld: '世界',
  perCountryTitle: '国ごとの塗り',

  // Map: ランキング
  rankingsTitle: 'ランキング',
  rankPainted: '塗ったマス',
  rankGps: 'GPS訪問',
  rankMuni: '市区町村',
  rankLevel: 'レベル',
  rankPlaytime: 'プレイ時間',
  rankPref: '都道府県',
  rankCountry: '国',
  rankRegionSelect: '地域を選択',
  rankRegionEmpty: 'この地域はまだ誰も塗っていません',
  rankLoading: 'ランキングを読み込み中…',
  rankEmpty: 'まだランキングがありません',
  rankYou: 'あなた',
  rankMeOutside: (rank: number) => `あなたの順位：${rank}位`,
  rankTotalUsers: (n: number) => `全${n.toLocaleString()}人`,
  rankUnitCells: 'マス',
  rankUnitMuni: '市区町村',
  rankUnitLevel: 'Lv',
  rankPeriodAll: '全期間',
  rankPeriodMonth: '月間',
  rankPeriodWeek: '週間',
  rankLevelAllOnly: 'レベルは全期間のみの集計です',
  rankPlaytimeAllOnly: 'プレイ時間は全期間のみの集計です',

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
  foreignPainted: (place: string, n: number) => `${place || '外国'}を${n}マスまとめ塗り！`,
  expGained: (n: number) => `経験値 +${n} 🎉`,
  expRevisit: (n: number) => `再訪ボーナス 経験値 +${n} 🎉`,
  expFloat: (n: number) => `経験値+${n}`,
  // 制覇・コンボ・フォグ
  muniConquered: (name: string) => `🎉 ${name} 制覇！`,
  prefConquered: (name: string) => `👑 ${name} 完全制覇！`,
  combo: (n: number) => `${n} れんさ！`,
  conquered: '制覇',
  conqueredMuni: '制覇した市区町村',
  conqueredPref: '完全制覇した都道府県',
  noConquered: 'まだありません（市区町村を100%塗ると制覇）',
  geoDenied: '位置情報の利用が許可されていません（ブラウザの設定を確認してください）',
  geoTimeout: '位置情報の取得がタイムアウトしました',
  geoFailed: '位置情報を取得できませんでした',
  geoInsecure: '位置情報は https か localhost でしか使えません（IPアドレス等のhttp接続では取得できません）',

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
  guestNotice: 'You are painting as a guest. Sign up to keep your progress on any device.',
  shareOnX: 'Share on X',
  shareText: 'Chizunurie — a paint-the-map game where the towns you walk turn into color 🗾📍 Use GPS to paint where you are and conquer Japan, city by city. Play free in your browser 👇',
  copyLink: 'Copy link',
  linkCopied: 'Copied!',

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
  vibration: 'Vibration',
  mapDisplay: 'Map display',
  baseMapOverlay: 'Show map faintly',
  baseMapOpacity: 'Map intensity',
  gpsAddressLabel: 'Show current address',
  iconSize: 'Icon size',
  iconSizeSmall: 'S',
  iconSizeMedium: 'M',
  iconSizeLarge: 'L',

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
  tonariHint:
    'Adjacent painting\n・Click for one cell, or drag (swipe on mobile) from an adjacent cell to paint continuously\n・Adjacent cells cost 1 point; far cells cost 10 (with confirmation)\n・Dragging from a non-adjacent spot scrolls the map',

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
  videoLoading: 'Preparing the ad…',
  videoDismissed: 'Watch the full video to recover paint points',
  videoUnavailable: 'No ad available right now. Please try again later',
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
  flyToCountry: 'Jump to painted areas in this country',
  noPainted: 'No painted areas yet',
  calcBreakdown: 'Calculating breakdown…',
  viewJapan: 'Japan',
  viewWorld: 'World',
  perCountryTitle: 'Painted by country',

  // Map: rankings
  rankingsTitle: 'Rankings',
  rankPainted: 'Cells',
  rankGps: 'GPS',
  rankMuni: 'Cities',
  rankLevel: 'Level',
  rankPlaytime: 'Play time',
  rankPref: 'Prefecture',
  rankCountry: 'Country',
  rankRegionSelect: 'Select a region',
  rankRegionEmpty: 'No one has painted this region yet',
  rankLoading: 'Loading rankings…',
  rankEmpty: 'No rankings yet',
  rankYou: 'You',
  rankMeOutside: (rank: number) => `Your rank: #${rank}`,
  rankTotalUsers: (n: number) => `${n.toLocaleString()} users`,
  rankUnitCells: 'cells',
  rankUnitMuni: 'cities',
  rankUnitLevel: 'Lv',
  rankPeriodAll: 'All time',
  rankPeriodMonth: 'Monthly',
  rankPeriodWeek: 'Weekly',
  rankLevelAllOnly: 'Level is all-time only',
  rankPlaytimeAllOnly: 'Play time is all-time only',

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
  foreignPainted: (place: string, n: number) =>
    `Painted ${n} cells at ${place || 'abroad'} at once!`,
  expGained: (n: number) => `EXP +${n} 🎉`,
  expRevisit: (n: number) => `Revisit bonus  EXP +${n} 🎉`,
  expFloat: (n: number) => `+${n} EXP`,
  // conquest / combo
  muniConquered: (name: string) => `🎉 ${name} conquered!`,
  prefConquered: (name: string) => `👑 ${name} fully conquered!`,
  combo: (n: number) => `${n} combo!`,
  conquered: 'Conquered',
  conqueredMuni: 'Conquered municipalities',
  conqueredPref: 'Fully conquered prefectures',
  noConquered: 'None yet (paint a municipality to 100% to conquer it)',
  geoDenied: 'Location access is not allowed (check your browser settings)',
  geoTimeout: 'Getting your location timed out',
  geoFailed: 'Could not get your location',
  geoInsecure: 'Location works only over https or localhost (not over plain http such as an IP address)',

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
      document.title = DOC_TITLE[saved];
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
    document.title = DOC_TITLE[l];
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
