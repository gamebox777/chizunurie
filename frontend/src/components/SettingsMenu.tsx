'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from '@/lib/auth-client';
import { logEvent } from '@/lib/userlog';
import { useLocale } from '@/lib/i18n';
import {
  isSeEnabled,
  setSeEnabled,
  getBgmTrack,
  setBgmTrack,
  type BgmTrack,
} from '@/lib/sound';

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

// 右側の歯車ボタン。押すと各種設定メニュー（言語切替・ニックネーム変更・ログアウト）が出る。
export default function SettingsMenu({ name, role, onEditNickname, onSignedOut }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { lang, setLang, t } = useLocale();

  // サウンド設定（localStorage 永続化）。初期値は描画後に同期する（SSR/水和対策）。
  const [seOn, setSeOn] = useState(true);
  const [bgmTrack, setTrack] = useState<BgmTrack>(0);
  useEffect(() => {
    setSeOn(isSeEnabled());
    setTrack(getBgmTrack());
  }, []);
  const toggleSe = () => {
    const next = !seOn;
    setSeOn(next);
    setSeEnabled(next);
  };
  const selectBgm = (track: BgmTrack) => {
    setTrack(track);
    setBgmTrack(track); // クリック=ユーザー操作なので、曲選択で即再生開始
  };
  // BGM 選択肢（OFF＋曲3つ）。
  const bgmOptions: { value: BgmTrack; label: string }[] = [
    { value: 0, label: t('bgmOff') },
    { value: 1, label: t('bgmSong1') },
    { value: 2, label: t('bgmSong2') },
    { value: 3, label: t('bgmSong3') },
  ];

  // role の値 → 画面に出すラベル（言語に追従）。
  const roleLabel = (r?: string | null): string =>
    r === 'developer' ? t('roleDeveloper') : t('roleUser');

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
        aria-label={t('settings')}
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
            <p className="text-xs text-gray-400">{t('loggedIn')}</p>
            <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t('role')}：{roleLabel(role)}</p>
          </div>
          {/* 言語切替（日本語 / English） */}
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-xs text-gray-400 mb-1.5">{t('language')}</p>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setLang('ja')}
                aria-pressed={lang === 'ja'}
                className={`flex-1 py-1.5 transition-colors ${
                  lang === 'ja'
                    ? 'bg-blue-500 text-white font-medium'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                日本語
              </button>
              <button
                type="button"
                onClick={() => setLang('en')}
                aria-pressed={lang === 'en'}
                className={`flex-1 py-1.5 transition-colors ${
                  lang === 'en'
                    ? 'bg-blue-500 text-white font-medium'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                English
              </button>
            </div>
          </div>
          {/* サウンド（効果音 / BGM） */}
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-xs text-gray-400 mb-1.5">{t('sound')}</p>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={toggleSe}
                aria-pressed={seOn}
                className="flex items-center justify-between text-sm text-gray-700"
              >
                <span>{t('soundEffects')}</span>
                <span
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    seOn ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      seOn ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>
              <div>
                <p className="text-sm text-gray-700 mb-1">{t('bgm')}</p>
                <div className="grid grid-cols-2 gap-1">
                  {bgmOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => selectBgm(opt.value)}
                      aria-pressed={bgmTrack === opt.value}
                      className={`py-1 rounded-lg text-sm transition-colors ${
                        bgmTrack === opt.value
                          ? 'bg-blue-500 text-white font-medium'
                          : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              onEditNickname();
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t('editNickname')}
          </button>
          {/* 開発者のみ：地図とは別の管理画面へ */}
          {role === 'developer' && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {t('adminPanel')}
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            {t('logout')}
          </button>
        </div>
      )}
    </div>
  );
}
