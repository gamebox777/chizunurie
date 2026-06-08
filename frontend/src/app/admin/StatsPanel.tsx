'use client';

import { useEffect, useState } from 'react';
import {
  fetchAccessStats,
  fetchStats,
  type AccessStats,
  type AdminStats,
} from './api';

const ROLE_LABELS: Record<string, string> = {
  user: '一般ユーザー',
  developer: '開発者',
};

function Card({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs text-gray-500">{title}</p>
      <p className="mt-1 text-3xl font-bold text-gray-800">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function StatsPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [access, setAccess] = useState<AccessStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch((e: Error) => setError(e.message));
    fetchAccessStats()
      .then(setAccess)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>;
  if (!stats) return <p className="text-sm text-gray-500">読み込み中…</p>;

  const { users, painted } = stats;
  // 日別バーの正規化用に、表示回数の最大値を取る。
  const maxViews = access?.daily.reduce((m, d) => Math.max(m, d.views), 0) ?? 0;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-600">サイトアクセス</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card
            title="累計アクセス数"
            value={(access?.views.total ?? 0).toLocaleString()}
            sub={`ユニーク ${(access?.uniques.total ?? 0).toLocaleString()} 人`}
          />
          <Card
            title="今日"
            value={(access?.views.today ?? 0).toLocaleString()}
            sub={`ユニーク ${(access?.uniques.today ?? 0).toLocaleString()} 人`}
          />
          <Card
            title="直近7日"
            value={(access?.views.last7 ?? 0).toLocaleString()}
            sub={`ユニーク ${(access?.uniques.last7 ?? 0).toLocaleString()} 人`}
          />
        </div>
        {access && access.daily.length > 0 && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
              <span>日別（新しい順・最大30日）</span>
              <span>アクセス / ユニーク</span>
            </div>
            <ul className="space-y-1">
              {access.daily.map((d) => (
                <li key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 tabular-nums text-gray-500">{d.date}</span>
                  <span className="h-3 flex-1 overflow-hidden rounded bg-gray-100">
                    <span
                      className="block h-full rounded bg-blue-400"
                      style={{ width: maxViews ? `${(d.views / maxViews) * 100}%` : '0%' }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right tabular-nums font-medium text-gray-700">
                    {d.views.toLocaleString()}
                    <span className="ml-1 font-normal text-gray-400">
                      / {d.uniques.toLocaleString()}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-600">ユーザー</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card title="登録ユーザー数" value={users.total.toLocaleString()} />
          {users.byRole.map((r) => (
            <Card
              key={r.role}
              title={ROLE_LABELS[r.role] ?? r.role}
              value={r.count.toLocaleString()}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-600">塗りセル</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card title="合計塗りセル数" value={painted.total.toLocaleString()} />
          <Card
            title="GPS（実際の訪問）"
            value={painted.gps.toLocaleString()}
            sub={painted.total ? `${Math.round((painted.gps / painted.total) * 100)}%` : undefined}
          />
          <Card
            title="manual（となり塗り等）"
            value={painted.manual.toLocaleString()}
            sub={painted.total ? `${Math.round((painted.manual / painted.total) * 100)}%` : undefined}
          />
        </div>
      </section>
    </div>
  );
}
