# 宣伝・SNS運用メモ

「ちずぬりえ」の宣伝に使う画像と、各SNSでの使い方をまとめる。

- 本番URL: <https://chizunurie.gamebox777.org/>
- アプリ名: ちずぬりえ
- 一言: 歩いた街が色になる、GPS白地図ぬりつぶしゲーム
- キャッチ: **歩いて、塗る。** ／ GPSで日本を"制覇"する

## 生成物（画像アセット）

すべて `frontend/public/promo/` に PNG と SVG で出力される（実プレイ状況ではなく、約4割塗った"デモ"の日本地図）。

| ファイル | サイズ | 用途 |
|---|---|---|
| `promo-square.png` | 1080×1080 | X / Instagram のフィード投稿用 |
| `promo-ogp.png` | 1200×630 | OGP / Twitterカード（URL共有時に展開される画像） |
| `icon.png` | 1024×1024 | SNSプロフィールアイコン（X / Instagram のアバター。円形クロップ前提） |

配色はアプリ実物と同じ：**黄 `#facc15` = GPS塗り / 茶 `#b5652f` = 手動塗り / 金 `#f59e0b` = 制覇**、未踏はスレート。

## 再生成

```bash
# プロジェクトルートで（@resvg/resvg-js が必要・未導入なら npm i @resvg/resvg-js）
node scripts/build-promo-image.mjs
```

差し替えポイントは [scripts/build-promo-image.mjs](../scripts/build-promo-image.mjs)：

- `CONQUER` / `GPS` / `MANUAL` … デモで塗る都道府県（`nam_ja`）。地元中心にする等はここ。
- キャッチコピー・タグラインは各 `build*()` 内の `<text>`。
- `SITE` 定数 … 画像に焼くURL。
- 素材は `frontend/public/data/prefectures.geojson`（47県）を Web Mercator で投影。

## OGP の配線（設定済み）

[frontend/src/app/layout.tsx](../frontend/src/app/layout.tsx) の `metadata` に `metadataBase` / `openGraph` / `twitter` / `icons` を設定済み。
URLを X・LINE・Slack・Discord に貼ると `promo-ogp.png` が展開される。

- 確認: デプロイ後に <https://cards-dev.twitter.com/validator> や各SNSのリンク展開で表示チェック。
- 画像を更新したら、SNS側のOGPキャッシュをクリア（再取得）しないと旧画像が残ることがある。

## 各SNSの推奨サイズ早見表

| 媒体 | 投稿/カード | プロフィール画像 |
|---|---|---|
| X (Twitter) | 16:9 まわり（OGP 1200×630 がそのまま使える） | 400×400（`icon.png` を縮小） |
| Instagram | 正方形 1080×1080（`promo-square.png`） | 320×320 以上（`icon.png`） |
| OGP全般 | 1200×630（`promo-ogp.png`） | — |

## 投稿文・ハッシュタグの叩き台

- 本文例: 「歩いた街が地図上で色になっていく白地図ゲーム『ちずぬりえ』作りました📍🗾 GPSで現在地を塗って、市区町村→都道府県と"制覇"していくやつです。ブラウザですぐ遊べます👉 https://chizunurie.gamebox777.org/ 」
- ハッシュタグ案: `#ちずぬりえ` `#個人開発` `#地図好き` `#散歩` `#位置ゲー` `#白地図`

## 次の一手（未対応）

- ユーザー個別のシェア機能（自分の塗った地図を画像化して共有 → 拡散ループ）。設計メモは別途。
- 動的OGP（共有リンクごとに本人のスタッツ入り画像を生成）。
