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
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null || true
adb exec-out screencap -p > android-smoke/device.png
adb logcat -d -s "Capacitor/Console:*" "Capacitor:*" "chromium:*" > android-smoke/logcat.txt || true
adb logcat -d > android-smoke/logcat-full.txt || true
adb shell dumpsys activity exit-info ru.transithub.dispatcher > android-smoke/exit-info.txt || true
echo "alive after test: $(adb shell pidof ru.transithub.dispatcher | tr -d '')"
exit $status
