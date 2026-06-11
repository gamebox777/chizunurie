'use client';

import { useEffect, useState } from 'react';
import {
  deletePainted,
  deleteUser,
  fetchUsers,
  setPoints,
  setRole,
  setUserAds,
  type AdminUser,
} from './api';
import UserFilter from './UserFilter';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ja-JP');
}

// 更新日時は日付＋時刻まで表示する（「最後にアクションした日時」を見るため）。
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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

// ユーザー個別の Web 広告上書き設定の選択値（select の値）。
// 'default'=全体設定に従う（上書きなし）/ 'on'=強制 ON / 'off'=強制 OFF。
type AdOverrideSel = 'default' | 'on' | 'off';

function toAdSel(v: boolean | undefined): AdOverrideSel {
  return v === undefined ? 'default' : v ? 'on' : 'off';
}

// 一覧セル用の短い表示。上書きなしは「既定」、上書きありは ON/OFF を色付きで出す。
function AdOverrideBadge({ value }: { value: boolean | undefined }) {
  if (value === undefined) return <span className="text-gray-400">既定</span>;
  return value ? (
    <span className="font-semibold text-emerald-600">ON</span>
  ) : (
    <span className="font-semibold text-red-600">OFF</span>
  );
}

// 1ユーザー分の行。権限変更・ポイント編集・広告設定・塗り全削除を担う。
function UserRow({
  u,
  onChanged,
  selected,
  onToggleSelect,
}: {
  u: AdminUser;
  onChanged: () => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // ロール変更をキャンセルしたとき、controlled な select の表示を u.role に戻すための再描画トリガー
  const [, bumpTick] = useState(0);
  const [points, setPointsField] = useState(String(u.points?.points ?? 0));
  const [level, setLevel] = useState(String(u.points?.level ?? 1));
  // Web 広告の個別上書き（個別＞全体）。'default' は上書きなし＝全体設定に従う。
  const [adAuto, setAdAuto] = useState<AdOverrideSel>(() => toAdSel(u.adSettings?.auto));
  const [adReward, setAdReward] = useState<AdOverrideSel>(() =>
    toAdSel(u.adSettings?.reward)
  );

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

  // Web 広告の個別上書きを保存する。'default' は null（上書き解除＝全体設定に従う）として送る。
  const saveAds = () =>
    run(async () => {
      await setUserAds(u.id, {
        auto: adAuto === 'default' ? null : adAuto === 'on',
        reward: adReward === 'default' ? null : adReward === 'on',
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
        <td className="px-3 py-2 text-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(u.id)}
            className="h-4 w-4 cursor-pointer accent-red-600"
            aria-label="選択"
          />
        </td>
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
        {/* Web 広告の個別上書き（自動広告 / 広告で回復）。「既定」は全体設定に従う。 */}
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          <div>
            自動: <AdOverrideBadge value={u.adSettings?.auto} />
          </div>
          <div>
            回復: <AdOverrideBadge value={u.adSettings?.reward} />
          </div>
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
        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap tabular-nums">
          {formatDateTime(u.updatedAt)}
        </td>
        <td className="px-3 py-2 whitespace-nowrap text-right">
          <button
            disabled={busy}
            onClick={() => setEditing((v) => !v)}
            className="rounded px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          >
            {editing ? '閉じる' : '編集'}
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
          <td colSpan={14} className="px-3 py-3">
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
              {/* Web 広告の個別上書き（個別＞全体）。「既定」にすると全体設定に従う。 */}
              <span className="mx-2 hidden h-9 w-px bg-gray-200 sm:block" />
              <label className="text-xs text-gray-600">
                自動広告
                <select
                  value={adAuto}
                  onChange={(e) => setAdAuto(e.target.value as AdOverrideSel)}
                  className="mt-1 block rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                >
                  <option value="default">既定（全体設定に従う）</option>
                  <option value="on">ON（強制配信）</option>
                  <option value="off">OFF（強制停止）</option>
                </select>
              </label>
              <label className="text-xs text-gray-600">
                広告で回復
                <select
                  value={adReward}
                  onChange={(e) => setAdReward(e.target.value as AdOverrideSel)}
                  className="mt-1 block rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                >
                  <option value="default">既定（全体設定に従う）</option>
                  <option value="on">ON（強制配信）</option>
                  <option value="off">OFF（強制停止）</option>
                </select>
              </label>
              <button
                disabled={busy}
                onClick={saveAds}
                className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
              >
                広告設定を保存
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
  // 選択中ユーザー（空なら全員表示）。
  const [userId, setUserId] = useState('');
  // チェックボックスで削除対象に選んだユーザー ID 集合（ページをまたいで保持する）。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 一括削除の実行中フラグ。
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    fetchUsers()
      .then((r) => setUsers(r.users))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (error) return <p className="text-sm text-red-600">読み込みに失敗しました：{error}</p>;
  if (!users) return <p className="text-sm text-gray-500">読み込み中…</p>;

  // ユーザーを選んだら、その1人だけを一覧に表示する。
  const visibleUsers = userId ? users.filter((u) => u.id === userId) : users;
  const total = visibleUsers.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // データ再読込・絞り込みで件数が減っても範囲外に出ないようにクランプする。
  const safePage = Math.min(page, pageCount - 1);
  const pageUsers = visibleUsers.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pager = (
    <Pager page={safePage} pageCount={pageCount} total={total} onChange={setPage} />
  );

  // 現在のページが全選択済みか（ヘッダのチェックボックスの状態）。
  const allPageSelected =
    pageUsers.length > 0 && pageUsers.every((u) => selectedIds.has(u.id));

  // ヘッダのチェックで現在ページぶんをまとめて選択／解除する。
  const toggleSelectPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageUsers.forEach((u) => next.delete(u.id));
      else pageUsers.forEach((u) => next.add(u.id));
      return next;
    });
  };

  // 選択したユーザーを関連データごと一括削除する。
  const deleteSelected = async () => {
    const ids = users.filter((u) => selectedIds.has(u.id));
    if (ids.length === 0) return;
    if (
      !confirm(
        `選択した ${ids.length} 人のユーザーを関連データ（塗り・ポイント・ログ等）ごと完全に削除します。\nこの操作は取り消せません。よろしいですか？`
      )
    )
      return;
    setDeleting(true);
    const failed: string[] = [];
    for (const u of ids) {
      try {
        await deleteUser(u.id);
      } catch (e) {
        failed.push(`${u.name || u.email}：${(e as Error).message}`);
      }
    }
    setDeleting(false);
    setSelectedIds(new Set());
    load();
    if (failed.length > 0) {
      alert(`一部の削除に失敗しました：\n${failed.join('\n')}`);
    }
  };

  return (
    <div className="space-y-3">
      <UserFilter
        userId={userId}
        onChange={(id) => {
          setUserId(id);
          setPage(0);
        }}
        users={users}
      />

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
          <span className="text-red-700">{selectedIds.size} 人を選択中</span>
          <button
            disabled={deleting}
            onClick={deleteSelected}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? '削除中…' : '選択したユーザーを削除'}
          </button>
          <button
            disabled={deleting}
            onClick={() => setSelectedIds(new Set())}
            className="rounded px-2 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            選択解除
          </button>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100">{pager}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="px-3 py-2 text-center font-medium">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleSelectPage}
                  className="h-4 w-4 cursor-pointer accent-red-600"
                  aria-label="このページを全選択"
                />
              </th>
              <th className="px-3 py-2 font-medium">ユーザー</th>
              <th className="px-3 py-2 font-medium">権限</th>
              <th className="px-3 py-2 font-medium">国</th>
              <th className="px-3 py-2 font-medium">広告</th>
              <th className="px-3 py-2 text-right font-medium">Lv</th>
              <th className="px-3 py-2 text-right font-medium">ポイント</th>
              <th className="px-3 py-2 text-right font-medium">塗り</th>
              <th className="px-3 py-2 text-right font-medium">プレイ時間</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">UserAgent</th>
              <th className="px-3 py-2 font-medium">登録日</th>
              <th className="px-3 py-2 font-medium">更新日</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageUsers.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                onChanged={load}
                selected={selectedIds.has(u.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
            {total === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-gray-400">
                  ユーザーがいません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
        <div className="border-t border-gray-100">{pager}</div>
      </div>
    </div>
  );
}
