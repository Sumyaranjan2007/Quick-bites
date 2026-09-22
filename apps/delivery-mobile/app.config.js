/**
 * Adds the Mapbox native SDK to the build, with its download token supplied
 * from the environment rather than from app.json.
 *
 * WHY THIS FILE EXISTS AT ALL.
 *
 * The Mapbox Android SDK is not on any public Maven repository. It is served
 * from Mapbox's own, which requires authentication with a SECRET token
 * carrying the `DOWNLOADS:READ` scope. Without it Gradle searches Maven
 * Central, Google and JitPack, finds nothing, and fails with
 * "Could not find com.mapbox.maps:android-ndk27" - which reads as a broken
 * dependency rather than a missing credential.
 *
 * The `@rnmapbox/maps` config plugin takes that token as a plugin OPTION, and
 * its own documentation shows it written directly into app.json. That is
 * correct for a private repository and wrong for this one: app.json is
 * committed, this repository is public, and a secret token with the scope to
 * download SDKs is exactly the kind of credential scrapers watch for.
 *
 * So app.json stays the source of truth for everything else and this file adds
 * only the part that must not be committed. Expo prefers app.config.js when
 * both exist, and reading app.json here means the two cannot drift.
 *
 * THIS TOKEN IS USED AT BUILD TIME AND NEVER SHIPPED. It authenticates a
 * download on the machine doing the building. The token that goes INSIDE the
 * app is the publishable `pk.` one, written into the manifest by
 * withMapboxToken. Two tokens, two purposes, and `check-apk-secrets.mjs`
 * fails the build if the secret one ever reaches an artifact.
 *
 * A MISSING DOWNLOAD TOKEN IS A LOUD FAILURE, deliberately, and it is the one
 * place in this project where that is right. Everything else here degrades:
 * no Maps key means a drawn map, no Firebase file means no push. But a build
 * without this token does not produce a worse app - it produces no app, and
 * Gradle's own message points at the wrong thing. Better to say so here.
 */
const fs = require('fs');
const path = require('path');
const appJson = require('./app.json');

/**
 * The token, from the process environment or from the monorepo root `.env`.
 *
 * Expo loads `.env` from the APP directory and this monorepo keeps one at the
 * root, so `process.env` alone would be empty for anyone who set it where
 * every other secret in this project lives. They would then get the same
 * "could not find com.mapbox.maps" failure as someone who set nothing, which
 * is the worst possible outcome: correct configuration, identical error.
 *
 * Walked upward rather than hardcoded, so this keeps working if an app moves.
 */
function readToken() {
  const fromEnv = (process.env.MAPBOX_DOWNLOAD_TOKEN || '').trim();
  if (fromEnv) return fromEnv;

  let dir = __dirname;
  for (let depth = 0; depth < 5; depth++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      const line = fs
        .readFileSync(candidate, 'utf8')
        .split(String.fromCharCode(10))
        .find(l => l.trim().startsWith('MAPBOX_DOWNLOAD_TOKEN='));
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

const DOWNLOAD_TOKEN = readToken();

if (DOWNLOAD_TOKEN && !DOWNLOAD_TOKEN.startsWith('sk.')) {
  throw new Error(
    '[app.config] MAPBOX_DOWNLOAD_TOKEN must be a SECRET token (sk.*) with the ' +
      'DOWNLOADS:READ scope. A publishable pk.* token cannot authenticate the SDK ' +
      'download, and Gradle will fail with a confusing "could not find" error.'
  );
}

module.exports = ({ config }) => {
  const expo = { ...appJson.expo, ...config };

  if (!DOWNLOAD_TOKEN) {
    console.warn(
      '\n  [app.config] No MAPBOX_DOWNLOAD_TOKEN in the environment.\n' +
        '  The Mapbox Android SDK cannot be downloaded and this build WILL FAIL\n' +
        '  with "Could not find com.mapbox.maps:...". Create a secret token with\n' +
        '  the DOWNLOADS:READ scope at mapbox.com and set it in the root .env.\n'
    );
    return expo;
  }

  return {
    ...expo,
    plugins: [
      ...(expo.plugins || []),
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsDownloadToken: DOWNLOAD_TOKEN
        }
      ]
    ]
  };
};
