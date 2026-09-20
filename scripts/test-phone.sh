#!/usr/bin/env bash
#
# Start a test phone on this PC and put all four Quick Bites apps on it.
#
# This is the free, full-fidelity way to test four roles at once: a real
# Android 14 image, no minute limits, no account, and the whole logcat available
# when something goes wrong. The paid online services exist for checking one app
# across two hundred device models — a different problem from four apps talking
# to each other.
#
# Run it from YOUR terminal rather than letting a tool spawn it: the emulator
# has to outlive the command that started it, and it has to be a window you can
# actually click on.
#
# Usage:
#   bash scripts/test-phone.sh              # one phone, all four apps
#   bash scripts/test-phone.sh 2            # a SECOND phone, so two roles can act at once
#   bash scripts/test-phone.sh 3            # a third
#
# Each phone needs about 3 GB of RAM. This machine has 15 GB, so three is
# comfortable and four is pushing it.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}"
ADB="$ANDROID_HOME/platform-tools/adb.exe"
[[ -x "$ADB" ]] || ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator.exe"
[[ -x "$EMULATOR" ]] || EMULATOR="$ANDROID_HOME/emulator/emulator"

# Instance 1 gets the standard port; each extra phone gets its own pair. adb
# addresses them as emulator-5554, emulator-5556, and so on.
INSTANCE="${1:-1}"
PORT=$((5552 + INSTANCE * 2))
SERIAL="emulator-$PORT"

APPS=(
  "QuickBites-Customer:com.quickbite.app:Quick Bites"
  "QuickBites-Partner:com.quickbite.partner:Quick Bites Partner"
  "QuickBites-Rider:com.quickbite.rider:Quick Bites Rider"
  "QuickBites-Admin:com.quickbite.admin:Quick Bites Operations"
)

if [[ ! -x "$EMULATOR" ]]; then
  echo "FATAL: no Android emulator found at $EMULATOR" >&2
  echo "       Install it from Android Studio: Tools > SDK Manager > SDK Tools > Android Emulator" >&2
  exit 1
fi

echo "Starting test phone #$INSTANCE ($SERIAL) ..."

# -read-only lets the SAME image boot more than once, which is what makes a
# second and third phone possible without creating separate AVDs.
READONLY=""
[[ "$INSTANCE" != "1" ]] && READONLY="-read-only"

# swiftshader_indirect because the API 36 Play image crash-loops surfaceflinger
# on this machine under hardware GL; qb34 with software rendering is stable.
"$EMULATOR" -avd qb34 -port "$PORT" -no-audio -no-boot-anim -no-snapshot \
  -gpu swiftshader_indirect -memory 3072 $READONLY >/dev/null 2>&1 &

EMU_PID=$!
echo "  emulator pid $EMU_PID — a phone window will appear shortly"
echo "  waiting for it to finish booting (about a minute) ..."

"$ADB" -s "$SERIAL" wait-for-device 2>/dev/null

# wait-for-device returns as soon as adb can talk to it, which is well before
# Android is usable. sys.boot_completed is the real signal.
for _ in $(seq 1 90); do
  booted="$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  [[ "$booted" == "1" ]] && break
  sleep 2
done

if [[ "${booted:-}" != "1" ]]; then
  echo "  the phone did not finish booting in 3 minutes. Leaving it running — try again in a moment." >&2
  exit 1
fi

echo "  booted."
echo ""

INSTALLED=0
for entry in "${APPS[@]}"; do
  artifact="${entry%%:*}"
  rest="${entry#*:}"
  pkg="${rest%%:*}"
  label="${rest#*:}"
  apk="$ROOT/build/apk/$artifact.apk"

  if [[ ! -f "$apk" ]]; then
    echo "  [SKIP] $label — $artifact.apk is not in build/apk"
    continue
  fi

  # Uninstall first so a signature difference from an older build cannot turn
  # into a confusing "App not installed" halfway through.
  "$ADB" -s "$SERIAL" uninstall "$pkg" >/dev/null 2>&1

  if "$ADB" -s "$SERIAL" install -r "$apk" 2>&1 | tail -1 | grep -q "Success"; then
    echo "  [OK]   $label"
    INSTALLED=$((INSTALLED + 1))
  else
    echo "  [FAIL] $label — install failed"
  fi
done

echo ""
echo "===================================================="
echo "  Test phone #$INSTANCE ready — $INSTALLED of 4 apps installed"
echo "===================================================="
echo ""
echo "  The four apps are in the app drawer. Swipe up from the bottom."
echo ""
echo "  Screenshot whatever is on screen:"
echo "    bash scripts/test-shot.sh $INSTANCE my-note"
echo ""
echo "  If an app dies, get the real error rather than describing it:"
echo "    bash scripts/test-crash.sh $INSTANCE"
echo ""
echo "  A second phone, so two roles can act at the same time:"
echo "    bash scripts/test-phone.sh 2"
echo ""
