#!/usr/bin/env bash
#
# Screenshot whatever is on a test phone right now.
#
# "It looked wrong" is hard to act on; a picture is not. Files land in
# build/screenshots/ with a timestamp so a run's worth of them stays in order.
#
# Usage:
#   bash scripts/test-shot.sh            # phone 1
#   bash scripts/test-shot.sh 2 cart     # phone 2, filed as "...-cart.png"
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}"
ADB="$ANDROID_HOME/platform-tools/adb.exe"
[[ -x "$ADB" ]] || ADB="$ANDROID_HOME/platform-tools/adb"

INSTANCE="${1:-1}"
NOTE="${2:-shot}"
SERIAL="emulator-$((5552 + INSTANCE * 2))"
OUT="$ROOT/build/screenshots"
mkdir -p "$OUT"

NAME="$(date +%H%M%S)-phone$INSTANCE-$NOTE.png"

# The destination must be converted to a Windows path while the /sdcard source
# must NOT be. Turning path conversion off for the whole command breaks the
# destination; cygpath is the only way to get both right.
DEST="$OUT/$NAME"
command -v cygpath >/dev/null 2>&1 && DEST="$(cygpath -w "$DEST")"

MSYS_NO_PATHCONV=1 "$ADB" -s "$SERIAL" shell screencap -p /sdcard/qb-shot.png >/dev/null 2>&1
if MSYS_NO_PATHCONV=1 "$ADB" -s "$SERIAL" pull /sdcard/qb-shot.png "$DEST" >/dev/null 2>&1; then
  MSYS_NO_PATHCONV=1 "$ADB" -s "$SERIAL" shell rm /sdcard/qb-shot.png >/dev/null 2>&1
  echo "saved: build/screenshots/$NAME"
else
  echo "could not capture — is phone $INSTANCE running? ($SERIAL)" >&2
  exit 1
fi
