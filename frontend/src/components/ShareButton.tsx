'use client';

import { useState } from 'react';
import { useLocale } from '@/lib/i18n';

const SHARE_URL = 'https://chizunurie.gamebox777.org/';
// 共有シートに実ファイルとして添付する宣伝画像（同一オリジン配信）
const SHARE_IMAGE = '/promo/promo-square.png';

// X のインテント（PC・画像はURLのOGPカードで表示される）
function openXIntent(text: string) {
  const intent = new URL('https://twitter.com/intent/tweet');
  intent.searchParams.set('text', text);
  intent.searchParams.set('url', SHARE_URL);
  intent.searchParams.set('hashtags', 'ちずぬりえ,個人開発');
  window.open(intent.toString(), '_blank', 'noopener,noreferrer');
}

export default function ShareButton() {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  const handleShareX = async () => {
    const text = t('shareText');
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData & { files?: File[] }) => boolean;
    };

    // タッチ端末（スマホ/タブレット）だけ共有シートに実画像を添付する。
    // PC は必ず X インテント（投稿画面）を開く → 文言入りですぐ投稿できる。
    const isTouch =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(pointer: coarse)').matches === true;

    if (isTouch) {
      try {
        const res = await fetch(SHARE_IMAGE);
        const blob = await res.blob();
        const file = new File([blob], 'chizunurie.png', { type: blob.type || 'image/png' });
        if (nav.canShare?.({ files: [file] })) {
          // 共有シートが使える端末。キャンセルされても黙って終わる（インテントは開かない）
          try {
            await nav.share({ files: [file], text: `${text}\n${SHARE_URL}` });
          } catch {
            /* ユーザーがキャンセル */
          }
          return;
        }
      } catch {
        // 画像取得に失敗 → インテントにフォールバック
      }
    }

    // PC・非タッチ端末：X インテント（投稿画面が開く・文言＋URL）
    openXIntent(text);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード非対応 → 手動コピー用にプロンプト
      window.prompt(t('copyLink'), SHARE_URL);
    }
  };

  return (
    <div className="shrink-0 flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleShareX}
        aria-label={t('shareOnX')}
        title={t('shareOnX')}
        className="flex items-center justify-center w-8 h-8 rounded-lg bg-black text-white hover:bg-gray-800 transition-colors"
      >
        {/* X (Twitter) ロゴ */}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? t('linkCopied') : t('copyLink')}
        title={copied ? t('linkCopied') : t('copyLink')}
        className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
      >
        {copied ? (
          // チェック（コピー済み）
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          // リンク
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        )}
      </button>
    </div>
  );
}
