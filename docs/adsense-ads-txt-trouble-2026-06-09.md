# AdSense ads.txt 認識不可トラブル対応記録（2026-06-09）

## 1. 最初の症状

Google AdSense が `gamebox777.org` の **ads.txt を認識しない**。サイト所有権の確認が通らない。

## 2. 調査の経緯（何を疑い、何が分かったか）

### 2-1. クローラーをブロックしていないか（プロジェクト側）

`chizunurie` リポジトリを確認した結果、クローラーを弾く設定は一切なかった。

| チェック項目 | 結果 |
|---|---|
| `ads.txt` の場所 | `frontend/public/ads.txt` ✓ 本番では `https://ドメイン/ads.txt` で配信される |
| `ads.txt` の中身 | `google.com, pub-3466778617044617, DIRECT, f08c47fec0942fa0` ✓ 形式正しい |
| `robots.txt` | 存在しない → Googlebot を弾く設定ゼロ |
| middleware | 存在しない → リクエストを遮断する箇所なし |
| Service Worker (`sw.js`) | ads.txt 認識には無関係（クローラーは JS/SW を実行せず HTTP で直接取得するだけ） |

※ なお Next.js 製のため、WordPress 向けの「キャッシュプラグイン・.htaccess・robots.txt」系の一般的アドバイスは該当しなかった。

### 2-2. 実ドメインの配信確認 → サーバーダウンが発覚

`gamebox777.org` を実際に叩いて切り分けた。

| URL | 結果 | 意味 |
|---|---|---|
| `/ads.txt` | 200 | （後述：実は Cloudflare Worker が返していた） |
| `/robots.txt` | **522** ×3回連続 | オリジン到達不可 |
| `/`（トップ） | **522**（0.1秒で即エラー） | オリジン到達不可 |
| 存在しない適当なパス | **522** | オリジン到達不可 |

**522 = Cloudflare がオリジンサーバーに接続できないエラー**。ブラウザでも「Connection timed out / Error 522（Host: Error）」を確認。

→ ads.txt の中身・場所・形式・robots 設定はすべて正しく、**問題はサーバー（オリジン）側にあると判明**。Google は ads.txt 取得前に robots.txt を見るため、robots.txt が 522（5xx）だとクロール自体を見送る。

### 2-3. サーバー（Oracle Cloud VPS）内の切り分け

SSH でログインして調査。

```bash
# コンテナ稼働状況 → frontend / backend / coolify-proxy すべて Up
docker ps -a | grep -E 'coolify-proxy|chizunurie'

# ポート → 80/443 ともに listen 済み
ss -tlnp | grep -E ':(80|443)\b'

# ローカルからの応答 → http=404 / https=503（Traefik が返す）
curl -I http://localhost
curl -kI https://localhost

# iptables → ルール 6,7 で 80/443 を ACCEPT（弾いていない）
sudo iptables -L INPUT -n --line-numbers

# 公開IP → 158.179.190.166（Cloudflare のオリジンIPと一致）
curl -4 ifconfig.me
```

判明した事実：

- コンテナ・Traefik・ポート・iptables・公開IP **すべて正常**。
- しかし Host 付きで叩いても Traefik が **503**（`curl -H "Host: gamebox777.org" https://localhost` → 503）。
- 503 の意味＝「ルーターはあるが振り分け先（健全なバックエンド）が無い」。

### 2-4. Cloudflare Worker の発見（ads.txt が 200 だった理由）

Cloudflare に **`apex-ads-txt` という Worker** があり、ルートが `gamebox777.org/ads.txt`。
→ **`/ads.txt` だけは Worker がエッジで直接返していた**ため、サーバーが落ちていても常に 200 だった。
（このWorkerは障害の原因ではなく、ads.txt 配信は独立して正常。）

### 2-5. 503 の真因 = Traefik のルーティング設定ミス

frontend コンテナのラベルを確認：

```bash
docker inspect frontend-... -f '{{json .Config.Labels}}' | tr ',' '\n' | grep -i traefik
```

結果、Traefik のルーティングが **`chizunurie.gamebox777.org`（サブドメイン）だけ**に設定されていた：

```
rule = Host(`chizunurie.gamebox777.org`) && PathPrefix(`/`)
```

→ **素の `gamebox777.org`（apex）に対するルーターが存在しない**ため、apex に来たリクエストは振り分け先が無く 503/522 になっていた。

- アプリ自体は健全：frontend コンテナに直接 `http://10.0.15.5:3000/` で叩くと **200 OK**、Next.js も `Ready`。
- frontend と traefik は同じ Docker ネットワーク（`rkk084s8oo8scssk84wowwc0`）に所属。到達経路もある。
- 単に「apex ドメインを受ける設定が無い」だけだった。

## 3. 方針の確定

ユーザー確認の結果：

- **本番サイトは `https://chizunurie.gamebox777.org/`（サブドメイン）**。
- ただし AdSense の仕様上、**ads.txt はルートドメイン `gamebox777.org/ads.txt` に置く必要がある**（サブドメインの広告でも ads.txt はルートを見に行く）。これは既に Worker で配信済み＝正しい。

→ apex 本体にアプリを置く必要はない。**apex の 522 を消すため、Cloudflare 側で apex → サブドメインへリダイレクト**するのが正解。ただし `/ads.txt` は Worker に残すため除外する。

## 4. 実施した対応（Cloudflare Redirect Rule）

Cloudflare ダッシュボード（アカウント: rin7studio@gmail.com / ゾーン: gamebox777.org）の
**Rules → Redirect Rules** で対応。

既に無効状態の逆ロジックのルール（「apex ads.txt redirect」＝ `/ads.txt` だけを転送する誤設定）が存在したので、**それを正しいロジックに書き換えて有効化**した。

**ルール名:** `apex to chizunurie (except ads.txt)`

- **条件（マッチング式）:**
  ```
  (http.host eq "gamebox777.org" and http.request.uri.path ne "/ads.txt")
  ```
- **アクション:** 動的リダイレクト
  ```
  concat("https://chizunurie.gamebox777.org", http.request.uri.path)
  ```
- **ステータスコード:** 301（Permanent Redirect）
- **クエリ文字列を保存する:** ON
- **状態:** アクティブ（有効化済み）

意図：apex に来た全リクエストをパス・クエリを保ったままサブドメインへ 301 転送。ただし `/ads.txt` だけは除外し、Worker が 200 で返し続ける。

## 5. 検証結果（実地確認）

| URL | 結果 |
|---|---|
| `gamebox777.org/ads.txt` | リダイレクトされず **200**・中身も正しい（Worker 配信、意図どおり） |
| `gamebox777.org/robots.txt` | `chizunurie.gamebox777.org/robots.txt` へ **301**（522 解消） |
| `gamebox777.org/`（トップ） | `chizunurie.gamebox777.org/` へ **301**（アプリ表示） |

→ apex の 522 が解消。Google が robots.txt でエラーに当たらなくなり、`gamebox777.org/ads.txt` を取得できる状態になった。

さらに AdSense クローラーの到達も確認（VPS から各 UA でテスト）：

```bash
for ua in "Mediapartners-Google" "AdsBot-Google" "Google-Site-Verification/1.0"; do
  curl -s -A "$ua" -o /dev/null -w "HTTP %{http_code}\n" https://gamebox777.org/ads.txt
done
```

→ **全UAで HTTP 200 ＋正しい中身**。Cloudflare の Bot 対策などで弾かれている可能性は無し。

## 6. 現状と残タスク

- 設定・配信・クローラー到達はすべて正常。
- AdSense の「確認」がまだ通らないのは **Google の再クロール待ち（タイミング）**。ads.txt 検出はリアルタイムではなく、数時間〜24時間以上かかることがある。直前まで長時間 522 だったため、Google には古い失敗が残っている。

### 次にやること

1. **「確認」を連打しない**（直後の失敗を繰り返してもクロールは早まらない）。
2. **翌日（2026-06-10 以降）に AdSense で「確認」を一度押す** → 所有権確認は通る見込み。
3. 通ったら **コンテンツ審査（要審査）** に進む。
   - 注意：AdSense 登録サイトは `gamebox777.org` だが、実コンテンツは `chizunurie.gamebox777.org`（apex は現在リダイレクト）。
   - 所有権確認（ads.txt）はこれで問題なく通るが、コンテンツ審査では「中身のあるサイト」を見せる必要がある。審査で止まる場合は、登録サイトをサブドメイン `chizunurie.gamebox777.org` に切り替える方が素直。

### 補足（将来用）

- 今回の Redirect Rule は 301（恒久）なので、ブラウザが強くキャッシュする。将来 `gamebox777.org` を別サイトにしたくなったら、このルールを無効化＋キャッシュクリアが必要。
- Traefik 側で apex を受けたい場合の本来の直し方は、Coolify の対象アプリの「Domains」に `gamebox777.org` を追加して Redeploy（今回はその方針は採らず、Cloudflare リダイレクトで対応）。

---

## 付録：用語・原因のまとめ

- **Cloudflare 522** = Cloudflare はオリジンサーバーへ接続を試みたが TCP 接続が完了せずタイムアウト。「箱（VPS）が生きている」ことと「Web 層がリクエストを受けられる」ことは別問題。
- **Traefik 503** = ルーター（ドメイン受け）はあるが、振り分け先サービスに健全なサーバーが無い。今回は apex 用のルーター自体が無かった（サブドメインのみ設定）ことが根本原因。
- **ads.txt が 200 だった理由** = Cloudflare Worker `apex-ads-txt`（ルート `gamebox777.org/ads.txt`）がエッジで直接配信していたため、オリジン障害と無関係に 200 を返していた。
