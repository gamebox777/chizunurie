// JST（Asia/Tokyo）の "YYYY-MM-DD" を返す。サイトアクセス集計（site_visits）の
// 日付キーや、管理画面の「今日」判定に使う。UTC に +9h して日付部分を取り出す。
export function jstDateKey(at: number = Date.now()): string {
  return new Date(at + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
