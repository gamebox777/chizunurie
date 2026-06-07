import {
  boolean,
  integer,
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
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // 権限。'user'=一般ユーザー（既定）/ 'developer'=開発者（デバッグメニュー表示）。
  // 新規登録時は必ず 'user'。開発者にするには DB で手動で 'developer' に変更する。
  role: text("role").notNull().default("user"),
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
    // 塗り方モード: 'gps'（実際に訪問・最優先・黄）/ 'manual'（マウス・隣接・茶）
    mode: text("mode").notNull().default("manual"),
    color: text("color").notNull().default("#3b82f6"),
    paintedAt: timestamp("painted_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique().on(t.userId, t.sourceLayer, t.keyCode)]
);

// 塗りポイント残高＋ユーザーレベル。GPS（実際の移動）は無料だが、それ以外の隣接塗り／
// 離れた場所の塗りは塗りポイントを消費する。ポイントは時間経過で回復する（points.ts 参照）。
// updatedAt は「回復時計のアンカー」。現在値は読み取り時に updatedAt からの経過時間で
// 遅延計算して確定させる（lazy regen）。1ユーザー1行。
//
// level / exp はゲームのレベル概念。塗ると経験値が貯まり、規定値に達するとレベルアップする。
// レベルが上がると塗りポイントの最大値（回復上限）が +1 され、さらにその最大値ぶんポイントが
// 即時加算される。level アップ時の加算で上限を超えた残高は保持される（時間回復では増えない）。
// 詳細な計算式は points.ts（maxPointsForLevel / expToNext / addExp）にある。
export const userPoints = pgTable("user_points", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  points: integer("points").notNull().default(10),
  level: integer("level").notNull().default(1),
  exp: integer("exp").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
