'use client';

import { useEffect, useState } from 'react';
import { fetchStats, type AdminStats } from './api';

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
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>;
  if (!stats) return <p className="text-sm text-gray-500">読み込み中…</p>;

  const { users, painted } = stats;

  return (
    <div className="space-y-6">
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
