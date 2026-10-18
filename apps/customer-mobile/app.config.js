/**
 * Adds the Google Maps keys to the build, read from the environment or the
 * monorepo root `.env`, never from app.json (this repository is public).
 *
 * Google Maps replaced Mapbox in the apps on 18 Oct 2026 (owner; master plan C2).
 * The keys are built into the app on purpose: Google's model assumes an app key
 * is extractable, and what protects it is the restriction set in the Google
 * Cloud console (Android: package name + SHA-1; iOS: bundle id). They are
 * listed as publishable in scripts/check-apk-secrets.mjs. The SERVER key
 * (GOOGLE_MAPS_SERVER_KEY) never comes near an app.
 *
 * No key is not a failed build: `extra` records which platforms have one, and
 * the map falls back to the drawn view (src/lib/nativeMap.ts).
 */
const fs = require('fs');
const path = require('path');
const appJson = require('./app.json');

/** A value from the process environment, else from the nearest `.env` upward. */
function readEnv(name) {
  const fromEnv = (process.env[name] || '').trim();
  if (fromEnv) return fromEnv;
  let dir = __dirname;
  for (let depth = 0; depth < 5; depth++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      const line = fs
        .readFileSync(candidate, 'utf8')
        .split(/\r?\n/)
        .find(l => l.trim().startsWith(`${name}=`));
      if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

const ANDROID_KEY = readEnv('GOOGLE_MAPS_ANDROID_KEY');
const IOS_KEY = readEnv('GOOGLE_MAPS_IOS_KEY');

module.exports = ({ config }) => {
  const expo = { ...appJson.expo, ...config };
  if (!ANDROID_KEY) {
    console.warn('\n  [app.config] No GOOGLE_MAPS_ANDROID_KEY: the Android map will show the drawn fallback.\n');
  }
  return {
    ...expo,
    android: {
      ...expo.android,
      config: { ...(expo.android && expo.android.config), ...(ANDROID_KEY ? { googleMaps: { apiKey: ANDROID_KEY } } : {}) }
    },
    // iPhone: Expo's own Maps plugin reads ios.config.googleMapsApiKey (react-native-maps 1.20 has no plugin).
    ...(expo.ios
      ? { ios: { ...expo.ios, config: { ...expo.ios.config, ...(IOS_KEY ? { googleMapsApiKey: IOS_KEY } : {}) } } }
      : {}),
    extra: { ...expo.extra, googleMapsAndroid: Boolean(ANDROID_KEY), googleMapsIos: Boolean(IOS_KEY && expo.ios) }
  };
};
