#!/usr/bin/env node
/**
 * Does the production build behave like a production build?
 *
 * Every backend suite runs with `NODE_ENV=test`, which means the behaviours
 * that only exist in production have never been executed by anything. Those
 * behaviours are not minor:
 *
 *   - It must REFUSE to boot with no administrator, rather than coming up with
 *     no way in. That refusal is the thing standing between the owner and a
 *     deployment nobody can administer.
 *   - It must refuse to boot with no signing secret, rather than falling back
 *     to a literal — the source is public, so a fallback is a published key.
 *   - It must start EMPTY. A demonstration restaurant that a real customer can
 *     order from is worse than an empty screen.
 *   - Demo bearer tokens must be dead.
 *   - A fixed OTP must be refused unless deliberately opted into.
 *
 * Each case starts a real server in a real child process with a real
 * environment, because that is the only way to observe a refusal to start.
 *
 * Run: node scripts/check-production-boot.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'apps/backend-api');

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-prod-boot-'));
let dataDirCounter = 0;

/** An empty directory, so each boot is a deployment that has never run before. */
function freshDataDir() {
  const dir = path.join(TEMP_ROOT, `data-${dataDirCounter++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let passed = 0;
let failed = 0;

function check(description, condition, detail = '') {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.log(`[FAIL] ${description}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

/**
 * Boots the server with the given environment and reports what happened.
 *
 * Resolves when the server is listening, or when the process exits — whichever
 * comes first. A refusal to start is a successful outcome for most of the cases
 * below, so both are normal results rather than errors.
 */
function boot(env, port) {
  return new Promise(resolve => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', 'src/server.ts'],
      {
        cwd: BACKEND,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PORT: String(port),
          // Everything the production build refuses without is supplied here by
          // default; each case then REMOVES exactly one, so a failure names a
          // single cause rather than a pile of them.
          JWT_SECRET: 'production-boot-test-secret-that-is-long-enough-to-pass',
          ADMIN_EMAIL: 'boot-test@quickbites.test',
          ADMIN_PASSWORD: 'a-long-enough-password',
          RAZORPAY_KEY_SECRET: 'boot-test-secret',
          SEED_DEMO_DATA: 'false',
          DATABASE_URL: '',
          // No database here, so the file-persistence escape hatch is opened
          // deliberately — production refuses without it, which is itself one
          // of the cases below.
          ALLOW_FILE_PERSISTENCE: 'true',
          // Each boot gets its OWN empty data directory.
          //
          // Without this, "does production start empty?" was answered against
          // whatever this machine happened to have in `apps/backend-api/data`,
          // and reported four seeded restaurants in a production deployment
          // that had never seeded anything. A test that reads the developer's
          // own leftovers is not testing the product.
          QB_DATA_DIR: freshDataDir(),
          ...env
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr, child });
    };

    child.stdout.on('data', d => {
      stdout += d.toString();
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
    });
    child.on('exit', code => finish({ started: false, exitCode: code }));

    // Readiness is "the port answers", not "a log line appeared".
    //
    // This used to match /listening|running on|started/ against stdout, which
    // meant any future log line containing the word "started" — say
    // ORDER_SWEEPER_STARTED — declared the server ready before it was
    // listening. Every request that followed was then refused by a socket that
    // did not exist yet, and the failure was reported against the endpoint
    // rather than against the check. Polling the health endpoint cannot be
    // broken by anything anyone logs.
    const deadline = Date.now() + 15000;
    const poll = async () => {
      if (settled) return;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.ok || res.status < 500) {
          finish({ started: true });
          return;
        }
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) {
        finish({ started: false, timedOut: true });
        return;
      }
      setTimeout(poll, 150);
    };
    setTimeout(poll, 150);

    // A backstop, so a child that neither answers nor exits cannot stall the run.
    const timer = setTimeout(() => finish({ started: false, timedOut: true }), 16000);
  });
}

function kill(result) {
  try {
    result.child?.kill();
  } catch {
    /* already gone */
  }
}

async function get(port, urlPath) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: null, error: String(err) };
  }
}

console.log('====================================================');
console.log('     CHECKING PRODUCTION CONFIGURATION BEHAVIOUR   ');
console.log('====================================================\n');

const basePort = 7100 + Math.floor(Math.random() * 300);

console.log('--- It must refuse to start without an administrator ---');

const noEmail = await boot({ ADMIN_EMAIL: '' }, basePort);
check('No ADMIN_EMAIL: the service refuses to start', !noEmail.started,
  `it started anyway (exit ${noEmail.exitCode})`);
check('and says why', /ADMIN_EMAIL|administrator|admin/i.test(noEmail.stderr + noEmail.stdout),
  'the failure gave no usable reason');
kill(noEmail);

const noPassword = await boot({ ADMIN_PASSWORD: '' }, basePort + 1);
check('No ADMIN_PASSWORD: the service refuses to start', !noPassword.started);
kill(noPassword);

const shortPassword = await boot({ ADMIN_PASSWORD: 'short' }, basePort + 2);
check('A too-short ADMIN_PASSWORD is refused', !shortPassword.started,
  'a five-character admin password was accepted in production');
kill(shortPassword);

const noSecret = await boot({ JWT_SECRET: '' }, basePort + 3);
check('No JWT_SECRET: the service refuses to start', !noSecret.started,
  'it would have fallen back to a value published in a public repository');
kill(noSecret);

// A production service with no database writes to a container filesystem that
// is thrown away on the next deploy. It used to come up HEALTHY and do exactly
// that, losing every order placed in between.
const noDatabase = await boot({ ALLOW_FILE_PERSISTENCE: '' }, basePort + 4);
check('No DATABASE_URL: the service refuses to start', !noDatabase.started,
  'it started with no durable storage and would have silently discarded every order');
check('and says the orders would be lost',
  /DATABASE_URL|discarded|restart/i.test(noDatabase.stderr + noDatabase.stdout),
  'the refusal did not explain itself');
kill(noDatabase);

console.log('\n--- With everything set, it starts — and starts empty ---');

const port = basePort + 10;
const good = await boot({}, port);
check('With all required variables set, the service starts', good.started,
  `it refused: ${(good.stderr || good.stdout).slice(-300)}`);

if (good.started) {
  const health = await get(port, '/health');
  check('and answers /health', health.status === 200, `status ${health.status}`);
  check('reporting HEALTHY', /HEALTHY/i.test(JSON.stringify(health.body)),
    JSON.stringify(health.body)?.slice(0, 200));
  check('with demo mode OFF — forced, whatever the host sets',
    JSON.stringify(health.body).includes('"demoMode":false'),
    'demo bearer tokens bypass authentication entirely');

  const restaurants = await get(port, '/api/restaurants');
  const list = restaurants.body?.data?.restaurants ?? [];
  check('The platform starts with NO restaurants', list.length === 0,
    `${list.length} restaurant(s) were seeded into production`);

  // A demo token is a complete authentication bypass. In production it must be
  // an ordinary invalid token.
  const demo = await fetch(`http://127.0.0.1:${port}/api/orders`, {
    headers: { Authorization: 'Bearer demo-admin-token' }
  }).then(r => r.status).catch(() => 0);
  check('A demo bearer token is rejected', demo === 401 || demo === 403, `status ${demo}`);

  // The fixed OTP is a six-digit master key to every account. Production must
  // refuse it unless the owner has deliberately turned it on.
  const otp = await fetch(`http://127.0.0.1:${port}/api/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210' })
  })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))
    .catch(() => ({ status: 0, body: null }));
  check('A fixed OTP is refused in production unless opted into',
    otp.status >= 400,
    `status ${otp.status} — anyone knowing six digits could sign in as anyone`);
}
kill(good);

console.log('\n--- And with the opt-in, testers can sign in ---');

const optedIn = await boot({ OTP_ALLOW_FIXED_IN_PRODUCTION: 'true', OTP_FIXED_CODE: '472913' }, basePort + 20);
check('With OTP_ALLOW_FIXED_IN_PRODUCTION it still starts', optedIn.started);
if (optedIn.started) {
  const otp = await fetch(`http://127.0.0.1:${basePort + 20}/api/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210' })
  })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))
    .catch(() => ({ status: 0 }));
  check('and a verification code can be requested', otp.status === 200, `status ${otp.status}`);
  check('but the code itself is never in the response',
    !JSON.stringify(otp.body || {}).includes('472913'),
    'the code was echoed back, which is an open door');
}
kill(optedIn);

console.log('');
console.log('====================================================');
if (failed === 0) {
  console.log(`   ALL ${passed} PRODUCTION CONFIGURATION CHECKS PASSED  `);
  console.log('====================================================\n');
  process.exit(0);
}
console.log(`   ${failed} PRODUCTION CONFIGURATION CHECK(S) FAILED      `);
console.log('====================================================\n');
process.exit(1);
