'use client';

import dynamic from 'next/dynamic';
import Header from '@/components/Header';

const Map = dynamic(() => import('@/components/Map'), { ssr: false });

export default function Home() {
  return (
    <div className="flex flex-col" style={{ height: '100dvh' }}>
      <Header />
      <div className="flex-1 overflow-hidden">
        <Map />
      </div>
    </div>
  );
}
