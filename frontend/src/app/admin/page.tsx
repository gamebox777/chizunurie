'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/auth-client';
import StatsPanel from './StatsPanel';
import UsersPanel from './UsersPanel';
import LogsPanel from './LogsPanel';
import PaintedLogPanel from './PaintedLogPanel';

type Tab = 'stats' | 'users' | 'logs' | 'painted';

// 中央寄せのメッセージ画面（読み込み中・権限なし用）。
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center text-gray-700">
      {children}
    </div>
  );
}

export default function AdminPage() {
  const { data: session, isPending } = useSession();
  const [tab, setTab] = useState<Tab>('stats');

  if (isPending) {
    return <Centered>読み込み中…</Centered>;
  }

  // 未ログイン or 開発者以外はアクセス不可。地図ページとは完全に独立した画面。
  if (!session) {
    return (
      <Centered>
        <p>このページはログインが必要です。</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          トップへ戻る
        </Link>
      </Centered>
    );
  }
  if (session.user.role !== 'developer') {
    return (
      <Centered>
        <p className="font-medium">アクセス権限がありません（開発者専用）。</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          トップへ戻る
        </Link>
      </Centered>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-lg font-bold">管理画面</h1>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          開発者専用
        </span>
        <span className="flex-1" />
        <span className="text-sm text-gray-500">{session.user.name}</span>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          地図へ戻る
        </Link>
      </header>

      <nav className="flex gap-1 border-b border-gray-200 bg-white px-6">
        {(
          [
            ['stats', '統計'],
            ['users', 'ユーザー管理'],
            ['logs', 'ユーザーログ'],
            ['painted', '塗りログ'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {tab === 'stats' && <StatsPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'logs' && <LogsPanel />}
        {tab === 'painted' && <PaintedLogPanel />}
      </main>
    </div>
  );
}
