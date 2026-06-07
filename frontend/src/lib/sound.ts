'use client';

// ゲームのサウンド（効果音＋BGM）を Web Audio API でその場合成するモジュール。
// - 音声ファイルは持たず、オシレータで合成する（DL不要・即鳴る）。
// - 効果音：となり塗り成功（playPaint）／レベルアップ（playLevelUp）。
// - BGM：穏やかなコード進行のループ（lookahead スケジューラで先読み再生）。
//   曲は3つ用意し、設定メニューから「曲1／曲2／曲3／OFF」を選べる。
// - ON/OFF・選択中の曲は localStorage に保存。設定メニュー（SettingsMenu）から切り替える。
// - ブラウザの自動再生制限のため、AudioContext は最初のユーザー操作で resume する。

const SE_KEY = 'chizunurie:sound:se'; // 効果音 ON/OFF（既定 ON）
const BGM_KEY = 'chizunurie:sound:bgm'; // BGM の選択（'0'=OFF / '1'〜'3'=曲番号・既定 OFF）

// 選べる BGM 曲番号。0 は OFF。
export type BgmTrack = 0 | 1 | 2 | 3;

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

// SSR ガード。localStorage / AudioContext はブラウザでのみ使える。
const isBrowser = () => typeof window !== 'undefined';

// AudioContext を遅延生成する。ユーザー操作後でないと suspended のことがある。
function getCtx(): AudioContext | null {
  if (!isBrowser()) return null;
  if (ctx) return ctx;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(ctx.destination);
  return ctx;
}

// ── ON/OFF 設定（localStorage 永続化） ──────────────────────────────
export function isSeEnabled(): boolean {
  if (!isBrowser()) return true;
  return localStorage.getItem(SE_KEY) !== '0'; // 既定 ON
}
export function setSeEnabled(on: boolean): void {
  if (!isBrowser()) return;
  localStorage.setItem(SE_KEY, on ? '1' : '0');
}

// 選択中の BGM 曲番号（0=OFF）。不正値・旧値は安全側へ寄せる。
export function getBgmTrack(): BgmTrack {
  if (!isBrowser()) return 0; // 既定 OFF
  const raw = localStorage.getItem(BGM_KEY);
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 ? (n as BgmTrack) : 0;
}
// 互換用：BGM が鳴る状態か（曲が選ばれているか）。
export function isBgmEnabled(): boolean {
  return getBgmTrack() !== 0;
}

// BGM の曲を選ぶ（0=OFF）。再生中なら即座に切り替える。
export function setBgmTrack(track: BgmTrack): void {
  if (!isBrowser()) return;
  localStorage.setItem(BGM_KEY, String(track));
  stopBgm();
  if (track !== 0) startBgm();
}

// 最初のユーザー操作で呼ぶ。suspended な AudioContext を resume し、
// BGM が選ばれていれば再生を開始する（自動再生ポリシー対策）。
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  if (isBgmEnabled()) startBgm();
}

// ── 効果音 ──────────────────────────────────────────────────────────
// 1音を鳴らすヘルパ。start からの相対時間でエンベロープを付ける。
function blip(
  c: AudioContext,
  dest: AudioNode,
  freq: number,
  start: number,
  dur: number,
  peak: number,
  type: OscillatorType = 'sine'
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// となり塗り成功：軽い「ポンッ」という2音の上昇。
export function playPaint(): void {
  if (!isSeEnabled()) return;
  const c = getCtx();
  if (!c || !masterGain) return;
  if (c.state === 'suspended') void c.resume();
  const t = c.currentTime;
  blip(c, masterGain, 660, t, 0.12, 0.25, 'triangle'); // E5
  blip(c, masterGain, 990, t + 0.06, 0.14, 0.2, 'triangle'); // B5
}

// レベルアップ：明るい上昇アルペジオ（ドミソド）。
export function playLevelUp(): void {
  if (!isSeEnabled()) return;
  const c = getCtx();
  if (!c || !masterGain) return;
  if (c.state === 'suspended') void c.resume();
  const t = c.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    blip(c, masterGain!, f, t + i * 0.1, 0.3, 0.26, 'triangle');
  });
  // 締めのきらめき
  blip(c, masterGain, 1567.98, t + 0.4, 0.35, 0.16, 'sine'); // G6
}

// ── BGM（メロディ＋ベース＋パッドのループ） ──────────────────────────
// 1曲 = テンポ（BEAT）＋各小節の伴奏（BARS）＋メロディ（MELODY）で表す。
// 各小節は4拍。メロディは [MIDI, 拍数] 列で、合計4拍になるように書く。
const BGM_GAIN = 0.14; // 効果音より控えめに

// MIDI ノート番号 → 周波数（A4=69=440Hz）。
const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

type Song = {
  beat: number; // 1拍の秒数（テンポ）
  bars: [number, number[]][]; // 各小節 [ベース(MIDI), 三和音3音(MIDI)]
  melody: [number, number][][]; // 各小節の [MIDI, 拍数] 列（合計4拍）
};

// ── 曲1：穏やかな C メジャー（16小節・元からのBGM） ──────────────────
const SONG_1: Song = {
  beat: 0.5,
  bars: [
    [48, [60, 64, 67]], // C
    [43, [55, 59, 62]], // G
    [45, [57, 60, 64]], // Am
    [41, [53, 57, 60]], // F
    [48, [60, 64, 67]], // C
    [43, [55, 59, 62]], // G
    [41, [53, 57, 60]], // F
    [43, [55, 59, 62]], // G
    [45, [57, 60, 64]], // Am
    [41, [53, 57, 60]], // F
    [48, [60, 64, 67]], // C
    [43, [55, 59, 62]], // G
    [41, [53, 57, 60]], // F
    [43, [55, 59, 62]], // G
    [48, [60, 64, 67]], // C
    [48, [60, 64, 67]], // C
  ],
  melody: [
    [[64, 1], [67, 1], [72, 2]],
    [[74, 1], [71, 1], [67, 2]],
    [[72, 1], [76, 1], [69, 2]],
    [[69, 1], [72, 1], [65, 2]],
    [[67, 1], [64, 1], [67, 1], [72, 1]],
    [[74, 2], [71, 2]],
    [[69, 1], [67, 1], [65, 1], [64, 1]],
    [[62, 2], [67, 2]],
    [[69, 1], [72, 1], [76, 2]],
    [[77, 1], [76, 1], [72, 2]],
    [[76, 1], [74, 1], [72, 2]],
    [[74, 1], [71, 1], [67, 2]],
    [[69, 1], [72, 1], [77, 2]],
    [[79, 2], [74, 2]],
    [[76, 1], [79, 1], [84, 2]],
    [[72, 4]],
  ],
};

// ── 曲2：弾むような G メジャー（8小節・少し速め） ────────────────────
const SONG_2: Song = {
  beat: 0.42,
  bars: [
    [43, [59, 62, 67]], // G
    [50, [57, 62, 66]], // D
    [40, [59, 64, 67]], // Em
    [48, [60, 64, 67]], // C
    [43, [59, 62, 67]], // G
    [50, [57, 62, 66]], // D
    [48, [60, 64, 67]], // C
    [50, [57, 62, 66]], // D
  ],
  melody: [
    [[67, 0.5], [71, 0.5], [74, 1], [71, 1], [67, 1]], // G4 B4 D5 B4 G4
    [[66, 0.5], [69, 0.5], [74, 1], [73, 1], [69, 1]], // F#4 A4 D5 C#5 A4
    [[71, 1], [67, 1], [64, 1], [67, 1]], // B4 G4 E4 G4
    [[72, 1], [71, 1], [67, 2]], // C5 B4 G4
    [[74, 0.5], [76, 0.5], [79, 1], [76, 1], [74, 1]], // D5 E5 G5 E5 D5
    [[78, 1], [74, 1], [69, 2]], // F#5 D5 A4
    [[72, 1], [76, 1], [72, 1], [67, 1]], // C5 E5 C5 G4
    [[74, 2], [69, 2]], // D5 A4
  ],
};

// ── 曲3：夢見るような F メジャー（8小節・ゆったり） ──────────────────
const SONG_3: Song = {
  beat: 0.56,
  bars: [
    [41, [60, 65, 69]], // F  (C4 F4 A4)
    [38, [62, 65, 69]], // Dm (D4 F4 A4)
    [46, [58, 62, 65]], // Bb (Bb3 D4 F4)
    [48, [60, 64, 67]], // C  (C4 E4 G4)
    [41, [60, 65, 69]], // F
    [38, [62, 65, 69]], // Dm
    [43, [62, 67, 70]], // Gm (D4 G4 Bb4)
    [48, [60, 64, 67]], // C
  ],
  melody: [
    [[69, 2], [72, 2]], // A4 C5
    [[74, 2], [69, 2]], // D5 A4
    [[70, 2], [65, 2]], // Bb4 F4
    [[67, 4]], // G4
    [[72, 2], [77, 2]], // C5 F5
    [[74, 3], [72, 1]], // D5 C5
    [[70, 2], [74, 2]], // Bb4 D5
    [[67, 2], [72, 2]], // G4 C5
  ],
};

const SONGS: Record<1 | 2 | 3, Song> = { 1: SONG_1, 2: SONG_2, 3: SONG_3 };

// 1周ぶんの発音イベントを拍位置順に組み立てる（startBgm 内で1回だけ生成）。
type BgmEvent = {
  beat: number;
  freq: number;
  dur: number;
  peak: number;
  type: OscillatorType;
};
function buildBgmEvents(song: Song): BgmEvent[] {
  const ev: BgmEvent[] = [];
  for (let bar = 0; bar < song.bars.length; bar++) {
    const start = bar * 4;
    const [bass, triad] = song.bars[bar];
    // ベース：1拍目・3拍目。
    ev.push({ beat: start, freq: midi(bass), dur: 1.8, peak: 0.42, type: 'triangle' });
    ev.push({ beat: start + 2, freq: midi(bass), dur: 1.8, peak: 0.34, type: 'triangle' });
    // パッド：三和音を小節いっぱい伸ばす。
    for (const n of triad) {
      ev.push({ beat: start, freq: midi(n), dur: 3.6, peak: 0.16, type: 'sine' });
    }
    // メロディ。
    let b = start;
    for (const [m, d] of song.melody[bar]) {
      if (m > 0) ev.push({ beat: b, freq: midi(m), dur: d * 0.9, peak: 0.5, type: 'triangle' });
      b += d;
    }
  }
  return ev.sort((a, z) => a.beat - z.beat);
}

let bgmGain: GainNode | null = null;
let bgmTimer: number | null = null;
let bgmEvents: BgmEvent[] = [];
let bgmBeat = 0.5; // 再生中の曲の1拍秒数
let bgmLoopBeats = 0; // 再生中の曲の1周の拍数
let loopStart = 0; // この周回の先頭の AudioContext 時刻
let evtIdx = 0; // 次にスケジュールするイベント

// 25ms ごとに 0.15s 先までイベントを先読みスケジュールし、末尾まで来たら次周回へ。
function bgmScheduler(): void {
  const c = getCtx();
  if (!c || !bgmGain) return;
  const horizon = c.currentTime + 0.15;
  for (;;) {
    if (evtIdx >= bgmEvents.length) {
      loopStart += bgmLoopBeats * bgmBeat; // 次の周回へ折り返す
      evtIdx = 0;
    }
    const e = bgmEvents[evtIdx];
    const when = loopStart + e.beat * bgmBeat;
    if (when >= horizon) break;
    blip(c, bgmGain, e.freq, Math.max(when, c.currentTime), e.dur * bgmBeat, e.peak, e.type);
    evtIdx++;
  }
}

export function startBgm(): void {
  const track = getBgmTrack();
  if (track === 0) return;
  const c = getCtx();
  if (!c || !masterGain) return;
  if (c.state === 'suspended') void c.resume();
  if (bgmTimer !== null) return; // 二重起動防止
  if (!bgmGain) {
    bgmGain = c.createGain();
    bgmGain.gain.value = BGM_GAIN;
    bgmGain.connect(masterGain);
  }
  const song = SONGS[track];
  bgmEvents = buildBgmEvents(song);
  bgmBeat = song.beat;
  bgmLoopBeats = song.bars.length * 4;
  loopStart = c.currentTime + 0.1;
  evtIdx = 0;
  bgmScheduler();
  bgmTimer = window.setInterval(bgmScheduler, 25);
}

export function stopBgm(): void {
  if (bgmTimer !== null) {
    window.clearInterval(bgmTimer);
    bgmTimer = null;
  }
}
