'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { fetchLogs, type UserLog } from './api';
import { SortableHeaderRow, TableBody, TablePager, SyncedScrollContainer } from './table';
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
  stats: 'データ詳細',
  ranking: 'ランキング',
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

function formatLatLng(lat: number | null | undefined, lng: number | null | undefined): string {
  if (lat == null || lng == null) return '-';
  return `${lat}, ${lng}`;
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

// 1行ぶんのログ全情報を JSON テキストにする（コピー用）。
function logToText(log: UserLog): string {
  return JSON.stringify(log, null, 2);
}

// サーバー環境バッジの表示ラベルと色。
const ENV_BADGE: Record<string, { label: string; cls: string }> = {
  dev: { label: '開発', cls: 'bg-green-100 text-green-700' },
  docker: { label: 'Docker', cls: 'bg-blue-100 text-blue-700' },
  production: { label: '本番', cls: 'bg-red-100 text-red-700' },
};

function EnvironmentBadge({ env }: { env: string | null }) {
  if (!env) return <span className="text-xs text-gray-300">-</span>;
  const badge = ENV_BADGE[env] ?? { label: env, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

// 列定義。ソートはサーバー側（manual モード）なので、ソート可能列の id は
// backend/routes/admin.ts の LOG_SORTABLE のキーと一致させる。
const columnHelper = createColumnHelper<UserLog>();
const columns = [
  // コピーボタン列（ソート不可・固定幅）
  columnHelper.display({
    id: 'copy',
    header: '',
    cell: ({ row }) => <CopyButton log={row.original} />,
    meta: { tdClass: 'px-1 py-1 whitespace-nowrap' },
    enableSorting: false,
  }),
  columnHelper.accessor('id', {
    id: 'logId',
    header: 'ID',
    meta: { tdClass: 'text-xs text-gray-400 whitespace-nowrap font-mono' },
  }),
  columnHelper.accessor('createdAt', {
    id: 'date',
    header: '日時',
    sortDescFirst: true,
    cell: (info) => formatDateTime(info.getValue()),
    meta: { tdClass: 'text-xs text-gray-500 whitespace-nowrap' },
  }),
  columnHelper.accessor((l) => l.userName || l.userEmail || l.userId || '', {
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
  // 環境（プラットフォーム＋アプリバージョン ＆ サーバー環境）
  columnHelper.accessor((l) => l.platform ?? '', {
    id: 'platform',
    header: '環境',
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <span>
            {row.original.platform
              ? (PLATFORM_LABEL[row.original.platform] ?? row.original.platform)
              : '-'}
          </span>
          {row.original.environment && (
            <EnvironmentBadge env={row.original.environment} />
          )}
        </div>
        {row.original.appVersion && (
          <div className="text-[10px] text-gray-400">{row.original.appVersion}</div>
        )}
      </div>
    ),
    meta: { tdClass: 'text-xs text-gray-600' },
  }),
  columnHelper.accessor((l) => l.url ?? '-', {
    id: 'url',
    header: 'URL',
    meta: { tdClass: 'text-xs text-gray-500 break-all max-w-[200px]' },
  }),
  columnHelper.accessor((l) => l.municipality ?? '-', {
    id: 'municipality',
    header: '市区町村',
    meta: { tdClass: 'text-xs text-gray-600 whitespace-nowrap' },
  }),
  columnHelper.display({
    id: 'latlng',
    header: '緯度・経度',
    cell: ({ row }) => {
      const { lat, lng } = row.original;
      if (lat == null || lng == null) return '-';
      return (
        <a
          href={`https://www.google.com/maps?q=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline flex flex-col gap-0.5"
        >
          <span>{lat.toFixed(5)}</span>
          <span>{lng.toFixed(5)}</span>
        </a>
      );
    },
    meta: { tdClass: 'text-xs text-gray-500 whitespace-nowrap font-mono' },
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

// コピーボタンコンポーネント。クリックで行全体の JSON をクリップボードにコピーする。
function CopyButton({ log }: { log: UserLog }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(logToText(log)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [log]);
  return (
    <button
      onClick={handleCopy}
      title="この行のログ情報をすべてコピー"
      className={`rounded p-1 text-xs transition-colors ${
        copied
          ? 'bg-green-100 text-green-600'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
      }`}
    >
      {copied ? '✓' : '📋'}
    </button>
  );
}



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
          <SyncedScrollContainer>
            <table className="w-full text-sm">
              <thead>
                <SortableHeaderRow table={table} />
              </thead>
              <TableBody table={table} empty="ログがありません" />
            </table>
          </SyncedScrollContainer>
          {pager}
        </div>
      )}
    </div>
  );
}
