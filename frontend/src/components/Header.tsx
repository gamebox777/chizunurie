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

  return (
    <>
      <header className="h-12 bg-white shadow-sm flex items-center px-4 z-10 shrink-0 gap-4">
        <h1 className="text-base font-bold text-gray-800 shrink-0">{t('appTitle')}</h1>
        <span className="flex-1 text-sm text-gray-600 truncate min-w-0" title={hoverAddress}>
          {hoverAddress}
        </span>

        <ShareButton />

        {!isPending && (
          session ? (
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

      {modal && (
        <AuthModal initialTab={modal} onClose={() => setModal(null)} />
      )}

      {/* ニックネーム未設定（Google ログイン等）なら入力を促す */}
      {!isPending && session && !session.user.name && (
        <NicknameModal onDone={() => refetch()} />
      )}

      {/* 設定からのニックネーム変更 */}
      {editingNickname && session && (
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
