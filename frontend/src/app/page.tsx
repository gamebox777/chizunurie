'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import Header from '@/components/Header';
import { useSession } from '@/lib/auth-client';
import { logEvent, recordAccess } from '@/lib/userlog';

const Map = dynamic(() => import('@/components/Map'), { ssr: false });

export default function Home() {
  const [hoverAddress, setHoverAddress] = useState('');

  // ページ表示につき1回、サイトアクセス数をカウントする（未ログインも数える）。
  const recordedAccess = useRef(false);
  useEffect(() => {
    if (recordedAccess.current) return;
    recordedAccess.current = true;
    recordAccess();
  }, []);

  // ページ起動につき1回、セッションがあれば session_start を記録する
  // （Google ログイン後のコールバック復帰もここで拾う）。
  const { data: session } = useSession();
  const loggedSessionStart = useRef(false);
  useEffect(() => {
    if (session?.user && !loggedSessionStart.current) {
      loggedSessionStart.current = true;
      logEvent('session_start');
    }
  }, [session]);

  return (
    <div className="flex flex-col" style={{ height: '100dvh' }}>
      <Header hoverAddress={hoverAddress} />
      <div className="flex-1 overflow-hidden">
        <Map onHoverAddressChange={setHoverAddress} />
      </div>
    </div>
  );
}
