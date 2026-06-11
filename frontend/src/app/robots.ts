import type { MetadataRoute } from "next";

const SITE_URL = "https://chizunurie.unitygamebox.com";

// 管理画面はクロール不要。それ以外（地図・情報ページ）は許可する。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
