'use client';

// 管理画面の一覧用ページャー。カーソル（beforeId）ベースの前後ページ移動を担う。
// page は 0 始まり。hasNext は「次ページがありそうか」（現在ページが満杯か）。
// total（絞り込み後の総件数）・pageSize・count（現在ページの表示件数）から
// 「全N件中 X〜Y件目（Pページ目）」を出す。
export default function Pager({
  page,
  hasNext,
  loading,
  total,
  pageSize,
  count,
  onPrev,
  onNext,
}: {
  page: number;
  hasNext: boolean;
  loading: boolean;
  // 絞り込み後の総件数。
  total: number;
  // 1ページあたりの件数。
  pageSize: number;
  // 現在ページに実際に表示されている件数。
  count: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = page * pageSize + count;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs tabular-nums text-gray-500">
        全 {total.toLocaleString()} 件中 {start.toLocaleString()}–{end.toLocaleString()} 件目
      </span>
      <div className="flex items-center gap-3">
        <button
          disabled={page === 0 || loading}
          onClick={onPrev}
          className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          ← 前へ
        </button>
        <span className="text-sm tabular-nums text-gray-600">
          {page + 1} / {totalPages} ページ
        </span>
        <button
          disabled={!hasNext || loading}
          onClick={onNext}
          className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          次へ →
        </button>
      </div>
    </div>
  );
}
