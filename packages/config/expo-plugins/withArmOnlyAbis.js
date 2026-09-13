/**
 * Expo config plugin: let the sideload APK drop the ABIs no phone uses.
 *
 * `reactNativeArchitectures` in gradle.properties limits what React Native
 * itself compiles, but prebuilt .so files inside third-party AARs — Hermes,
 * the Expo modules, react-native-svg — ship every ABI and are packaged anyway.
 * That put x86 and x86_64 slices in the release APK: 24 MB of a 51 MB download
 * that no shipping Android phone can execute. They exist for emulators.
 *
 * The filter is deliberately OFF unless `-PqbPhoneAbisOnly` is passed, because
 * abiFilters in defaultConfig applies to every variant, `bundleRelease`
 * included — and stripping ABIs from an App Bundle is a pure regression. Play
 * generates a per-device APK from the bundle, so each user already downloads
 * only their own slice; removing x86_64 saves them nothing and silently drops
 * Chromebooks, x86 tablets and Windows Subsystem for Android from the listing.
 * (`splits.abi` would be ignored for a bundle; `ndk.abiFilters` is not, which
 * is exactly why this one has to be conditional.)
 *
 * So:
 *   ./gradlew assembleRelease -PqbPhoneAbisOnly   -> ~27 MB APK to share
 *   ./gradlew bundleRelease                       -> every ABI, for Play
 *
 * Forgetting the flag yields a fat APK, which is merely wasteful. The reverse
 * default would yield an ARM-only Play listing, which is invisible until
 * someone reports they cannot install it.
 *
 * Injected at prebuild time because `expo prebuild` regenerates android/, so a
 * hand-edit to app/build.gradle does not survive.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

/** Emulator-only ABIs are excluded; these two cover every Android phone in use. */
const PHONE_ABIS = ['armeabi-v7a', 'arm64-v8a'];

const ABI_BLOCK = `
        // --- Quick Bites: phone ABIs only (injected by withArmOnlyAbis plugin) ---
        // Opt-in: assembleRelease -PqbPhoneAbisOnly. Never enable for bundleRelease,
        // which must keep every ABI so Play can serve x86_64 devices.
        if (project.hasProperty("qbPhoneAbisOnly")) {
            ndk {
                abiFilters ${PHONE_ABIS.map(a => `"${a}"`).join(', ')}
            }
        }`;

function withArmOnlyAbis(config) {
  return withAppBuildGradle(config, cfg => {
    let gradle = cfg.modResults.contents;

    if (gradle.includes('withArmOnlyAbis plugin')) {
      return cfg;
    }

    // Anchor on the versionName line inside defaultConfig, which every Expo
    // template emits exactly once.
    const anchor = /(\n\s*versionName\s+"[^"]*")/;
    if (!anchor.test(gradle)) {
      throw new Error(
        'withArmOnlyAbis: could not find versionName in defaultConfig; the Android template changed.'
      );
    }
    gradle = gradle.replace(anchor, `$1\n${ABI_BLOCK}`);

    cfg.modResults.contents = gradle;
    return cfg;
  });
}

module.exports = withArmOnlyAbis;
