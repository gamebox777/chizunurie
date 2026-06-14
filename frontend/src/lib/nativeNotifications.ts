'use client';

// ネイティブアプリ（Capacitor）のローカル通知。@capacitor/local-notifications を
// window.Capacitor.Plugins.LocalNotifications 経由で呼ぶ（リモートURL方式なので import しない）。
// - 「毎日きまった時刻のリマインド通知」を端末ローカルに予約する（サーバー不要・オフラインでも鳴る）。
// - ON/OFF は localStorage に保存（既定 OFF＝オプトイン。勝手に権限を要求しない）。
//   設定メニュー（SettingsMenu）で切り替え、ON にした瞬間に OS の通知許可を要求する。
// - 通知は実機のアプリ版でのみ動作する。Web/PWA・プラグイン未搭載の旧 APK では no-op。

const ENABLED_KEY = 'chizunurie:notifications'; // 通知 ON/OFF（既定 OFF）
const ENABLED_EVENT = 'chizunurie:notifications-change'; // ON/OFF 変更を Map.tsx へ即時通知
const DAILY_ID = 1001; // 毎日リマインドの通知ID（固定・上書き/キャンセル用）
const CONFIRM_ID = 1002; // ON にした瞬間の確認通知ID
const RECOVERY_ID = 1003; // 塗りポイント全回復の通知ID（全回復予定時刻に1回だけ）
const REMIND_HOUR = 8; // リマインド時刻（毎日8:00・歩くアプリなので朝に促す）
const REMIND_MINUTE = 0;

const isBrowser = () => typeof window !== 'undefined';

// @capacitor/local-notifications の使う範囲だけの最小型。
type PermState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';
type NotificationSchema = {
  id: number;
  title: string;
  body: string;
  // schedule 省略＝即時。on(時刻のみ)＝毎日その時刻に繰り返す。at(日時)＝その日時に1回だけ。
  schedule?: {
    on?: { hour: number; minute: number };
    at?: Date;
    allowWhileIdle?: boolean;
  };
};
type LocalNotificationsPlugin = {
  checkPermissions: () => Promise<{ display: PermState }>;
  requestPermissions: () => Promise<{ display: PermState }>;
  schedule: (options: { notifications: NotificationSchema[] }) => Promise<unknown>;
  cancel: (options: { notifications: { id: number }[] }) => Promise<void>;
};

function getPlugin(): LocalNotificationsPlugin | undefined {
  if (typeof window === 'undefined') return undefined;
  const cap = (
    window as unknown as {
      Capacitor?: { Plugins?: { LocalNotifications?: LocalNotificationsPlugin } };
    }
  ).Capacitor;
  return cap?.Plugins?.LocalNotifications;
}

/** ネイティブアプリの通知プラグインが使えるか（Web・旧 APK では false）。 */
export function isNativeNotificationsAvailable(): boolean {
  return !!getPlugin();
}

// ── ON/OFF 設定（localStorage 永続化・既定 OFF） ────────────────────
export function isNotificationsEnabled(): boolean {
  if (!isBrowser()) return false;
  return localStorage.getItem(ENABLED_KEY) === '1'; // 既定 OFF
}
// フラグだけを保存する（実際の予約はしない。userSettings の同期適用用）。
// 変更を Map.tsx へ即時伝えるため CustomEvent を投げる（ON 直後の回復通知の即予約用）。
export function setNotificationsEnabled(on: boolean): void {
  if (!isBrowser()) return;
  localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  window.dispatchEvent(new CustomEvent(ENABLED_EVENT, { detail: on }));
}

// 通知 ON/OFF の変更を購読する。返り値を呼ぶと購読解除。
export function onNotificationsChange(cb: (on: boolean) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<boolean>).detail);
  window.addEventListener(ENABLED_EVENT, handler);
  return () => window.removeEventListener(ENABLED_EVENT, handler);
}

// 通知に出す文言（i18n の都合で呼び出し側＝SettingsMenu から渡す）。
export type NotifyTexts = {
  reminderTitle: string;
  reminderBody: string;
  confirmTitle: string;
  confirmBody: string;
};

// 毎日19時のリマインドを予約（既存の同IDがあれば上書き）。
async function scheduleDaily(
  plugin: LocalNotificationsPlugin,
  texts: NotifyTexts
): Promise<void> {
  await plugin.schedule({
    notifications: [
      {
        id: DAILY_ID,
        title: texts.reminderTitle,
        body: texts.reminderBody,
        schedule: {
          on: { hour: REMIND_HOUR, minute: REMIND_MINUTE },
          allowWhileIdle: true,
        },
      },
    ],
  });
}

/**
 * 通知を ON にする：OS の許可を要求し、許可されたら毎日リマインドを予約＋確認の即時通知。
 * 戻り値は実際に有効化できたか。権限拒否なら false（呼び出し側はトグルを戻す）。
 */
export async function enableNotifications(texts: NotifyTexts): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    let perm = await plugin.checkPermissions();
    if (perm.display !== 'granted') perm = await plugin.requestPermissions();
    if (perm.display !== 'granted') return false;
    setNotificationsEnabled(true);
    await scheduleDaily(plugin, texts);
    // ON にできたことが分かるよう、確認の即時通知を出す。
    await plugin.schedule({
      notifications: [{ id: CONFIRM_ID, title: texts.confirmTitle, body: texts.confirmBody }],
    });
    return true;
  } catch (e) {
    console.warn('enableNotifications failed', e);
    return false;
  }
}

/** 通知を OFF にする：フラグを落とし、予約済みのリマインド・回復通知をすべて取り消す。 */
export async function disableNotifications(): Promise<void> {
  setNotificationsEnabled(false);
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.cancel({
      notifications: [{ id: DAILY_ID }, { id: CONFIRM_ID }, { id: RECOVERY_ID }],
    });
  } catch (e) {
    console.warn('disableNotifications failed', e);
  }
}

/**
 * 塗りポイントが全回復する時刻（fullAtMs・epoch ms）に1回だけ通知を予約する。
 * - 通知が ON で権限がある実機アプリ版でのみ動作（それ以外は no-op）。
 * - 既に全回復済み／直近すぎる（now+5秒以内）なら予約せず、既存の回復通知を取り消す。
 * - 同IDで上書きするので、塗るたび（全回復予定が動くたび）に呼び直してよい。
 */
export async function scheduleRecovery(
  fullAtMs: number,
  texts: { title: string; body: string }
): Promise<void> {
  const plugin = getPlugin();
  if (!plugin || !isNotificationsEnabled()) return;
  try {
    const now = Date.now();
    if (fullAtMs <= now + 5000) {
      await plugin.cancel({ notifications: [{ id: RECOVERY_ID }] });
      return;
    }
    const perm = await plugin.checkPermissions();
    if (perm.display !== 'granted') return;
    await plugin.schedule({
      notifications: [
        {
          id: RECOVERY_ID,
          title: texts.title,
          body: texts.body,
          schedule: { at: new Date(fullAtMs), allowWhileIdle: true },
        },
      ],
    });
  } catch (e) {
    console.warn('scheduleRecovery failed', e);
  }
}

/** 予約済みの「全回復」通知を取り消す（全回復済み・ポイント消費の取り消し時など）。 */
export async function cancelRecovery(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.cancel({ notifications: [{ id: RECOVERY_ID }] });
  } catch (e) {
    console.warn('cancelRecovery failed', e);
  }
}

/**
 * 起動時・設定取得後の整合：ON なのに未予約のケース（別端末で ON にした設定が同期された等）で、
 * 既に権限があるときだけ予約し直す。許可プロンプトは出さない（ユーザー操作起点でのみ要求する）。
 */
export async function syncNotifications(texts: NotifyTexts): Promise<void> {
  const plugin = getPlugin();
  if (!plugin || !isNotificationsEnabled()) return;
  try {
    const perm = await plugin.checkPermissions();
    if (perm.display === 'granted') await scheduleDaily(plugin, texts);
  } catch (e) {
    console.warn('syncNotifications failed', e);
  }
}
