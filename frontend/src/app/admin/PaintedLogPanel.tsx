'use client';

import { useEffect, useState } from 'react';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { fetchPaintedLog, type PaintedLog } from './api';
import { SortableHeaderRow, TableBody, TablePager, SyncedScrollContainer } from './table';
import UserFilter from './UserFilter';

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
  return `${lat}, ${lng}`;
}

// 列定義。ソートはサーバー側（manual モード）なので、ソート可能列の id は
// backend/routes/admin.ts の PAINTED_SORTABLE のキーと一致させる。
const columnHelper = createColumnHelper<PaintedLog>();
const columns = [
  columnHelper.accessor('id', {
    id: 'paintedId',
    header: 'ID',
    meta: { tdClass: 'text-xs text-gray-400 whitespace-nowrap font-mono' },
  }),
  columnHelper.accessor('paintedAt', {
    id: 'date',
    header: '日時',
    sortDescFirst: true,
    cell: (info) => formatDateTime(info.getValue()),
    meta: { tdClass: 'text-xs text-gray-500 whitespace-nowrap' },
  }),
  columnHelper.accessor((p) => p.userName || p.userEmail || p.userId || '', {
    id: 'user',
    header: 'ユーザー',
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <div className="font-medium text-gray-800">{row.original.userName || '(未設定)'}</div>
        {row.original.userEmail && (
          <div className="text-xs text-gray-400">{row.original.userEmail}</div>
        )}
        <div className="text-[10px] text-gray-400 font-mono">{row.original.userId || '-'}</div>
      </div>
    ),
  }),
  columnHelper.accessor('sourceLayer', {
    id: 'sourceLayer',
    header: 'レイヤー',
    meta: { tdClass: 'text-xs text-gray-600' },
  }),
  columnHelper.accessor('keyCode', {
    id: 'keyCode',
    header: 'メッシュ',
    meta: { tdClass: 'text-xs text-gray-600 tabular-nums' },
  }),
  columnHelper.accessor('mode', {
    id: 'mode',
    header: 'モード',
    cell: (info) => modeBadge(info.getValue()),
    meta: { tdClass: 'whitespace-nowrap' },
  }),
  columnHelper.accessor((p) => p.country ?? '-', {
    id: 'country',
    header: '国',
    meta: { tdClass: 'text-xs text-gray-600 whitespace-nowrap' },
  }),
  columnHelper.accessor((p) => p.municipality ?? '-', {
    id: 'municipality',
    header: '市区町村',
    meta: { tdClass: 'text-xs text-gray-600' },
  }),
  columnHelper.display({
    id: 'latlng',
    header: '緯度経度',
    cell: ({ row }) => formatLatLng(row.original.lat, row.original.lng),
    meta: { tdClass: 'text-xs text-gray-500 whitespace-nowrap tabular-nums font-mono' },
  }),
];

export default function PaintedLogPanel() {
  const [rows, setRows] = useState<PaintedLog[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  // ユーザー絞り込み：選択中の userId。
  const [userId, setUserId] = useState('');
  // モード絞り込み：''（すべて）／'gps'／'manual'。
  const [mode, setMode] = useState<'' | 'gps' | 'manual'>('');
  // ソート・ページング状態（サーバー側で処理。初期値は新しい順）。
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: PAGE_SIZE });

  // 絞り込み・ソート・ページが変わるたびにサーバーから読み直す。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const s = sorting[0];
    fetchPaintedLog({
      userId: userId || undefined,
      mode: mode || undefined,
      limit: PAGE_SIZE,
      offset: pagination.pageIndex * PAGE_SIZE,
      sort: s?.id,
      dir: s ? (s.desc ? 'desc' : 'asc') : undefined,
    })
      .then((r) => {
        if (cancelled) return;
        setRows(r.painted);
        setTotal(r.total);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, mode, sorting, pagination.pageIndex]);

  const table = useReactTable({
    data: rows ?? [],
    columns,
    state: { sorting, pagination },
    manualSorting: true,
    manualPagination: true,
    rowCount: total,
    onSortingChange: (updater) => {
      setSorting(updater);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
    getRowId: (r) => String(r.id),
    getCoreRowModel: getCoreRowModel(),
  });

  const pager = <TablePager table={table} loading={loading} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <UserFilter
          userId={userId}
          onChange={(id) => {
            setUserId(id);
            setPagination((p) => ({ ...p, pageIndex: 0 }));
          }}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">モード</label>
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as '' | 'gps' | 'manual');
              setPagination((p) => ({ ...p, pageIndex: 0 }));
            }}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">すべて</option>
            <option value="gps">GPS</option>
            <option value="manual">手動</option>
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>}
      {!rows && !error && <p className="text-sm text-gray-500">読み込み中…</p>}

      {rows && (
        <div className="space-y-3">
          {pager}
          <SyncedScrollContainer>
            <table className="w-full text-sm">
              <thead>
                <SortableHeaderRow table={table} />
              </thead>
              <TableBody table={table} empty="塗りログがありません" />
            </table>
          </SyncedScrollContainer>
          {pager}
        </div>
      )}
    </div>
  );
}
