#!/bin/zsh
# App Store screenshots for the customer app, on a matching Simulator, clean status bar.
#
#   SIZE=6.3 scripts/app-store/screenshots.sh prepare [path/to/QuickBites.app]  boot, clean status bar, install, launch
#   SIZE=6.3 scripts/app-store/screenshots.sh shot 01-home     save build/app-store/screenshots/6.3/01-home.png
#   SIZE=6.3 scripts/app-store/screenshots.sh check            list the shots with their sizes
#   SIZE=6.3 scripts/app-store/screenshots.sh finish           put the real status bar back
#
# SIZE=6.3 (default): iPhone 17 Pro, 1206 x 2622 — App Store Connect's REQUIRED
#   "iPhone with Dynamic Island (medium display)" (14 Oct 2026).
# SIZE=6.9: iPhone 17 Pro Max, 1320 x 2868 — the optional large display.
#
# Navigate in the Simulator between shots (by hand, or with the Simulator tools).
# Suggested set: 01-home, 02-restaurant, 03-cart, 04-checkout, 05-tracking, 06-profile.
# The files can show live restaurant names and the reviewer's saved address, so
# build/app-store/ is gitignored, like build/play-store/.
set -eu
SIZE="${SIZE:-6.3}"
case "$SIZE" in
  6.3) DEVICE_NAME="iPhone 17 Pro";     WANT_W=1206; WANT_H=2622 ;;
  6.9) DEVICE_NAME="iPhone 17 Pro Max"; WANT_W=1320; WANT_H=2868 ;;
  *) echo "SIZE must be 6.3 or 6.9"; exit 1 ;;
esac
BUNDLE_ID="in.quickbites.app"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/build/app-store/screenshots/$SIZE"

udid() {
  local booted
  booted=$(xcrun simctl list devices booted | grep "    $DEVICE_NAME (" | head -1 | grep -oE '[0-9A-F-]{36}' || true)
  if [ -n "$booted" ]; then echo "$booted"; return; fi
  xcrun simctl list devices available | grep "    $DEVICE_NAME (" | head -1 | grep -oE '[0-9A-F-]{36}'
}

case "${1:-}" in
  prepare)
    U=$(udid)
    xcrun simctl boot "$U" 2>/dev/null || true
    xcrun simctl bootstatus "$U" -b >/dev/null
    open -a Simulator --args -CurrentDeviceUDID "$U"
    # Apple's own marketing look: 9:41, full signal, full battery, no carrier name.
    xcrun simctl status_bar "$U" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
      --cellularMode active --cellularBars 4 --operatorName "" --batteryState discharging --batteryLevel 100
    if [ -n "${2:-}" ]; then xcrun simctl install "$U" "$2"; fi
    # A fresh launch: no "◀ app" back link in the corner from whatever opened it.
    xcrun simctl terminate "$U" "$BUNDLE_ID" 2>/dev/null || true
    xcrun simctl launch "$U" "$BUNDLE_ID" >/dev/null
    mkdir -p "$OUT"
    echo "Ready on $DEVICE_NAME ($U). Status bar overridden. Shots go to $OUT"
    ;;
  shot)
    NAME="${2:?usage: shot <name, e.g. 01-home>}"
    U=$(udid)
    mkdir -p "$OUT"
    xcrun simctl io "$U" screenshot --type=png "$OUT/$NAME.png" >/dev/null 2>&1
    W=$(sips -g pixelWidth "$OUT/$NAME.png" | awk '/pixelWidth/{print $2}')
    H=$(sips -g pixelHeight "$OUT/$NAME.png" | awk '/pixelHeight/{print $2}')
    if [ "$W" != $WANT_W ] || [ "$H" != $WANT_H ]; then echo "WRONG SIZE ${W}x${H} for $NAME (App Store needs ${WANT_W}x${WANT_H})"; exit 1; fi
    echo "saved $SIZE/$NAME.png (${W}x${H})"
    ;;
  check)
    for f in "$OUT"/*.png(N); do
      printf '%s  %sx%s\n' "${f:t}" "$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')" "$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')"
    done
    ;;
  finish)
    xcrun simctl status_bar "$(udid)" clear
    echo "Status bar back to normal."
    ;;
  *)
    sed -n '2,15p' "$0"; exit 1
    ;;
esac
