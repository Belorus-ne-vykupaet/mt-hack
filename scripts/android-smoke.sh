#!/usr/bin/env bash
# Installs the APK on the running emulator, opens the app and checks it through WebView DevTools.
set -euo pipefail
mkdir -p android-smoke
adb install -r transit-hub.apk
adb logcat -c
adb shell am start -W -n ru.transithub.dispatcher/.MainActivity
sleep 20
pid=$(adb shell pidof ru.transithub.dispatcher | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_${pid}"
status=0
node scripts/android-smoke.mjs || status=$?
adb exec-out screencap -p > android-smoke/device.png
adb logcat -d -s "Capacitor/Console:*" "Capacitor:*" "chromium:*" > android-smoke/logcat.txt || true
exit $status
