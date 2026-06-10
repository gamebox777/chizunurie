import type { MetadataRoute } from "next";

const SITE_URL = "https://chizunurie.gamebox777.org";

// 公開ページの一覧（クローラ向け）。情報ページを追加したらここにも足す。
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/about",
    "/how-to-play",
    "/news",
    "/columns",
    "/columns/mesh-1km",
    "/columns/walking-tips",
    "/privacy",
    "/contact",
    "/delete-account",
  ];
  return paths.map((p) => ({
    url: `${SITE_URL}${p}`,
    changeFrequency: p === "/" || p === "/news" ? "weekly" : "monthly",
    priority: p === "/" ? 1 : 0.6,
  }));
}
