'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Header from '@/components/Header';

const Map = dynamic(() => import('@/components/Map'), { ssr: false });

export default function Home() {
  const [hoverAddress, setHoverAddress] = useState('');

  return (
    <div className="flex flex-col" style={{ height: '100dvh' }}>
      <Header hoverAddress={hoverAddress} />
      <div className="flex-1 overflow-hidden">
        <Map onHoverAddressChange={setHoverAddress} />
      </div>
    </div>
  );
}
