/**
 * Every route the apps call exists on the server, with the method they use.
 *
 * -------------------------------------------------------------------------
 * TWO FAILURES, POINTING OPPOSITE WAYS
 * -------------------------------------------------------------------------
 * The KYC alert was built, correct, and wired to `POST /kyc/submit` — a route no
 * app calls. A server feature nothing reaches, unnoticed for as long as it existed.
 *
 * The reverse is worse and just as quiet: an app calling a path the server does not
 * have, or having with a different method. Nothing fails at build time. A renamed
 * route, a PUT changed to PATCH, a typo — each ships green, and until W7.1 fourteen
 * admin screens would have rendered the failure as an empty list.
 *
 * -------------------------------------------------------------------------
 * THE SELF-TESTS ARE NOT CEREMONY HERE
 * -------------------------------------------------------------------------
 * This scanner was wrong four times while being written, and every one of those
 * bugs made it report SUCCESS:
 *
 *   - Backreferences mangled to control characters, so it matched nothing at all
 *     and reported every app as clean.
 *   - A single character class for all three quote styles, which truncated a
 *     template literal at its first inner quote.
 *   - A `method:` lookahead of 300 characters, which reached into the next function
 *     and reported half the delivery app as POST.
 *   - `split('?')` to drop the query string, which cut inside a ternary.
 *
 * Three of those produce a clean report from a blind scanner. So the planted probes
 * below are the check, and the app scan is what they license.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import {
  mountedRoutes,
  appCalls,
  unmatchedCalls,
  unmatchedPrefixes,
  normalisePath,
  type MountedRoute
} from './helpers/routeContract.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPS_DIR = path.resolve(HERE, '../../..');

console.log('====================================================');
console.log('  THE APPS AND THE SERVER AGREE ON EVERY ROUTE      ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 700)}`);
  }
}

await seedDatabase();
const app: any = await createApp();
const mounted: MountedRoute[] = mountedRoutes(app);

const APPS = [
  'admin-mobile',
  'restaurant-mobile',
  'delivery-mobile',
  'customer-mobile'
] as const;

const scanned = APPS.map(name => ({
  name,
  ...appCalls(name, path.join(APPS_DIR, name, 'src'))
}));

const allCalls = scanned.flatMap(s => s.calls);
const allUnreadable = scanned.flatMap(s => s.unreadable);
const unmatched = unmatchedCalls(allCalls, mounted);

it('EVERY ROUTE THE APPS CALL EXISTS, WITH THE METHOD THEY USE', () => {
  assert.equal(
    unmatched.length,
    0,
    `these are called by an app and mounted nowhere:\n  ${unmatched
      .map(c => `${c.method} /${c.path}   (${c.app} ${c.file})`)
      .join('\n  ')}`
  );
});

it('and the scan actually read the server, so a clean result is not an empty one', () => {
  /*
   * An empty route table makes every call unmatched, and an empty CALL list makes
   * every route satisfied. The check above passes on the second, so both sides are
   * given a floor.
   */
  assert.ok(mounted.length > 300, `only ${mounted.length} routes were found on the server`);
  assert.ok(allCalls.length > 210, `only ${allCalls.length} app calls were read`);
  /*
   * MEASURED PER APP, not one number for all four.
   *
   * This was `> 10` for every app, and it is the floor that let the admin console
   * report 69 calls and look healthy while every one of its list screens was being
   * skipped. A floor set from a guess licenses whatever the scan happens to find.
   *
   * Each is set a little under what the scan reads today (admin 92, restaurant 30,
   * delivery 42, customer 53), so ordinary churn does not trip it but losing a whole
   * family of calls does.
   */
  const floors: Record<string, number> = {
    'admin-mobile': 85,
    'restaurant-mobile': 26,
    'delivery-mobile': 37,
    'customer-mobile': 47
  };
  for (const one of scanned) {
    const floor = floors[one.name] ?? 10;
    assert.ok(
      one.calls.length >= floor,
      `only ${one.calls.length} calls found in ${one.name}, below its measured floor of ${floor}`
    );
  }
});

it('THE PUSH-TOKEN CALLS EVERY NOTIFICATION DEPENDS ON ARE COVERED', () => {
  /*
   * All four apps register their push token with a RAW `fetch`, not a helper and not
   * `request()`, so the first version of this scan read none of them. They are the
   * two calls the entire notification system rests on: a renamed device route would
   * have stopped every push on the platform and passed the gate in silence.
   *
   * Asserted by name rather than left to the totals, because the totals move for a
   * dozen innocent reasons and these two must never drop out.
   */
  for (const appName of APPS) {
    const mine = scanned.find(s => s.name === appName)!.calls;
    assert.ok(
      mine.some(c => c.method === 'POST' && c.path === '/devices'),
      `${appName} does not register a push token through any call this scan can read`
    );
    assert.ok(
      mine.some(c => c.method === 'DELETE' && c.path === '/devices/:param'),
      `${appName} does not unregister a push token through any call this scan can read`
    );
  }
});

it('AND EVERY QUERY-BUILT PATH IS CHECKED AT ITS PREFIX', () => {
  /*
   * Fifteen of the admin console's list screens build their path as
   * `/admin/x${query({ ... })}`, which cannot be matched whole — the hole could expand
   * to anything, so the scan refuses to guess.
   *
   * Reporting those as "cannot check" and stopping throws away most of what is
   * knowable. The segment before the hole is a real path, and it is the one the screen
   * requests when it opens with no filters. So a renamed list route is caught even
   * though the full path is not.
   */
  const badPrefixes = unmatchedPrefixes(allUnreadable, mounted);
  assert.deepEqual(
    badPrefixes.map(c => `${c.method} /${c.path} (${c.app} ${c.file})`),
    [],
    'these list screens ask for a base path the server does not mount'
  );
  assert.ok(
    allUnreadable.length >= 10,
    `only ${allUnreadable.length} query-built paths were found, so this check is not exercising much`
  );
});

it('and the handful it cannot read are reported rather than counted as fine', () => {
  /*
   * A path glued to a hole — `/earnings/statement${query}` — could expand to
   * anything, so its shape is unknown. Saying so is the point: "we could not check
   * this" and "this is fine" must never look the same. A growing list here means
   * the apps are building paths in a way this cannot follow, and that is worth
   * seeing rather than swallowing.
   */
  assert.ok(
    allUnreadable.length <= 20,
    `${allUnreadable.length} calls could not be read:\n  ${allUnreadable
      .map(c => `${c.method} /${c.path}   (${c.app} ${c.file})`)
      .join('\n  ')}`
  );
});

/* ================================================================ *
 *  PLANTED PROBES — the scanner proving it can still see            *
 * ================================================================ */

const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-routes-'));
const probeSrc = path.join(probeDir, 'src');
fs.mkdirSync(probeSrc);

const write = (name: string, lines: string[]) =>
  fs.writeFileSync(path.join(probeSrc, name), lines.join('\n'));

write('Good.ts', ["export const a = () => api.get('/admin/payouts/dues');"]);
write('Missing.ts', ["export const b = () => api.get('/admin/does-not-exist');"]);
write('WrongMethod.ts', ["export const c = () => api.put('/admin/payouts/dues');"]);
write('TemplateQuotes.ts', [
  'export const d = (r: boolean) =>',
  '  apiFetch(`${apiUrl}/auth/otp/${r ? \'resend\' : \'request\'}`, { method: \'POST\' });'
]);
write('BadBranch.ts', [
  'export const e = (r: boolean) =>',
  '  apiFetch(`${apiUrl}/auth/otp/${r ? \'resend\' : \'nonsense\'}`, { method: \'POST\' });'
]);
write('NotAnHttpMethod.ts', [
  "export const f = () => request(ctx, '/payee-accounts/me', { body: { method: 'BANK' } });"
]);
write('Commented.ts', ["// export const g = () => api.get('/admin/does-not-exist');"]);

const probe = appCalls('probe', probeSrc);
const probeBad = unmatchedCalls(probe.calls, mounted);
const badPaths = new Set(probeBad.map(c => `${c.method} ${c.path}`));
const probeFiles = new Set(probeBad.map(c => c.file));

it('A PLANTED CALL TO A ROUTE THAT DOES NOT EXIST IS CAUGHT', () => {
  assert.ok(badPaths.has('GET /admin/does-not-exist'), `caught: ${[...badPaths].join(', ')}`);
});

it('and so is the RIGHT path with the WRONG method', () => {
  /*
   * The one a path-only check misses entirely, and the likeliest of the set: a route
   * changed from PUT to PATCH during a tidy-up, with one caller left behind.
   */
  assert.ok(badPaths.has('PUT /admin/payouts/dues'), `caught: ${[...badPaths].join(', ')}`);
});

it('and a good call is NOT flagged', () => {
  assert.equal(probeFiles.has('Good.ts'), false, 'a correct call was reported as missing');
});

it('A TEMPLATE PATH CONTAINING QUOTES IS READ, NOT TRUNCATED', () => {
  /*
   * The bug that made this scanner report the customer login screen as calling a
   * route that does not exist. One character class for all three quote styles cuts a
   * backtick template at its first inner quote, and inner quotes are exactly where
   * a choice between two real routes is written.
   */
  assert.equal(
    probeFiles.has('TemplateQuotes.ts'),
    false,
    'a template path with inner quotes was misread as a missing route'
  );
  const both = probe.calls.filter(c => c.file === 'TemplateQuotes.ts').map(c => c.path);
  assert.deepEqual(
    both.sort(),
    ['/auth/otp/request', '/auth/otp/resend'],
    `it expanded to ${JSON.stringify(both)}`
  );
});

it('and BOTH branches of such a path must exist, not just one', () => {
  /*
   * Expanding a choice and passing when any branch matches would be worse than not
   * expanding at all: it would hide the broken half behind the working one.
   */
  assert.ok(
    badPaths.has('POST /auth/otp/nonsense'),
    `the invalid branch was not caught: ${[...badPaths].join(', ')}`
  );
  assert.equal(
    badPaths.has('POST /auth/otp/resend'),
    false,
    'the valid branch was flagged as well'
  );
});

it('and a field called "method" that is not an HTTP method is not used as one', () => {
  /*
   * A payee account has a `method` of BANK or VPA. An earlier version of this scan
   * read that as the verb and reported `BANK /payee-accounts/me` — a route no server
   * could ever have, so every run failed for a reason that had nothing to do with
   * the apps.
   */
  const call = probe.calls.find(c => c.file === 'NotAnHttpMethod.ts');
  assert.ok(call, 'the call was not read at all');
  assert.equal(call!.method, 'GET', `it read the method as ${call!.method}`);
});

it('and a COMMENTED-OUT call is not treated as a call', () => {
  assert.equal(
    probeFiles.has('Commented.ts'),
    false,
    'a commented-out call was reported as a missing route'
  );
  assert.equal(
    probe.calls.some(c => c.file === 'Commented.ts'),
    false,
    'a commented-out call was counted'
  );
});

it('Paths are compared by SHAPE, so parameter names do not matter', () => {
  // `/orders/:id` and `/orders/:orderId` are the same route. Comparing names would
  // report most of the platform as mismatched and the check would be switched off.
  assert.equal(normalisePath('/api/orders/:id/cancel'), normalisePath('/api/orders/:orderId/cancel'));
  assert.equal(normalisePath('/api/orders/${o.id}'), normalisePath('/api/orders/:id'));
  assert.notEqual(normalisePath('/api/orders/:id'), normalisePath('/api/orders/:id/cancel'));
});

fs.rmSync(probeDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 50);
