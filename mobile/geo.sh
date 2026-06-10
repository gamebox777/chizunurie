#!/usr/bin/env bash
# エミュレータの現在地（GPS）を注入する。引数は「緯度 経度」の順（人間が読みやすい順）。
# 例: bash geo.sh 35.6812 139.7671   # 東京駅
#     bash geo.sh                     # 引数省略時は東京駅
# 注意: adb emu geo fix は内部的に「経度 緯度」の順なので、ここで入れ替えて渡す。
set -e

LAT="${1:-35.6812}"   # 緯度（北緯+）
LON="${2:-139.7671}"  # 経度（東経+）
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"

# 実機(USB)が同時に繋がっていると -s なしの adb は "more than one device" で失敗するため、
# エミュのシリアルを特定して -s で操作する（run-emu.sh と同じ対策）。
SERIAL="$("$ADB" devices | awk '/^emulator-[0-9]+[[:space:]]+device/{print $1; exit}')"
if [ -z "$SERIAL" ]; then
  echo "✗ 起動中のエミュレータが見つかりません（adb devices に emulator-XXXX が無い）" >&2
  exit 1
fi

# 位置情報権限も念のため付与（未許可だと geolocation が取れない）
"$ADB" -s "$SERIAL" shell pm grant jp.chizunurie.app android.permission.ACCESS_FINE_LOCATION 2>/dev/null || true
"$ADB" -s "$SERIAL" shell pm grant jp.chizunurie.app android.permission.ACCESS_COARSE_LOCATION 2>/dev/null || true

# adb emu geo fix <経度> <緯度>
"$ADB" -s "$SERIAL" emu geo fix "$LON" "$LAT"
echo "✓ 現在地を 緯度=$LAT 経度=$LON に設定しました（GPS塗り・現在地ボタンで反映）"
