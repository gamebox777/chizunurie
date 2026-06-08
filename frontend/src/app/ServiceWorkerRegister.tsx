"use client";

import { useEffect } from "react";

// /sw.js を登録するだけのクライアント専用コンポーネント。
// 本番（https）でのみ登録する。dev では SW のキャッシュが邪魔になりやすいので除外。
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 登録失敗は致命的ではないので握りつぶす
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
