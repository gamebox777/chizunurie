'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchVideoStats, type VideoStats } from './api';

// 期間フィルタの選択肢（null=全期間）。
const RANGES: { label: string; days?: number }[] = [
  { label: '全期間' },
  { label: '直近7日', days: 7 },
  { label: '直近30日', days: 30 },
];

function Card({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs text-gray-500">{title}</p>
      <p className="mt-1 text-3xl font-bold text-gray-800">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ファネル各段階の表示定義（funnel のキー・ラベル・説明・色）。
const ROWS: {
  key: keyof VideoStats['funnel'];
  label: string;
  desc: string;
  tone: string;
}[] = [
  { key: 'start', label: 'ボタン押下', desc: '「広告を見て回復」を押した回数', tone: 'text-gray-800' },
  { key: 'granted', label: '視聴完了・報酬付与', desc: '最後まで視聴し回復した回数', tone: 'text-green-700' },
  { key: 'dismissed', label: '途中キャンセル', desc: '広告を最後まで見ずに閉じた', tone: 'text-amber-700' },
  { key: 'unavailable', label: '在庫なし・非対応', desc: '広告を表示できなかった', tone: 'text-gray-500' },
  { key: 'error', label: 'エラー', desc: 'gpt.js 読込失敗など想定外', tone: 'text-red-600' },
  { key: 'cooldown', label: 'クールダウンで弾いた', desc: '30分以内の再視聴（広告未表示）', tone: 'text-gray-500' },
  { key: 'dailyLimit', label: '1日上限で弾いた', desc: '1日5回到達（広告未表示）', tone: 'text-gray-500' },
  { key: 'nonceError', label: 'nonce 発行失敗', desc: 'その他の事前チェック失敗', tone: 'text-gray-500' },
  { key: 'claimFailed', label: '報酬請求失敗', desc: '視聴後の付与に失敗（nonce不正等）', tone: 'text-red-600' },
];

// details の event（生の meta.event）の日本語ラベル。
const EVENT_LABEL: Record<string, string> = {
  start: 'ボタン押下',
  granted: '視聴完了・付与',
  dismissed: '途中キャンセル',
  unavailable: '在庫なし・非対応',
  error: 'エラー',
  cooldown: 'クールダウン',
  daily_limit: '1日上限',
  nonce_error: 'nonce発行失敗',
  claim_failed: '報酬請求失敗',
};

// details の detail（失敗の具体的な原因）の日本語ラベル。
// Web GPT（rewardedAd.ts の RewardedAdDetail）＋ネイティブ Unity Ads
// （nativeRewardedAd.ts の NativeRewardedAdDetail）＋ claim_failed の reason。
const DETAIL_LABEL: Record<string, string> = {
  // Web GPT
  gpt_load_failed: 'gpt.js読込失敗（広告ブロッカー等）',
  define_threw: 'スロット定義で例外',
  slot_null: 'リワード非対応・スロット重複',
  ready_timeout: '在庫なし（readyタイムアウト）',
  // ネイティブ Unity Ads
  plugin_missing: 'プラグイン無し（旧APK等）',
  init_failed: 'SDK初期化失敗',
  load_failed: '在庫なし・読込失敗',
  show_failed: '表示失敗',
  bridge_error: 'プラグイン呼び出し例外',
  // claim_failed の reason
  cooldown: 'クールダウン',
  daily_limit: '1日上限',
  invalid_nonce: 'nonce不正',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP');
}

export default function VideoStatsPanel() {
  const [days, setDays] = useState<number | undefined>(undefined);
  const [stats, setStats] = useState<VideoStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetchVideoStats({ days })
      .then(setStats)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const f = stats?.funnel;
  const pct =
    f && f.completionRate !== null ? `${Math.round(f.completionRate * 100)}%` : '—';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.label}
            onClick={() => setDays(r.days)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              days === r.days
                ? 'border-blue-500 bg-blue-50 text-blue-600'
                : 'border-gray-200 bg-white text-gray-500 hover:text-gray-700'
            }`}
          >
            {r.label}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          再読み込み
        </button>
      </div>

      {error && <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>}
      {loading && !stats && <p className="text-sm text-gray-500">読み込み中…</p>}

      {f && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card title="ボタン押下" value={f.start.toLocaleString()} />
            <Card title="視聴完了・報酬付与" value={f.granted.toLocaleString()} />
            <Card
              title="完了率（付与 / 押下）"
              value={pct}
              sub="押下した人のうち最後まで視聴した割合"
            />
          </div>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-600">内訳</h2>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-4 py-2 font-medium">段階</th>
                    <th className="px-4 py-2 text-right font-medium">件数</th>
                    <th className="px-4 py-2 font-medium">説明</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.key} className="border-b border-gray-100 last:border-0">
                      <td className={`px-4 py-2 font-medium ${row.tone}`}>{row.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-800">
                        {(f[row.key] as number).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-400">{row.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              ※ user_logs（action=video_reward）の meta.event を集計。
              {stats.days ? `直近 ${stats.days} 日` : '全期間'}。
            </p>
          </section>

          {/* 失敗の具体的な原因（meta.detail / meta.reason）の内訳。
              本番でリワードが埋まらないとき（ready_timeout 等）の切り分け用。 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-600">
              失敗の詳細（detail）
            </h2>
            {stats.details.length === 0 ? (
              <p className="text-sm text-gray-400">
                detail 付きの失敗ログはありません
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                      <th className="px-4 py-2 font-medium">段階</th>
                      <th className="px-4 py-2 font-medium">原因</th>
                      <th className="px-4 py-2 text-right font-medium">件数</th>
                      <th className="px-4 py-2 text-right font-medium">ユーザー数</th>
                      <th className="px-4 py-2 font-medium">最終発生</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.details.map((d) => (
                      <tr
                        key={`${d.event}:${d.detail}`}
                        className="border-b border-gray-100 last:border-0"
                      >
                        <td className="px-4 py-2 text-gray-700">
                          {EVENT_LABEL[d.event] ?? d.event}
                        </td>
                        <td className="px-4 py-2">
                          <span className="font-medium text-gray-800">
                            {DETAIL_LABEL[d.detail] ?? d.detail}
                          </span>
                          <span className="ml-2 font-mono text-xs text-gray-400">
                            {d.detail}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-800">
                          {d.count.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                          {d.users.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {formatDateTime(d.lastAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-gray-400">
              ※ 1件ごとの生ログ（ユーザー・IP・UA つき）は「ログ」タブを
              アクション「動画広告」で絞り込むと確認できます。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
