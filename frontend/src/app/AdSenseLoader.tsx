"use client";

// Google AdSense（自動広告）スクリプトのローダー。
//
// ネイティブアプリ（mobile/ の Capacitor WebView）内では読み込まない：
// アプリ内 WebView への AdSense 配信はポリシー違反（アプリは AdMob/Unity Ads の領分）で、
// しかも capacitor.config.ts が UA から "; wv" を消しているため通常ブラウザに見えてしまい
// 無効トラフィック判定のリスクがある。window.Capacitor の有無はマウント後にしか分からない
// ので、いったん null を返してから非アプリと確定したときだけ <Script> を描画する。
//
// ローカル開発（localhost）でも読み込むが、AdSense は承認済みドメインにしか実広告を
// 配信しないため、ローカルでは空枠 or 未表示になることがある（エラーではない）。
//
// 配信の ON/OFF は管理画面の Web 広告設定で制御する：全体設定（app_settings.webAds.autoEnabled）
// ＋ユーザー個別の上書き（user.ad_settings.auto・個別＞全体）。実効値はサーバー
// （/api/backend/user/me/ads）が解決し、OFF ならスクリプト自体を読み込まない。
// 以前あった「開発者アカウント（role=developer）には読み込まない」特別扱いは廃止した。
// 自分の閲覧で広告を出したくない場合は、管理画面で自分のユーザーの個別設定を OFF にする。

import { useEffect, useState } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { isNativeApp } from "@/lib/platform";
import { getMyWebAds } from "@/lib/webAds";

const ADSENSE_CLIENT = "ca-pub-3466778617044617";

export default function AdSenseLoader() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (isNativeApp()) return;
    // 管理画面（/admin から始まるパス）では広告は絶対に表示しない
    if (pathname && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
      setEnabled(false);
      return;
    }
    let cancelled = false;
    // 実効設定（全体＋個別・取得失敗時は ON）を確認してから読み込む。
    getMyWebAds().then((ads) => {
      if (!cancelled && ads.auto) setEnabled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (pathname && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    return null;
  }

  if (!enabled) return null;
  return (
    <Script
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      strategy="afterInteractive"
      crossOrigin="anonymous"
    />
  );
}
