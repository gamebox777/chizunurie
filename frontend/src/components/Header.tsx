'use client';

import { useState } from 'react';
import { useSession, signOut } from '@/lib/auth-client';
import AuthModal from './AuthModal';

type ModalTab = 'login' | 'register';

type HeaderProps = {
  hoverAddress?: string;
};

export default function Header({ hoverAddress = '' }: HeaderProps) {
  const { data: session, isPending } = useSession();
  const [modal, setModal] = useState<ModalTab | null>(null);

  return (
    <>
      <header className="h-12 bg-white shadow-sm flex items-center px-4 z-10 shrink-0 gap-4">
        <h1 className="text-base font-bold text-gray-800 shrink-0">白地図ゲーム</h1>
        <span className="flex-1 text-sm text-gray-600 truncate min-w-0" title={hoverAddress}>
          {hoverAddress}
        </span>

        {!isPending && (
          session ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 hidden sm:block">
                {session.user.name || session.user.email}
              </span>
              <button
                onClick={() => signOut()}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                ログアウト
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setModal('login')}
                className="text-sm text-gray-600 hover:text-gray-800 transition-colors px-2 py-1"
              >
                ログイン
              </button>
              <button
                onClick={() => setModal('register')}
                className="text-sm bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 transition-colors"
              >
                新規登録
              </button>
            </div>
          )
        )}
      </header>

      {modal && (
        <AuthModal initialTab={modal} onClose={() => setModal(null)} />
      )}
    </>
  );
}
