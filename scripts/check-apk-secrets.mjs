#!/usr/bin/env node
/**
 * Does a built artifact contain anything it should not?
 *
 * `check-secrets.mjs` reads tracked source files. An APK is neither: it is a
 * zip of a JavaScript bundle produced by a bundler that inlines constants,
 * folds `__DEV__` branches, and embeds whatever the app's config resolved to at
 * build time. A credential can therefore be absent from every file in the
 * repository and present in the binary handed to testers.
 *
 * Specifically worth checking, because each has nearly happened here:
 *
 *   - A development default that `__DEV__` was supposed to strip. The rider
 *     app's sign-in screen holds `useState(__DEV__ ? 'pass123' : '')`. That is
 *     correct, and it is correct only as long as the release build really does
 *     fold the branch out.
 *   - A Razorpay key id or secret inlined from configuration.
 *   - A JWT secret, which has no business in a client at all.
 *   - Any value from the gitignored `.env`.
 *
 * Reads the real values from `.env` at runtime and never prints them, in the
 * same way `check-secrets.mjs` does: a scanner that echoes what it found is a
 * scanner that publishes it to a build log.
 *
 * Run: node scripts/check-apk-secrets.mjs
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APK_DIR = path.join(ROOT, 'build/apk');

let problems = 0;
const fail = m => {
  console.log(`[FAIL] ${m}`);
  problems++;
};
const pass = m => console.log(`[PASS] ${m}`);

/**
 * Placeholder-looking values are skipped, exactly as in check-secrets.mjs.
 * Without this the scanner flags `your-key-here` and everyone learns to ignore
 * it, which is worse than not having a scanner.
 */
const PLACEHOLDER = /^(your-|sample|change-?me|set-this|placeholder|local-development|xxx|todo|<)/i;

/*
 * VALUES THAT ARE MEANT TO BE IN THE APP.
 *
 * Not every name matching /KEY|TOKEN/ is a secret. Some are publishable by
 * design, ship inside the binary on purpose, and are protected by a
 * restriction set in the provider's console rather than by being hidden.
 * Flagging them would fail every honest build, and a check that always fails
 * is one people learn to ignore - which costs more than the gap it was
 * guarding.
 *
 * Each entry here is a deliberate decision that extraction is harmless, not a
 * convenience. Anything not listed is treated as a secret.
 */
const PUBLISHABLE = new Set([
  // Mapbox pk.* - compiled into the app so the map can fetch tiles. Mapbox's
  // own model assumes it is extractable; the account's URL and scope
  // restrictions are what protect it.
  'MAPBOX_PUBLIC_TOKEN',
  // The Android Maps key was package-name and SHA-1 restricted for the same
  // reason. Retained so a build made from an older .env does not fail.
  'GOOGLE_MAPS_ANDROID_KEY'
]);

function secretsFromEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return [];
  const out = [];
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    const [, name, raw] = match;
    const value = raw.replace(/^['"]|['"]$/g, '');
    // Short values produce false positives against a two-megabyte bundle.
    if (value.length < 12) continue;
    if (PLACEHOLDER.test(value)) continue;
    if (!/SECRET|KEY|TOKEN|PASSWORD|DSN|URI|URL/.test(name)) continue;
    if (PUBLISHABLE.has(name)) continue;
    out.push({ name, value });
  }
  return out;
}

/**
 * Patterns that are wrong in a client binary no matter what `.env` says.
 *
 * `rzp_test_` is deliberately absent: the key ID is meant to reach the client,
 * that is what it is for. The SECRET is what must never appear, and it is
 * matched through the `.env` values above.
 */
const FORBIDDEN = [
  { label: 'a live Razorpay key', pattern: /rzp_live_[A-Za-z0-9]{6,}/ },
  { label: 'a private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'the seeded development password', pattern: /pass123/ },
  { label: 'an AWS access key id', pattern: /AKIA[0-9A-Z]{16}/ },
  /**
   * Any Google API key at all, in the JavaScript bundle.
   *
   * There are two Google keys in this project and NEITHER belongs here.
   *
   * The Android Maps key is written into AndroidManifest.xml by the
   * `withGoogleMapsApiKey` config plugin, because that is where the native
   * Maps SDK reads it from. It is restricted by package name and release
   * SHA-1, so shipping it is Google's intended model — but it still has no
   * reason to be in the JS bundle, and finding it there means somebody has
   * added a second copy by hand.
   *
   * The SERVER key is the one that matters. It cannot be package-restricted,
   * it bills per call, and it lives only in Railway behind the `/places` and
   * routing endpoints. A developer who "just needs the key on the client"
   * would reach for the same `AIza...` string, and this is the line that stops
   * that reaching a release.
   *
   * Matched by shape rather than by value because the server key is not in any
   * local `.env` — it is only ever set on the deployment — so the value-based
   * check above could never see it.
   */
  {
    label: 'a Google API key (neither Google key belongs in the JS bundle)',
    pattern: /AIza[0-9A-Za-z_-]{35}/,
    /*
     * BUNDLE ONLY, and the scope is the whole point.
     *
     * google-services.json legitimately contains an AIza key - it is the
     * Firebase client key, it ships in every Android app that uses Firebase,
     * and Google's model assumes it is readable. It lands in the packaged
     * resources, so scanning those for this pattern fails every build that has
     * notifications configured.
     *
     * The danger this rule was written for is the Maps SERVER key, which
     * cannot be restricted and would reach the client only by somebody pasting
     * it into application code. That lands in the JavaScript bundle.
     */
    scope: 'bundle'
  },
  /**
   * A MAPBOX SECRET TOKEN, ANYWHERE IN AN ARTIFACT.
   *
   * Mapbox issues two kinds and they differ by one character of prefix:
   *
   *   pk.*  public. Ships inside the APK by design, restricted in the account,
   *         and is what the map view uses. Expected, and not matched here.
   *   sk.*  secret. Downloads the SDK at build time and can create further
   *         tokens, including public ones. Never belongs in an artifact.
   *
   * They are pasted from the same page of the same dashboard, which is what
   * makes this worth a check rather than a convention. The config plugin
   * already refuses an sk.* token at build time; this is the second line, for
   * a copy that arrived some other way - hardcoded in a screen, pasted into a
   * config file, committed in a fixture.
   *
   * Matched by shape rather than value: the secret token is not in any local
   * .env by design, so the value-based check above could never see it.
   */
  { label: 'a Mapbox SECRET token (sk.*) - only pk.* may ship', pattern: /(^|[^A-Za-z0-9])sk[.][A-Za-z0-9_-]{20,}/ }
];

console.log('====================================================');
console.log('        SCANNING BUILT APKS FOR CREDENTIALS        ');
console.log('====================================================\n');

// Not `process.exit` — that used to return "clean" for a machine that had
// simply never built the apps, and it skipped the web portals below entirely.
// A missing artifact is a thing to say out loud, not a pass and not an abort.
const apks = fs.existsSync(APK_DIR)
  ? fs.readdirSync(APK_DIR).filter(f => f.endsWith('.apk'))
  : [];

if (apks.length === 0) {
  console.log('[SKIP] No APKs in build/apk — nothing to scan there. Build them first.');
}

const envSecrets = secretsFromEnv();
console.log(
  `[INFO] Matching ${envSecrets.length} credential(s) from .env, plus ` +
    `${FORBIDDEN.length} always-forbidden pattern(s), against ${apks.length} APK(s) ` +
    `and the web builds.\n`
);

for (const apk of apks) {
  const full = path.join(APK_DIR, apk);
  /*
   * MORE THAN THE JAVASCRIPT BUNDLE, because a secret reached a release
   * through the gap.
   *
   * This read only `assets/index.android.bundle` and reported "no credentials"
   * on three APKs that each contained a Mapbox SECRET token. The token was in
   * `assets/app.config` - Expo serialises the fully resolved config, plugin
   * options included, and packages it. The scanner was looking in the one
   * place it was not.
   *
   * So every packaged asset that can carry a string is read. The bundle is
   * still required to exist and be a plausible size, because an APK with no
   * bundle is a broken build rather than a clean one - but a missing
   * app.config is not an error, since only Expo builds have one.
   */
  const REQUIRED_ENTRIES = ['assets/index.android.bundle'];
  const OPTIONAL_ENTRIES = ['assets/app.config', 'resources.arsc', 'AndroidManifest.xml'];

  const readEntry = entry => {
    try {
      // -p writes to stdout. Each entry is a few megabytes at most, which is
      // fine to hold; the APK as a whole is fifty-odd and is not.
      return execFileSync('unzip', ['-p', full, entry], {
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'latin1'
      });
    } catch {
      return null;
    }
  };

  let bundle = '';
  /** The JavaScript bundle alone, for rules scoped to it. */
  let jsBundle = '';
  let missingRequired = false;
  for (const entry of REQUIRED_ENTRIES) {
    const text = readEntry(entry);
    if (text === null) {
      fail(`${apk}: could not read ${entry} out of it`);
      missingRequired = true;
      break;
    }
    if (text.length < 10000) {
      fail(`${apk}: its JavaScript bundle is ${text.length} bytes, which cannot be a real app`);
      missingRequired = true;
      break;
    }
    bundle += text;
    jsBundle += text;
  }
  if (missingRequired) continue;

  for (const entry of OPTIONAL_ENTRIES) {
    const text = readEntry(entry);
    if (text) bundle += String.fromCharCode(10) + text;
  }

  let found = 0;

  for (const secret of envSecrets) {
    if (bundle.includes(secret.value)) {
      // The NAME, never the value.
      fail(`${apk} contains the value of ${secret.name} from .env`);
      found++;
    }
  }

  for (const rule of FORBIDDEN) {
    // A rule may narrow itself to the JavaScript bundle. Everything else is
    // checked against every packaged asset, which is what let a secret token
    // through in `assets/app.config`.
    const haystack = rule.scope === 'bundle' ? jsBundle : bundle;
    if (rule.pattern.test(haystack)) {
      fail(`${apk} contains ${rule.label}`);
      found++;
    }
  }

  if (found === 0) {
    pass(`${apk} — ${(bundle.length / 1024 / 1024).toFixed(1)} MB bundle, nothing sensitive in it`);
  }
}

// ---------------------------------------------------------------------------
// The web portals, for the same reason.
//
// Vite inlines every `VITE_*` variable into the bundle it emits, so a secret
// added to `.env` with that prefix is published to every visitor the moment the
// portal is deployed — with no warning, and nothing in the source to see.
// ---------------------------------------------------------------------------
const WEB_APPS = ['apps/admin-web/dist', 'apps/restaurant-web/dist'];

function filesUnder(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, out);
    else out.push(full);
  }
  return out;
}

for (const relative of WEB_APPS) {
  const dir = path.join(ROOT, relative);
  if (!fs.existsSync(dir)) {
    console.log(`[SKIP] ${relative} has not been built`);
    continue;
  }

  const files = filesUnder(dir);
  let found = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'latin1');
    const name = path.relative(ROOT, file).replace(/\\/g, '/');

    for (const secret of envSecrets) {
      if (content.includes(secret.value)) {
        fail(`${name} contains the value of ${secret.name} from .env`);
        found++;
      }
    }
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(content)) {
        fail(`${name} contains ${rule.label}`);
        found++;
      }
    }
  }

  if (found === 0) pass(`${relative} — ${files.length} files, nothing sensitive in them`);
}

console.log('');
console.log('====================================================');
if (problems === 0) {
  console.log('  NO CREDENTIALS IN ANY BUILT ARTIFACT             ');
  console.log('====================================================\n');
  process.exit(0);
}
console.log(`  ${problems} PROBLEM(S) — DO NOT DISTRIBUTE THESE BUILDS    `);
console.log('====================================================\n');
process.exit(1);
