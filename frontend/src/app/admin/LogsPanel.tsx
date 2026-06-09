'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLogs, type UserLog } from './api';
import Pager from './Pager';
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

// 動画リワード失敗時の具体的な原因（meta.detail）の日本語ラベル。
const VIDEO_DETAIL_LABEL: Record<string, string> = {
  gpt_load_failed: 'gpt.js読込失敗（広告ブロッカー等）',
  define_threw: 'スロット定義で例外',
  slot_null: 'リワード非対応・スロット重複',
  ready_timeout: '在庫なし（タイムアウト）',
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
        return `${label}：${reason}`;
      }
      return label;
    }
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
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [total, setTotal] = useState(0);
  // cursorsRef[i] = ページ i を取得するための beforeId（先頭ページは undefined）。
  // 次へ進むたびに「今ページの末尾 id」を次ページのカーソルとして覚える。
  const cursorsRef = useRef<(number | undefined)[]>([undefined]);

  const loadPage = useCallback(
    (p: number) => {
      setLoading(true);
      setError('');
      const beforeId = cursorsRef.current[p];
      fetchLogs({ userId: userId || undefined, action: action || undefined, beforeId, limit: PAGE_SIZE })
        .then((r) => {
          setLogs(r.logs);
          setTotal(r.total);
          setHasNext(r.logs.length === PAGE_SIZE);
          if (r.logs.length > 0) {
            cursorsRef.current[p + 1] = r.logs[r.logs.length - 1].id;
          }
          setPage(p);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [action, userId]
  );

  // 絞り込み（action・ユーザー）が変わったらカーソルを捨てて先頭ページから読み直す。
  useEffect(() => {
    cursorsRef.current = [undefined];
    loadPage(0);
  }, [loadPage]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <UserFilter userId={userId} onChange={setUserId} />
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
      </div>

      {error && <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>}
      {!logs && !error && <p className="text-sm text-gray-500">読み込み中…</p>}

      {logs && (
        <Pager
          page={page}
          hasNext={hasNext}
          loading={loading}
          total={total}
          pageSize={PAGE_SIZE}
          count={logs.length}
          onPrev={() => loadPage(page - 1)}
          onNext={() => loadPage(page + 1)}
        />
      )}

      {logs && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-medium whitespace-nowrap">日時</th>
                <th className="px-3 py-2 font-medium">ユーザー</th>
                <th className="px-3 py-2 font-medium">アクション</th>
                <th className="px-3 py-2 font-medium">詳細</th>
                <th className="px-3 py-2 font-medium">市区町村</th>
                <th className="px-3 py-2 font-medium">IP</th>
                <th className="px-3 py-2 font-medium">UserAgent</th>
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
                  <td className="px-3 py-2 text-xs text-gray-600">{formatMeta(l.meta)}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {l.municipality ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {l.ipAddress ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400 break-all">
                    {l.userAgent ?? '-'}
                  </td>
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

      {logs && (
        <Pager
          page={page}
          hasNext={hasNext}
          loading={loading}
          total={total}
          pageSize={PAGE_SIZE}
          count={logs.length}
          onPrev={() => loadPage(page - 1)}
          onNext={() => loadPage(page + 1)}
        />
      )}
    </div>
  );
}
