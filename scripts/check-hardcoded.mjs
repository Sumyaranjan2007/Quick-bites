#!/usr/bin/env node
/**
 * Stops environment-specific values from creeping back into screen code.
 *
 * The production API URL was written out in six places across the four apps —
 * inside a checkout screen, inside two App.tsx files, inside a session module,
 * and twice in the web console. Pointing a build at a different backend meant
 * finding all six, and missing one produced a build that was half against
 * production and half against something else. Each app now has a single
 * `src/config.ts`, and this refuses any other file that hardcodes a host.
 *
 * It deliberately does NOT ban every URL. Icons, map tiles, image CDNs and
 * documentation links are legitimately absolute and have nothing to do with
 * which deployment the app is talking to.
 *
 * Usage: node scripts/check-hardcoded.mjs
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Hosts that identify a deployment rather than a third-party resource. */
const DEPLOYMENT_HOSTS = [
  /https?:\/\/[a-z0-9-]*\.up\.railway\.app/i,
  /https?:\/\/[a-z0-9-]*\.trycloudflare\.com/i,
  /https?:\/\/[a-z0-9-]*\.ngrok[-.][a-z]+/i,
  /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/,
  /https?:\/\/localhost:\d+/
];

/**
 * Files allowed to name a deployment.
 *
 * The per-app config, the documentation that tells a human where to point a
 * build, the environment template, and the backend's own server/test code,
 * which legitimately binds and calls 127.0.0.1.
 */
const ALLOWED = [
  /^apps\/[^/]+\/src\/config\.ts$/,
  /^apps\/backend-api\//,
  /^apps\/(admin|restaurant)-web\/src\/config\.ts$/,
  // Build plugins that exist precisely to describe a local development host —
  // 10.0.2.2 is the Android emulator's route back to the machine running it,
  // and means nothing anywhere else.
  /^packages\/config\/expo-plugins\//,
  /^scripts\//,
  /^docs\//,
  /\.md$/,
  /^\.env\.example$/,
  /^\.github\//,
  /^nginx\//,
  /docker-compose\.yml$/,
  /railway\.json$/
];

const CHECKED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

function trackedFiles() {
  return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => CHECKED_EXT.has(path.extname(f)))
    .filter((f) => !ALLOWED.some((re) => re.test(f)));
}

const findings = [];

for (const file of trackedFiles()) {
  let content;
  try {
    content = fs.readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    continue;
  }

  content.split(/\r?\n/).forEach((line, i) => {
    // A commented line explaining a URL is documentation, not configuration.
    //
    // The `[^:]` matters more than it looks: `https://` contains `//`, so a
    // naive comment strip truncates every line at the scheme and the scanner
    // then reports a clean repository while staring straight at the thing it
    // was written to find. It did exactly that on first run.
    const code = line.replace(/(^|[^:])\/\/.*$/, '$1').replace(/\/\*.*?\*\//g, '');
    for (const re of DEPLOYMENT_HOSTS) {
      const m = code.match(re);
      if (m) {
        findings.push(`${file}:${i + 1} — ${m[0]}`);
        break;
      }
    }
  });
}

console.log('\n====================================================');
if (findings.length === 0) {
  console.log('  NO HARDCODED DEPLOYMENT URLS                     ');
  console.log('====================================================\n');
  process.exit(0);
}

console.log('  HARDCODED DEPLOYMENT URLS FOUND                  ');
console.log('====================================================\n');
for (const f of findings) console.log(`  [HARDCODED] ${f}`);
console.log('\nMove the value into that app\'s src/config.ts and import it.');
console.log('One place to change means a build cannot end up half-pointed at');
console.log('production and half at something else.\n');
process.exit(1);
