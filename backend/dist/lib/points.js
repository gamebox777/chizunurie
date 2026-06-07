import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userPoints } from "../db/schema.js";
// ── 塗りポイントの調整パラメータ（今後バランス調整予定） ──────────────
export const INITIAL_POINTS = 10; // 登録時（初回）に付与される残高
export const REGEN_INTERVAL_MS = 30 * 60 * 1000; // 30分で1ポイント回復
// 塗りのコスト（クライアントが隣接判定して送る。サーバーは残高のみ権威的に管理する）
export const COST_ADJACENT = 1; // 塗り済みに隣接する場所
export const COST_FAR = 10; // 離れた場所（確認ダイアログ付き）
// 許可するコスト（0 は Shift+クリックのデバッグ塗り用＝無料）
export const ALLOWED_COSTS = new Set([0, COST_ADJACENT, COST_FAR]);
// ── レベル / 経験値の調整パラメータ ──────────────────────────────
// 塗りポイントの最大値（時間回復の上限）はレベルに応じて増える。
//   level 1 = 10、以降レベルが上がるごとに +1。
const BASE_MAX_POINTS = 10; // level 1 のときの最大塗りポイント
// 次のレベルに必要な経験値。level 1→2 で 1000、以降レベルが上がるごとに +100。
const BASE_EXP_TO_NEXT = 1000;
const EXP_TO_NEXT_STEP = 100;
// 塗りで得られる経験値
export const EXP_VISIT = 100; // 実際に訪れる（GPS塗り・manual→gps 昇格）
export const EXP_PAINT = 50; // となり塗り／離れた場所塗り（manual・有料）
// level のときの最大塗りポイント（回復上限）
export function maxPointsForLevel(level) {
    return BASE_MAX_POINTS + (level - 1);
}
// level → level+1 に必要な経験値
export function expToNext(level) {
    return BASE_EXP_TO_NEXT + (level - 1) * EXP_TO_NEXT_STEP;
}
// updatedAt をアンカーに経過時間ぶんポイントを回復させる。回復の上限はレベル依存の max。
// 満タン時は updatedAt を now に進めて余剰時間が貯まらないようにする。
// ※レベルアップ加算やデバッグで max を超えた残高は削らずに保持する（超過分は回復では増えない）。
function regen(points, updatedAt, now, level) {
    const max = maxPointsForLevel(level);
    if (points >= max) {
        return { points, updatedAt: new Date(now) };
    }
    const elapsed = now - updatedAt.getTime();
    const gained = Math.floor(elapsed / REGEN_INTERVAL_MS);
    if (gained <= 0)
        return { points, updatedAt };
    const next = Math.min(max, points + gained);
    // 満タンに達したら now にリセット。未満なら回復した整数時間ぶんだけ進める（端数は繰り越し）。
    const nextUpdatedAt = next >= max
        ? new Date(now)
        : new Date(updatedAt.getTime() + gained * REGEN_INTERVAL_MS);
    return { points: next, updatedAt: nextUpdatedAt };
}
function toState(points, updatedAt, level, exp) {
    const max = maxPointsForLevel(level);
    return {
        points,
        max,
        regenAt: points >= max ? null : updatedAt.getTime() + REGEN_INTERVAL_MS,
        level,
        exp,
        expToNext: expToNext(level),
    };
}
// 経験値を加算し、必要経験値に達したぶんレベルアップする。
// レベルアップ1回ごとに、新しいレベルの最大塗りポイントぶん残高を加算する（上限超過を許容）。
// 戻り値は加算後の確定状態。
function applyExp(points, level, exp, gainedExp) {
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
export async function ensurePoints(userId, now, tx = db) {
    const rows = await tx
        .select()
        .from(userPoints)
        .where(eq(userPoints.userId, userId));
    if (rows.length === 0) {
        const updatedAt = new Date(now);
        await tx
            .insert(userPoints)
            .values({ userId, points: INITIAL_POINTS, level: 1, exp: 0, updatedAt })
            .onConflictDoNothing();
        return toState(INITIAL_POINTS, updatedAt, 1, 0);
    }
    const row = rows[0];
    const r = regen(row.points, row.updatedAt, now, row.level);
    if (r.points !== row.points ||
        r.updatedAt.getTime() !== row.updatedAt.getTime()) {
        await tx
            .update(userPoints)
            .set({ points: r.points, updatedAt: r.updatedAt })
            .where(eq(userPoints.userId, userId));
    }
    return toState(r.points, r.updatedAt, row.level, row.exp);
}
// 経験値を加算する。回復を反映したうえで加算し、レベルアップを処理して永続化する。
// 加算量が 0 以下なら現在の状態をそのまま返す（課金なしのデバッグ塗り等）。
export async function addExp(userId, gainedExp, now, tx = db) {
    const state = await ensurePoints(userId, now, tx); // 行を作成＋回復を確定
    if (gainedExp <= 0)
        return state;
    const next = applyExp(state.points, state.level, state.exp, gainedExp);
    const leveledUp = next.level > state.level;
    // レベルアップで上限超過の残高が生じうるので、その場合は回復時計を now に張り直す
    // （超過ぶんは時間回復で増えないため、満タン基準のアンカーにそろえる）。
    const updatedAt = leveledUp && next.points >= maxPointsForLevel(next.level)
        ? new Date(now)
        : new Date(state.regenAt === null ? now : state.regenAt - REGEN_INTERVAL_MS);
    await tx
        .update(userPoints)
        .set({
        points: next.points,
        level: next.level,
        exp: next.exp,
        updatedAt,
    })
        .where(eq(userPoints.userId, userId));
    return toState(next.points, updatedAt, next.level, next.exp);
}
// デバッグ用：残高を指定値にそのままセットする（max を超える値も許容）。
// 回復時計は now を基準に張り直す。レベル・経験値は変更しない。
export async function setPoints(userId, points, now, tx = db) {
    const state = await ensurePoints(userId, now, tx); // 行が無ければ初期化しておく
    const updatedAt = new Date(now);
    await tx
        .update(userPoints)
        .set({ points, updatedAt })
        .where(eq(userPoints.userId, userId));
    return toState(points, updatedAt, state.level, state.exp);
}
// cost ぶんポイントを消費する。残高不足なら null を返す（呼び出し側でロールバック）。
// 満タンから消費する場合は回復時計を now から始める。
export async function spendPoints(userId, cost, now, tx = db) {
    const state = await ensurePoints(userId, now, tx);
    if (cost <= 0)
        return state; // 無料（デバッグ）
    if (state.points < cost)
        return null; // 残高不足
    const remaining = state.points - cost;
    // 消費前が満タンだった（regenAt === null）なら、回復時計を now から開始する。
    const updatedAt = state.regenAt === null
        ? new Date(now)
        : new Date(state.regenAt - REGEN_INTERVAL_MS);
    await tx
        .update(userPoints)
        .set({ points: remaining, updatedAt })
        .where(eq(userPoints.userId, userId));
    return toState(remaining, updatedAt, state.level, state.exp);
}
