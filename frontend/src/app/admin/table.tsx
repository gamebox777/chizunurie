'use client';

// 管理画面の一覧テーブル共通部品（TanStack Table ベース）。
// 各パネルは useReactTable でテーブルを組み立て、ヘッダー行（クリックでソート切替）と
// ページャーをここから使う。クライアント側ソート（ユーザー管理）と
// サーバー側ソート（塗りログ・ユーザーログ＝manual モード）の両方で同じ見た目になる。

import { useCallback, useEffect, useRef, useState } from 'react';
import { flexRender, type RowData, type SortingFn, type Table } from '@tanstack/react-table';

// columnDef.meta で列の寄せ（既定は左寄せ）と、flexRender で tbody を描く
// テーブル向けの td 追加クラスを指定できるようにする。
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'center' | 'right';
    tdClass?: string;
  }
}

// 日本語の文字列ソート（TanStack 既定の alphanumeric は日本語の照合が不自然なため）。
export function jaTextSort<T>(): SortingFn<T> {
  return (a, b, columnId) =>
    String(a.getValue(columnId) ?? '').localeCompare(
      String(b.getValue(columnId) ?? ''),
      'ja'
    );
}

function thAlign(align: 'center' | 'right' | undefined): string {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return '';
}

// ヘッダー行。ソート可能な列はクリックで 昇順 → 降順 →（解除＝既定順）をトグルし、
// アクティブな列に ▲/▼、その他のソート可能列に薄い ↕ を出す。
export function SortableHeaderRow<T>({ table }: { table: Table<T> }) {
  return (
    <>
      {table.getHeaderGroups().map((hg) => (
        <tr key={hg.id} className="text-left text-xs text-gray-500">
          {hg.headers.map((h) => {
            const align = h.column.columnDef.meta?.align;
            const label = flexRender(h.column.columnDef.header, h.getContext());
            const sorted = h.column.getIsSorted(); // false | 'asc' | 'desc'
            return (
              <th
                key={h.id}
                className={`px-3 py-2 font-medium whitespace-nowrap ${thAlign(align)}`}
              >
                {h.column.getCanSort() ? (
                  <button
                    onClick={h.column.getToggleSortingHandler()}
                    className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-gray-800 ${
                      sorted ? 'text-gray-800' : ''
                    }`}
                  >
                    {label}
                    <span className={sorted ? 'text-blue-600' : 'text-gray-300'}>
                      {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                    </span>
                  </button>
                ) : (
                  label
                )}
              </th>
            );
          })}
        </tr>
      ))}
    </>
  );
}

// flexRender ベースの tbody。各セルは columnDef.cell を描画し、meta.tdClass を td に当てる。
// （ユーザー管理のように行内に編集 state を持つテーブルは使わず、自前で行を描く。）
export function TableBody<T>({ table, empty }: { table: Table<T>; empty: string }) {
  const rows = table.getRowModel().rows;
  return (
    <tbody>
      {rows.map((row) => (
        <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
          {row.getVisibleCells().map((cell) => (
            <td
              key={cell.id}
              className={`px-3 py-2 ${cell.column.columnDef.meta?.tdClass ?? ''}`}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          ))}
        </tr>
      ))}
      {rows.length === 0 && (
        <tr>
          <td
            colSpan={table.getAllLeafColumns().length}
            className="px-3 py-6 text-center text-gray-400"
          >
            {empty}
          </td>
        </tr>
      )}
    </tbody>
  );
}

// ページャー（前へ/次へ＋「全N件中 X–Y件目」）。ページ状態はテーブル本体から読むので、
// クライアントページングでも manual（サーバー）ページングでもそのまま使える。
export function TablePager<T>({
  table,
  loading = false,
  unit = '件',
}: {
  table: Table<T>;
  loading?: boolean;
  unit?: string;
}) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getRowCount();
  const pageCount = Math.max(1, table.getPageCount());
  const start = total === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min((pageIndex + 1) * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <span className="text-xs tabular-nums text-gray-500">
        全 {total.toLocaleString()} {unit}中 {start.toLocaleString()}–{end.toLocaleString()} {unit}目
      </span>
      <div className="flex items-center gap-3">
        <button
          disabled={!table.getCanPreviousPage() || loading}
          onClick={() => table.previousPage()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          ← 前へ
        </button>
        <span className="text-sm tabular-nums text-gray-600">
          {pageIndex + 1} / {pageCount} ページ
        </span>
        <button
          disabled={!table.getCanNextPage() || loading}
          onClick={() => table.nextPage()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          次へ →
        </button>
      </div>
    </div>
  );
}

// 上下スクロールバー同期コンテナ。上にもスクロールバーを配置し、
// 下のスクロールバーと連動させる。
export function SyncedScrollContainer({
  children,
  className = 'overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const syncing = useRef(false);

  // テーブルの実コンテンツ幅を監視して上のダミーバーに反映する。
  useEffect(() => {
    const bottom = bottomRef.current;
    if (!bottom) return;
    const update = () => {
      const inner = bottom.scrollWidth;
      if (inner !== contentWidth) setContentWidth(inner);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(bottom);
    // テーブル内の子要素のサイズ変化も拾う
    const first = bottom.firstElementChild;
    if (first) ro.observe(first);
    return () => ro.disconnect();
  }, [contentWidth]);

  const onTopScroll = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (bottomRef.current && topRef.current) {
      bottomRef.current.scrollLeft = topRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  const onBottomScroll = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (topRef.current && bottomRef.current) {
      topRef.current.scrollLeft = bottomRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  return (
    <div className="space-y-1">
      {/* 上部スクロールバー（ダミー） */}
      <div
        ref={topRef}
        onScroll={onTopScroll}
        className="overflow-x-auto"
        style={{ height: 12 }}
      >
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
      {/* テーブル本体 */}
      <div
        ref={bottomRef}
        onScroll={onBottomScroll}
        className={className}
      >
        {children}
      </div>
    </div>
  );
}

