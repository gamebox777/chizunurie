'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import Header from '@/components/Header';
import SiteFooter from '@/components/SiteFooter';
import { signIn, useSession } from '@/lib/auth-client';
import { logEvent, recordAccess } from '@/lib/userlog';

const Map = dynamic(() => import('@/components/Map'), { ssr: false });

export default function Home() {
  // ページ表示につき1回、サイトアクセス数をカウントする（未ログインも数える）。
  const recordedAccess = useRef(false);
  useEffect(() => {
    if (recordedAccess.current) return;
    recordedAccess.current = true;
    recordAccess();
  }, []);

  const { data: session, isPending, refetch } = useSession();

  // セッションが無ければ匿名（ゲスト）セッションを発行する。これでログインせずとも
  // となり塗りを DB に保存できる。本登録/ログインすると塗り・ポイントは本ユーザーへ移行される。
  // ログアウトで session が null に戻った時も、再びゲストセッションを張り直す。
  // anonInFlight は二重発行（→ゴミ匿名ユーザー）防止。session 確定で false に戻す。
  const anonInFlight = useRef(false);
  useEffect(() => {
    if (isPending) return;
    if (session) {
      anonInFlight.current = false;
      return;
    }
    if (anonInFlight.current) return;
    anonInFlight.current = true;
    (async () => {
      try {
        await signIn.anonymous();
        refetch?.();
      } catch {
        // 失敗時はフラグを戻す（deps が変わらない限り再発火しないのでループしない）
        anonInFlight.current = false;
      }
    })();
  }, [isPending, session, refetch]);

  // ページ起動につき1回、本ログインのセッションがあれば session_start を記録する
  // （Google ログイン後のコールバック復帰もここで拾う）。匿名ゲストは記録しない。
  const loggedSessionStart = useRef(false);
  useEffect(() => {
    if (session?.user && !session.user.isAnonymous && !loggedSessionStart.current) {
      loggedSessionStart.current = true;
      logEvent('session_start');
    }
  }, [session]);

  return (
    <div className="flex flex-col" style={{ height: '100dvh' }}>
      <Header />
      <div className="flex-1 overflow-hidden">
        <Map />
      </div>
      {/* 情報ページへのリンク（クローラ導線・AdSense のコンテンツ要件対応） */}
      <SiteFooter variant="bar" />
    </div>
  );
}
