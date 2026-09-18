#!/usr/bin/env node
/**
 * Does a built APK contain anything it should not?
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
  { label: 'an AWS access key id', pattern: /AKIA[0-9A-Z]{16}/ }
];

console.log('====================================================');
console.log('        SCANNING BUILT APKS FOR CREDENTIALS        ');
console.log('====================================================\n');

if (!fs.existsSync(APK_DIR)) {
  console.log('[SKIP] build/apk does not exist. Build the apps first.\n');
  process.exit(0);
}

const apks = fs.readdirSync(APK_DIR).filter(f => f.endsWith('.apk'));
if (apks.length === 0) {
  console.log('[SKIP] No APKs in build/apk. Build the apps first.\n');
  process.exit(0);
}

const envSecrets = secretsFromEnv();
console.log(
  `[INFO] Matching ${envSecrets.length} credential(s) from .env, plus ` +
    `${FORBIDDEN.length} always-forbidden pattern(s), against ${apks.length} APK(s).\n`
);

for (const apk of apks) {
  const full = path.join(APK_DIR, apk);
  let bundle;
  try {
    // -p writes to stdout. The bundle is a couple of megabytes, which is fine
    // to hold; the APK as a whole is fifty-odd and is not.
    bundle = execFileSync('unzip', ['-p', full, 'assets/index.android.bundle'], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'latin1'
    });
  } catch {
    fail(`${apk}: could not read assets/index.android.bundle out of it`);
    continue;
  }

  if (!bundle || bundle.length < 10000) {
    fail(`${apk}: its JavaScript bundle is ${bundle?.length ?? 0} bytes, which cannot be a real app`);
    continue;
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
    if (rule.pattern.test(bundle)) {
      fail(`${apk} contains ${rule.label}`);
      found++;
    }
  }

  if (found === 0) {
    pass(`${apk} — ${(bundle.length / 1024 / 1024).toFixed(1)} MB bundle, nothing sensitive in it`);
  }
}

console.log('');
console.log('====================================================');
if (problems === 0) {
  console.log('  NO CREDENTIALS IN ANY BUILT APK                  ');
  console.log('====================================================\n');
  process.exit(0);
}
console.log(`  ${problems} PROBLEM(S) — DO NOT DISTRIBUTE THESE APKS     `);
console.log('====================================================\n');
process.exit(1);
