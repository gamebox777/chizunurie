import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";

const GA_MEASUREMENT_ID = "G-CLKCJXR6CN";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://chizunurie.gamebox777.org";
const SITE_NAME = "ちずぬりえ";
const SITE_DESC = "歩いた街が色になる、GPS白地図ぬりつぶしゲーム";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "地図ぬりえ",
  description: SITE_DESC,
  icons: {
    icon: "/promo/icon.png",
    apple: "/promo/icon.png",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "ちずぬりえ｜歩いて、塗る。",
    description: SITE_DESC,
    locale: "ja_JP",
    images: [{ url: "/promo/promo-ogp.png", width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ちずぬりえ｜歩いて、塗る。",
    description: SITE_DESC,
    images: ["/promo/promo-ogp.png"],
  },
  // AdSense サイト所有権の確認用メタタグ
  other: {
    "google-adsense-account": "ca-pub-3466778617044617",
  },
};

// GPT のリワード広告は「モバイル最適化ページ（ズーム中立）」でのみ配信されるため、
// viewport を明示しておく（Next のデフォルトと同値だが要件として固定する）。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Google tag (gtag.js) */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
