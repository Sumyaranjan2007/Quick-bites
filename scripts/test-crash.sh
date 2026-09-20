#!/usr/bin/env bash
#
# The actual error behind "it crashed".
#
# Android keeps a dedicated crash buffer. Reading it turns a vague report into
# a stack trace someone can fix, and it also shows when the crash belonged to
# something else entirely - an emulator graphics fault once made all four apps
# look like they had died when none of them had.
#
# Usage:
#   bash scripts/test-crash.sh          # phone 1
#   bash scripts/test-crash.sh 2
set -uo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}"
ADB="$ANDROID_HOME/platform-tools/adb.exe"
[[ -x "$ADB" ]] || ADB="$ANDROID_HOME/platform-tools/adb"

INSTANCE="${1:-1}"
SERIAL="emulator-$((5552 + INSTANCE * 2))"

echo "=== crashes on phone $INSTANCE ==="
"$ADB" -s "$SERIAL" logcat -d -b crash 2>/dev/null | tail -40

echo ""
echo "=== anything Quick Bites logged ==="
"$ADB" -s "$SERIAL" logcat -d 2>/dev/null | grep -iE "quickbite|ReactNative|AndroidRuntime|FATAL" | tail -30

echo ""
echo "=== which of the four are running right now ==="
for pkg in com.quickbite.app com.quickbite.partner com.quickbite.rider com.quickbite.admin; do
  pid="$("$ADB" -s "$SERIAL" shell pidof "$pkg" 2>/dev/null | tr -d '\r')"
  printf "  %-26s %s\n" "$pkg" "${pid:-not running}"
done
