'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchLogs, type UserLog } from './api';

const PAGE_SIZE = 100;

// アクション種別の日本語ラベルと色。
const ACTION_LABEL: Record<string, string> = {
  login: 'ログイン',
  signup: '新規登録',
  logout: 'ログアウト',
  session_start: 'セッション開始',
  search: '検索',
  gps: '現在地取得',
};

// 絞り込み用の選択肢
const ACTION_OPTIONS = Object.keys(ACTION_LABEL);

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP');
}

function actionBadge(action: string) {
  const label = ACTION_LABEL[action] ?? action;
  return (
    <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
      {label}
    </span>
  );
}

// meta（任意の付帯情報）を1行に整形する。検索クエリなどを見やすく出す。
function formatMeta(meta: unknown): string {
  if (meta == null) return '';
  if (typeof meta === 'object' && meta !== null && 'query' in meta) {
    const q = (meta as { query?: unknown }).query;
    if (typeof q === 'string') return `「${q}」`;
  }
  try {
    return JSON.stringify(meta);
  } catch {
    return '';
  }
}

export default function LogsPanel() {
  const [logs, setLogs] = useState<UserLog[] | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);

  const load = useCallback(() => {
    setLogs(null);
    setError('');
    setReachedEnd(false);
    fetchLogs({ action: action || undefined, limit: PAGE_SIZE })
      .then((r) => {
        setLogs(r.logs);
        setReachedEnd(r.logs.length < PAGE_SIZE);
      })
      .catch((e: Error) => setError(e.message));
  }, [action]);

  useEffect(load, [load]);

  const loadMore = () => {
    if (!logs || logs.length === 0) return;
    setLoadingMore(true);
    const beforeId = logs[logs.length - 1].id;
    fetchLogs({ action: action || undefined, beforeId, limit: PAGE_SIZE })
      .then((r) => {
        setLogs((prev) => [...(prev ?? []), ...r.logs]);
        if (r.logs.length < PAGE_SIZE) setReachedEnd(true);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600">アクション</label>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
        >
          <option value="">すべて</option>
          {ACTION_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>}
      {!logs && !error && <p className="text-sm text-gray-500">読み込み中…</p>}

      {logs && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-medium whitespace-nowrap">日時</th>
                <th className="px-3 py-2 font-medium">ユーザー</th>
                <th className="px-3 py-2 font-medium">アクション</th>
                <th className="px-3 py-2 font-medium">市区町村</th>
                <th className="px-3 py-2 font-medium">IP</th>
                <th className="px-3 py-2 font-medium">UserAgent</th>
                <th className="px-3 py-2 font-medium">詳細</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {formatDateTime(l.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{l.userName || '(未設定)'}</div>
                    <div className="text-xs text-gray-400">{l.userEmail}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{actionBadge(l.action)}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {l.municipality ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {l.ipAddress ?? '-'}
                  </td>
                  <td
                    className="px-3 py-2 text-xs text-gray-400 max-w-[240px] truncate"
                    title={l.userAgent ?? ''}
                  >
                    {l.userAgent ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">{formatMeta(l.meta)}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                    ログがありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {logs && logs.length > 0 && !reachedEnd && (
        <div className="text-center">
          <button
            disabled={loadingMore}
            onClick={loadMore}
            className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? '読み込み中…' : 'もっと見る'}
          </button>
        </div>
      )}
    </div>
  );
}
