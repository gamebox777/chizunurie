'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchUsers, type AdminUser } from './api';

// 塗りログ・ユーザーログ・ユーザー管理で共有するユーザー絞り込み UI。
// プルダウンで1ユーザーを選び、横の入力ボックスの文字で候補を部分一致で絞る。
// users を渡せば（既に一覧を持っている画面用）自前で fetch しない。
export default function UserFilter({
  userId,
  onChange,
  users: usersProp,
}: {
  userId: string;
  onChange: (id: string) => void;
  users?: AdminUser[];
}) {
  const [fetched, setFetched] = useState<AdminUser[]>([]);
  const [filter, setFilter] = useState('');

  // usersProp が無い画面（ログ系）は自前でユーザー一覧を取得する。
  // 失敗してもログ自体は表示できるよう握りつぶす。
  useEffect(() => {
    if (usersProp) return;
    fetchUsers()
      .then((r) => setFetched(r.users))
      .catch(() => {});
  }, [usersProp]);

  const users = usersProp ?? fetched;

  // 入力ボックスの文字に部分一致（名前・本名・メール）するユーザーだけ候補に出す。
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.name, u.realName, u.email].some((s) => s?.toLowerCase().includes(q))
    );
  }, [users, filter]);

  // 選択中ユーザーが絞り込みで候補から外れても、選択は維持して表示する。
  const selected = users.find((u) => u.id === userId);
  const options =
    selected && !filtered.some((u) => u.id === userId)
      ? [selected, ...filtered]
      : filtered;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-gray-600">ユーザー</label>
      <select
        value={userId}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-xs rounded border border-gray-300 bg-white px-2 py-1 text-sm"
      >
        <option value="">すべて</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {(u.name || '(未設定)') + (u.email ? `（${u.email}）` : '')}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="名前・メールで絞り込み"
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
      />
    </div>
  );
}
