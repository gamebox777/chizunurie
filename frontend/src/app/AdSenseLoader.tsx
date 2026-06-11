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
// 開発者アカウント（role=developer）にも読み込まない：自分の閲覧で広告を出さない
// （無効トラフィック対策）。session 確定（isPending 解消）を待ってから読み込むため、
// 一般ユーザーも自動広告の開始が session 取得ぶんだけ遅れる。リワード動画
// （displayAd.ts・動作確認用）は開発者でも従来どおり表示される。

import { useEffect, useState } from "react";
import Script from "next/script";
import { isNativeApp } from "@/lib/platform";
import { useSession } from "@/lib/auth-client";

const ADSENSE_CLIENT = "ca-pub-3466778617044617";

export default function AdSenseLoader() {
  const [browser, setBrowser] = useState(false);
  const { data: session, isPending } = useSession();
  const isDeveloper =
    (session?.user as { role?: string } | undefined)?.role === "developer";

  useEffect(() => {
    if (!isNativeApp()) setBrowser(true);
  }, []);

  if (!browser || isPending || isDeveloper) return null;
  return (
    <Script
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      strategy="afterInteractive"
      crossOrigin="anonymous"
    />
  );
}
