'use client';

import { useEffect, useState } from 'react';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { fetchLogs, type UserLog } from './api';
import { SortableHeaderRow, TableBody, TablePager } from './table';
import UserFilter from './UserFilter';

const PAGE_SIZE = 100;

// アクション種別の日本語ラベルと色。
const ACTION_LABEL: Record<string, string> = {
  login: 'ログイン',
  signup: '新規登録',
  logout: 'ログアウト',
  session_start: 'セッション開始',
  search: '検索',
  gps: '現在地取得',
  video_reward: '動画広告',
};

// 動画リワード（video_reward）の meta.event の日本語ラベル。
const VIDEO_EVENT_LABEL: Record<string, string> = {
  start: 'ボタン押下',
  granted: '視聴完了・付与',
  dismissed: '途中キャンセル',
  unavailable: '在庫なし・非対応',
  error: 'エラー',
  cooldown: 'クールダウンで弾く',
  daily_limit: '1日上限で弾く',
  nonce_error: 'nonce発行失敗',
  claim_failed: '報酬請求失敗',
};

// 動画リワード失敗時の具体的な原因（meta.detail / meta.reason）の日本語ラベル。
const VIDEO_DETAIL_LABEL: Record<string, string> = {
  // Web GPT（rewardedAd.ts）
  gpt_load_failed: 'gpt.js読込失敗（広告ブロッカー等）',
  define_threw: 'スロット定義で例外',
  slot_null: 'リワード非対応・スロット重複',
  ready_timeout: '在庫なし（readyタイムアウト）',
  // ネイティブ Unity Ads（nativeRewardedAd.ts）
  plugin_missing: 'プラグイン無し（旧APK等）',
  init_failed: 'SDK初期化失敗',
  load_failed: '在庫なし・読込失敗',
  show_failed: '表示失敗',
  bridge_error: 'プラグイン呼び出し例外',
  // claim_failed の reason
  cooldown: 'クールダウン',
  daily_limit: '1日上限',
  invalid_nonce: 'nonce不正',
};

// 実行プラットフォーム（user_logs.platform）の表示ラベル。
const PLATFORM_LABEL: Record<string, string> = {
  web: 'Web',
  pwa: 'PWA',
  ios: 'iOS',
  android: 'Android',
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

// meta（任意の付帯情報）の日本語サマリーを作る。検索クエリ・動画リワードの段階など。
// サマリーで言い換えたキー以外（debug・net 等）は MetaCell が JSON 全文で添える。
function formatMeta(meta: unknown): string {
  if (meta == null) return '';
  if (typeof meta === 'object' && meta !== null && 'query' in meta) {
    const q = (meta as { query?: unknown }).query;
    if (typeof q === 'string') return `「${q}」`;
  }
  // 動画リワードの段階（event）を日本語で出す。granted は回復量、失敗は detail を添える。
  if (typeof meta === 'object' && meta !== null && 'event' in meta) {
    const ev = (meta as { event?: unknown }).event;
    if (typeof ev === 'string') {
      const label = VIDEO_EVENT_LABEL[ev] ?? ev;
      const granted = (meta as { granted?: unknown }).granted;
      if (typeof granted === 'number' && granted > 0) {
        return `${label}（+${granted}）`;
      }
      // 失敗の具体的な原因（detail）があれば「ラベル：原因」で出す。
      const detail = (meta as { detail?: unknown }).detail;
      if (typeof detail === 'string') {
        return `${label}：${VIDEO_DETAIL_LABEL[detail] ?? detail}`;
      }
      // 報酬請求失敗（claim_failed）は reason（cooldown 等）を添える。
      const reason = (meta as { reason?: unknown }).reason;
      if (typeof reason === 'string') {
        return `${label}：${VIDEO_DETAIL_LABEL[reason] ?? reason}`;
      }
      return label;
    }
  }
  // オブジェクトは MetaCell の「詳細データ」（JSON 全文）に任せて二重表示を避ける。
  if (typeof meta === 'object') return '';
  try {
    return JSON.stringify(meta);
  } catch {
    return '';
  }
}

// formatMeta のサマリーが言い換え済みのキー。これ以外が meta にあれば JSON 全文も出す。
const SUMMARIZED_META_KEYS = new Set(['event', 'detail', 'reason', 'granted', 'query']);

// meta のうちサマリーに含まれない残り（debug・net・message 等）の JSON。無ければ null。
function metaExtrasJson(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return null;
  const extras = Object.fromEntries(
    Object.entries(meta as Record<string, unknown>).filter(
      ([k]) => !SUMMARIZED_META_KEYS.has(k)
    )
  );
  if (Object.keys(extras).length === 0) return null;
  try {
    return JSON.stringify(extras);
  } catch {
    return null;
  }
}

// 詳細セル：日本語サマリー＋（あれば）meta 残りの JSON 全文。
// debug トレースが長くなるため、JSON は <details> で折りたたんで全文を見られるようにする。
function MetaCell({ meta }: { meta: unknown }) {
  const summary = formatMeta(meta);
  const extras = metaExtrasJson(meta);
  return (
    <>
      {summary}
      {extras && (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-[10px] text-gray-400 select-none">
            詳細データ
          </summary>
          <pre className="mt-0.5 max-w-xl whitespace-pre-wrap break-all text-[10px] text-gray-400">
            {extras}
          </pre>
        </details>
      )}
    </>
  );
}

// 列定義。ソートはサーバー側（manual モード）なので、ソート可能列の id は
// backend/routes/admin.ts の LOG_SORTABLE のキーと一致させる。
const columnHelper = createColumnHelper<UserLog>();
const columns = [
  columnHelper.accessor('createdAt', {
    id: 'date',
    header: '日時',
    sortDescFirst: true,
    cell: (info) => formatDateTime(info.getValue()),
    meta: { tdClass: 'text-xs text-gray-500 whitespace-nowrap' },
  }),
  columnHelper.accessor((l) => l.userName || l.userEmail || '', {
    id: 'user',
    header: 'ユーザー',
    cell: ({ row }) => (
      <>
        <div className="font-medium text-gray-800">{row.original.userName || '(未設定)'}</div>
        <div className="text-xs text-gray-400">{row.original.userEmail}</div>
      </>
    ),
  }),
  columnHelper.accessor('action', {
    id: 'action',
    header: 'アクション',
    cell: (info) => actionBadge(info.getValue()),
    meta: { tdClass: 'whitespace-nowrap' },
  }),
  columnHelper.display({
    id: 'meta',
    header: '詳細',
    cell: ({ row }) => <MetaCell meta={row.original.meta} />,
    meta: { tdClass: 'text-xs text-gray-600' },
  }),
  // プラットフォーム＋バージョン表記（旧ログ・未申告は -）
  columnHelper.accessor((l) => l.platform ?? '', {
    id: 'platform',
    header: '環境',
    cell: ({ row }) => (
      <>
        <div>
          {row.original.platform
            ? (PLATFORM_LABEL[row.original.platform] ?? row.original.platform)
            : '-'}
        </div>
        {row.original.appVersion && (
          <div className="text-[10px] text-gray-400">{row.original.appVersion}</div>
        )}
      </>
    ),
    meta: { tdClass: 'text-xs text-gray-600 whitespace-nowrap' },
  }),
  columnHelper.accessor((l) => l.municipality ?? '-', {
    id: 'municipality',
    header: '市区町村',
    meta: { tdClass: 'text-xs text-gray-600' },
  }),
  columnHelper.accessor((l) => l.ipAddress ?? '-', {
    id: 'ip',
    header: 'IP',
    meta: { tdClass: 'text-xs text-gray-500 whitespace-nowrap' },
  }),
  columnHelper.accessor((l) => l.userAgent ?? '-', {
    id: 'userAgent',
    header: 'UserAgent',
    meta: { tdClass: 'text-xs text-gray-400 break-all' },
  }),
];

export default function LogsPanel() {
  const [logs, setLogs] = useState<UserLog[] | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  // ソート・ページング状態（サーバー側で処理。初期値は新しい順）。
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: PAGE_SIZE });

  // 絞り込み・ソート・ページが変わるたびにサーバーから読み直す。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const s = sorting[0];
    fetchLogs({
      userId: userId || undefined,
      action: action || undefined,
      limit: PAGE_SIZE,
      offset: pagination.pageIndex * PAGE_SIZE,
      sort: s?.id,
      dir: s ? (s.desc ? 'desc' : 'asc') : undefined,
    })
      .then((r) => {
        if (cancelled) return;
        setLogs(r.logs);
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
  }, [userId, action, sorting, pagination.pageIndex]);

  const table = useReactTable({
    data: logs ?? [],
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
          <label className="text-xs text-gray-600">アクション</label>
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPagination((p) => ({ ...p, pageIndex: 0 }));
            }}
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
      </div>

      {error && <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>}
      {!logs && !error && <p className="text-sm text-gray-500">読み込み中…</p>}

      {logs && (
        <div className="space-y-3">
          {pager}
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <SortableHeaderRow table={table} />
              </thead>
              <TableBody table={table} empty="ログがありません" />
            </table>
          </div>
          {pager}
        </div>
      )}
    </div>
  );
}
