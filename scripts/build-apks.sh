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

# Apps that came out debug-signed, reported again at the end: a warning printed
# before four minutes of Gradle output is a warning nobody sees.
DEBUG_SIGNED=()

APPS=(
  "customer-mobile:QuickBites-Customer"
  "restaurant-mobile:QuickBites-Partner"
  "delivery-mobile:QuickBites-Rider"
  "admin-mobile:QuickBites-Admin"
)

ABI_FLAG=""
PREBUILD=1
ONLY=""
DRY_RUN=0
ALLOW_DEBUG_SIGNING=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --emulator) ABI_FLAG=""; shift ;;   # kept: universal is already the default
    --arm-only) ABI_FLAG="-PqbPhoneAbisOnly"; shift ;;
    --no-prebuild) PREBUILD=0; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    # For a contributor without the keystores. The result can never update the
    # app on a phone and must not be handed out; it is named so.
    --allow-debug-signing) ALLOW_DEBUG_SIGNING=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

GUARDS="$ROOT/scripts/release/releaseGuards.mjs"
SIGNING_FLAG=""
[[ "$ALLOW_DEBUG_SIGNING" == "1" ]] && SIGNING_FLAG="--allow-debug-signing"

#
# EVERY APK MUST INSTALL AS AN UPDATE OVER THE ONE ON THE PHONE (U-1..U-3).
#
# The guards' own checks run first: a guard that has stopped guarding must not
# wave a build through. See scripts/release/releaseGuards.mjs.
#
echo ""
echo "Checking the release guards themselves"
node "$ROOT/scripts/test-release-guards.mjs" > "$(mktemp)" || {
  echo "FATAL: the release guards' own checks failed. Run: node scripts/test-release-guards.mjs" >&2
  exit 1
}

if [[ "$DRY_RUN" == "1" ]]; then
  echo ""
  echo "DRY RUN: nothing is built, and no versionCode is taken."
  echo "  next versionCode: $(node "$GUARDS" next-version-code)"
  for entry in "${APPS[@]}"; do
    app="${entry%%:*}"
    [[ -n "$ONLY" && "$ONLY" != "$app" ]] && continue
    echo "  $app signing: $(node "$GUARDS" check-signing "$ROOT/apps/$app" $SIGNING_FLAG)"
  done
  echo "Dry run passed."
  exit 0
fi

# One code for every app in this build, taken once, and recorded both in the
# committed counter and on this machine so it can never be handed out twice.
VERSION_CODE="$(node "$GUARDS" claim-version-code)"
echo "versionCode for this build: $VERSION_CODE"

mkdir -p "$OUT_DIR"

#
# METRO'S TRANSFORM CACHE IS CLEARED BEFORE EVERY RELEASE BUILD.
#
# It shipped a stale screen. The admin APK carried the CURRENT App.tsx and the
# PREVIOUS RatesScreen.tsx from the same commit - so the section was correctly
# named "Inflation", the tabs were there, and the GST field and the
# no-markup warning inside it simply did not exist. The nav label being right
# is what would have stopped anybody noticing.
#
# `expo prebuild --clean` does not prevent this. It wipes android/, and the
# transform cache lives in the OS temp directory keyed by project, so a clean
# prebuild is not a clean bundle. The build ran four and a half hours after
# the code it was missing, and did it twice on two consecutive builds.
#
# Cheap insurance: a cold transform costs a couple of minutes on a build that
# already takes ten, and the alternative is an artifact that disagrees with
# the source in a way nothing else here would catch.
#
echo ""
echo "Clearing Metro's transform cache (it has shipped a stale screen before)"
rm -rf "${TMPDIR:-/tmp}"/metro-cache "${TMPDIR:-/tmp}"/metro-file-map-* 2>/dev/null || true
rm -rf /tmp/metro-cache /tmp/metro-file-map-* 2>/dev/null || true

for entry in "${APPS[@]}"; do
  app="${entry%%:*}"
  artifact="${entry##*:}"
  [[ -n "$ONLY" && "$ONLY" != "$app" ]] && continue

  echo ""
  echo "=== $app -> $artifact.apk ==="
  cd "$ROOT/apps/$app"

  # QuickBites-Customer -> customer. The prefix is stripped and the rest
  # lowercased, so the vault filename is derived from the artifact rather than
  # held in a second list that could disagree with the first.
  artifact_key="$(echo "${artifact#QuickBites-}" | tr '[:upper:]' '[:lower:]')"

  #
  # THE SIGNING CONFIG IS RESTORED FROM A VAULT OUTSIDE THE REPOSITORY.
  #
  # keystore.properties is gitignored and lives inside android/, which
  # `prebuild --clean` deletes. This script used to protect it with a mktemp
  # copy taken moments before, and that is enough ONLY while every prebuild
  # goes through this script. It does not, and the gap is not hypothetical:
  # running `npx expo prebuild` by hand - the obvious thing to do while
  # debugging - deletes the file with nothing to restore it from, and because
  # it is gitignored there is no diff and no warning. That is how the customer
  # key's password was lost on 22 Sep, and it nearly happened a second time on
  # the same day.
  #
  # So the copy in android/ is now treated as disposable and the vault is the
  # source of truth. A missing or destroyed keystore.properties is repaired
  # from $KEYSTORE_VAULT on every build, by anyone, whatever deleted it.
  #
  # The vault holds the .jks files too, is outside the repository, and is
  # never committed - this repository is public.
  #
  KEYSTORE_VAULT="${QB_KEYSTORE_VAULT:-$HOME/quickbites-keystores}"
  vault_config="$KEYSTORE_VAULT/$artifact_key.keystore.properties"

  if [[ "$PREBUILD" == "1" ]]; then
    keystore_backup="$(mktemp)"
    [[ -f android/keystore.properties ]] && cp android/keystore.properties "$keystore_backup"
    npx expo prebuild --platform android --clean
    [[ -s "$keystore_backup" ]] && cp "$keystore_backup" android/keystore.properties
    rm -f "$keystore_backup"
  fi

  # Restored whether or not a prebuild ran, because the file can go missing
  # for reasons this script never sees.
  if [[ ! -f android/keystore.properties && -f "$vault_config" ]]; then
    cp "$vault_config" android/keystore.properties
    echo "  restored signing config from the vault: $vault_config"
  fi

  echo "sdk.dir=$ANDROID_HOME_NATIVE" > android/local.properties

  # U-1: into app.json AND the generated build.gradle, so a --no-prebuild build
  # carries it too.
  node "$GUARDS" set-version "$ROOT/apps/$app" "$VERSION_CODE"

  #
  # THE MAPBOX SDK DOWNLOAD TOKEN, SUPPLIED TO GRADLE AND NOT TO EXPO.
  #
  # The Mapbox Android SDK comes from an authenticated Maven repository. The
  # @rnmapbox config plugin writes that repository into build.gradle with
  # `password = project.properties['MAPBOX_DOWNLOADS_TOKEN']`, so the token is
  # an ordinary Gradle property and belongs here.
  #
  # It is NOT passed as a plugin option, which is what @rnmapbox's own
  # documentation recommends. That builds perfectly and puts the SECRET token
  # inside every APK, because Expo serialises the resolved config - plugin
  # options included - into `assets/app.config`, which is packaged. We shipped
  # exactly that and found it by unzipping the result.
  #
  # android/ is generated and gitignored, and gradle.properties is a build
  # input that is never packaged, so the token reaches the compiler and
  # nothing else.
  #
  if [[ -n "${MAPBOX_DOWNLOAD_TOKEN:-}" ]]; then
    printf 'MAPBOX_DOWNLOADS_TOKEN=%s
' "$MAPBOX_DOWNLOAD_TOKEN" >> android/gradle.properties
  elif [[ -f "$ROOT/.env" ]] && grep -q '^MAPBOX_DOWNLOAD_TOKEN=' "$ROOT/.env"; then
    # Read from the repository-root .env, where every other secret in this
    # project lives. Expo reads .env from the APP directory, so relying on its
    # loader would silently find nothing here.
    grep '^MAPBOX_DOWNLOAD_TOKEN=' "$ROOT/.env"       | head -1       | sed 's/^MAPBOX_DOWNLOAD_TOKEN=/MAPBOX_DOWNLOADS_TOKEN=/'       >> android/gradle.properties
  else
    echo "  WARNING: no MAPBOX_DOWNLOAD_TOKEN - the Mapbox SDK cannot be fetched" >&2
  fi

  # Refuse to hand back a DEBUG-SIGNED release (U-2).
  #
  # withReleaseSigning falls back to Android's debug keystore when it cannot
  # find credentials, and Gradle says nothing about it. That is how the admin
  # app once came out of a full build signed with the debug key while the other
  # three were signed properly: the APK looked normal, installed on a clean
  # device, and would have been refused as an update by every phone that had
  # the real one. This used to be a warning; it is now fatal, unless
  # --allow-debug-signing says the build will never be handed out.
  signing="$(node "$GUARDS" check-signing "$ROOT/apps/$app" $SIGNING_FLAG)"
  if [[ "$signing" == "DEBUG" ]]; then
    echo "  --allow-debug-signing: $app will be DEBUG-SIGNED and cannot update any phone." >&2
    DEBUG_SIGNED+=("$app")
  fi

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

  if [[ "$signing" == "DEBUG" ]]; then
    # Named so it cannot be mistaken for a release, and not checked against the
    # pinned certificate, which it cannot match.
    cp "$built" "$OUT_DIR/$artifact-DEBUG-SIGNED.apk"
    echo "  -> $OUT_DIR/$artifact-DEBUG-SIGNED.apk (NOT for anybody's phone)"
    continue
  fi

  cp "$built" "$OUT_DIR/$artifact.apk"
  echo "  -> $OUT_DIR/$artifact.apk ($(du -h "$OUT_DIR/$artifact.apk" | cut -f1))"

  # U-3: the file that will be handed out, checked against the certificate on
  # the phones, its package, and the versionCode this build claimed. A failure
  # removes it, so a copy that would not install as an update is never left
  # lying in build/apk looking like a release.
  node "$GUARDS" verify-apk "$app" "$OUT_DIR/$artifact.apk" "$VERSION_CODE" || {
    mv "$OUT_DIR/$artifact.apk" "$OUT_DIR/$artifact.REJECTED.apk"
    echo "FATAL: $app was built but would not install as an update; kept as $artifact.REJECTED.apk for inspection." >&2
    exit 1
  }
done

echo ""
echo "Done. APKs in $OUT_DIR, versionCode $VERSION_CODE"
echo "Commit release/version.json so the next build, on any machine, starts above $VERSION_CODE."

if [[ ${#DEBUG_SIGNED[@]} -gt 0 ]]; then
  echo "" >&2
  echo "  DEBUG-SIGNED, DO NOT PUBLISH: ${DEBUG_SIGNED[*]}" >&2
  echo "  Built with --allow-debug-signing. None of these can update an installed app." >&2
  echo "" >&2
fi
