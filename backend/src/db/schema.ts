import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ── better-auth が管理するテーブル ────────────────────────────
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Google ログイン時に取得できた本名（プロフィール名）。ニックネーム(name)とは別管理。
  // ゲーム画面には一切表示せず、開発者向け管理画面でのみ閲覧する。取得できなければ null。
  realName: text("real_name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // 権限。'user'=一般ユーザー（既定）/ 'developer'=開発者（デバッグメニュー表示）。
  // 新規登録時は必ず 'user'。開発者にするには DB で手動で 'developer' に変更する。
  role: text("role").notNull().default("user"),
  // GPS で取得した現在地から判定した所在国（Natural Earth の adm0_a3 コード。日本は "JPN"）。
  // ＝「国籍」的な所在国。初回 GPS 取得時に解決して入れ、別の国へ移動して値が変わったら更新する。
  // 未取得（GPS 前・位置情報不許可）の間は null。管理画面の一覧で表示する。
  country: text("country"),
  // ユーザー設定（効果音・BGM・バイブ・地図オーバーレイ・言語など）を1つの JSON にまとめて保存する。
  // 設定項目は今後増減するため、項目ごとにカラム＝マイグレーションを増やすのを避け jsonb に全部入れる。
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// ── アプリ固有テーブル ─────────────────────────────────────────
export const paintedRegions = pgTable(
  "painted_regions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 'municipalities' | 'chocho'
    sourceLayer: text("source_layer").notNull(),
    // GeoJSON の KEY_CODE（行政コード。PMTiles 再生成後も不変）
    keyCode: text("key_code").notNull(),
    // 塗り方モード: 'gps'（実際に訪問・最優先・黄）/ 'manual'（マウス・隣接・茶）。
    // 表示色はクライアントが mode から決める（COLOR_GPS / COLOR_MANUAL）ので色は保存しない。
    mode: text("mode").notNull().default("manual"),
    // 塗った時点の文脈（INSERT 時のみ書き込む。再POST・GPS昇格では更新しない）。
    // ip/ua はサーバー側で取得。lat/lng はセル中心、municipality は "PREF|CITY"。
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    municipality: text("municipality"),
    // 世界版の塗り％集計用。塗った時点で world-states レイヤーから解決した
    // 州・県コード（Natural Earth の adm1_code）。国は world-stats.json の
    // stateMeta[adm1_code].adm0_a3 から導出する。日本の外を塗った時だけ入る。
    region: text("region"),
    // 塗った国（Natural Earth の adm0_a3 コード。日本は "JPN"）。塗った時点で
    // クライアントが解決して送る。管理画面の塗りログ表示用。
    country: text("country"),
    paintedAt: timestamp("painted_at", { withTimezone: true }).defaultNow(),
    // 直近に GPS で実際に訪れた時刻。再訪（既に gps 済みのセルへ GPS で入り直す）で
    // 経験値を再付与する際のクールダウン判定に使う。訪問のたびに同じ行を上書き更新する
    // ので、訪問履歴で行が増えず DB が肥大化しない（1セル1行のまま）。GPS 塗り／manual→gps
    // 昇格／再訪で now に更新。manual 塗りでは触らない（GPS で訪れた記録ではないため）。
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.userId, t.sourceLayer, t.keyCode)]
);

// 開発者確認用のユーザー行動ログ。塗り以外の主要アクション（ログイン/ログアウト/
// 新規登録/セッション開始/検索/現在地取得）を1アクション1行で記録する。
// 塗りは painted_regions 側に文脈列を持たせ、ここには記録しない（DB負担対策）。
// ip/ua はサーバー側で常時取得。lat/lng/municipality は取得できた時だけ（best-effort）。
export const userLogs = pgTable(
  "user_logs",
  {
    id: serial("id").primaryKey(),
    // 将来の匿名イベント拡張に備えて nullable。今回は常に認証済みユーザー。
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    municipality: text("municipality"),
    // 検索クエリ等の任意付帯情報
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("user_logs_user_created_idx").on(t.userId, t.createdAt)]
);

// 塗りポイント残高＋ユーザーレベル。GPS（実際の移動）は無料だが、それ以外の隣接塗り／
// 離れた場所の塗りは塗りポイントを消費する。ポイントは時間経過で回復する（points.ts 参照）。
// updatedAt は「回復時計のアンカー」。現在値は読み取り時に updatedAt からの経過時間で
// 遅延計算して確定させる（lazy regen）。1ユーザー1行。
//
// level / exp はゲームのレベル概念。塗ると経験値が貯まり、規定値に達するとレベルアップする。
// レベルが上がると塗りポイントの最大値（回復上限）が +1 され、さらにその最大値ぶんポイントが
// 即時加算される。level アップ時の加算で上限を超えた残高は保持される（時間回復では増えない）。
// totalExp は累計獲得経験値（減らない記録用。exp と違いレベルアップで目減りしない）。
// 詳細な計算式は points.ts（maxPointsForLevel / expToNext / addExp）にある。
export const userPoints = pgTable("user_points", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  points: integer("points").notNull().default(10),
  level: integer("level").notNull().default(1),
  exp: integer("exp").notNull().default(0),
  // 累計獲得経験値（これまでに獲得した経験値の総和）。exp は現レベル内の進捗なので
  // レベルアップで目減りするが、こちらは獲得のたびに加算するだけで減らない。
  // レベルアップに必要な経験値が今後のバランス調整で変わっても、この値は記録として残る。
  totalExp: integer("total_exp").notNull().default(0),
  // 合計プレイ時間（秒）。クライアントが約1分ごと／アクション時に経過秒を送って加算する
  // （points.ts の addPlayTime。1回の加算は MAX_HEARTBEAT_DELTA_SEC で上限を設けて不正対策）。
  playTimeSec: integer("play_time_sec").notNull().default(0),
  // ── 動画リワード（動画視聴で「そのレベルの満タン分」を回復）の不正対策メタ ──
  // 直近に動画報酬を受け取った時刻。クールダウン判定に使う（points.ts の VIDEO_REWARD_COOLDOWN_MS）。
  lastVideoRewardAt: timestamp("last_video_reward_at", { withTimezone: true }),
  // 動画報酬を受け取った回数（videoRewardDay の1日内）。日付が変わるとリセットする。
  videoRewardCount: integer("video_reward_count").notNull().default(0),
  // videoRewardCount が属する JST の日付（"YYYY-MM-DD"）。未受領なら null。
  videoRewardDay: text("video_reward_day"),
  // Web の GPT リワードは AdMob のような SSV ポストバックが無く、報酬付与はクライアントの
  // rewardedSlotGranted で判断する。直接POSTの乱用・リプレイを抑えるため、視聴開始時に
  // 1回限りの nonce を発行（rewardNonce）して請求時に照合し、成功したら消す（単回使用）。
  rewardNonce: text("reward_nonce"),
  rewardNonceAt: timestamp("reward_nonce_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
