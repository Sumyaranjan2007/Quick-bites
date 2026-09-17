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
#   2. The release APK is UNIVERSAL (all four ABIs) on purpose. An ARM-only APK
#      halves the download but cannot be installed on an x86_64 emulator, which
#      means the file that ships can never be the file that was launch-tested —
#      only a same-source rebuild can be, and this project has a documented
#      history (the duplicate react-native-svg crash) of a build passing every
#      static check and still dying at launch on every device. Pass --arm-only
#      if you are deliberately shipping something you will test on real ARM
#      hardware instead.
#
# Requires JDK 17 — Gradle 8.10/AGP here reject Java 25 — and an Android SDK.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/build/apk"

# --- Toolchain discovery ---------------------------------------------------
#
# This used to hardcode two macOS paths, which meant the script only ran on the
# machine it was written on. It now looks where each platform actually puts
# these, and says precisely what is missing when it cannot find them. Nothing
# about WHICH toolchain is required has changed: Gradle 8.10/AGP here reject
# Java 25 and need 17.

first_existing() {
  # Echoes the first argument that exists on disk. Globs are expanded by the
  # caller, so an unmatched pattern simply contributes nothing.
  local candidate
  for candidate in "$@"; do
    [[ -e "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}

java_major() {
  # "17.0.20" -> 17, "1.8.0_401" -> 8. Version is read from the binary itself
  # rather than from the directory name, which can lie.
  local home="$1"
  [[ -x "$home/bin/java" || -x "$home/bin/java.exe" ]] || return 1
  "$home/bin/java" -version 2>&1 \
    | head -1 \
    | sed -E 's/.*version "([0-9]+)\.([0-9]+).*/\1 \2/' \
    | awk '{ if ($1 == 1) print $2; else print $1 }'
}

if [[ -n "${JAVA_HOME:-}" ]] && [[ "$(java_major "$JAVA_HOME" || echo 0)" == "17" ]]; then
  : # caller supplied a usable JDK 17
else
  JAVA_HOME="$(first_existing \
    /c/Program\ Files/Eclipse\ Adoptium/jdk-17* \
    /c/Program\ Files/Java/jdk-17* \
    /c/Program\ Files/Microsoft/jdk-17* \
    /c/Program\ Files/Android/Android\ Studio/jbr \
    /opt/homebrew/opt/openjdk@17 \
    /usr/local/opt/openjdk@17 \
    /Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
    /usr/lib/jvm/java-17-openjdk-amd64 \
    /usr/lib/jvm/java-17-openjdk \
    2>/dev/null || true)"
fi

if [[ -z "${JAVA_HOME:-}" ]] || [[ "$(java_major "$JAVA_HOME" || echo 0)" != "17" ]]; then
  echo "FATAL: no JDK 17 found." >&2
  echo "  Gradle 8.10 / AGP in this project reject newer Java and require 17." >&2
  echo "  Windows: winget install EclipseAdoptium.Temurin.17.JDK" >&2
  echo "  macOS:   brew install openjdk@17" >&2
  echo "  Linux:   apt install openjdk-17-jdk" >&2
  echo "  Or export JAVA_HOME to an existing JDK 17." >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
  ANDROID_HOME="${ANDROID_SDK_ROOT:-$(first_existing \
    "$HOME/AppData/Local/Android/Sdk" \
    "$HOME/Library/Android/sdk" \
    "$HOME/Android/Sdk" \
    /usr/local/share/android-commandlinetools \
    /usr/local/lib/android/sdk \
    2>/dev/null || true)}"
fi

if [[ -z "${ANDROID_HOME:-}" ]] || [[ ! -d "$ANDROID_HOME/platform-tools" && ! -d "$ANDROID_HOME/build-tools" ]]; then
  echo "FATAL: no Android SDK found${ANDROID_HOME:+ at $ANDROID_HOME}." >&2
  echo "  Install Android Studio, or set ANDROID_HOME to an existing SDK." >&2
  exit 1
fi

export JAVA_HOME ANDROID_HOME

# Gradle reads local.properties as a Java properties file, so on Windows the
# MSYS path (/c/Users/...) is meaningless to it. cygpath -m gives C:/Users/...,
# which Gradle accepts on every platform.
if command -v cygpath >/dev/null 2>&1; then
  ANDROID_HOME_NATIVE="$(cygpath -m "$ANDROID_HOME")"
else
  ANDROID_HOME_NATIVE="$ANDROID_HOME"
fi

echo "JDK 17:      $JAVA_HOME"
echo "Android SDK: $ANDROID_HOME_NATIVE"

APPS=(
  "customer-mobile:QuickBites-Customer"
  "restaurant-mobile:QuickBites-Partner"
  "delivery-mobile:QuickBites-Rider"
  "admin-mobile:QuickBites-Admin"
)

ABI_FLAG=""
PREBUILD=1
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --emulator) ABI_FLAG=""; shift ;;   # kept: universal is already the default
    --arm-only) ABI_FLAG="-PqbPhoneAbisOnly"; shift ;;
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

  echo "sdk.dir=$ANDROID_HOME_NATIVE" > android/local.properties

  # See note 1: never let one app's module list leak into the next app's build.
  rm -rf "$ROOT/node_modules/expo/android/build"

  built="android/app/build/outputs/apk/release/app-release.apk"
  # Removed before the build, not merely checked afterwards: a Gradle run that
  # fails to produce an APK would otherwise leave the previous run's file in
  # place, and copying it would publish an old binary as a new release. That
  # has happened on this project before.
  rm -f "$built"

  (cd android && ./gradlew assembleRelease --console=plain $ABI_FLAG)

  if [[ ! -f "$built" ]]; then
    echo "FATAL: $app built no APK at $built" >&2
    exit 1
  fi

  cp "$built" "$OUT_DIR/$artifact.apk"
  echo "  -> $OUT_DIR/$artifact.apk ($(du -h "$OUT_DIR/$artifact.apk" | cut -f1))"
done

echo ""
echo "Done. APKs in $OUT_DIR"
