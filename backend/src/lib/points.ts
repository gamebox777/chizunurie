import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userPoints } from "../db/schema.js";

// ── 塗りポイントの調整パラメータ（今後バランス調整予定） ──────────────
export const INITIAL_POINTS = 10; // 登録時（初回）に付与される残高
export const REGEN_INTERVAL_MS = 10 * 60 * 1000; // 10分で1ポイント回復

// 塗りのコスト（クライアントが隣接判定して送る。サーバーは残高のみ権威的に管理する）
export const COST_ADJACENT = 1; // 塗り済みに隣接する場所
export const COST_FAR = 10; // 離れた場所（確認ダイアログ付き）
// 許可するコスト（0 は Shift+クリックのデバッグ塗り用＝無料）
export const ALLOWED_COSTS = new Set([0, COST_ADJACENT, COST_FAR]);

// ── レベル / 経験値の調整パラメータ ──────────────────────────────
// 塗りポイントの最大値（時間回復の上限）はレベルに応じて増える。
//   level 1 = 10、以降レベルが上がるごとに +1。
const BASE_MAX_POINTS = 10; // level 1 のときの最大塗りポイント
// 次のレベルに必要な経験値。level 1→2 で 500、以降レベルが上がるごとに +100。
const BASE_EXP_TO_NEXT = 500;
const EXP_TO_NEXT_STEP = 100;

// 塗りで得られる経験値
export const EXP_VISIT = 100; // 実際に訪れる（GPS塗り・manual→gps 昇格・再訪）
export const EXP_PAINT = 50; // となり塗り／離れた場所塗り（manual・有料）

// 再訪クールダウン：既に gps 済みのセルへ GPS で入り直した時、前回の訪問から
// この時間が経過していれば再び EXP_VISIT を付与する。GPS は静止中も連続発火するため、
// この間隔で「再訪あたり1回」に制限して無限獲得を防ぐ（painted_regions.lastVisitAt で判定）。
export const REVISIT_EXP_COOLDOWN_MS = 60 * 60 * 1000; // 1時間に1回

// level のときの最大塗りポイント（回復上限）
export function maxPointsForLevel(level: number): number {
  return BASE_MAX_POINTS + (level - 1);
}

// level → level+1 に必要な経験値
export function expToNext(level: number): number {
  return BASE_EXP_TO_NEXT + (level - 1) * EXP_TO_NEXT_STEP;
}

// 1回のハートビートで加算を許可する最大秒数。クライアントは約1分ごとに送るため、
// 多少の遅延（タブ復帰直後など）を見込んでこの値を上限にして不正な水増しを防ぐ。
export const MAX_HEARTBEAT_DELTA_SEC = 120;

// ── 動画リワード（動画視聴で塗りポイントを回復） ──────────────────────
// 動画を1本見ると「そのレベルの満タン分（= maxPointsForLevel(level)）」を残高に加算する。
// 自然回復（REGEN_INTERVAL_MS で 1pt）と同等量を一気に得られる位置づけ。
// 不正・乱用対策として「クールダウン」と「1日の上限回数」を併用する。
export const VIDEO_REWARD_COOLDOWN_MS = 30 * 60 * 1000; // 前回視聴から30分は再視聴不可
export const VIDEO_REWARD_MAX_PER_DAY = 5; // 1日（JST）に受け取れる上限回数
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
  level: number
): { points: number; updatedAt: Date } {
  const max = maxPointsForLevel(level);
  if (points >= max) {
    return { points, updatedAt: new Date(now) };
  }
  const elapsed = now - updatedAt.getTime();
  const gained = Math.floor(elapsed / REGEN_INTERVAL_MS);
  if (gained <= 0) return { points, updatedAt };
  const next = Math.min(max, points + gained);
  // 満タンに達したら now にリセット。未満なら回復した整数時間ぶんだけ進める（端数は繰り越し）。
  const nextUpdatedAt =
    next >= max
      ? new Date(now)
      : new Date(updatedAt.getTime() + gained * REGEN_INTERVAL_MS);
  return { points: next, updatedAt: nextUpdatedAt };
}

function toState(
  points: number,
  updatedAt: Date,
  level: number,
  exp: number,
  playTimeSec: number,
  totalExp: number
): PointsState {
  const max = maxPointsForLevel(level);
  return {
    points,
    max,
    regenAt: points >= max ? null : updatedAt.getTime() + REGEN_INTERVAL_MS,
    level,
    exp,
    expToNext: expToNext(level),
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
  gainedExp: number
): { points: number; level: number; exp: number } {
  let nextPoints = points;
  let nextLevel = level;
  let nextExp = exp + gainedExp;
  // 一度の加算で複数レベル上がる可能性に備えてループ
  while (nextExp >= expToNext(nextLevel)) {
    nextExp -= expToNext(nextLevel);
    nextLevel += 1;
    // レベルアップ時、新レベルの最大塗りポイントぶんポイントを加算（上限を超えてよい）
    nextPoints += maxPointsForLevel(nextLevel);
  }
  return { points: nextPoints, level: nextLevel, exp: nextExp };
}

// ユーザーのポイント行を取得（無ければ初期値で作成）し、回復を反映して確定・永続化する。
// 任意で同一トランザクション（tx）上で実行できる。
export async function ensurePoints(
  userId: string,
  now: number,
  tx: DbExecutor = db
): Promise<PointsState> {
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
        points: INITIAL_POINTS,
        level: 1,
        exp: 0,
        totalExp: 0,
        updatedAt,
      })
      .onConflictDoNothing();
    return toState(INITIAL_POINTS, updatedAt, 1, 0, 0, 0);
  }

  const row = rows[0];
  const r = regen(row.points, row.updatedAt, now, row.level);
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
    row.totalExp
  );
}

// 経験値を加算する。回復を反映したうえで加算し、レベルアップを処理して永続化する。
// 加算量が 0 以下なら現在の状態をそのまま返す（課金なしのデバッグ塗り等）。
export async function addExp(
  userId: string,
  gainedExp: number,
  now: number,
  tx: DbExecutor = db
): Promise<PointsState> {
  const state = await ensurePoints(userId, now, tx); // 行を作成＋回復を確定
  if (gainedExp <= 0) return state;

  const next = applyExp(state.points, state.level, state.exp, gainedExp);
  // 累計獲得経験値は獲得ぶんをそのまま足す（レベルアップで目減りしない記録）。
  const nextTotalExp = state.totalExp + gainedExp;
  const leveledUp = next.level > state.level;
  // レベルアップで上限超過の残高が生じうるので、その場合は回復時計を now に張り直す
  // （超過ぶんは時間回復で増えないため、満タン基準のアンカーにそろえる）。
  const updatedAt =
    leveledUp && next.points >= maxPointsForLevel(next.level)
      ? new Date(now)
      : new Date(
          state.regenAt === null ? now : state.regenAt - REGEN_INTERVAL_MS
        );
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
    nextTotalExp
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
  const state = await ensurePoints(userId, now, tx); // 行が無ければ初期化しておく
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
    state.totalExp
  );
}

// デバッグ用：ユーザーのポイント状態を初期値（レベル1・経験値0・初期残高）に戻す。
// 回復時計は now を基準に張り直す。塗りデータは別（painted ルーターの DELETE /all）で消す。
export async function resetPoints(
  userId: string,
  now: number,
  tx: DbExecutor = db
): Promise<PointsState> {
  await ensurePoints(userId, now, tx); // 行が無ければ初期化しておく
  const updatedAt = new Date(now);
  await tx
    .update(userPoints)
    .set({
      points: INITIAL_POINTS,
      level: 1,
      exp: 0,
      totalExp: 0,
      playTimeSec: 0,
      updatedAt,
    })
    .where(eq(userPoints.userId, userId));
  return toState(INITIAL_POINTS, updatedAt, 1, 0, 0, 0);
}

// cost ぶんポイントを消費する。残高不足なら null を返す（呼び出し側でロールバック）。
// 満タンから消費する場合は回復時計を now から始める。
export async function spendPoints(
  userId: string,
  cost: number,
  now: number,
  tx: DbExecutor = db
): Promise<PointsState | null> {
  const state = await ensurePoints(userId, now, tx);
  if (cost <= 0) return state; // 無料（デバッグ）
  if (state.points < cost) return null; // 残高不足

  const remaining = state.points - cost;
  // 消費前が満タンだった（regenAt === null）なら、回復時計を now から開始する。
  const updatedAt =
    state.regenAt === null
      ? new Date(now)
      : new Date(state.regenAt - REGEN_INTERVAL_MS);
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
    state.totalExp
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
function buildVideoRewardStatus(
  now: number,
  lastVideoRewardAt: Date | null,
  videoRewardCount: number,
  videoRewardDay: string | null
): VideoRewardStatus {
  const today = jstDayString(now);
  // 当日ぶんの回数（日付が変わっていたら 0 とみなす）
  const countToday = videoRewardDay === today ? videoRewardCount : 0;
  const remainingToday = Math.max(0, VIDEO_REWARD_MAX_PER_DAY - countToday);

  const cooldownUntil =
    lastVideoRewardAt === null
      ? 0
      : lastVideoRewardAt.getTime() + VIDEO_REWARD_COOLDOWN_MS;
  const inCooldown = now < cooldownUntil;
  const reachedDailyLimit = remainingToday <= 0;

  return {
    maxPerDay: VIDEO_REWARD_MAX_PER_DAY,
    remainingToday,
    cooldownMs: VIDEO_REWARD_COOLDOWN_MS,
    nextAvailableAt: inCooldown ? cooldownUntil : null,
    resetAt: reachedDailyLimit ? jstNextMidnight(now) : null,
    available: !inCooldown && !reachedDailyLimit,
  };
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
  tx: DbExecutor = db
): Promise<VideoRewardNonceResult> {
  const status = await getVideoRewardStatus(userId, now, tx);
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
  tx: DbExecutor = db
): Promise<VideoRewardStatus> {
  await ensurePoints(userId, now, tx); // 行を作成＋回復を確定
  const meta = await selectRewardMeta(userId, tx);
  return buildVideoRewardStatus(
    now,
    meta?.lastVideoRewardAt ?? null,
    meta?.videoRewardCount ?? 0,
    meta?.videoRewardDay ?? null
  );
}

// 動画視聴の報酬を受け取る。「そのレベルの満タン分」を残高に加算する。
// クールダウン中・1日上限到達なら ok:false を返して付与しない。
// 付与後は残高が満タン以上になるため回復時計は now にそろえる（addExp の満タン時と同様）。
export async function claimVideoReward(
  userId: string,
  now: number,
  nonce: string | null,
  tx: DbExecutor = db
): Promise<VideoRewardResult> {
  const state = await ensurePoints(userId, now, tx); // 行を作成＋回復を確定
  const meta = await selectRewardMeta(userId, tx);
  const lastVideoRewardAt = meta?.lastVideoRewardAt ?? null;
  const today = jstDayString(now);
  const countToday =
    meta?.videoRewardDay === today ? meta?.videoRewardCount ?? 0 : 0;

  const status = buildVideoRewardStatus(
    now,
    lastVideoRewardAt,
    meta?.videoRewardCount ?? 0,
    meta?.videoRewardDay ?? null
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

  // 付与：そのレベルの満タン分（= 自然回復の上限と同量）を加算する。
  const granted = maxPointsForLevel(state.level);
  const nextPoints = state.points + granted; // 必ず max 以上になる（満タン扱い）
  const updatedAt = new Date(now); // 満タン以上なので回復時計を now にそろえる

  const nextCount = countToday + 1;
  await tx
    .update(userPoints)
    .set({
      points: nextPoints,
      updatedAt,
      lastVideoRewardAt: updatedAt,
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
    state.totalExp
  );
  // 付与後の利用可否を計算し直して返す（クールダウン開始・残回数を反映）
  const nextStatus = buildVideoRewardStatus(now, updatedAt, nextCount, today);
  return { ok: true, state: nextState, granted, status: nextStatus };
}
