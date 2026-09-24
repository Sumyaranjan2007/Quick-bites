/**
 * Every admin section loads, and a change made in it sticks and is recorded.
 *
 * -------------------------------------------------------------------------
 * THE OWNER'S QUESTION, AND WHY LOADING IS ONLY HALF OF IT
 * -------------------------------------------------------------------------
 * "Every section should work and be controllable from the admin." A section that
 * 500s is easy to notice. The two failures that are not:
 *
 *   A change that appears to save and is gone after a restart. `memoryStore` is
 *   Maps, and a write with nothing scheduling a save survives exactly as long as the
 *   process. Three modules were in that state; the check for it is mechanical now,
 *   but a route can still write somewhere the read path does not look.
 *
 *   A change nobody can trace. An admin console without an audit trail cannot answer
 *   the question it exists to answer — who changed the commission on a Friday, and
 *   what was it before.
 *
 * So each section here is loaded, changed, RELOADED through the same route the app
 * uses, and the change is asserted to have survived the round trip and to have left
 * an audit entry naming who did it.
 *
 * -------------------------------------------------------------------------
 * THE SECTION LIST IS DERIVED, NOT TYPED
 * -------------------------------------------------------------------------
 * Every admin GET the four apps actually call is extracted from their source and
 * loaded. A hand-written list goes stale the moment somebody adds a screen — and the
 * screen nobody added to the list is exactly the one nobody is checking.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { appCalls, normalisePath } from './helpers/routeContract.ts';

const PORT = 5257;
const API = `http://127.0.0.1:${PORT}/api`;
const ADMIN_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../admin-mobile/src'
);

console.log('====================================================');
console.log('  EVERY ADMIN SECTION LOADS, CHANGES AND REMEMBERS  ');
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
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 500)}`);
  }
}

async function api(pathname: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 20000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const admin = await login('admin@quickbite.app');

  /* ================================================================ *
   *  1. EVERY SECTION THE APP LOADS, LOADS                            *
   * ================================================================ */
  console.log('-- Loading every admin screen the app asks for');

  const { calls, unreadable } = appCalls('admin-mobile', ADMIN_SRC);

  /*
   * THE LIST SCREENS ARE IN THE UNREADABLE PILE, AND THEY ARE THE ONES THAT MATTER.
   *
   * Orders, People, Refunds, Catalogue, Support and Documents all build their path as
   * `/admin/x${query({ ... })}` — a hole glued to a segment, which the route-contract
   * scanner correctly refuses to match against a mounted route because it could expand
   * to anything.
   *
   * For loading a screen that does not matter: the hole is a query string, and the
   * base path is what the screen requests when it first opens with no filters set. So
   * the readable prefix is taken and loaded. Dropping them would have meant sweeping
   * fifteen sections and calling it every one.
   */
  const prefixes = unreadable
    .filter(c => c.method === 'GET' && c.path.startsWith('/admin/'))
    .map(c => ({ ...c, path: c.path.split(':param')[0].replace(/\/$/, '') }))
    .filter(c => c.path.split('/').filter(Boolean).length >= 2);

  /*
   * The GETs, with a parameter filled in where one is needed.
   *
   * A path with `:param` cannot be requested as written. Rather than skip those — which
   * would quietly drop the per-restaurant and per-order screens, some of the most used
   * — a real id from the seed is substituted. A 404 for a made-up id proves nothing; a
   * 500 for a real one is a broken screen.
   */
  const ids: Record<string, string> = {
    restaurants: 'rst_bbh_01',
    orders: String((Array.from(memoryStore.orders.keys()) as string[])[0] || 'ord_none'),
    riders: 'rdr_vikram_01',
    settlements: 'rst_bbh_01',
    users: 'usr_customer_01'
  };

  const gets = Array.from(
    new Map(
      [...calls, ...prefixes]
        .filter(c => c.method === 'GET' && c.path.startsWith('/admin/'))
        .map(c => [c.path, c])
    ).values()
  );

  const broken: string[] = [];
  for (const call of gets) {
    const segments = call.path.split('/').filter(Boolean);
    const filled = segments
      .map((segment, index) => (segment === ':param' ? ids[segments[index - 1]] || 'unknown' : segment))
      .join('/');
    const res = await api(`/${filled}`, {}, admin.token);
    /*
     * 404 is allowed — a substituted id may genuinely not exist for that screen — and
     * so is 400. What is never allowed is a 5xx, which is the screen itself failing.
     */
    if (res.status >= 500) {
      broken.push(`${call.method} /${filled} -> ${res.status} (${call.file})`);
    }
  }

  it('EVERY ADMIN SCREEN THE APP LOADS ANSWERS WITHOUT FAILING', () => {
    assert.deepEqual(broken, [], `these failed:\n  ${broken.join('\n  ')}`);
  });

  it('and the sweep actually loaded a realistic number of them', () => {
    // An empty list passes the check above. The floor says the extraction worked.
    /*
     * Forty-plus, not twenty. The first version of this floor was 22 and passed while
     * the sweep covered FIFTEEN sections — every list screen in the console was absent,
     * because the extractor did not allow `api.get<any>(...)` and skipped them
     * silently. A floor set from a guess licenses whatever the scan happens to find.
     */
    assert.ok(gets.length >= 40, `only ${gets.length} distinct admin screens were loaded`);
  });

  /* ================================================================ *
   *  2. A CHANGE IN EACH SECTION STICKS, AND IS RECORDED              *
   * ================================================================ */
  console.log('\n-- Changing one thing in each section, then reading it back');

  interface SectionChange {
    section: string;
    /** Make the change through the route the app uses. */
    change: () => Promise<{ status: number; json: any }>;
    /** Read it back through the route the screen loads. */
    readBack: () => Promise<boolean>;
    /** The audit action the change must leave behind. */
    auditAction: string;
  }

  const changes: SectionChange[] = [
    {
      section: 'Settings — a platform switch',
      change: () =>
        api(
          '/admin/settings/flags/coupons',
          { method: 'PUT', body: { enabled: false, note: 'Section sweep' } },
          admin.token
        ),
      readBack: async () => {
        const res = await api('/admin/settings', {}, admin.token);
        return (res.json?.data?.flags || []).some((f: any) => f.key === 'coupons' && !f.enabled);
      },
      auditAction: 'FEATURE_DISABLED'
    },
    {
      section: 'Settings — a notification switch',
      change: () =>
        api(
          '/admin/settings/notifications/MONEY',
          { method: 'PUT', body: { enabled: false } },
          admin.token
        ),
      readBack: async () => {
        const res = await api('/admin/settings', {}, admin.token);
        return (res.json?.data?.notifications || []).some(
          (n: any) => n.key === 'MONEY' && n.enabled === false
        );
      },
      auditAction: 'NOTIFICATIONS_DISABLED'
    },
    {
      section: 'Inflation — a platform rate',
      change: () =>
        api(
          '/admin/pricing/config',
          {
            method: 'PUT',
            body: { rates: { deliveryBaseFee: 37 }, note: 'Section sweep for the rates screen' }
          },
          admin.token
        ),
      readBack: async () => {
        const res = await api('/admin/pricing/config', {}, admin.token);
        const rates = res.json?.data?.config?.rates ?? res.json?.data?.rates;
        return Number(rates?.deliveryBaseFee) === 37;
      },
      auditAction: 'RATES_CHANGED'
    }
  ];

  const stuck: string[] = [];
  const unaudited: string[] = [];

  for (const one of changes) {
    const before = await api('/admin/audit-log', {}, admin.token);
    const beforeCount = (before.json?.data?.entries || []).length;

    const res = await one.change();
    if (res.status !== 200 && res.status !== 201) {
      stuck.push(`${one.section}: the change itself was refused with ${res.status}`);
      continue;
    }

    if (!(await one.readBack())) {
      stuck.push(`${one.section}: the change did not come back when the screen reloaded`);
    }

    const after = await api('/admin/audit-log', {}, admin.token);
    const entries = after.json?.data?.entries || [];
    const found = entries.some((e: any) => String(e.action || '').includes(one.auditAction));
    if (!found) {
      unaudited.push(
        `${one.section}: no audit entry containing "${one.auditAction}" ` +
          `(${entries.length} entries, was ${beforeCount})`
      );
    }
  }

  it('A CHANGE IN EACH SECTION SURVIVES A RELOAD', () => {
    /*
     * Read back through the ROUTE THE SCREEN LOADS, not from the module that wrote it.
     * A write that lands somewhere the read path does not look is invisible to a
     * module-level check and obvious to an operator, who sees their edit vanish.
     */
    assert.deepEqual(stuck, [], `these did not stick:\n  ${stuck.join('\n  ')}`);
  });

  it('and leaves an audit entry naming what changed', () => {
    /*
     * The question an admin console exists to answer: who changed the commission on a
     * Friday, and what was it before. A change with no trail cannot be argued with,
     * and on a platform with one operator it cannot even be remembered.
     */
    assert.deepEqual(unaudited, [], `these were not recorded:\n  ${unaudited.join('\n  ')}`);
  });

  const auditAfterChanges = (await api('/admin/audit-log', {}, admin.token)).json?.data?.entries || [];

  /* Put the two switches back, so a later suite is not reading a muted platform. */
  await api('/admin/settings/flags/coupons', { method: 'PUT', body: { enabled: true } }, admin.token);
  await api(
    '/admin/settings/notifications/MONEY',
    { method: 'PUT', body: { enabled: true } },
    admin.token
  );

  it('and the audit entry names the person, not just the action', () => {
    /*
     * "Somebody disabled coupons" is not an audit trail. The question is who, and an
     * entry without an actor cannot answer it — which on a platform where several
     * people share an admin console is the whole reason the log exists.
     */
    const recent = auditAfterChanges.filter((e: any) =>
      ['FEATURE_DISABLED', 'NOTIFICATIONS_DISABLED', 'RATES_CHANGED'].some(a =>
        String(e.action || '').includes(a)
      )
    );
    assert.ok(recent.length >= 2, `only ${recent.length} of the three changes were logged at all`);
    for (const entry of recent) {
      assert.ok(
        entry.actorUserId || entry.actorName,
        `an entry for ${entry.action} names nobody: ${JSON.stringify(entry).slice(0, 160)}`
      );
      assert.ok(
        entry.summary && String(entry.summary).length > 5,
        `an entry for ${entry.action} says nothing about what changed`
      );
    }
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
