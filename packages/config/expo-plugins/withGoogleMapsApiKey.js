/**
 * Expo config plugin: bake the Google Maps Android key into the build, from an
 * environment file that git never sees.
 *
 * Android's Maps SDK reads its key from a `com.google.android.geo.API_KEY`
 * meta-data entry in the manifest. There is no runtime way to supply it — the
 * native map view reads it as the process starts — so it has to be written at
 * build time, which leaves exactly two places it could live: app.json, which is
 * committed, or here.
 *
 * It matters which. This repository is public. A Maps key committed to a public
 * repository is found by scrapers in hours, and the first anyone knows is the
 * bill. So the key is read from the environment, `.env` is gitignored, and
 * app.json carries a placeholder that is never a real key.
 *
 * WHAT ACTUALLY PROTECTS THIS KEY, though, is not that it is out of git. An
 * Android Maps key is shipped inside every APK and can be read out of one with
 * `unzip` and `strings` in under a minute — Google's model assumes this. The
 * protection is the restriction set on the key in the Cloud console: package
 * name plus release SHA-1 certificate fingerprint, which makes an extracted key
 * useless to anyone who cannot sign an APK with our keystore. Keeping it out of
 * git avoids the window between a scrape and a restriction, and nothing more.
 *
 * This is why the SERVER key is handled completely differently and lives only
 * in Railway: that one is genuinely secret, cannot be package-restricted, and
 * must never enter an APK. `scripts/check-apk-secrets.mjs` enforces the
 * separation.
 *
 * A MISSING KEY IS NOT A BUILD FAILURE. It is recorded in `extra` so the
 * JavaScript can ask, and the map components fall back to the drawn map they
 * used before. A build that dies because a developer has no key would make
 * every non-map change unbuildable by anyone without Cloud console access; a
 * build that silently ships grey tiles would be worse still. This does neither:
 * it warns at build time and degrades visibly at runtime.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ENV_NAME = 'GOOGLE_MAPS_ANDROID_KEY';
const META_NAME = 'com.google.android.geo.API_KEY';

/**
 * The key, from the process environment or from the monorepo root `.env`.
 *
 * The file is read directly rather than through `dotenv` because Expo loads
 * `.env` from the app directory, and this monorepo keeps one at the root. A
 * developer running `npx expo prebuild` inside `apps/customer-mobile` would
 * otherwise get a keyless build and no indication why.
 */
function readKey(projectRoot) {
  const fromEnv = (process.env[ENV_NAME] || '').trim();
  if (fromEnv) return fromEnv;

  // apps/<app> -> repository root. Walked upward rather than hardcoded so this
  // keeps working if an app moves.
  let dir = projectRoot;
  for (let depth = 0; depth < 5; depth++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      const line = fs
        .readFileSync(candidate, 'utf8')
        .split(/\r?\n/)
        .find(l => l.trim().startsWith(`${ENV_NAME}=`));
      if (line) {
        // Quotes are stripped because a value pasted from a console often
        // arrives wrapped in them, and a quoted key fails as an unquoted one
        // would not: the map simply does not authorise.
        return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

function withGoogleMapsApiKey(config) {
  const key = readKey(config._internal?.projectRoot || process.cwd());

  // Recorded on `extra` so `Constants.expoConfig.extra` can answer "is there a
  // key in this build?" in JavaScript. Without this the apps would have to
  // discover a keyless build by watching the map fail to draw, which looks
  // identical to a slow network.
  config.extra = { ...(config.extra || {}), googleMapsConfigured: Boolean(key) };

  if (!key) {
    console.warn(
      `\n  [withGoogleMapsApiKey] No ${ENV_NAME} found.\n` +
        `  Maps will fall back to the drawn map in this build.\n` +
        `  Set it in the repository-root .env to build with real maps.\n`
    );
    return config;
  }

  return withAndroidManifest(config, cfg => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    // addMetaDataItemToMainApplication replaces an existing entry of the same
    // name rather than appending a second one. Two meta-data entries with this
    // name is a manifest merge failure, which would only show at assemble time.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, META_NAME, key);

    return cfg;
  });
}

module.exports = withGoogleMapsApiKey;
