#!/usr/bin/env bash
#
# Build the four Quick Bites Android apps as signed, shareable APKs.
#
# Two things about this monorepo make a naive `gradlew assembleRelease` fail or
# mislead, and both are handled here:
#
#   1. Expo's autolinking writes ExpoModulesPackageList.java into the HOISTED
#      node_modules/expo/android/build, which every app shares. Build the
#      customer app and then the rider app and the rider build still references
#      expo-speech-recognition, a customer-only dependency, and fails to
#      compile. The generated directory is therefore cleared before each app.
#
#   2. The release APK is ARM-only on purpose (-PqbPhoneAbisOnly), which halves
#      the download but cannot be installed on an x86_64 emulator. Pass
#      --emulator to build fat APKs for testing instead.
#
# Requires JDK 17 — Gradle 8.10/AGP here reject Java 25 — and an Android SDK.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/build/apk"

JAVA_HOME="${JAVA_HOME:-/usr/local/opt/openjdk@17}"
ANDROID_HOME="${ANDROID_HOME:-/usr/local/share/android-commandlinetools}"
export JAVA_HOME ANDROID_HOME

APPS=(
  "customer-mobile:QuickBites-Customer"
  "restaurant-mobile:QuickBites-Partner"
  "delivery-mobile:QuickBites-Rider"
  "admin-mobile:QuickBites-Admin"
)

ABI_FLAG="-PqbPhoneAbisOnly"
PREBUILD=1
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --emulator) ABI_FLAG=""; shift ;;
    --no-prebuild) PREBUILD=0; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$OUT_DIR"

for entry in "${APPS[@]}"; do
  app="${entry%%:*}"
  artifact="${entry##*:}"
  [[ -n "$ONLY" && "$ONLY" != "$app" ]] && continue

  echo ""
  echo "=== $app -> $artifact.apk ==="
  cd "$ROOT/apps/$app"

  if [[ "$PREBUILD" == "1" ]]; then
    # keystore.properties is gitignored and lives inside android/, which
    # prebuild --clean deletes. Keep it across the regeneration.
    keystore_backup="$(mktemp)"
    [[ -f android/keystore.properties ]] && cp android/keystore.properties "$keystore_backup"
    npx expo prebuild --platform android --clean
    [[ -s "$keystore_backup" ]] && cp "$keystore_backup" android/keystore.properties
    rm -f "$keystore_backup"
  fi

  echo "sdk.dir=$ANDROID_HOME" > android/local.properties

  # See note 1: never let one app's module list leak into the next app's build.
  rm -rf "$ROOT/node_modules/expo/android/build"

  (cd android && ./gradlew assembleRelease --console=plain $ABI_FLAG)

  cp android/app/build/outputs/apk/release/app-release.apk "$OUT_DIR/$artifact.apk"
  echo "  -> $OUT_DIR/$artifact.apk ($(du -h "$OUT_DIR/$artifact.apk" | cut -f1))"
done

echo ""
echo "Done. APKs in $OUT_DIR"
