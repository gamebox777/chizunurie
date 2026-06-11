// ネイティブアプリ（mobile/ の Capacitor ラッパー）内で Unity Ads のリワード動画を出す
// ためのブリッジ。実体は mobile/android の UnityAdsPlugin.java（@CapacitorPlugin "UnityAds"）で、
// Capacitor がリモートURLの WebView に注入する window.Capacitor.Plugins.UnityAds 経由で呼ぶ。
//
// Web 版 GPT（rewardedAd.ts）と同じ { outcome, detail? } 形を返すので、呼び出し側
// （Map.tsx の openVideoReward）は isNativeApp() でどちらを呼ぶか切り替えるだけでよい。
// 報酬付与の検証は Web 版と同じ backend の nonce 方式をそのまま使う（ここは表示のみ）。

import type { RewardedAdOutcome } from "./rewardedAd";

// 失敗（granted 以外）の具体的な原因。Web 版の RewardedAdDetail に相当し、
// 操作ログ（video_reward の meta.detail）に残す。
export type NativeRewardedAdDetail =
  | "plugin_missing" // window.Capacitor.Plugins.UnityAds が無い（旧APK・Web で誤呼び出し）
  | "init_failed" // Unity Ads SDK の初期化失敗
  | "load_failed" // 在庫なし・ネットワーク不通（Web 版の ready_timeout に相当）
  | "show_failed" // load は成功したが表示に失敗
  | "bridge_error"; // プラグイン呼び出し自体が例外

export type NativeRewardedAdResult = {
  outcome: RewardedAdOutcome;
  detail?: NativeRewardedAdDetail;
  // 失敗時の診断スナップショット（getAdDebugInfo の内容＋例外メッセージ）。
  // 操作ログ（video_reward の meta.debug）に残して失敗原因の切り分けに使う。
  debug?: Record<string, unknown>;
};

// プラグインの addListener が返すハンドル（Capacitor のバージョンにより
// Promise で返るものと直接返るものがあるので両対応の型にする）。
type ListenerHandle = { remove: () => void | Promise<void> };

// UnityAdsPlugin.java の resolveOutcome が返す形（使う範囲だけの最小型）。
// getRewardedStatus 以降は新しい APK にのみ存在する（旧 APK では undefined）。
type UnityAdsPlugin = {
  showRewarded: () => Promise<{ outcome?: string; detail?: string }>;
  getRewardedStatus?: () => Promise<{ ready?: boolean }>;
  getAdDebugInfo?: () => Promise<NativeAdDebugInfo>;
  getAdTestMode?: () => Promise<NativeAdTestMode>;
  setAdTestMode?: (opts: {
    enabled: boolean;
  }) => Promise<{ testMode?: boolean; requiresRestart?: boolean }>;
  addListener?: (
    event: "rewardedStatus",
    cb: (data: { ready?: boolean }) => void
  ) => ListenerHandle | Promise<ListenerHandle>;
};

// getAdDebugInfo が返す診断情報（デバッグメニューの「広告ステータス」表示用）。
export type NativeAdDebugInfo = {
  sdkVersion?: string;
  initState?: "not_started" | "initializing" | "initialized" | "failed";
  initError?: string; // 初期化失敗の内容（成功時は無し）
  testMode?: boolean;
  effectiveTestMode?: boolean;
  isDebugBuild?: boolean;
  gameId?: string;
  rewardedPlacementId?: string;
  bannerPlacementId?: string;
  rewardedReady?: boolean;
  rewardedLoading?: boolean;
  rewardedLoadAttempts?: number;
  lastRewardedLoadAt?: number; // epoch ms（未試行は無し）
  lastRewardedError?: string; // 直近の load 失敗内容（成功で消える）
  bannerShown?: boolean;
  lastBannerError?: string;
};

// getAdTestMode が返す広告モード。requiresRestart=true は保存値が次回起動から有効の意。
export type NativeAdTestMode = {
  testMode?: boolean; // 保存されている設定（次回起動以降のモード）
  effectiveTestMode?: boolean; // いま実際に効いているモード
  requiresRestart?: boolean;
  isDebugBuild?: boolean;
};

function getUnityAdsPlugin(): UnityAdsPlugin | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (
    window as unknown as {
      Capacitor?: { Plugins?: { UnityAds?: UnityAdsPlugin } };
    }
  ).Capacitor;
  return cap?.Plugins?.UnityAds;
}

// 失敗時のログ用に SDK の診断情報（初期化状態・直近の load エラー等）を best-effort で取る。
async function collectDebug(extra?: Record<string, unknown>): Promise<
  Record<string, unknown> | undefined
> {
  const info = await getNativeAdDebugInfo();
  if (!info && !extra) return undefined;
  return { ...(info ?? {}), ...(extra ?? {}) };
}

/** ネイティブのリワード動画を 1 本表示し、視聴結果を返す（広告 UI は Unity Ads SDK が描画）。 */
export async function showNativeRewardedAd(): Promise<NativeRewardedAdResult> {
  const plugin = getUnityAdsPlugin();
  if (!plugin) {
    // プラグイン未登録の古い APK や、ブラウザでの誤呼び出し。
    return { outcome: "unavailable", detail: "plugin_missing" };
  }
  try {
    const ret = await plugin.showRewarded();
    const outcome = ret?.outcome;
    if (
      outcome === "granted" ||
      outcome === "dismissed" ||
      outcome === "unavailable" ||
      outcome === "error"
    ) {
      return {
        outcome,
        detail: ret.detail as NativeRewardedAdDetail | undefined,
        // 視聴完了以外は SDK の診断情報を添えて失敗原因を残す。
        debug: outcome === "granted" ? undefined : await collectDebug(),
      };
    }
    return {
      outcome: "error",
      detail: "bridge_error",
      debug: await collectDebug({ rawOutcome: outcome ?? null }),
    };
  } catch (e) {
    console.warn("native rewarded ad failed", e);
    return {
      outcome: "error",
      detail: "bridge_error",
      debug: await collectDebug({ error: String(e) }),
    };
  }
}

/**
 * リワード広告の在庫（ready）を監視する。プラグインはアプリ起動時から広告を
 * プリロードしており、在庫の有無が変わるたびに "rewardedStatus" イベントを流す。
 * 呼び出し側（Map.tsx）は ready になるまで「広告を見て回復」ボタンを非活性にする。
 *
 * 旧 APK（getRewardedStatus 未実装）やブラウザでは ready=true を即時返して
 * 従来どおりボタンを活性のままにする（押した時点で load→show が走る）。
 * 戻り値は購読解除関数。
 */
export function watchNativeRewardedReady(
  cb: (ready: boolean) => void
): () => void {
  const plugin = getUnityAdsPlugin();
  if (!plugin?.getRewardedStatus || !plugin.addListener) {
    cb(true);
    return () => {};
  }
  let disposed = false;
  let handle: ListenerHandle | null = null;
  Promise.resolve(
    plugin.addListener("rewardedStatus", (data) => {
      if (!disposed) cb(data?.ready === true);
    })
  )
    .then((h) => {
      handle = h;
      if (disposed) h.remove();
    })
    .catch((e) => console.warn("rewardedStatus listener failed", e));
  // 現在値も取りに行く（イベントは「変化時」しか来ないため）。
  plugin
    .getRewardedStatus()
    .then((r) => {
      if (!disposed) cb(r?.ready === true);
    })
    .catch((e) => console.warn("getRewardedStatus failed", e));
  return () => {
    disposed = true;
    handle?.remove();
  };
}

/**
 * 広告の診断情報（SDK 初期化・リワード在庫・バナーの状態とエラー）を取得する。
 * 旧 APK・ブラウザは null。取得ついでにネイティブ側で止まっていたプリロードが再起動する。
 */
export async function getNativeAdDebugInfo(): Promise<NativeAdDebugInfo | null> {
  const plugin = getUnityAdsPlugin();
  if (!plugin?.getAdDebugInfo) return null;
  try {
    return await plugin.getAdDebugInfo();
  } catch (e) {
    console.warn("getAdDebugInfo failed", e);
    return null;
  }
}

/** 現在の広告モード（テスト広告/本広告）を取得する。旧 APK・ブラウザは null。 */
export async function getNativeAdTestMode(): Promise<NativeAdTestMode | null> {
  const plugin = getUnityAdsPlugin();
  if (!plugin?.getAdTestMode) return null;
  try {
    return await plugin.getAdTestMode();
  } catch (e) {
    console.warn("getAdTestMode failed", e);
    return null;
  }
}

/**
 * テスト広告モードを設定する（SharedPreferences に永続化）。
 * SDK 初期化後の切り替えは requiresRestart=true で返り、アプリ再起動後に反映される。
 */
export async function setNativeAdTestMode(
  enabled: boolean
): Promise<{ requiresRestart: boolean } | null> {
  const plugin = getUnityAdsPlugin();
  if (!plugin?.setAdTestMode) return null;
  try {
    const ret = await plugin.setAdTestMode({ enabled });
    return { requiresRestart: ret?.requiresRestart === true };
  } catch (e) {
    console.warn("setAdTestMode failed", e);
    return null;
  }
}
