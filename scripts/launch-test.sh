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
# Each app that launches is also screenshotted into build/screenshots/, because
# a process being alive and an app being usable are different claims.
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
SHOT_DIR="$ROOT/build/screenshots"
SUSPECT=0
# Below this, a screenshot is almost certainly a flat colour rather than a
# rendered interface. Measured against real first screens from these four apps,
# which run from roughly 90 KB to 400 KB.
MIN_SHOT_BYTES=40000

if ! "$ADB" devices | grep -qE "device$"; then
  echo "FATAL: no device or emulator attached. Start one, then re-run." >&2
  exit 1
fi

# A filter that matches nothing must not be reported as a clean run. "0 APKs
# installed and opened" is not a pass, and this script exits 0 on it.
if [[ -n "$ONLY" ]]; then
  case "$(echo "$ONLY" | tr 'A-Z' 'a-z')" in
    customer|partner|rider|admin) ;;
    *)
      echo "FATAL: '$ONLY' is not one of: customer partner rider admin" >&2
      exit 1
      ;;
  esac
fi

for entry in "${APPS[@]}"; do
  artifact="${entry%%:*}"
  rest="${entry#*:}"
  pkg="${rest%%:*}"
  label="${rest#*:}"

  if [[ -n "$ONLY" ]]; then
    # Case-folded on both sides. The usage line above says `customer partner
    # rider admin`, and the artifact names are `QuickBites-Customer` and
    # friends, so a case-sensitive match made every documented invocation
    # select nothing and report "0 APK(S) INSTALLED AND OPENED" as a success.
    case "$(echo "$artifact" | tr 'A-Z' 'a-z')" in
      *"$(echo "$ONLY" | tr 'A-Z' 'a-z')"*) ;;
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

  # A live process is not a working app. React Native will happily keep a
  # process alive while rendering a blank white screen - a failed bundle, a
  # component that threw during its first render, an error boundary with
  # nothing behind it. The process check cannot tell those apart from success,
  # so take a picture and look.
  #
  # Git Bash rewrites anything that looks like a Unix path into a Windows one
  # before adb sees it, which mangles /sdcard/... MSYS_NO_PATHCONV stops that.
  #
  # But `pull` has a path on EACH side, and they need opposite treatment: the
  # source is an Android path that must stay as written, and the destination is
  # a Windows path that must NOT stay as `/d/my all projects/...`. Turning the
  # conversion off for the whole command fixed the first and broke the second,
  # and adb said so only on stderr - which was redirected to /dev/null, so the
  # run reported a pass with no screenshot and no reason. cygpath converts the
  # destination explicitly, which is the only way to get both.
  mkdir -p "$SHOT_DIR"
  shot_dest="$SHOT_DIR/$artifact.png"
  if command -v cygpath >/dev/null 2>&1; then
    shot_dest="$(cygpath -w "$shot_dest")"
  fi

  MSYS_NO_PATHCONV=1 "$ADB" shell screencap -p /sdcard/qb-shot.png >/dev/null 2>&1
  if ! MSYS_NO_PATHCONV=1 "$ADB" pull /sdcard/qb-shot.png "$shot_dest" >/dev/null 2>"$SHOT_DIR/.pull-error"; then
    echo "       screenshot pull failed: $(tail -1 "$SHOT_DIR/.pull-error")"
  fi
  rm -f "$SHOT_DIR/.pull-error"
  MSYS_NO_PATHCONV=1 "$ADB" shell rm /sdcard/qb-shot.png >/dev/null 2>&1

  if [[ -f "$SHOT_DIR/$artifact.png" ]]; then
    shot_bytes=$(wc -c < "$SHOT_DIR/$artifact.png" | tr -d ' ')

    # A blank screen is the failure a pid check cannot see, and it has a
    # signature: a flat expanse of one colour compresses to almost nothing,
    # while a real interface with text, icons and a photograph does not. This
    # is a heuristic, not a proof - so it reports rather than failing the run,
    # and the screenshot is on disk for a human to look at either way.
    if [[ "$shot_bytes" -lt "$MIN_SHOT_BYTES" ]]; then
      echo "[WARN] $label is running but its first screen is only ${shot_bytes} bytes"
      echo "       of PNG - that is about what a blank screen compresses to."
      echo "       Open build/screenshots/$artifact.png before shipping this."
      SUSPECT=$((SUSPECT + 1))
    fi

    echo "[PASS] $label launched and is still running (pid $pid)"
    echo "       screenshot: build/screenshots/$artifact.png (${shot_bytes} bytes)"
  else
    echo "[PASS] $label launched and is still running (pid $pid)"
    echo "       (no screenshot captured - check the emulator display)"
  fi

  PASSED=$((PASSED + 1))
  "$ADB" shell am force-stop "$pkg" >/dev/null 2>&1
done

echo ""
echo "===================================================="
if [[ "$FAILED" -eq 0 ]]; then
  echo "  $PASSED APK(S) INSTALLED AND OPENED                "
  if [[ "$SUSPECT" -gt 0 ]]; then
    echo "  $SUSPECT WITH A SUSPICIOUSLY EMPTY FIRST SCREEN     "
  fi
  echo "===================================================="
  exit 0
fi
echo "  $FAILED APK(S) FAILED TO LAUNCH — DO NOT PUBLISH   "
echo "===================================================="
exit 1
