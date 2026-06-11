import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { appSettings, user, userPoints } from "../db/schema.js";

// ── 塗りポイントの調整パラメータ（今後バランス調整予定） ──────────────
// 塗りのコスト（クライアントが隣接判定して送る。サーバーは残高のみ権威的に管理する）
export const COST_ADJACENT = 1; // 塗り済みに隣接する場所
export const COST_FAR = 10; // 離れた場所（確認ダイアログ付き）
// 許可するコスト（0 は Shift+クリックのデバッグ塗り用＝無料）
export const ALLOWED_COSTS = new Set([0, COST_ADJACENT, COST_FAR]);

// ── 経験値・レベル・ポイント設定（app_settings の expConfig キーで動的変更可能） ──────────
// 全フィールドは管理画面の設定タブから変更でき、保存すると全ユーザーに即反映される。
// DB 未設定時は下記の既定値（EXP_CONFIG_DEFAULTS）が使われる。

export type ExpConfig = {
  expVisit: number;            // GPS 訪問・昇格・全面セル再訪の経験値
  expPaint: number;            // 手動塗り（となり塗り）の経験値
  expFine: number;             // 125m 細セル初踏みの経験値
  expFineRevisit: number;      // 125m 細セル再訪の経験値（クールダウン経過後）
  baseMaxPoints: number;       // level 1 の最大塗りポイント（回復上限）
  baseExpToNext: number;       // level 1→2 に必要な経験値
  expToNextStep: number;       // レベルが上がるごとに増える必要経験値の増分
  initialPoints: number;       // 新規ユーザーの初期塗りポイント残高
  regenIntervalSec: number;    // 1ポイント回復するまでの秒数
  revisitCooldownSec: number;  // 再訪クールダウン：既訪セルへ GPS で入り直したとき再び XP を付与するまでの待ち時間
};

export const EXP_CONFIG_DEFAULTS: ExpConfig = {
  expVisit: 100,
  expPaint: 50,
  expFine: 5,
  expFineRevisit: 5,
  baseMaxPoints: 10,
  baseExpToNext: 500,
  expToNextStep: 100,
  initialPoints: 10,
  regenIntervalSec: 600,
  revisitCooldownSec: 3600,
};

// app_settings（単一行 id=1 の jsonb）の expConfig キーから設定を読む。
// 未設定・値が不正なキーは既定値にフォールバックする。
// painted リクエストごとに1回読む（動画リワードと同じパターン）。
export async function getExpConfig(tx: DbExecutor = db): Promise<ExpConfig> {
  const rows = await tx
    .select({ settings: appSettings.settings })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  const raw = (rows[0]?.settings as Record<string, unknown> | undefined)
    ?.expConfig as Record<string, unknown> | undefined;
  function numOr(v: unknown, min: number, def: number): number {
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : def;
  }
  return {
    expVisit: numOr(raw?.expVisit, 0, EXP_CONFIG_DEFAULTS.expVisit),
    expPaint: numOr(raw?.expPaint, 0, EXP_CONFIG_DEFAULTS.expPaint),
    expFine: numOr(raw?.expFine, 0, EXP_CONFIG_DEFAULTS.expFine),
    expFineRevisit: numOr(raw?.expFineRevisit, 0, EXP_CONFIG_DEFAULTS.expFineRevisit),
    baseMaxPoints: numOr(raw?.baseMaxPoints, 1, EXP_CONFIG_DEFAULTS.baseMaxPoints),
    baseExpToNext: numOr(raw?.baseExpToNext, 1, EXP_CONFIG_DEFAULTS.baseExpToNext),
    expToNextStep: numOr(raw?.expToNextStep, 0, EXP_CONFIG_DEFAULTS.expToNextStep),
    initialPoints: numOr(raw?.initialPoints, 0, EXP_CONFIG_DEFAULTS.initialPoints),
    regenIntervalSec: numOr(raw?.regenIntervalSec, 1, EXP_CONFIG_DEFAULTS.regenIntervalSec),
    revisitCooldownSec: numOr(raw?.revisitCooldownSec, 0, EXP_CONFIG_DEFAULTS.revisitCooldownSec),
  };
}

// level のときの最大塗りポイント（回復上限）
export function maxPointsForLevel(level: number, cfg: ExpConfig): number {
  return cfg.baseMaxPoints + (level - 1);
}

// level → level+1 に必要な経験値
export function expToNext(level: number, cfg: ExpConfig): number {
  return cfg.baseExpToNext + (level - 1) * cfg.expToNextStep;
}

// 1回のハートビートで加算を許可する最大秒数。クライアントは約1分ごとに送るため、
// 多少の遅延（タブ復帰直後など）を見込んでこの値を上限にして不正な水増しを防ぐ。
export const MAX_HEARTBEAT_DELTA_SEC = 120;

// ── 動画リワード（動画視聴で塗りポイントを回復） ──────────────────────
// 動画を1本見ると回復量設定（amountMode）に応じたポイントを残高に加算する。
// 不正・乱用対策として「クールダウン」と「1日の上限回数」を併用する。
//
// クールダウンと回復量は app_settings（jsonb の videoReward キー・管理画面で編集）で
// ゲーム全体に対して変更できる。クールダウンは Web（GPT/AdSense オーバーレイ）のみに
// 適用し、アプリ（Unity Ads）は従来どおり 0（連続視聴の抑制は広告在庫のプリロード完了
// までボタンを非活性にするクライアント側の制御 nativeAdReady と1日上限に任せる）。
export const VIDEO_REWARD_MAX_PER_DAY = 100; // 1日（JST）に受け取れる上限回数

// リワード請求の出どころ。Web のみクールダウンを適用する（クライアントが自己申告で送る。
// 偽装は可能だが nonce と同レベルの「直接POST乱用への歯止め」という位置づけ）。
export type VideoRewardPlatform = "web" | "app";

// 回復量の決め方：full=そのレベルの満タン分／half=満タンの半分（切り上げ）／fixed=固定値。
export type VideoRewardAmountMode = "full" | "half" | "fixed";

export type VideoRewardConfig = {
  cooldownWebMs: number; // Web の視聴クールダウン（アプリは常に 0）
  amountMode: VideoRewardAmountMode;
  fixedAmount: number; // amountMode="fixed" のときの回復ポイント
};

// app_settings 未設定時の既定値：Web は5分クールダウン・回復量は満タン分（従来挙動）。
export const VIDEO_REWARD_DEFAULTS: VideoRewardConfig = {
  cooldownWebMs: 5 * 60 * 1000,
  amountMode: "full",
  fixedAmount: 10,
};

// app_settings（単一行 id=1 の jsonb）の videoReward キーから設定を読む。
// 管理画面の保存が即・全ユーザーに効くよう、リワード系のリクエストごとに読み直す
// （リワードはユーザー操作起点で頻度が低いので SELECT 1回の追加は許容）。
export async function getVideoRewardConfig(
  tx: DbExecutor = db
): Promise<VideoRewardConfig> {
  const rows = await tx
    .select({ settings: appSettings.settings })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  const raw = (rows[0]?.settings as Record<string, unknown> | undefined)
    ?.videoReward as
    | { cooldownWebSec?: unknown; amountMode?: unknown; fixedAmount?: unknown }
    | undefined;
  const cooldownSec = Number(raw?.cooldownWebSec);
  const fixed = Number(raw?.fixedAmount);
  const mode = raw?.amountMode;
  return {
    cooldownWebMs:
      Number.isFinite(cooldownSec) && cooldownSec >= 0
        ? Math.floor(cooldownSec) * 1000
        : VIDEO_REWARD_DEFAULTS.cooldownWebMs,
    amountMode:
      mode === "full" || mode === "half" || mode === "fixed"
        ? mode
        : VIDEO_REWARD_DEFAULTS.amountMode,
    fixedAmount:
      Number.isFinite(fixed) && fixed >= 1
        ? Math.floor(fixed)
        : VIDEO_REWARD_DEFAULTS.fixedAmount,
  };
}
// 視聴開始時に発行する nonce の有効期間。広告の表示〜視聴完了に十分な余裕を持たせる。
export const VIDEO_REWARD_NONCE_TTL_MS = 10 * 60 * 1000;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// now（UTC ms epoch）が属する JST の日付文字列 "YYYY-MM-DD" を返す。
function jstDayString(now: number): string {
  return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10);
}

// now が属する JST の「翌日0時」を UTC ms epoch で返す（1日上限のリセット時刻）。
function jstNextMidnight(now: number): number {
  const shifted = new Date(now + JST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0); // JST の当日0時（シフト空間）
  return shifted.getTime() - JST_OFFSET_MS + DAY_MS; // 実epochに戻して翌日へ
}

export type PointsState = {
  points: number;
  max: number; // 現在レベルの最大塗りポイント（回復上限）
  // 次の1ポイント回復時刻（ms epoch）。満タンなら null。
  regenAt: number | null;
  level: number;
  exp: number; // 現在レベル内での経験値（次レベルまでの進捗）
  expToNext: number; // 現在レベルから次レベルへ必要な経験値
  totalExp: number; // 累計獲得経験値（これまでの獲得総和・減らない）
  playTimeSec: number; // 合計プレイ時間（秒）
};

// db 本体でもトランザクション(tx)でも受け取れるように、使うメソッドだけ取り出した型。
type DbExecutor = Pick<typeof db, "select" | "insert" | "update">;

// updatedAt をアンカーに経過時間ぶんポイントを回復させる。回復の上限はレベル依存の max。
// 満タン時は updatedAt を now に進めて余剰時間が貯まらないようにする。
// ※レベルアップ加算やデバッグで max を超えた残高は削らずに保持する（超過分は回復では増えない）。
function regen(
  points: number,
  updatedAt: Date,
  now: number,
  level: number,
  cfg: ExpConfig
): { points: number; updatedAt: Date } {
  const max = maxPointsForLevel(level, cfg);
  const regenIntervalMs = cfg.regenIntervalSec * 1000;
  if (points >= max) {
    return { points, updatedAt: new Date(now) };
  }
  const elapsed = now - updatedAt.getTime();
  const gained = Math.floor(elapsed / regenIntervalMs);
  if (gained <= 0) return { points, updatedAt };
  const next = Math.min(max, points + gained);
  // 満タンに達したら now にリセット。未満なら回復した整数時間ぶんだけ進める（端数は繰り越し）。
  const nextUpdatedAt =
    next >= max
      ? new Date(now)
      : new Date(updatedAt.getTime() + gained * regenIntervalMs);
  return { points: next, updatedAt: nextUpdatedAt };
}

function toState(
  points: number,
  updatedAt: Date,
  level: number,
  exp: number,
  playTimeSec: number,
  totalExp: number,
  cfg: ExpConfig
): PointsState {
  const max = maxPointsForLevel(level, cfg);
  const regenIntervalMs = cfg.regenIntervalSec * 1000;
  return {
    points,
    max,
    regenAt: points >= max ? null : updatedAt.getTime() + regenIntervalMs,
    level,
    exp,
    expToNext: expToNext(level, cfg),
    totalExp,
    playTimeSec,
  };
}

// 経験値を加算し、必要経験値に達したぶんレベルアップする。
// レベルアップ1回ごとに、新しいレベルの最大塗りポイントぶん残高を加算する（上限超過を許容）。
// 戻り値は加算後の確定状態。
function applyExp(
  points: number,
  level: number,
  exp: number,
  gainedExp: number,
  cfg: ExpConfig
): { points: number; level: number; exp: number } {
  let nextPoints = points;
  let nextLevel = level;
  let nextExp = exp + gainedExp;
  // 一度の加算で複数レベル上がる可能性に備えてループ
  while (nextExp >= expToNext(nextLevel, cfg)) {
    nextExp -= expToNext(nextLevel, cfg);
    nextLevel += 1;
    // レベルアップ時、新レベルの最大塗りポイントぶんポイントを加算（上限を超えてよい）
    nextPoints += maxPointsForLevel(nextLevel, cfg);
  }
  return { points: nextPoints, level: nextLevel, exp: nextExp };
}

// ユーザーのポイント行を取得（無ければ初期値で作成）し、回復を反映して確定・永続化する。
// 任意で同一トランザクション（tx）上で実行できる。cfg 省略時は DB から読む。
export async function ensurePoints(
  userId: string,
  now: number,
  tx: DbExecutor = db,
  cfg?: ExpConfig
): Promise<PointsState> {
  const resolvedCfg = cfg ?? (await getExpConfig(tx));
  const rows = await tx
    .select()
    .from(userPoints)
    .where(eq(userPoints.userId, userId));

  if (rows.length === 0) {
    const updatedAt = new Date(now);
    await tx
      .insert(userPoints)
      .values({
        userId,
        points: resolvedCfg.initialPoints,
        level: 1,
        exp: 0,
        totalExp: 0,
        updatedAt,
      })
      .onConflictDoNothing();
    return toState(resolvedCfg.initialPoints, updatedAt, 1, 0, 0, 0, resolvedCfg);
  }

  const row = rows[0];
  const r = regen(row.points, row.updatedAt, now, row.level, resolvedCfg);
  if (
    r.points !== row.points ||
    r.updatedAt.getTime() !== row.updatedAt.getTime()
  ) {
    await tx
      .update(userPoints)
      .set({ points: r.points, updatedAt: r.updatedAt })
      .where(eq(userPoints.userId, userId));
  }
  return toState(
    r.points,
    r.updatedAt,
    row.level,
    row.exp,
    row.playTimeSec,
    row.totalExp,
    resolvedCfg
  );
}

// 経験値を加算する。回復を反映したうえで加算し、レベルアップを処理して永続化する。
// 加算量が 0 以下なら現在の状態をそのまま返す（課金なしのデバッグ塗り等）。
// cfg 省略時は DB から読む。painted.ts など呼び出し元でまとめて取得して渡すと DB 読みが減る。
export async function addExp(
  userId: string,
  gainedExp: number,
  now: number,
  tx: DbExecutor = db,
  cfg?: ExpConfig
): Promise<PointsState> {
  const resolvedCfg = cfg ?? (await getExpConfig(tx));
  const state = await ensurePoints(userId, now, tx, resolvedCfg); // 行を作成＋回復を確定
  if (gainedExp <= 0) return state;

  const next = applyExp(state.points, state.level, state.exp, gainedExp, resolvedCfg);
  // 累計獲得経験値は獲得ぶんをそのまま足す（レベルアップで目減りしない記録）。
  const nextTotalExp = state.totalExp + gainedExp;
  const leveledUp = next.level > state.level;
  const regenIntervalMs = resolvedCfg.regenIntervalSec * 1000;
  // レベルアップで上限超過の残高が生じうるので、その場合は回復時計を now に張り直す
  // （超過ぶんは時間回復で増えないため、満タン基準のアンカーにそろえる）。
  const updatedAt =
    leveledUp && next.points >= maxPointsForLevel(next.level, resolvedCfg)
      ? new Date(now)
      : new Date(state.regenAt === null ? now : state.regenAt - regenIntervalMs);
  await tx
    .update(userPoints)
    .set({
      points: next.points,
      level: next.level,
      exp: next.exp,
      totalExp: nextTotalExp,
      updatedAt,
    })
    .where(eq(userPoints.userId, userId));
  return toState(
    next.points,
    updatedAt,
    next.level,
    next.exp,
    state.playTimeSec,
    nextTotalExp,
    resolvedCfg
  );
}

// デバッグ用：残高を指定値にそのままセットする（max を超える値も許容）。
// 回復時計は now を基準に張り直す。レベル・経験値は変更しない。
export async function setPoints(
  userId: string,
  points: number,
  now: number,
  tx: DbExecutor = db
): Promise<PointsState> {
  const resolvedCfg = await getExpConfig(tx);
  const state = await ensurePoints(userId, now, tx, resolvedCfg); // 行が無ければ初期化しておく
  const updatedAt = new Date(now);
  await tx
    .update(userPoints)
    .set({ points, updatedAt })
    .where(eq(userPoints.userId, userId));
  return toState(
    points,
    updatedAt,
    state.level,
    state.exp,
    state.playTimeSec,
    state.totalExp,
    resolvedCfg
  );
}

// デバッグ用：ユーザーのポイント状態を初期値（レベル1・経験値0・初期残高）に戻す。
// 回復時計は now を基準に張り直す。塗りデータは別（painted ルーターの DELETE /all）で消す。
export async function resetPoints(
  userId: string,
  now: number,
  tx: DbExecutor = db
): Promise<PointsState> {
  const resolvedCfg = await getExpConfig(tx);
  await ensurePoints(userId, now, tx, resolvedCfg); // 行が無ければ初期化しておく
  const updatedAt = new Date(now);
  await tx
    .update(userPoints)
    .set({
      points: resolvedCfg.initialPoints,
      level: 1,
      exp: 0,
      totalExp: 0,
      playTimeSec: 0,
      updatedAt,
    })
    .where(eq(userPoints.userId, userId));
  return toState(resolvedCfg.initialPoints, updatedAt, 1, 0, 0, 0, resolvedCfg);
}

// cost ぶんポイントを消費する。残高不足なら null を返す（呼び出し側でロールバック）。
// 満タンから消費する場合は回復時計を now から始める。
// cfg 省略時は DB から読む。painted.ts など呼び出し元でまとめて取得して渡すと DB 読みが減る。
export async function spendPoints(
  userId: string,
  cost: number,
  now: number,
  tx: DbExecutor = db,
  cfg?: ExpConfig
): Promise<PointsState | null> {
  const resolvedCfg = cfg ?? (await getExpConfig(tx));
  const state = await ensurePoints(userId, now, tx, resolvedCfg);
  if (cost <= 0) return state; // 無料（デバッグ）
  if (state.points < cost) return null; // 残高不足

  const remaining = state.points - cost;
  const regenIntervalMs = resolvedCfg.regenIntervalSec * 1000;
  // 消費前が満タンだった（regenAt === null）なら、回復時計を now から開始する。
  const updatedAt =
    state.regenAt === null
      ? new Date(now)
      : new Date(state.regenAt - regenIntervalMs);
  await tx
    .update(userPoints)
    .set({ points: remaining, updatedAt })
    .where(eq(userPoints.userId, userId));
  return toState(
    remaining,
    updatedAt,
    state.level,
    state.exp,
    state.playTimeSec,
    state.totalExp,
    resolvedCfg
  );
}

// 合計プレイ時間に経過秒を加算する。1回の加算は MAX_HEARTBEAT_DELTA_SEC で頭打ちにする
// （タブ復帰直後の大きな経過や、不正な水増しを防ぐ）。負値・0 は無視して現状を返す。
export async function addPlayTime(
  userId: string,
  deltaSec: number,
  now: number,
  tx: DbExecutor = db
): Promise<PointsState> {
  const state = await ensurePoints(userId, now, tx);
  const delta = Math.min(
    MAX_HEARTBEAT_DELTA_SEC,
    Math.max(0, Math.floor(Number(deltaSec) || 0))
  );
  if (delta <= 0) return state;
  const nextPlayTime = state.playTimeSec + delta;
  await tx
    .update(userPoints)
    .set({ playTimeSec: nextPlayTime })
    .where(eq(userPoints.userId, userId));
  // ゲームをプレイ中（heartbeat）も「更新日」を進める＝管理画面で最終プレイ日時が分かる。
  await tx.update(user).set({ updatedAt: new Date(now) }).where(eq(user.id, userId));
  return { ...state, playTimeSec: nextPlayTime };
}

// 動画リワードの現在の利用可否（クライアントのボタン表示・カウントダウン用）。
export type VideoRewardStatus = {
  maxPerDay: number; // 1日の上限回数
  remainingToday: number; // 今日あと何回受け取れるか
  cooldownMs: number; // クールダウンの長さ
  // 次に視聴可能になる時刻（クールダウン中のみ。視聴可能なら null）
  nextAvailableAt: number | null;
  // 1日上限に達した場合のリセット時刻（翌JST0時。未達なら null）
  resetAt: number | null;
  // いま動画を見て受け取れるか（クールダウン・上限の両方を満たすか）
  available: boolean;
};

export type VideoRewardResult =
  | { ok: true; state: PointsState; granted: number; status: VideoRewardStatus }
  | {
      ok: false;
      reason: "cooldown" | "daily_limit" | "invalid_nonce";
      status: VideoRewardStatus;
    };

// 視聴開始前の nonce 発行結果。クールダウン中・1日上限なら発行しない。
export type VideoRewardNonceResult =
  | { ok: true; nonce: string; status: VideoRewardStatus }
  | { ok: false; reason: "cooldown" | "daily_limit"; status: VideoRewardStatus };

// 行の動画リワードメタ（受領時刻・当日回数）から現在の利用可否を組み立てる。
// cooldownMs はプラットフォームに応じて呼び出し側が決める（Web=設定値／アプリ=0）。
function buildVideoRewardStatus(
  now: number,
  lastVideoRewardAt: Date | null,
  videoRewardCount: number,
  videoRewardDay: string | null,
  cooldownMs: number
): VideoRewardStatus {
  const today = jstDayString(now);
  // 当日ぶんの回数（日付が変わっていたら 0 とみなす）
  const countToday = videoRewardDay === today ? videoRewardCount : 0;
  const remainingToday = Math.max(0, VIDEO_REWARD_MAX_PER_DAY - countToday);

  const cooldownUntil =
    lastVideoRewardAt === null ? 0 : lastVideoRewardAt.getTime() + cooldownMs;
  const inCooldown = now < cooldownUntil;
  const reachedDailyLimit = remainingToday <= 0;

  return {
    maxPerDay: VIDEO_REWARD_MAX_PER_DAY,
    remainingToday,
    cooldownMs,
    nextAvailableAt: inCooldown ? cooldownUntil : null,
    resetAt: reachedDailyLimit ? jstNextMidnight(now) : null,
    available: !inCooldown && !reachedDailyLimit,
  };
}

// プラットフォームに応じて適用するクールダウン長を返す（Web のみ・アプリは 0）。
function cooldownMsFor(
  platform: VideoRewardPlatform,
  cfg: VideoRewardConfig
): number {
  return platform === "app" ? 0 : cfg.cooldownWebMs;
}

// userPoints 行の動画リワード列だけを読む（無ければ null）。
async function selectRewardMeta(
  userId: string,
  tx: DbExecutor
): Promise<{
  lastVideoRewardAt: Date | null;
  videoRewardCount: number;
  videoRewardDay: string | null;
  rewardNonce: string | null;
  rewardNonceAt: Date | null;
} | null> {
  const rows = await tx
    .select({
      lastVideoRewardAt: userPoints.lastVideoRewardAt,
      videoRewardCount: userPoints.videoRewardCount,
      videoRewardDay: userPoints.videoRewardDay,
      rewardNonce: userPoints.rewardNonce,
      rewardNonceAt: userPoints.rewardNonceAt,
    })
    .from(userPoints)
    .where(eq(userPoints.userId, userId));
  return rows.length === 0 ? null : rows[0];
}

// 視聴開始前に1回限りの nonce を発行して行に保存する。発行時点でクールダウン中・
// 1日上限なら発行しない（早期に弾く）。発行した nonce は claimVideoReward で照合する。
export async function issueVideoRewardNonce(
  userId: string,
  now: number,
  platform: VideoRewardPlatform,
  tx: DbExecutor = db
): Promise<VideoRewardNonceResult> {
  const status = await getVideoRewardStatus(userId, now, platform, tx);
  if (status.nextAvailableAt !== null) {
    return { ok: false, reason: "cooldown", status };
  }
  if (status.remainingToday <= 0) {
    return { ok: false, reason: "daily_limit", status };
  }
  const nonce = randomUUID();
  await tx
    .update(userPoints)
    .set({ rewardNonce: nonce, rewardNonceAt: new Date(now) })
    .where(eq(userPoints.userId, userId));
  return { ok: true, nonce, status };
}

// 動画リワードの現在の利用可否を返す（付与はしない）。行が無ければ初期状態を作る。
export async function getVideoRewardStatus(
  userId: string,
  now: number,
  platform: VideoRewardPlatform,
  tx: DbExecutor = db
): Promise<VideoRewardStatus> {
  await ensurePoints(userId, now, tx); // 行を作成＋回復を確定
  const meta = await selectRewardMeta(userId, tx);
  const cfg = await getVideoRewardConfig(tx);
  return buildVideoRewardStatus(
    now,
    meta?.lastVideoRewardAt ?? null,
    meta?.videoRewardCount ?? 0,
    meta?.videoRewardDay ?? null,
    cooldownMsFor(platform, cfg)
  );
}

// 動画視聴の報酬を受け取る。回復量設定（amountMode）に応じたポイントを残高に加算する。
// クールダウン中・1日上限到達なら ok:false を返して付与しない。
export async function claimVideoReward(
  userId: string,
  now: number,
  nonce: string | null,
  platform: VideoRewardPlatform,
  tx: DbExecutor = db
): Promise<VideoRewardResult> {
  const expCfg = await getExpConfig(tx);
  const state = await ensurePoints(userId, now, tx, expCfg); // 行を作成＋回復を確定
  const meta = await selectRewardMeta(userId, tx);
  const cfg = await getVideoRewardConfig(tx);
  const cooldownMs = cooldownMsFor(platform, cfg);
  const lastVideoRewardAt = meta?.lastVideoRewardAt ?? null;
  const today = jstDayString(now);
  const countToday =
    meta?.videoRewardDay === today ? meta?.videoRewardCount ?? 0 : 0;

  const status = buildVideoRewardStatus(
    now,
    lastVideoRewardAt,
    meta?.videoRewardCount ?? 0,
    meta?.videoRewardDay ?? null,
    cooldownMs
  );

  // 上限・クールダウンのチェック（クールダウンを先に見て理由を明確にする）
  if (status.nextAvailableAt !== null) {
    return { ok: false, reason: "cooldown", status };
  }
  if (status.remainingToday <= 0) {
    return { ok: false, reason: "daily_limit", status };
  }

  // nonce 照合：視聴開始時に発行したもの（単回使用・未失効）であることを確認する。
  // Web の GPT リワードは SSV ポストバックが無いため、これが直接POST乱用への最低限の歯止め。
  const nonceOk =
    typeof nonce === "string" &&
    nonce.length > 0 &&
    meta?.rewardNonce === nonce &&
    meta?.rewardNonceAt != null &&
    now - meta.rewardNonceAt.getTime() <= VIDEO_REWARD_NONCE_TTL_MS;
  if (!nonceOk) {
    return { ok: false, reason: "invalid_nonce", status };
  }

  // 付与：回復量設定に応じて加算する。
  //   full  = そのレベルの満タン分（= 自然回復の上限と同量・従来挙動）
  //   half  = 満タンの半分（切り上げ）
  //   fixed = 固定値
  const max = maxPointsForLevel(state.level, expCfg);
  const granted =
    cfg.amountMode === "fixed"
      ? cfg.fixedAmount
      : cfg.amountMode === "half"
        ? Math.ceil(max / 2)
        : max;
  const nextPoints = state.points + granted;
  const regenIntervalMs = expCfg.regenIntervalSec * 1000;
  // 満タン以上になったら回復時計を now にそろえる（addExp の満タン時と同様）。
  // 満タン未満（half/fixed で少量回復）の場合は進行中の回復アンカーを保つ。
  const updatedAt =
    nextPoints >= max
      ? new Date(now)
      : new Date(state.regenAt === null ? now : state.regenAt - regenIntervalMs);

  const nextCount = countToday + 1;
  await tx
    .update(userPoints)
    .set({
      points: nextPoints,
      updatedAt,
      // 受領時刻（クールダウンの起点）は常に now。updatedAt は回復時計のアンカーなので
      // 満タン未満の回復では now にならないことがある（上の分岐参照）。
      lastVideoRewardAt: new Date(now),
      videoRewardCount: nextCount,
      videoRewardDay: today,
      // 使った nonce は消す（単回使用＝同じ視聴で二重に受け取れない）。
      rewardNonce: null,
      rewardNonceAt: null,
    })
    .where(eq(userPoints.userId, userId));

  const nextState = toState(
    nextPoints,
    updatedAt,
    state.level,
    state.exp,
    state.playTimeSec,
    state.totalExp,
    expCfg
  );
  // 付与後の利用可否を計算し直して返す（クールダウン開始・残回数を反映）
  const nextStatus = buildVideoRewardStatus(
    now,
    new Date(now), // lastVideoRewardAt は now で更新した（updatedAt は回復時計用で別物）
    nextCount,
    today,
    cooldownMs
  );
  return { ok: true, state: nextState, granted, status: nextStatus };
}
