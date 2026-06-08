/*
 * ちずぬりえ Service Worker（手書き・最小構成）
 *
 * 目的は「PWAとしてインストール可能にする」こと（= fetch ハンドラの存在が必須）と、
 * オフライン時にトップページの簡易フォールバックを出すこと。
 *
 * 方針：
 *  - ナビゲーション（ページ遷移）は network-first。成功したらキャッシュも更新し、
 *    オフライン時はキャッシュ済みトップを返す。
 *  - 大きい地図タイル（/data 配下の *.pmtiles）・API・認証は SW で一切触らない
 *    （キャッシュすると数十MB単位で膨らむ・認証が壊れるため素通り）。
 *  - それ以外の同一オリジン静的アセットは stale-while-revalidate（高速表示＋裏で更新）。
 *
 *  キャッシュ名に日付/版を付けているので、内容を変えたら CACHE_VERSION を上げること。
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `chizunurie-${CACHE_VERSION}`;
const OFFLINE_URL = "/";

// SW 更新時に即時反映できるようにする
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// SW で触らないリクエストか判定する
function shouldBypass(url) {
  // 別オリジン（GA・AdSense・地理院ジオコーダ等）は触らない
  if (url.origin !== self.location.origin) return true;
  // API / 認証 は触らない
  if (url.pathname.startsWith("/api/")) return true;
  // 大きい地図データ（pmtiles など）は触らない
  if (url.pathname.startsWith("/data/")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (shouldBypass(url)) return; // 既定のネットワーク処理に任せる

  // ページ遷移：network-first → 失敗時キャッシュ → 最後にオフライン用トップ
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          return cached || (await caches.match(OFFLINE_URL)) || Response.error();
        }
      })()
    );
    return;
  }

  // その他の同一オリジン静的アセット：stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })()
  );
});
