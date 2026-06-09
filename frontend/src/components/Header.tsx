'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { useLocale } from '@/lib/i18n';
import AuthModal from './AuthModal';
import NicknameModal from './NicknameModal';
import SettingsMenu from './SettingsMenu';
import ShareButton from './ShareButton';

type ModalTab = 'login' | 'register';

type HeaderProps = {
  hoverAddress?: string;
};

export default function Header({ hoverAddress = '' }: HeaderProps) {
  const { data: session, isPending, refetch } = useSession();
  const { t } = useLocale();
  const [modal, setModal] = useState<ModalTab | null>(null);
  const [editingNickname, setEditingNickname] = useState(false);
  const [guestNoticeDismissed, setGuestNoticeDismissed] = useState(false);

  // 匿名（ゲスト）セッションは「ログイン済み」ではなく未ログイン扱いにする：
  // ヘッダーはログイン/新規登録ボタンを出し、ニックネーム入力も促さない。
  const realUser = !!session && !session.user.isAnonymous;
  const isGuest = !!session && !!session.user.isAnonymous;

  return (
    <>
      <header className="h-12 bg-white shadow-sm flex items-center px-4 z-10 shrink-0 gap-4">
        <h1 className="text-base font-bold text-gray-800 shrink-0">{t('appTitle')}</h1>
        <span className="flex-1 text-sm text-gray-600 truncate min-w-0" title={hoverAddress}>
          {hoverAddress}
        </span>

        <ShareButton />

        {!isPending && (
          realUser ? (
            // 本名・メールは表示しない。ニックネームのみ表示する。
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-medium text-gray-700">
                {session.user.name}
              </span>
              <SettingsMenu
                name={session.user.name}
                role={session.user.role}
                onEditNickname={() => setEditingNickname(true)}
                onSignedOut={() => refetch()}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setModal('login')}
                className="text-sm text-gray-600 hover:text-gray-800 transition-colors px-2 py-1"
              >
                {t('login')}
              </button>
              <button
                onClick={() => setModal('register')}
                className="text-sm bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 transition-colors"
              >
                {t('register')}
              </button>
            </div>
          )
        )}
      </header>

      {/* ゲスト（匿名）で塗っている間は、本登録/ログインを促すバナーを出す。 */}
      {!isPending && isGuest && !guestNoticeDismissed && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-3 shrink-0">
          <span className="flex-1 text-sm text-amber-900 min-w-0">
            {t('guestNotice')}
          </span>
          <button
            onClick={() => setModal('register')}
            className="text-sm bg-blue-500 text-white px-3 py-1 rounded-lg hover:bg-blue-600 transition-colors shrink-0"
          >
            {t('register')}
          </button>
          <button
            onClick={() => setModal('login')}
            className="text-sm text-amber-900 hover:text-amber-700 transition-colors px-2 py-1 shrink-0"
          >
            {t('login')}
          </button>
          <button
            onClick={() => setGuestNoticeDismissed(true)}
            aria-label={t('close')}
            className="text-amber-700 hover:text-amber-900 transition-colors px-1 shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {modal && (
        <AuthModal initialTab={modal} onClose={() => setModal(null)} />
      )}

      {/* ニックネーム未設定（Google ログイン等）なら入力を促す。ゲストには出さない。 */}
      {!isPending && realUser && !session.user.name && (
        <NicknameModal onDone={() => refetch()} />
      )}

      {/* 設定からのニックネーム変更 */}
      {editingNickname && realUser && (
        <NicknameModal
          initialName={session.user.name}
          onClose={() => setEditingNickname(false)}
          onDone={() => {
            setEditingNickname(false);
            refetch();
          }}
        />
      )}
    </>
  );
}
