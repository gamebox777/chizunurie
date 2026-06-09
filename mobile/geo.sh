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

# 位置情報権限も念のため付与（未許可だと geolocation が取れない）
"$ADB" shell pm grant jp.chizunurie.app android.permission.ACCESS_FINE_LOCATION 2>/dev/null || true
"$ADB" shell pm grant jp.chizunurie.app android.permission.ACCESS_COARSE_LOCATION 2>/dev/null || true

# adb emu geo fix <経度> <緯度>
"$ADB" emu geo fix "$LON" "$LAT"
echo "✓ 現在地を 緯度=$LAT 経度=$LON に設定しました（GPS塗り・現在地ボタンで反映）"
