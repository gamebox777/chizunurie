type KeepAwakePlugin = {
  keepAwake: () => Promise<void>;
  allowSleep: () => Promise<void>;
};

function getPlugin(): KeepAwakePlugin | undefined {
  if (typeof window === 'undefined') return undefined;
  const cap = (
    window as unknown as {
      Capacitor?: {
        Plugins?: { KeepAwake?: KeepAwakePlugin };
      };
    }
  ).Capacitor;
  return cap?.Plugins?.KeepAwake;
}

/** アプリ内で画面スリープ防止プラグインが使えるか（Web・旧 APK では false）。 */
export function isNativeKeepAwakeAvailable(): boolean {
  return !!getPlugin();
}

/** アプリ内の画面スリープ防止を有効にする（スリープしないようにする）。 */
export async function startNativeKeepAwake(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.keepAwake();
  } catch (e) {
    console.warn('native keepAwake failed', e);
  }
}

/** アプリ内の画面スリープ防止を解除する（通常通りスリープするようにする）。 */
export async function stopNativeKeepAwake(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.allowSleep();
  } catch (e) {
    console.warn('native allowSleep failed', e);
  }
}
