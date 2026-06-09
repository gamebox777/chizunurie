'use client';

import { useState } from 'react';
import { useLocale } from '@/lib/i18n';

const SHARE_URL = 'https://chizunurie.gamebox777.org/';

// X のインテント（投稿画面を別タブで開く。画像はURLのOGPカードで表示される）
function openXIntent(text: string) {
  const intent = new URL('https://twitter.com/intent/tweet');
  intent.searchParams.set('text', text);
  intent.searchParams.set('url', SHARE_URL);
  intent.searchParams.set('hashtags', 'ちずぬりえ,個人開発');
  window.open(intent.toString(), '_blank', 'noopener,noreferrer');
}

// 左下パネル内に並べる共有アイコン（X・Instagram・LINE・リンクコピー）。
// パネルの折りたたみと一緒に開閉される。
export default function ShareIcons() {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  // ネイティブ共有シート（Web Share API）は使わず、必ずブラウザの別タブで開く。
  const handleShareX = () => {
    openXIntent(t('shareText'));
  };

  const handleShareLine = () => {
    const url = new URL('https://social-plugins.line.me/lineit/share');
    url.searchParams.set('url', SHARE_URL);
    url.searchParams.set('text', t('shareText'));
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  };

  const handleShareInstagram = async () => {
    // Instagram には文言を渡せる Web 共有 URL が無いため、共有文＋リンクを
    // クリップボードにコピーしてから Instagram を別タブで開く（貼り付けて投稿）。
    try {
      await navigator.clipboard.writeText(`${t('shareText')} ${SHARE_URL}`);
    } catch {
      /* コピー失敗は無視 */
    }
    window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(t('copyLink'), SHARE_URL);
    }
  };

  const btnClass =
    'flex items-center justify-center w-8 h-8 rounded-lg transition-colors';

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleShareX}
        aria-label={t('shareOnX')}
        title={t('shareOnX')}
        className={`${btnClass} bg-black text-white hover:bg-gray-800`}
      >
        {/* X (Twitter) ロゴ */}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleShareInstagram}
        aria-label="Instagram"
        title="Instagram"
        className={`${btnClass} text-white bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 hover:opacity-90`}
      >
        {/* Instagram ロゴ */}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleShareLine}
        aria-label="LINE"
        title="LINE"
        className={`${btnClass} text-white bg-[#06C755] hover:opacity-90`}
      >
        {/* LINE ロゴ */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M12 3C6.48 3 2 6.69 2 11.23c0 4.07 3.55 7.48 8.35 8.13.32.07.77.21.88.49.1.25.06.64.03.9l-.14.85c-.04.25-.2.99.87.54 1.07-.45 5.76-3.39 7.86-5.81C21.36 14.6 22 12.99 22 11.23 22 6.69 17.52 3 12 3zM8.13 13.62H6.14c-.29 0-.52-.23-.52-.52V9.13c0-.29.23-.52.52-.52.29 0 .52.23.52.52v3.45h1.47c.29 0 .52.23.52.52s-.23.52-.51.5zm2.04-.52c0 .29-.23.52-.52.52s-.52-.23-.52-.52V9.13c0-.29.23-.52.52-.52s.52.23.52.52v3.97zm4.69 0c0 .22-.14.42-.36.49-.05.02-.11.03-.16.03-.16 0-.32-.08-.42-.21l-2.04-2.78v2.47c0 .29-.23.52-.52.52s-.52-.23-.52-.52V9.13c0-.22.14-.42.36-.49.05-.02.11-.02.16-.02.16 0 .32.08.42.21l2.04 2.78V9.13c0-.29.23-.52.52-.52s.52.23.52.52v3.97zm3.32-2.51c.29 0 .52.23.52.52s-.23.52-.52.52h-1.47v.95h1.47c.29 0 .52.23.52.52s-.23.51-.52.51h-1.99c-.29 0-.52-.23-.52-.52V9.13c0-.29.23-.52.52-.52h1.99c.29 0 .52.23.52.52s-.23.52-.52.52h-1.47v.95h1.47z" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? t('linkCopied') : t('copyLink')}
        title={copied ? t('linkCopied') : t('copyLink')}
        className={`${btnClass} bg-gray-100 text-gray-700 hover:bg-gray-200`}
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
