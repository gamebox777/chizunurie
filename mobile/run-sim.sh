#!/usr/bin/env bash
#
# iOS シミュレータでアプリをビルド→インストール→起動する（PC で動作確認する用）。
# Android の run-emu.sh / `npm run play` の iOS 版。開く先（本番サイト or ローカル Web）は
# 起動時のコマンドで選ぶ：
#
#   npm run sim        本番サイト（https://chizunurie.unitygamebox.com）を開く
#   npm run sim:dev    ローカル Web（http://localhost:3000）を開く
#                      ※ 別ターミナルで先に `npm run dev`（or dev:frontend）を起動しておくこと。
#                        iOS シミュレータはホストの localhost にそのまま到達できる（adb reverse 不要）。
#
# 前提:
#   - Xcode 本体が選択済み（`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`）
#   - iOS シミュレータのプラットフォーム導入済み（`xcodebuild -downloadPlatform iOS`）
#   - CocoaPods は Homebrew 版（`brew install cocoapods`。システムの /usr/local/bin/pod は
#     Apple Silicon で壊れているため、下で PATH を /opt/homebrew/bin 優先にしている）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:$PATH"

SCHEME="App"
BUNDLE_ID="jp.chizunurie.app"
DEV_MODE="${CAP_DEV:-}"

# 1) capacitor.config の server.url を native へ焼き込む（CAP_DEV=1 なら localhost:3000）。
echo "→ cap sync ios（CAP_DEV=${DEV_MODE:-0}）"
( cd "$ROOT" && npx cap sync ios )

# 2) 起動するシミュレータを決める：Booted があればそれ、無ければ利用可能な iPhone を起動する。
DEV="$(xcrun simctl list devices booted | grep -Eo '[0-9A-Fa-f-]{36}' | head -1 || true)"
if [ -z "${DEV:-}" ]; then
  DEV="$(xcrun simctl list devices available | grep -E 'iPhone' | grep -Eo '[0-9A-Fa-f-]{36}' | head -1)"
  echo "→ シミュレータを起動: $DEV"
  xcrun simctl boot "$DEV"
fi
open -a Simulator
xcrun simctl bootstatus "$DEV" -b >/dev/null

# 3) ビルド（署名不要・出力先を ios/App/build に固定＝ios/.gitignore で除外済み）。
echo "→ ビルド"
( cd "$ROOT/ios/App" && xcodebuild \
    -workspace App.xcworkspace -scheme "$SCHEME" -configuration Debug \
    -destination "id=$DEV" -derivedDataPath build \
    CODE_SIGNING_ALLOWED=NO build )

APP="$ROOT/ios/App/build/Build/Products/Debug-iphonesimulator/App.app"

# 4) インストール→（起動中なら一旦終了して）起動。
echo "→ インストール＆起動"
xcrun simctl install "$DEV" "$APP"
xcrun simctl terminate "$DEV" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl launch "$DEV" "$BUNDLE_ID"

if [ "${DEV_MODE:-}" = "1" ] || [ "${DEV_MODE:-}" = "true" ]; then
  echo "✓ 起動しました（ローカル Web: http://localhost:3000 を表示）"
else
  echo "✓ 起動しました（本番サイト: https://chizunurie.unitygamebox.com を表示）"
fi
