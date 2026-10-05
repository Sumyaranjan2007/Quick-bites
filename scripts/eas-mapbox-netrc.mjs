/**
 * Lets CocoaPods download the Mapbox iOS SDK, which Mapbox serves only to a
 * request carrying the SECRET download token (sk.*).
 *
 * Runs as the customer app's `eas-build-pre-install` hook on EAS, and by hand
 * on a Mac before `pod install` (docs/app-store/IOS.md). The token goes into
 * the build machine's ~/.netrc and nowhere else: not the project, not the
 * Podfile, not a plugin option — plugin options are serialised into the app,
 * which is how the Android build once shipped it (see app.config.js).
 *
 * Token from the environment (an EAS secret), else the repository-root .env.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// EAS runs the hook for Android builds too; Android reads the token from gradle.properties.
if (process.env.EAS_BUILD_PLATFORM && process.env.EAS_BUILD_PLATFORM !== 'ios') process.exit(0);

function fromRootEnv() {
  try {
    const line = fs
      .readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .find(l => l.trim().startsWith('MAPBOX_DOWNLOAD_TOKEN='));
    return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

const token = (process.env.MAPBOX_DOWNLOAD_TOKEN || '').trim() || fromRootEnv();
if (!token.startsWith('sk.')) {
  console.error(
    'MAPBOX_DOWNLOAD_TOKEN (a secret sk.* token with DOWNLOADS:READ) is not set.\n' +
      'On EAS: expo.dev -> project -> Environment variables. On a Mac: the repository-root .env.'
  );
  process.exit(1);
}

const file = path.join(os.homedir(), '.netrc');
const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
if (!existing.includes('machine api.mapbox.com')) {
  fs.appendFileSync(file, `${existing && !existing.endsWith('\n') ? '\n' : ''}machine api.mapbox.com\nlogin mapbox\npassword ${token}\n`);
}
fs.chmodSync(file, 0o600);
console.log(`Mapbox download access written to ${file}`);
