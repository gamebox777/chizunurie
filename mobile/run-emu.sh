#!/usr/bin/env bash
# エミュレータを起動 → ビルド済みデバッグAPKを入れて起動するまでを一発で行う。
# 使い方: cd mobile && npm run play   （= apk ビルド後にこのスクリプト）
#        または既にAPKがあるなら: bash run-emu.sh
set -e

AVD="chizunurie_pixel"
PKG="jp.chizunurie.app"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMU="$ANDROID_HOME/emulator/emulator"
APK="android/app/build/outputs/apk/debug/app-debug.apk"

# 1) エミュが起動していなければ起動（DNS明示・コールドブートで通信不調を回避）
if ! "$ADB" devices | grep -q "emulator-"; then
  echo "▶ エミュレータ($AVD)を起動中..."
  "$EMU" -avd "$AVD" -no-snapshot -dns-server 8.8.8.8 -gpu auto >/tmp/chizunurie-emu.log 2>&1 &
fi

# 2) ブート完了を待つ
echo "▶ ブート待ち..."
"$ADB" wait-for-device
until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
echo "✓ ブート完了"

# 2.5) 端末の localhost:3000/3001 を「ホストMacの localhost」へ転送（dev用）。
#      dev ビルドは http://localhost:3000 を開く。localhost はセキュアコンテキスト扱いなので
#      http のままでも GPS(geolocation) が使える（10.0.2.2 だと非セキュアでブロックされる）。
#      本番ビルド(https)では使われないので、常に張っておいて無害。
"$ADB" reverse tcp:3000 tcp:3000 >/dev/null 2>&1 || true
"$ADB" reverse tcp:3001 tcp:3001 >/dev/null 2>&1 || true

# 3) APKをインストール（-r で上書き）
echo "▶ APKをインストール..."
"$ADB" install -r "$APK"

# 4) アプリを起動
echo "▶ アプリ起動..."
"$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null
echo "✓ 完了。エミュレータの画面で操作してください。"
