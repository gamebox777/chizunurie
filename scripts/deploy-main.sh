#!/usr/bin/env bash
#
# develop を main にマージして push し、develop に戻る（本番再デプロイ用）。
# 使い方: プロジェクトルートで `npm run deploy`（または `bash scripts/deploy-main.sh`）。
#
# 安全のため：
# - どこかで失敗したら即停止（set -euo pipefail）
# - 未コミットの変更があれば中断（取りこぼし防止）
# - 元いたブランチを覚えておき、最後に必ずそこへ戻る（develop 以外で実行しても戻れる）
set -euo pipefail

SRC_BRANCH="develop"   # マージ元（作業ブランチ）
DST_BRANCH="main"      # マージ先（本番ブランチ）
REMOTE="origin"

# リポジトリのルートへ移動（どこから実行しても動くように）
cd "$(git rev-parse --show-toplevel)"

# 戻り先ブランチを記録し、終了時に必ず戻る
ORIG_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
restore_branch() {
  local current
  current="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$current" != "$ORIG_BRANCH" ]; then
    echo "→ 元のブランチ ($ORIG_BRANCH) に戻ります"
    git checkout "$ORIG_BRANCH"
  fi
}
trap restore_branch EXIT

# 未コミットの変更があると merge/checkout で事故るので中断
if ! git diff-index --quiet HEAD --; then
  echo "✗ 未コミットの変更があります。コミットまたは stash してから実行してください。" >&2
  exit 1
fi

echo "→ 最新を取得 (git fetch $REMOTE)"
git fetch "$REMOTE"

echo "→ $SRC_BRANCH を最新化"
git checkout "$SRC_BRANCH"
git pull --ff-only "$REMOTE" "$SRC_BRANCH"

echo "→ $DST_BRANCH に $SRC_BRANCH をマージ"
git checkout "$DST_BRANCH"
git pull --ff-only "$REMOTE" "$DST_BRANCH"
git merge --no-edit "$SRC_BRANCH"

echo "→ $DST_BRANCH を push"
git push "$REMOTE" "$DST_BRANCH"

echo "✓ push 完了。次の順番で本番反映されます："
echo "  1) GitHub Actions がイメージをビルドして ghcr.io に push（数分）"
echo "     → https://github.com/gamebox777/chizunurie/actions"
echo "  2) 完了後に Coolify で Deploy（webhook 設定済みなら自動）"
echo "  ※ Coolify の Auto Deploy は OFF にしておくこと（push直後だと旧イメージを掴むため）"
