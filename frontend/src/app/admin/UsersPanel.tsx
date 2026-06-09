'use client';

import { useEffect, useState } from 'react';
import {
  deletePainted,
  fetchUsers,
  setPoints,
  setRole,
  type AdminUser,
} from './api';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ja-JP');
}

// 合計プレイ時間（秒）を「X時間Y分」などの日本語に整形する（一覧向けに分単位まで）。
function formatPlayTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0分';
  const totalSec = Math.floor(sec);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}日`);
  if (d > 0 || h > 0) parts.push(`${h}時間`);
  parts.push(`${m}分`);
  return parts.join('');
}

// 1ユーザー分の行。権限変更・ポイント編集・塗り全削除を担う。
function UserRow({
  u,
  onChanged,
}: {
  u: AdminUser;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // ロール変更をキャンセルしたとき、controlled な select の表示を u.role に戻すための再描画トリガー
  const [, bumpTick] = useState(0);
  const [points, setPointsField] = useState(String(u.points?.points ?? 0));
  const [level, setLevel] = useState(String(u.points?.level ?? 1));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      alert(`操作に失敗しました：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = (role: string) => {
    const next = role === 'developer' ? 'developer' : 'user';
    const label = next === 'developer' ? '開発者' : '一般ユーザー';
    if (
      !confirm(`「${u.name || u.email}」の権限を「${label}」に変更します。よろしいですか？`)
    ) {
      bumpTick((n) => n + 1); // 再描画して select の表示を u.role に戻す
      return;
    }
    run(() => setRole(u.id, next));
  };

  const savePoints = () =>
    run(async () => {
      await setPoints(u.id, {
        points: Number(points),
        level: Number(level),
      });
      setEditing(false);
    });

  const removePainted = () => {
    if (!confirm(`「${u.name || u.email}」の塗りを全て削除します。よろしいですか？`)) return;
    run(() => deletePainted(u.id));
  };

  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-gray-50">
        <td className="px-3 py-2">
          <div className="font-medium text-gray-800">{u.name || '(未設定)'}</div>
          {u.realName && (
            <div className="text-xs text-gray-500">本名: {u.realName}</div>
          )}
          <div className="text-xs text-gray-400">{u.email}</div>
        </td>
        <td className="px-3 py-2">
          <select
            value={u.role === 'developer' ? 'developer' : 'user'}
            disabled={busy}
            onChange={(e) => changeRole(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            <option value="user">一般ユーザー</option>
            <option value="developer">開発者</option>
          </select>
        </td>
        <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
          {u.country ?? '-'}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{u.points?.level ?? '-'}</td>
        <td className="px-3 py-2 text-right tabular-nums">{u.points?.points ?? '-'}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {u.painted.total.toLocaleString()}
          <span className="ml-1 text-xs text-gray-400">
            (G{u.painted.gps}/M{u.painted.manual})
          </span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
          {formatPlayTime(u.playTimeSec)}
        </td>
        <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap tabular-nums">
          {u.lastIpAddress ?? '-'}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500">
          <div className="max-w-[16rem] truncate" title={u.lastUserAgent ?? ''}>
            {u.lastUserAgent ?? '-'}
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-gray-400">{formatDate(u.createdAt)}</td>
        <td className="px-3 py-2 whitespace-nowrap text-right">
          <button
            disabled={busy}
            onClick={() => setEditing((v) => !v)}
            className="rounded px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          >
            {editing ? '閉じる' : 'ポイント編集'}
          </button>
          <button
            disabled={busy}
            onClick={removePainted}
            className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            塗り全削除
          </button>
        </td>
      </tr>
      {editing && (
        <tr className="border-t border-gray-100 bg-blue-50/40">
          <td colSpan={11} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-gray-600">
                ポイント
                <input
                  type="number"
                  min={0}
                  value={points}
                  onChange={(e) => setPointsField(e.target.value)}
                  className="mt-1 block w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-gray-600">
                レベル
                <input
                  type="number"
                  min={1}
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="mt-1 block w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <button
                disabled={busy}
                onClick={savePoints}
                className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// 1ページあたりの表示件数。
const PAGE_SIZE = 50;

// ページ送り（前へ/次へ＋現在ページ）。一覧の上下に同じものを置く。
function Pager({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (p: number) => void;
}) {
  if (total === 0) return null;
  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-gray-600">
      <span className="tabular-nums">
        {start}–{end} / {total}人
      </span>
      <div className="flex items-center gap-2">
        <button
          disabled={page <= 0}
          onClick={() => onChange(page - 1)}
          className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40"
        >
          前へ
        </button>
        <span className="tabular-nums">
          {page + 1} / {pageCount}
        </span>
        <button
          disabled={page >= pageCount - 1}
          onClick={() => onChange(page + 1)}
          className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40"
        >
          次へ
        </button>
      </div>
    </div>
  );
}

export default function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  const load = () => {
    fetchUsers()
      .then((r) => setUsers(r.users))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  if (error) return <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>;
  if (!users) return <p className="text-sm text-gray-500">読み込み中…</p>;

  const total = users.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // データ再読込で件数が減っても範囲外に出ないようにクランプする。
  const safePage = Math.min(page, pageCount - 1);
  const pageUsers = users.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pager = (
    <Pager page={safePage} pageCount={pageCount} total={total} onChange={setPage} />
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100">{pager}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="px-3 py-2 font-medium">ユーザー</th>
              <th className="px-3 py-2 font-medium">権限</th>
              <th className="px-3 py-2 font-medium">国</th>
              <th className="px-3 py-2 text-right font-medium">Lv</th>
              <th className="px-3 py-2 text-right font-medium">ポイント</th>
              <th className="px-3 py-2 text-right font-medium">塗り</th>
              <th className="px-3 py-2 text-right font-medium">プレイ時間</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">UserAgent</th>
              <th className="px-3 py-2 font-medium">登録日</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageUsers.map((u) => (
              <UserRow key={u.id} u={u} onChanged={load} />
            ))}
            {total === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-gray-400">
                  ユーザーがいません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-gray-100">{pager}</div>
    </div>
  );
}
