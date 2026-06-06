import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userPoints } from "../db/schema.js";

// ── 塗りポイントの調整パラメータ（今後バランス調整予定） ──────────────
export const INITIAL_POINTS = 10; // 登録時（初回）に付与される残高
export const MAX_POINTS = 50; // 回復の上限（初期値より多い固定値）
export const REGEN_INTERVAL_MS = 60 * 60 * 1000; // 1時間で1ポイント回復

// 塗りのコスト（クライアントが隣接判定して送る。サーバーは残高のみ権威的に管理する）
export const COST_ADJACENT = 1; // 塗り済みに隣接する場所
export const COST_FAR = 10; // 離れた場所（確認ダイアログ付き）
// 許可するコスト（0 は Shift+クリックのデバッグ塗り用＝無料）
export const ALLOWED_COSTS = new Set([0, COST_ADJACENT, COST_FAR]);

export type PointsState = {
  points: number;
  max: number;
  // 次の1ポイント回復時刻（ms epoch）。満タンなら null。
  regenAt: number | null;
};

// db 本体でもトランザクション(tx)でも受け取れるように、使うメソッドだけ取り出した型。
type DbExecutor = Pick<typeof db, "select" | "insert" | "update">;

// updatedAt をアンカーに経過時間ぶんポイントを回復させる。
// 満タン時は updatedAt を now に進めて余剰時間が貯まらないようにする。
// ※時間回復の上限は MAX_POINTS だが、デバッグ等で MAX_POINTS を超えた残高は
//   削らずにそのまま保持する（超過分は回復では増えないだけ）。
function regen(
  points: number,
  updatedAt: Date,
  now: number
): { points: number; updatedAt: Date } {
  if (points >= MAX_POINTS) {
    return { points, updatedAt: new Date(now) };
  }
  const elapsed = now - updatedAt.getTime();
  const gained = Math.floor(elapsed / REGEN_INTERVAL_MS);
  if (gained <= 0) return { points, updatedAt };
  const next = Math.min(MAX_POINTS, points + gained);
  // 満タンに達したら now にリセット。未満なら回復した整数時間ぶんだけ進める（端数は繰り越し）。
  const nextUpdatedAt =
    next >= MAX_POINTS
      ? new Date(now)
      : new Date(updatedAt.getTime() + gained * REGEN_INTERVAL_MS);
  return { points: next, updatedAt: nextUpdatedAt };
}

function toState(points: number, updatedAt: Date): PointsState {
  return {
    points,
    max: MAX_POINTS,
    regenAt:
      points >= MAX_POINTS ? null : updatedAt.getTime() + REGEN_INTERVAL_MS,
  };
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
      .values({ userId, points: INITIAL_POINTS, updatedAt })
      .onConflictDoNothing();
    return toState(INITIAL_POINTS, updatedAt);
  }

  const row = rows[0];
  const r = regen(row.points, row.updatedAt, now);
  if (r.points !== row.points || r.updatedAt.getTime() !== row.updatedAt.getTime()) {
    await tx
      .update(userPoints)
      .set({ points: r.points, updatedAt: r.updatedAt })
      .where(eq(userPoints.userId, userId));
  }
  return toState(r.points, r.updatedAt);
}

// デバッグ用：残高を指定値にそのままセットする（MAX_POINTS を超える値も許容）。
// 回復時計は now を基準に張り直す。
export async function setPoints(
  userId: string,
  points: number,
  now: number,
  tx: DbExecutor = db
): Promise<PointsState> {
  await ensurePoints(userId, now, tx); // 行が無ければ初期化しておく
  const updatedAt = new Date(now);
  await tx
    .update(userPoints)
    .set({ points, updatedAt })
    .where(eq(userPoints.userId, userId));
  return toState(points, updatedAt);
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
  return toState(remaining, updatedAt);
}
