'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPaintedLog, type PaintedLog } from './api';
import Pager from './Pager';

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
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [total, setTotal] = useState(0);
  // cursorsRef[i] = ページ i の beforeId（先頭は undefined）。次へ進むたびに末尾 id を覚える。
  const cursorsRef = useRef<(number | undefined)[]>([undefined]);

  const loadPage = useCallback((p: number) => {
    setLoading(true);
    setError('');
    const beforeId = cursorsRef.current[p];
    fetchPaintedLog({ beforeId, limit: PAGE_SIZE })
      .then((r) => {
        setRows(r.painted);
        setTotal(r.total);
        setHasNext(r.painted.length === PAGE_SIZE);
        if (r.painted.length > 0) {
          cursorsRef.current[p + 1] = r.painted[r.painted.length - 1].id;
        }
        setPage(p);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  if (error) return <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>;
  if (!rows) return <p className="text-sm text-gray-500">読み込み中…</p>;

  return (
    <div className="space-y-3">
      <Pager
        page={page}
        hasNext={hasNext}
        loading={loading}
        total={total}
        pageSize={PAGE_SIZE}
        count={rows.length}
        onPrev={() => loadPage(page - 1)}
        onNext={() => loadPage(page + 1)}
      />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="px-3 py-2 font-medium whitespace-nowrap">日時</th>
              <th className="px-3 py-2 font-medium">ユーザー</th>
              <th className="px-3 py-2 font-medium">メッシュ</th>
              <th className="px-3 py-2 font-medium">モード</th>
              <th className="px-3 py-2 font-medium">国</th>
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
                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                  {p.country ?? '-'}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">{p.municipality ?? '-'}</td>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap tabular-nums">
                  {formatLatLng(p.lat, p.lng)}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {p.ipAddress ?? '-'}
                </td>
                <td className="px-3 py-2 text-xs text-gray-400 break-all">
                  {p.userAgent ?? '-'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-400">
                  塗りログがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        hasNext={hasNext}
        loading={loading}
        total={total}
        pageSize={PAGE_SIZE}
        count={rows.length}
        onPrev={() => loadPage(page - 1)}
        onNext={() => loadPage(page + 1)}
      />
    </div>
  );
}
