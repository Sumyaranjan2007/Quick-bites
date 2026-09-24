#!/usr/bin/env node
/**
 * Runs the backend suites, each in its own process with its own data directory.
 *
 * They used to be a single `&&` chain in package.json, and every one of them
 * wrote to the same `apps/backend-api/data/store.json`. Two consequences, both
 * of which actually happened:
 *
 *   - A suite that finishes with a debounced write still in flight exits while
 *     the file is half written. The next suite loads it, the parse fails, the
 *     server never starts, and every check in that suite reports "the server
 *     does not handle it". The defect is reported against the wrong suite, in
 *     the wrong file, about routes that are perfectly fine. That is worse than
 *     no test at all, because somebody then goes looking for a routing bug.
 *
 *   - Running the tests overwrote whatever was in a developer's local store.
 *
 * Both disappear once each suite gets a directory of its own. The directories
 * are disposable and are cleared before the run, so no suite can inherit an
 * assumption from the last one either.
 *
 * Run: node scripts/run-backend-tests.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'apps/backend-api');

// Order matters only in that the cheap ones run first: a syntax error should be
// reported in five seconds, not after the slow end-to-end suites.
const SUITES = [
  'health',
  'db',
  'orders',
  'search',
  'routing',
  'membership',
  'ledger',
  'payees',
  'bankChain',
  'payouts',
  'refunds',
  'cash',
  'cashLocations',
  'charges',
  'itemPricing',
  'deliveryMarkup',
  'routes',
  'statements',
  'policies',
  'payoutPromise',
  'gatewaySettlements',
  'moneyReached',
  'adminEverything',
  'moneyPaths',
  'adminErrorStates',
  'routeContract',
  'lifecycleMoney',
  'settlementsAgree',
  'ratesAndSwitches',
  'adminSections',
  'adminPush',
  'orderMap',
  'riderTripPush',
  'carryingWatch',
  'platformReset',
  'accountBlocking',
  'profileEdits',
  'identity',
  'notifications',
  'kitchenPush',
  'offers',
  'sockets',
  'sockets.security',
  'otp',
  'onboarding',
  'payments',
  'security',
  'pipeline',
  'admin',
  'partner',
  'features',
  'contract',
  'resilience',
  'platform',
  'flows',
  'regression'
];

/*
 * EVERY SUITE ON DISK IS NAMED ABOVE, AND THAT IS CHECKED.
 *
 * The list already refuses a name with no file. The reverse — a FILE with no
 * name — was silent, and it is the dangerous direction: the gate prints "ALL
 * SUITES PASSED" and exits 0 while a suite that would have failed never ran.
 * It happened. A workstream's own suite was written, was failing, and the gate
 * was green.
 *
 * A rule saying "remember to add it to the runner" is exactly how that
 * happened, so it is a check instead. Deleting a suite from the list is still
 * allowed; doing it silently is not.
 */
function assertEverySuiteIsListed() {
  const dir = path.join(BACKEND, 'src/test');
  const onDisk = fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.test.ts'))
    .map(name => name.slice(0, -'.test.ts'.length));

  const listed = new Set(SUITES);
  const unlisted = onDisk.filter(name => !listed.has(name));
  if (unlisted.length === 0) return;

  console.log('');
  console.log('====================================================');
  console.log(`  ${unlisted.length} SUITE(S) EXIST BUT ARE NOT IN THE RUNNER`);
  for (const name of unlisted) {
    console.log(`    src/test/${name}.test.ts`);
  }
  console.log('  They would never run, and this gate would be green.');
  console.log('  Add them to SUITES above, or delete the files.');
  console.log('====================================================');
  console.log('');
  process.exit(1);
}

assertEverySuiteIsListed();

const SANDBOX = path.join(os.tmpdir(), 'quick-bites-test-data');
fs.rmSync(SANDBOX, { recursive: true, force: true });

const failures = [];
const started = Date.now();

for (const suite of SUITES) {
  const file = path.join(BACKEND, `src/test/${suite}.test.ts`);
  if (!fs.existsSync(file)) {
    console.log(`\n[MISSING] src/test/${suite}.test.ts — the runner names a suite that is not there`);
    failures.push(suite);
    continue;
  }

  const dataDir = path.join(SANDBOX, suite);
  fs.mkdirSync(dataDir, { recursive: true });

  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', `src/test/${suite}.test.ts`],
    {
      cwd: BACKEND,
      stdio: 'inherit',
      env: { ...process.env, QB_DATA_DIR: dataDir }
    }
  );

  if (result.status !== 0) failures.push(suite);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log('');
console.log('====================================================');
if (failures.length === 0) {
  console.log(`  ALL ${SUITES.length} BACKEND SUITES PASSED in ${seconds}s`);
  console.log('====================================================\n');
  process.exit(0);
}
console.log(`  ${failures.length} SUITE(S) FAILED: ${failures.join(', ')}`);
console.log('====================================================\n');
process.exit(1);
