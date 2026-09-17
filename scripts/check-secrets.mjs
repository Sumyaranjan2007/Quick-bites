#!/usr/bin/env node
/**
 * Secret leak scanner.
 *
 * Fails if a credential reaches a file git is tracking.
 *
 * The check works in two directions, because either alone is insufficient:
 *
 *   1. LITERAL LEAK. It reads the real values out of `.env` — which git ignores
 *      — and searches every tracked file for them. This catches the actual
 *      accident: a key pasted into a source file, a config, a markdown snippet
 *      or a test fixture. Note that this script therefore contains no secret of
 *      its own; it learns what to look for at runtime and never prints a value,
 *      only the variable name and where it surfaced.
 *
 *   2. PATTERN. Some credentials will never be in this machine's `.env` — a
 *      live Razorpay key belonging to someone else, an AWS key, a private key
 *      block. Those are matched by shape.
 *
 * Placeholder values in `.env.example` are expected and ignored: the whole
 * point of that file is to be committed.
 *
 * Usage: node scripts/check-secrets.js
 * Exit code 0 = clean, 1 = a secret is tracked.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Variable names whose values are credentials rather than configuration. */
const SECRET_NAME = /(SECRET|PASSWORD|TOKEN|PRIVATE|_KEY$|_KEY_|APIKEY|API_KEY)/i;

/**
 * Values that are obviously templates rather than credentials. A placeholder
 * appearing in a tracked file is the correct state, not a leak.
 */
const PLACEHOLDER = /^(your-|sample|change-?me|set-this|placeholder|local-development|xxx|todo|<)/i;

/** Credentials that would never appear in this machine's .env but must never be committed. */
const PATTERNS = [
  { name: 'Razorpay LIVE key id', re: /rzp_live_[A-Za-z0-9]{10,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Slack token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'Firebase service account', re: /"type"\s*:\s*"service_account"/ }
];

/** Tracked files that legitimately contain example credentials. */
const ALLOWED = new Set(['.env.example', 'scripts/check-secrets.js']);

/** Binary and generated files are not searched. */
const SKIP_EXT = new Set([
  '.apk', '.aab', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.ttf',
  '.otf', '.woff', '.woff2', '.zip', '.jar', '.keystore', '.jks', '.pdf', '.mp4'
]);

function loadEnvSecrets() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return [];

  return fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const eq = line.indexOf('=');
      return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() };
    })
    // Only credentials, only real ones, and long enough that a match is not coincidence.
    .filter(({ key, value }) => SECRET_NAME.test(key) && value.length >= 12 && !PLACEHOLDER.test(value));
}

function trackedFiles() {
  return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(f => !ALLOWED.has(f))
    .filter(f => !SKIP_EXT.has(path.extname(f).toLowerCase()));
}

function main() {
  const secrets = loadEnvSecrets();
  const files = trackedFiles();
  const findings = [];

  if (secrets.length === 0) {
    console.log('[INFO] No .env credentials to match against (file absent or placeholders only).');
  } else {
    console.log(`[INFO] Matching ${secrets.length} credential(s) from .env against ${files.length} tracked files.`);
  }

  for (const file of files) {
    const full = path.join(ROOT, file);
    let content;
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue; // unreadable or binary — nothing to check
    }

    // 1. Literal leak of a value this machine actually holds.
    for (const { key, value } of secrets) {
      if (content.includes(value)) {
        const line = content.slice(0, content.indexOf(value)).split('\n').length;
        findings.push(`${file}:${line} — value of ${key} is committed`);
      }
    }

    // 2. Shape of a credential that should never be committed at all.
    for (const { name, re } of PATTERNS) {
      const m = content.match(re);
      if (m) {
        const line = content.slice(0, m.index).split('\n').length;
        findings.push(`${file}:${line} — ${name}`);
      }
    }
  }

  console.log('\n====================================================');
  if (findings.length === 0) {
    console.log('  NO SECRETS IN TRACKED FILES                      ');
    console.log('====================================================');
    process.exit(0);
  }

  console.log('  SECRETS FOUND IN TRACKED FILES — BUILD REFUSED    ');
  console.log('====================================================\n');
  for (const f of findings) console.log(`  [LEAK] ${f}`);
  console.log('\nRemove the value, replace it with a placeholder, read it from');
  console.log('configuration instead, and rotate the credential — it is in git');
  console.log('history even after you delete the line.\n');
  process.exit(1);
}

main();
