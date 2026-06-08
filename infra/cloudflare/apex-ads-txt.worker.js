// Cloudflare Worker: apex（gamebox777.org）の /ads.txt を「実体200」で直接返す。
//
// 背景: AdSense の所有権確認は apex gamebox777.org/ads.txt を見にくる。
// apex はアプリ本体を配信していない（サブドメイン chizunurie.gamebox777.org が本体）ため、
// 以前は Cloudflare の Redirect Rule で apex/ads.txt → サブドメインへ 301 していた。
// curl 上は 301→200 で正しく見えるが、AdSense の所有権確認はこの「別ホストへの 301」を
// 通さず「確認できませんでした」になった。そこで apex 自身が 200 で実体を返すようにする。
//
// デプロイ:
//   1. Cloudflare → Workers & Pages → Create Worker → このコードを貼って Deploy。
//   2. Worker の Settings → Triggers → Routes に  gamebox777.org/ads.txt  を追加（Zone: gamebox777.org）。
//   3. 既存の Redirect Rule「apex ads.txt redirect」を無効化 or 削除する。
//      ※ Redirect Rules は Workers より前に評価されるため、残っていると 301 が先に発火して
//        この Worker が呼ばれない。必ず無効化すること。
//   4. apex は Proxied（オレンジクラウド）のまま（AAAA 100:: でOK。オリジンには到達しない）。
//
// 確認:  curl -sI https://gamebox777.org/ads.txt  が 200 / text/plain で 1 行返ればOK。

const ADS_TXT = "google.com, pub-3466778617044617, DIRECT, f08c47fec0942fa0\n";

export default {
  async fetch() {
    return new Response(ADS_TXT, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  },
};
