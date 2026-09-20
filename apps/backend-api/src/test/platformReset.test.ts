/**
 * Emptying the platform: every guard, and what survives.
 *
 * This is the most destructive endpoint in the product, so the checks that
 * matter most are the ones asserting it REFUSES. A reset that works is easy; a
 * reset that cannot be triggered by a support login, by a script that inherited
 * a boolean, or on a deployment nobody armed is the actual requirement.
 *
 * The last check is the one that keeps somebody's platform usable: wiping the
 * accounts that can sign in to operations, from inside operations, would lock
 * the owner out by pressing the button meant to give them a clean start.
 */
import assert from 'node:assert';
import http from 'http';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';

console.log('====================================================');
console.log('  PLATFORM RESET                                    ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

const PHRASE = 'DELETE ALL PLATFORM DATA';

const server = http.createServer(createApp());

await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
const port = (server.address() as { port: number }).port;
const API = `http://127.0.0.1:${port}/api/v1`;

async function api(path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await api('/auth/login', { email, password });
  return res.json?.data?.token || '';
}

try {
  await seedDatabase();
  resetAuthRateLimit();
  resetRequestRateLimit();

  const superToken = await signIn('admin@quickbite.app', 'pass123');
  check('A super administrator can sign in', Boolean(superToken));

  const supportToken = await signIn('support@quickbite.app', 'pass123');

  /* ---------------------------------------------------------------- *
   *  It must refuse                                                   *
   * ---------------------------------------------------------------- */

  (config as any).ALLOW_PLATFORM_RESET = false;

  const noFlag = await api('/admin/platform/reset', { confirm: PHRASE }, superToken);
  check(
    'Refused when the deployment has not been armed',
    noFlag.status === 403 && noFlag.json?.error?.code === 'PLATFORM_RESET_DISABLED',
    `${noFlag.status} ${noFlag.json?.error?.code}`
  );
  check('and nothing was deleted', memoryStore.restaurants.size > 0);

  // Armed from here on, so the remaining refusals are about the CALLER and the
  // confirmation rather than about the flag still being off.
  (config as any).ALLOW_PLATFORM_RESET = true;

  const wrongPhrase = await api('/admin/platform/reset', { confirm: 'yes' }, superToken);
  check(
    'Refused without the exact phrase',
    wrongPhrase.status === 400,
    `${wrongPhrase.status} ${wrongPhrase.json?.error?.code}`
  );

  const booleanConfirm = await api('/admin/platform/reset', { confirm: true }, superToken);
  check(
    'A boolean confirm is not a confirmation',
    booleanConfirm.status === 400,
    `${booleanConfirm.status}`
  );

  const noBody = await api('/admin/platform/reset', {}, superToken);
  check('Refused with no confirmation at all', noBody.status === 400);

  if (supportToken) {
    const support = await api('/admin/platform/reset', { confirm: PHRASE }, supportToken);
    check(
      'Refused for a scoped admin — this is super-admin only',
      support.status === 403,
      `${support.status} ${support.json?.error?.code}`
    );
  } else {
    check('Refused for a scoped admin — this is super-admin only', false, 'support login failed');
  }

  const anonymous = await api('/admin/platform/reset', { confirm: PHRASE });
  check('Refused without a token', anonymous.status === 401 || anonymous.status === 403);

  // Restaurants and riders, not orders: the seed creates no orders, so
  // asserting on those would have passed whether or not the refusals held.
  check(
    'After every refusal the data is still there',
    memoryStore.restaurants.size > 0 && memoryStore.riders.size > 0,
    `${memoryStore.restaurants.size} restaurants, ${memoryStore.riders.size} riders`
  );

  /* ---------------------------------------------------------------- *
   *  And when it does run                                             *
   * ---------------------------------------------------------------- */

  const adminsBefore = [...memoryStore.users.values()].filter(
    (u: any) => u.role === 'admin' || u.role === 'super_admin'
  ).length;
  const restaurantsBefore = memoryStore.restaurants.size;
  check('There is something to delete', restaurantsBefore > 0 && adminsBefore > 0);

  const done = await api('/admin/platform/reset', { confirm: PHRASE }, superToken);
  check('It runs for a super administrator with the phrase', done.status === 200, `${done.status}`);

  check('Restaurants are gone', memoryStore.restaurants.size === 0);
  check('Orders are gone', memoryStore.orders.size === 0);
  check('Riders are gone', memoryStore.riders.size === 0);
  check('Menus are gone', memoryStore.menus.size === 0);
  check('Wallets are gone', memoryStore.wallets.size === 0);
  check('Addresses are gone', memoryStore.addresses.size === 0);

  const adminsAfter = [...memoryStore.users.values()].filter(
    (u: any) => u.role === 'admin' || u.role === 'super_admin'
  ).length;
  check(
    'Every administrator survived',
    adminsAfter === adminsBefore,
    `${adminsBefore} before, ${adminsAfter} after`
  );

  const customersAfter = [...memoryStore.users.values()].filter(
    (u: any) => u.role !== 'admin' && u.role !== 'super_admin'
  ).length;
  check('and every non-administrator is gone', customersAfter === 0, `${customersAfter} left`);

  check(
    'The roles administrators depend on survived',
    memoryStore.adminRoles.size > 0,
    `${memoryStore.adminRoles.size} roles`
  );

  check(
    'The audit trail survived and records the reset',
    [...memoryStore.auditLogs.values()].some((a: any) => a.action === 'PLATFORM_RESET'),
    'an audit log erasable by the action it audits is not one'
  );

  // The point of keeping administrators: the owner can still get back in.
  resetAuthRateLimit();
  const afterToken = await signIn('admin@quickbite.app', 'pass123');
  check('The administrator can still sign in afterwards', Boolean(afterToken));

  const feed = await api('/restaurants');
  check(
    'and the platform now serves an empty catalogue rather than erroring',
    feed.status === 200 && (feed.json?.data?.restaurants || []).length === 0,
    `${feed.status}`
  );
} finally {
  server.close();
}

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
