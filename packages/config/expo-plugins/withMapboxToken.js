/**
 * Expo config plugin: put the Mapbox token into the build, from an environment
 * file that git never sees.
 *
 * Replaces withGoogleMapsApiKey. The shape is deliberately the same, because
 * the failure it prevents is the same and that failure was learned the hard
 * way: a build with no token draws an empty canvas and reports nothing, which
 * looks exactly like a slow network.
 *
 * MAPBOX NEEDS TWO TOKENS, AND CONFUSING THEM IS THE EXPENSIVE MISTAKE.
 *
 *   PUBLIC  (pk.*)  ships inside the APK, is readable by anyone with `unzip`,
 *                   and is what the map view uses. This is the one here.
 *   SECRET  (sk.*)  downloads the SDK at build time and can create further
 *                   tokens. It must never enter an APK.
 *
 * Mapbox's own model assumes the public token is extractable, exactly as
 * Google's did. What protects it is the URL restriction and scope set on it in
 * the Mapbox account, not its absence from git — keeping it out of a public
 * repository only closes the window between a scrape and a restriction.
 *
 * `scripts/check-apk-secrets.mjs` enforces the separation, and a secret token
 * reaching an artifact is a build failure rather than a warning.
 *
 * A MISSING TOKEN IS NOT A BUILD FAILURE. It is recorded on `extra` so the
 * JavaScript can ask, and every map falls back to the drawn map it used
 * before. A build that died without a token would make every non-map change
 * unbuildable by anyone without account access; a build that silently shipped
 * an empty canvas would be worse. This does neither: it warns at build time
 * and degrades visibly at runtime.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ENV_NAME = 'MAPBOX_PUBLIC_TOKEN';
const STYLE_ENV_NAME = 'MAPBOX_STYLE_URL';

/**
 * Android reads this at process start to fetch tiles. Named by Mapbox, not by
 * us — changing it silently stops the map loading with no error.
 */
const META_NAME = 'MAPBOX_ACCESS_TOKEN';

/**
 * A value from the process environment or from the monorepo root `.env`.
 *
 * The file is read directly rather than through `dotenv` because Expo loads
 * `.env` from the app directory and this monorepo keeps one at the root. A
 * developer running `npx expo prebuild` inside `apps/customer-mobile` would
 * otherwise get a tokenless build with no indication why.
 */
function readValue(projectRoot, name) {
  const fromEnv = (process.env[name] || '').trim();
  if (fromEnv) return fromEnv;

  // apps/<app> -> repository root. Walked upward rather than hardcoded, so
  // this keeps working if an app moves.
  let dir = projectRoot;
  for (let depth = 0; depth < 5; depth++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      const line = fs
        .readFileSync(candidate, 'utf8')
        .split(/\r?\n/)
        .find(l => l.trim().startsWith(`${name}=`));
      if (line) {
        return line
          .slice(line.indexOf('=') + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

function withMapboxToken(config) {
  const root = config._internal?.projectRoot || process.cwd();
  const token = readValue(root, ENV_NAME);
  const styleUrl = readValue(root, STYLE_ENV_NAME);

  /*
   * A SECRET TOKEN HERE WOULD BE SHIPPED TO EVERY PHONE.
   *
   * The two token types differ by one character of prefix and are pasted from
   * the same page of the same dashboard, so this is a mistake a careful person
   * makes. Refused rather than warned: a warning scrolls past in a build log,
   * and the consequence is a token that can mint further tokens sitting inside
   * an APK on strangers' phones.
   */
  if (token.startsWith('sk.')) {
    throw new Error(
      `[withMapboxToken] ${ENV_NAME} is a SECRET token (sk.*). ` +
        'Secret tokens must never be built into an app. Use the public token (pk.*).'
    );
  }

  // Recorded on `extra` so `Constants.expoConfig.extra` can answer "is there a
  // token in this build?" in JavaScript, and so the map library can be given
  // the token without a second copy of this file-reading logic.
  config.extra = {
    ...(config.extra || {}),
    mapboxConfigured: Boolean(token),
    mapboxAccessToken: token || '',
    ...(styleUrl ? { mapboxStyleUrl: styleUrl } : {})
  };

  if (!token) {
    console.warn(
      `\n  [withMapboxToken] No ${ENV_NAME} found.\n` +
        `  Maps will fall back to the drawn map in this build.\n` +
        `  Set it in the repository-root .env to build with real maps.\n`
    );
    return config;
  }

  return withAndroidManifest(config, cfg => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    // addMetaDataItemToMainApplication replaces an existing entry of the same
    // name rather than appending a second. Two entries with this name is a
    // manifest merge failure that only shows at assemble time.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, META_NAME, token);

    return cfg;
  });
}

module.exports = withMapboxToken;
