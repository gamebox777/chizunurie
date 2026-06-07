'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from '@/lib/auth-client';
import { logEvent } from '@/lib/userlog';

type Props = {
  // 現在のニックネーム（メニュー先頭に表示）
  name: string;
  // 権限（session.user.role）。未設定／null なら一般ユーザー扱い。
  role?: string | null;
  // 「ニックネーム変更」を押したとき
  onEditNickname: () => void;
  // ログアウト完了後（セッション再取得など）
  onSignedOut: () => void;
};

// role の値 → 画面に出す日本語ラベル。
const ROLE_LABELS: Record<string, string> = {
  user: '一般ユーザー',
  developer: '開発者',
};
function roleLabel(role?: string | null): string {
  return ROLE_LABELS[role ?? 'user'] ?? (role ?? '一般ユーザー');
}

// 右側の歯車ボタン。押すと各種設定メニュー（ニックネーム変更・ログアウト）が出る。
export default function SettingsMenu({ name, role, onEditNickname, onSignedOut }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // メニュー外クリック・Escで閉じる
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    // まだ認証クッキーが有効なうちにログアウトを記録する。
    await logEvent('logout');
    await signOut();
    setOpen(false);
    onSignedOut();
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="設定"
        aria-expanded={open}
        className="flex items-center justify-center w-8 h-8 rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20">
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-xs text-gray-400">ログイン中</p>
            <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
            <p className="text-xs text-gray-500 mt-0.5">権限：{roleLabel(role)}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              onEditNickname();
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ニックネーム変更
          </button>
          {/* 開発者のみ：地図とは別の管理画面へ */}
          {role === 'developer' && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              管理画面
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
}
