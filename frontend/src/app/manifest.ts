import type { MetadataRoute } from "next";

// PWA マニフェスト。Next.js が /manifest.webmanifest として配信し、
// <link rel="manifest"> も自動で <head> に挿入する。
// アイコンは public/icons/ に置いた 192/512px（元: public/promo/icon.png 1024px）。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ちずぬりえ｜歩いて、塗る。",
    short_name: "ちずぬりえ",
    description: "歩いた街が色になる、GPS白地図ぬりつぶしゲーム",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "ja",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // maskable は付けない：このアイコンは下部に「ちずぬりえ」の文字を入れており、
      // OS のマスク整形（端を約10%切り取る）で文字が欠けるため。purpose: any のみとし、
      // Android では白い角丸コンテナに余白付きで収まる（文字は保持される）。
    ],
  };
}
