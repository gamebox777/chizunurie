'use client';

import { useEffect, useState } from 'react';
import {
  playHaptic,
  isHapticsSupported,
  isNativeHapticsAvailable,
  type HapticKind,
} from '@/lib/haptics';

// 触覚フィードバック（バイブ）の体験パネル（開発者専用）。
// 各ボタンを押すと、その種類の触覚を「設定の ON/OFF を無視して」必ず鳴らす（force）。
// ネイティブアプリ（iOS の Taptic Engine / Android の Vibrator・@capacitor/haptics）が
// 入っていればそれを、無い Web/PWA では Web Vibration API（navigator.vibrate）を使う。
// iOS Safari / WKWebView は navigator.vibrate 非対応なので、iOS で振動を確かめるには
// ネイティブアプリ（mobile/）でこのページを開く必要がある。

// 体験できる触覚の一覧（衝撃の強弱＋通知系）。実際の塗りは light を使っている。
const KINDS: { kind: HapticKind; label: string; hint: string }[] = [
  { kind: 'light', label: '弱（Light）', hint: 'セルを塗った瞬間に使う標準の触覚' },
  { kind: 'medium', label: '中（Medium）', hint: 'やや強い衝撃' },
  { kind: 'heavy', label: '強（Heavy）', hint: '強い衝撃' },
  { kind: 'success', label: '成功（Success）', hint: '制覇など達成時向けの通知パターン' },
  { kind: 'warning', label: '警告（Warning）', hint: '注意喚起向けの通知パターン' },
  { kind: 'error', label: 'エラー（Error）', hint: '失敗・拒否向けの通知パターン' },
];

export default function HapticsPanel() {
  // 端末対応状況はマウント後に判定する（SSR/初期描画では window が無い）。
  const [supported, setSupported] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    setSupported(isHapticsSupported());
    setNative(isNativeHapticsAvailable());
  }, []);

  return (
    <section className="max-w-xl space-y-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">触覚フィードバック体験</h2>
        <p className="mt-1 text-sm text-gray-500">
          各ボタンを押すと触覚（バイブ）を鳴らします。設定の ON/OFF に関わらず必ず鳴ります。
        </p>
      </div>

      {/* 端末の対応状況 */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
        {!supported ? (
          <p className="text-amber-700">
            この端末は触覚に対応していません（PC・iOS Safari など）。実機のアプリ版で開いて確認してください。
          </p>
        ) : native ? (
          <p className="text-green-700">
            ネイティブ触覚が利用可能です（アプリ版・Taptic Engine / Vibrator）。
          </p>
        ) : (
          <p className="text-gray-600">
            Web Vibration API を使用します（Android Chrome 等）。iOS Safari では鳴りません。
          </p>
        )}
      </div>

      {/* 体験ボタン */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {KINDS.map(({ kind, label, hint }) => (
          <button
            key={kind}
            type="button"
            disabled={!supported}
            onClick={() => playHaptic(kind, { force: true })}
            title={hint}
            className="flex flex-col items-start gap-0.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-sm font-medium text-gray-800">{label}</span>
            <span className="text-xs text-gray-500">{hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
