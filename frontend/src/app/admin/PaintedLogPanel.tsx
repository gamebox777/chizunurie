'use client';

import { useEffect, useState } from 'react';
import { fetchPaintedLog, type PaintedLog } from './api';

const PAGE_SIZE = 100;

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP');
}

function modeBadge(mode: string) {
  const isGps = mode === 'gps';
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        isGps ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'
      }`}
    >
      {isGps ? 'GPS' : '手動'}
    </span>
  );
}

function formatLatLng(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return '-';
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export default function PaintedLogPanel() {
  const [rows, setRows] = useState<PaintedLog[] | null>(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);

  useEffect(() => {
    fetchPaintedLog({ limit: PAGE_SIZE })
      .then((r) => {
        setRows(r.painted);
        setReachedEnd(r.painted.length < PAGE_SIZE);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadMore = () => {
    if (!rows || rows.length === 0) return;
    setLoadingMore(true);
    const beforeId = rows[rows.length - 1].id;
    fetchPaintedLog({ beforeId, limit: PAGE_SIZE })
      .then((r) => {
        setRows((prev) => [...(prev ?? []), ...r.painted]);
        if (r.painted.length < PAGE_SIZE) setReachedEnd(true);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };

  if (error) return <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>;
  if (!rows) return <p className="text-sm text-gray-500">読み込み中…</p>;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="px-3 py-2 font-medium whitespace-nowrap">日時</th>
              <th className="px-3 py-2 font-medium">ユーザー</th>
              <th className="px-3 py-2 font-medium">メッシュ</th>
              <th className="px-3 py-2 font-medium">モード</th>
              <th className="px-3 py-2 font-medium">市区町村</th>
              <th className="px-3 py-2 font-medium">緯度経度</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">UserAgent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {formatDateTime(p.paintedAt)}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-800">{p.userName || '(未設定)'}</div>
                  <div className="text-xs text-gray-400">{p.userEmail}</div>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">{p.keyCode}</td>
                <td className="px-3 py-2 whitespace-nowrap">{modeBadge(p.mode)}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{p.municipality ?? '-'}</td>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap tabular-nums">
                  {formatLatLng(p.lat, p.lng)}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {p.ipAddress ?? '-'}
                </td>
                <td
                  className="px-3 py-2 text-xs text-gray-400 max-w-[240px] truncate"
                  title={p.userAgent ?? ''}
                >
                  {p.userAgent ?? '-'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                  塗りログがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && !reachedEnd && (
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
