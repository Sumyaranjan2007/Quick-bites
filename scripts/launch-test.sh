#!/usr/bin/env bash
#
# Install each built APK and confirm it actually opens.
#
# This project has a documented history of a build that passed every static
# check — lint, typecheck, the whole test suite, apksigner — and then died at
# launch on every device, because a duplicate native library only fails when the
# process starts. Signature verification proves who signed a file. It proves
# nothing about whether the app runs.
#
# So: install on a real device or emulator, start the launcher activity, wait,
# and then ask the system whether the process is still alive. A crash on startup
# is the failure this catches, and it is the one that reaches testers.
#
# Usage:
#   bash scripts/launch-test.sh            # every APK in build/apk
#   bash scripts/launch-test.sh customer   # one of: customer partner rider admin
#
# Requires: a booted emulator or a connected device (adb devices shows it).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}"
ADB="$ANDROID_HOME/platform-tools/adb.exe"
[[ -x "$ADB" ]] || ADB="$ANDROID_HOME/platform-tools/adb"

# artifact : package id : human name
APPS=(
  "QuickBites-Customer:com.quickbite.app:Quick Bites"
  "QuickBites-Partner:com.quickbite.partner:Quick Bites Partner"
  "QuickBites-Rider:com.quickbite.rider:Quick Bites Rider"
  "QuickBites-Admin:com.quickbite.admin:Quick Bites Operations"
)

ONLY="${1:-}"
FAILED=0
PASSED=0

if ! "$ADB" devices | grep -qE "device$"; then
  echo "FATAL: no device or emulator attached. Start one, then re-run." >&2
  exit 1
fi

for entry in "${APPS[@]}"; do
  artifact="${entry%%:*}"
  rest="${entry#*:}"
  pkg="${rest%%:*}"
  label="${rest#*:}"

  if [[ -n "$ONLY" ]]; then
    case "$artifact" in
      *"$ONLY"*) ;;
      *) continue ;;
    esac
  fi

  apk="$ROOT/build/apk/$artifact.apk"
  if [[ ! -f "$apk" ]]; then
    echo "[FAIL] $label — $artifact.apk does not exist. Build it first."
    FAILED=$((FAILED + 1))
    continue
  fi

  echo ""
  echo "=== $label ($pkg) ==="

  # Uninstalled first rather than installed over: these builds are signed with
  # a different key from anything previously published, and Android refuses an
  # update whose signature differs. That refusal is the single most likely
  # thing to confuse a tester, so the script models what they must do.
  "$ADB" uninstall "$pkg" >/dev/null 2>&1

  if ! "$ADB" install -r "$apk" 2>&1 | tail -1 | grep -q "Success"; then
    echo "[FAIL] $label — install failed"
    FAILED=$((FAILED + 1))
    continue
  fi

  # Clear anything logged before this launch, so a crash found below belongs to
  # this run and not to a previous one.
  "$ADB" logcat -c >/dev/null 2>&1

  "$ADB" shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 8

  pid="$("$ADB" shell pidof "$pkg" 2>/dev/null | tr -d '\r')"

  if [[ -z "$pid" ]]; then
    echo "[FAIL] $label — the process is not running 8 seconds after launch."
    echo "       Last crash lines:"
    "$ADB" logcat -d -b crash 2>/dev/null | tail -15 | sed 's/^/       /'
    FAILED=$((FAILED + 1))
    continue
  fi

  echo "[PASS] $label launched and is still running (pid $pid)"
  PASSED=$((PASSED + 1))
  "$ADB" shell am force-stop "$pkg" >/dev/null 2>&1
done

echo ""
echo "===================================================="
if [[ "$FAILED" -eq 0 ]]; then
  echo "  $PASSED APK(S) INSTALLED AND OPENED                "
  echo "===================================================="
  exit 0
fi
echo "  $FAILED APK(S) FAILED TO LAUNCH — DO NOT PUBLISH   "
echo "===================================================="
exit 1
