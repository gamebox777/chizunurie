// 起動時に DB マイグレーション（drizzle/ の SQL）を適用する。
// docker-entrypoint.sh から `node dist/migrate.js` で server 起動の前に実行する。
// drizzle-kit ではなく drizzle-orm の migrator を使うので、実行時に必要なのは
// コンパイル済みの drizzle/ フォルダだけ（schema のソースや drizzle-kit は不要）。
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
const url = process.env.DATABASE_URL;
if (!url) {
    console.error("[migrate] DATABASE_URL が設定されていません");
    process.exit(1);
}
// migrate 専用の接続（max:1 推奨）。完了したら必ず閉じる。
const client = postgres(url, { max: 1 });
const db = drizzle(client);
try {
    console.log("[migrate] マイグレーションを適用します...");
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[migrate] 完了");
}
catch (err) {
    console.error("[migrate] 失敗:", err);
    process.exit(1);
}
finally {
    await client.end();
}
