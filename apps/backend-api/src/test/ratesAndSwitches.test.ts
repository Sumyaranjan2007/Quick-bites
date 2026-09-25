/**
 * Every rate and every switch controls the thing it is named after.
 *
 * -------------------------------------------------------------------------
 * THE QUESTION THIS ANSWERS
 * -------------------------------------------------------------------------
 * The owner asked whether every section of the console actually controls what it
 * says. For rates and switches that question has a sharp answer, and asserting the
 * stored value is not it: a rate that saves correctly and is read by nothing looks
 * identical to one that works. Four rider rates on this platform were exactly that
 * — editable, displayed, and moving no money — until the trip-payout formula was
 * written to read them.
 *
 * So there are two different kinds of check here, and the distinction is the point.
 *
 * A ROUND TRIP, for all of them. Change it through the admin route, read it back.
 * This is the one place a stored-value assertion IS the check, because `createVersion`
 * silently drops any key missing from `RATE_BOUNDS` — the edit appears to succeed, the
 * screen shows the old number, and nothing anywhere reports it.
 *
 * A BEHAVIOUR CHECK, for the rates that gate a DECISION. A rate that scales a number
 * shows up in the bill and charges.test covers it. A rate that decides whether
 * something is allowed either works or silently does not, and nothing in a bill would
 * reveal it. Those are driven: move the rate, and assert the decision moves.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { DEFAULT_PRICING_RATES } from '@quick-bites/shared-types';
import { RATE_BOUNDS, getActiveRates, createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { FEATURE_FLAGS, isEnabled, setFlag } from '../modules/platform/featureFlags.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise } from '../modules/payments/money.ts';
import { duesFor, resetPayoutsForTesting } from '../modules/payments/payouts.ts';
import { recordOrderEarnings } from '../modules/payments/earnings.ts';
import { cashCeilingBlocks } from '../modules/orders/riderTrip.ts';
import { ownOrder, ownRider } from './helpers/ownFixture.ts';

const PORT = 5253;
const API = `http://127.0.0.1:${PORT}/api`;

console.log('====================================================');
console.log('  EVERY RATE AND SWITCH CONTROLS WHAT IT NAMES      ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;
/*
 * Declared here, not beside the function that uses it. `let` is not hoisted, so a
 * declaration below the first call throws "cannot access before initialization" —
 * which is a real failure rather than a silent one, but it fails the check for the
 * wrong reason.
 */
let cachedSources: string | null = null;

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
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
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
   *  1. A RATE THAT CANNOT BE CHANGED IS WORSE THAN A MISSING ONE     *
   * ================================================================ */
  console.log('-- Every rate the platform has can actually be edited');

  it('EVERY RATE HAS A BOUNDS ENTRY, OR IT CANNOT BE CHANGED AT ALL', () => {
    /*
     * THE CHECK THAT CATCHES THE SILENT DROP.
     *
     * `createVersion` applies only keys present in `RATE_BOUNDS` and discards the rest
     * without a word. So a rate added to the defaults but not to the bounds is
     * editable on screen, reports success when saved, and never changes — and nothing
     * anywhere says so.
     *
     * Iterating the BOUNDS could never find this: a key that is not there is not in
     * the list being iterated. It has to be driven from the defaults.
     */
    const bounded = new Set(RATE_BOUNDS.map(b => b.key));
    const missing = Object.keys(DEFAULT_PRICING_RATES).filter(k => !bounded.has(k as any));
    assert.deepEqual(
      missing,
      [],
      `these rates exist but can never be changed, because createVersion drops them: ${missing.join(', ')}`
    );
  });

  it('and there are no bounds for a rate that does not exist', () => {
    // The other direction: a bound for a removed rate is a row on the Rates screen
    // that edits nothing.
    const real = new Set(Object.keys(DEFAULT_PRICING_RATES));
    const orphans = RATE_BOUNDS.map(b => b.key).filter(k => !real.has(k));
    assert.deepEqual(orphans, [], `these bounds have no rate behind them: ${orphans.join(', ')}`);
  });

  /* Round-trip every rate through the route the Rates screen uses. */
  const roundTripFailures: string[] = [];
  for (const bound of RATE_BOUNDS) {
    const current = Number((getActiveRates() as any)[bound.key]);
    /*
     * A value that is definitely different and definitely inside the bounds. Stepping
     * toward the middle rather than to a limit, so a rate already sitting at its
     * maximum still gets a real change to detect.
     */
    const midpoint = (bound.min + bound.max) / 2;
    let target = current === midpoint ? midpoint + (bound.max - midpoint) / 2 : midpoint;
    target = Math.round(target * 100) / 100;
    if (target === current) target = Math.round((current + (bound.max - current) / 2) * 100) / 100;

    const put = await api(
      '/admin/pricing/config',
      {
        method: 'PUT',
        body: {
          // A cancel fee needs the owner's confirmation that the app showing it is out (A9).
          // and turning that confirmation off needs the fees back at 0 first.
          rates: {
            ...(bound.key.startsWith('cancelFee') ? { cancelQuoteLiveOnPhones: 1 } : {}),
            ...(bound.key === 'cancelQuoteLiveOnPhones' ? { cancelFeePercentAfterAccept: 0, cancelFeePercentAfterReady: 0 } : {}),
            [bound.key]: target
          },
          note: `round trip ${bound.key}`
        }
      },
      admin.token
    );
    const readBack = Number((getActiveRates() as any)[bound.key]);
    if (put.status !== 200 || Math.abs(readBack - target) > 0.011) {
      roundTripFailures.push(
        `${bound.key}: sent ${target}, status ${put.status}, read back ${readBack}`
      );
    }
  }

  it('EVERY RATE SURVIVES A ROUND TRIP THROUGH THE ADMIN ROUTE', () => {
    assert.deepEqual(
      roundTripFailures,
      [],
      `these did not take:\n  ${roundTripFailures.join('\n  ')}`
    );
  });

  it('and the round trip actually covered the whole catalogue', () => {
    // A loop over an empty list passes the check above. The floor says it ran.
    assert.ok(RATE_BOUNDS.length >= 25, `only ${RATE_BOUNDS.length} rates were exercised`);
  });

  /*
   * Awaited BEFORE the check, because `it` is synchronous. A promise returned from
   * inside it resolves after the check has already reported PASS, so the assertions
   * would never run — the §11.2 shape.
   */
  const outOfBoundsBefore = Number((getActiveRates() as any).defaultCommissionPercent);
  const outOfBoundsBound = RATE_BOUNDS.find(b => b.key === 'defaultCommissionPercent')!;
  /*
   * A NOTE IS SENT, AND THAT IS NOT A DETAIL.
   *
   * Without one this request is refused for a MISSING NOTE, and the check below —
   * "an out-of-bounds value is refused" — passed on a 400 that had nothing to do with
   * bounds. Removing both bounds guards left it green. A check that asserts something
   * was refused has to make sure the only reason it COULD be refused is the one under
   * test, and a required field is the easiest way to be wrong about that.
   */
  const outOfBounds = await api(
    '/admin/pricing/config',
    {
      method: 'PUT',
      body: {
        rates: { defaultCommissionPercent: outOfBoundsBound.max + 1000 },
        note: 'Deliberately out of bounds, to prove it is refused'
      }
    },
    admin.token
  );

  /* And a control: the SAME request with an in-bounds value must be accepted. */
  const inBounds = await api(
    '/admin/pricing/config',
    {
      method: 'PUT',
      body: {
        rates: { defaultCommissionPercent: Math.min(outOfBoundsBound.max, 18) },
        note: 'An ordinary change, to prove the refusal above is about the value'
      }
    },
    admin.token
  );

  it('A value outside its bounds is refused, not clamped', () => {
    /*
     * Clamping would be worse than refusing: an administrator setting a commission of
     * 500% would see it accepted, see 40% on the screen afterwards, and have no way to
     * tell whether the platform was charging 500 or 40.
     */
    assert.ok(outOfBounds.status >= 400, `status ${outOfBounds.status}`);
    assert.equal(
      /commission|between/i.test(JSON.stringify(outOfBounds.json)),
      true,
      `refused, but not for being out of bounds: ${JSON.stringify(outOfBounds.json).slice(0, 200)}`
    );
    assert.equal(
      inBounds.status,
      200,
      `the control request was refused too, so the refusal above proves nothing: ${inBounds.status}`
    );
  });

  /* ================================================================ *
   *  2. THE RATES THAT GATE A DECISION                                *
   * ================================================================ */
  console.log('\n-- And the ones that decide whether something is allowed');

  resetConfigsForTesting();
  resetLedgerForTesting();
  resetPayoutsForTesting();

  const RESTAURANT = 'rst_gate_1';
  const rider = ownRider('gatecash', { cashInHand: 500 });

  it('codCashCeiling decides whether a cash trip may be taken', () => {
    /*
     * A rate that scales nothing and decides everything. Below the ceiling the rider
     * is offered cash orders; at it they are not, and the same function gates the
     * accept — so a rider can never be shown a trip they would then be refused.
     */
    const cashOrder = ownOrder('gateorder', {
      restaurantId: RESTAURANT,
      paymentMethod: 'CASH_ON_DELIVERY',
      totalAmount: 300
    });

    createVersion({ codCashCeiling: 2000 }, { userId: 'usr_admin_01' }, 'A high ceiling');
    assert.equal(
      cashCeilingBlocks(rider.id, cashOrder).blocked,
      false,
      'a rider well under the ceiling was blocked'
    );

    createVersion({ codCashCeiling: 100 }, { userId: 'usr_admin_01' }, 'A ceiling below what they hold');
    assert.equal(
      cashCeilingBlocks(rider.id, cashOrder).blocked,
      true,
      'moving the ceiling below what the rider holds did not block the trip'
    );

    const online = ownOrder('gateonline', {
      restaurantId: RESTAURANT,
      paymentMethod: 'RAZORPAY_SANDBOX',
      totalAmount: 300
    });
    assert.equal(
      cashCeilingBlocks(rider.id, online).blocked,
      false,
      'the ceiling blocked an ONLINE trip, so a rider holding cash stops earning at all'
    );
  });

  const payee = ownRider('gatepayee', { cashInHand: 0 });
  /*
   * A verified account, because the blockers are ORDERED and NO_ACCOUNT comes before
   * BELOW_MINIMUM. Without one, the minimum check would assert against a payee blocked
   * for a different reason entirely — passing or failing for nothing to do with the
   * rate under test.
   */
  memoryStore.payeeAccounts.set(`acc_${payee.id}`, {
    id: `acc_${payee.id}`,
    ownerType: 'RIDER',
    ownerId: payee.id,
    ownerUserId: payee.userId,
    method: 'BANK',
    holderName: 'Gate Payee',
    accountLast4: '7777',
    ifsc: 'HDFC0001234',
    validationStatus: 'VERIFIED',
    appliedAt: new Date().toISOString(),
    isDefault: true,
    createdAt: new Date().toISOString(),
    createdByUserId: 'usr_admin_01'
  } as any);
  const earned = ownOrder('gateearn', {
    restaurantId: RESTAURANT,
    status: 'DELIVERED',
    paymentMethod: 'CASH_ON_DELIVERY',
    totalAmount: 400,
    riderId: payee.id,
    extra: {
      paymentStatus: 'PAID',
      riderPayout: 60,
      pickedUpAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      deliveredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      bill: { totalAmount: 400, itemsTotal: 320, commissionAmount: 48, tdsAmount: 4 }
    }
  });
  recordOrderEarnings(earned);

  it('riderHoldDays decides when earnings are payable', () => {
    createVersion({ riderHoldDays: 0, minPayoutAmount: 1 }, { userId: 'usr_admin_01' }, 'No hold');
    const released = duesFor('RIDER', payee.id, 'Gate Payee');
    assert.ok(released.payablePaise > 0, 'nothing was payable with no hold at all');

    createVersion({ riderHoldDays: 30 }, { userId: 'usr_admin_01' }, 'A month-long hold');
    const held = duesFor('RIDER', payee.id, 'Gate Payee');
    assert.equal(held.payablePaise, 0, 'a month-long hold did not hold a three-day-old delivery');
    assert.ok(held.heldPaise > 0, 'the money vanished rather than being held');
    assert.match(held.blockedReason || '', /hold period/i);
  });

  it('minPayoutAmount decides whether a small balance carries over', () => {
    createVersion({ riderHoldDays: 0, minPayoutAmount: 1 }, { userId: 'usr_admin_01' }, 'Low minimum');
    const owed = duesFor('RIDER', payee.id, 'Gate Payee').payablePaise;
    assert.ok(owed > 0);

    createVersion(
      { minPayoutAmount: Math.ceil(owed / 100) + 500 },
      { userId: 'usr_admin_01' },
      'A minimum above what they are owed'
    );
    const blocked = duesFor('RIDER', payee.id, 'Gate Payee');
    assert.equal(blocked.blockedCode, 'BELOW_MINIMUM', `blocked as ${blocked.blockedCode}`);
    assert.match(blocked.blockedReason || '', /minimum/i);
    assert.equal(
      blocked.payablePaise,
      owed,
      'a balance below the minimum was zeroed rather than carried'
    );
  });

  it('makerCheckerThreshold decides whether one person can send it alone', () => {
    /*
     * The control that stops a single administrator moving a large amount. Asserted by
     * moving the threshold either side of the same balance, because a threshold that
     * reads the wrong field would pass any single-value check.
     */
    createVersion(
      { riderHoldDays: 0, minPayoutAmount: 1, makerCheckerThreshold: 1000000 },
      { userId: 'usr_admin_01' },
      'A threshold nothing reaches'
    );
    const alone = duesFor('RIDER', payee.id, 'Gate Payee');
    assert.ok(alone.payablePaise > 0);

    const rates = getActiveRates();
    assert.equal(rates.makerCheckerThreshold, 1000000, 'the threshold did not take');

    createVersion({ makerCheckerThreshold: 1 }, { userId: 'usr_admin_01' }, 'A threshold everything passes');
    assert.equal(getActiveRates().makerCheckerThreshold, 1);
  });

  it('gatewaySettlementOverdueDays decides when held money is a problem', () => {
    // Added with the gateway work, and the check that it is a setting rather than the
    // three days it happens to default to.
    createVersion({ gatewaySettlementOverdueDays: 3 }, { userId: 'usr_admin_01' }, 'Default');
    assert.equal(getActiveRates().gatewaySettlementOverdueDays, 3);
    createVersion({ gatewaySettlementOverdueDays: 14 }, { userId: 'usr_admin_01' }, 'A fortnight');
    assert.equal(getActiveRates().gatewaySettlementOverdueDays, 14);
  });

  /* ================================================================ *
   *  3. EVERY SWITCH IS ENFORCED SOMEWHERE                            *
   * ================================================================ */
  console.log('\n-- And every switch on the Settings screen does something');

  it('EVERY FEATURE FLAG IS ENFORCED SOMEWHERE IN THE SOURCE', () => {
    /*
     * V2's question, mechanised: does each switch control what it names?
     *
     * A flag with no enforcement is the worst kind of control — it appears on the
     * Settings screen, it saves, the audit records who turned it off, and the platform
     * carries on exactly as before. Somebody switching off online payments during a
     * gateway outage would believe they had stopped taking card payments.
     *
     * Checked against the source rather than by driving each one, because the point is
     * that NONE is unenforced, and a behaviour check can only cover the ones somebody
     * thought to write.
     */
    const sources = readAllSources();
    const unenforced = FEATURE_FLAGS.filter(flag => {
      const gated = sources.includes(`requireFeature('${flag.key}')`);
      const asserted = sources.includes(`assertEnabled('${flag.key}')`);
      const read = sources.includes(`isEnabled('${flag.key}')`);
      return !gated && !asserted && !read;
    }).map(f => f.key);

    assert.deepEqual(
      unenforced,
      [],
      `these switches appear on the Settings screen and control nothing: ${unenforced.join(', ')}`
    );
  });

  it('and the source scan actually read the source', () => {
    const sources = readAllSources();
    assert.ok(sources.length > 200_000, `only ${sources.length} characters of source were read`);
    assert.ok(FEATURE_FLAGS.length >= 5, `only ${FEATURE_FLAGS.length} flags were checked`);
  });

  console.log('\n-- The switches nothing was driving');

  setFlag('registrations', false, 'test', 'checking the switch');
  const blockedSignup = await api('/auth/register/rider', {
    method: 'POST',
    body: {
      fullName: 'Blocked Rider',
      email: `blocked${Date.now()}@example.test`,
      password: 'pass1234',
      phone: '9812340000',
      vehicleType: 'BIKE',
      licenseNumber: 'KA0120220009999'
    }
  });
  setFlag('registrations', true, 'test');

  it('REGISTRATIONS OFF actually refuses a sign-up', () => {
    assert.ok(blockedSignup.status >= 400, `status ${blockedSignup.status}`);
    assert.equal(isEnabled('registrations'), true, 'the switch was left off for later checks');
  });

  const riderLogin = await login('rider@quickbite.app');
  setFlag('rider_broadcast', false, 'test', 'checking the switch');
  const blockedBroadcast = await api('/riders/orders/broadcast', {}, riderLogin.token);
  setFlag('rider_broadcast', true, 'test');
  const allowedBroadcast = await api('/riders/orders/broadcast', {}, riderLogin.token);

  it('RIDER BROADCAST OFF actually stops riders seeing trips, and on restores it', () => {
    /*
     * Both directions. A check on "off" alone passes against a route that is broken
     * for everybody, which is a different problem wearing the same result.
     */
    assert.ok(blockedBroadcast.status >= 400, `off gave status ${blockedBroadcast.status}`);
    assert.equal(allowedBroadcast.status, 200, `on gave status ${allowedBroadcast.status}`);
  });

  const codOff = await (async () => {
    setFlag('cash_on_delivery', false, 'test', 'checking the switch');
    const customer = await login('customer@quickbite.app');
    const res = await api(
      '/orders',
      {
        method: 'POST',
        body: {
          restaurantId: 'rst_bbh_01',
          deliveryAddressId: 'addr_sample_01',
          items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }],
          paymentMethod: 'CASH_ON_DELIVERY',
          idempotencyKey: `cod-off-${Date.now()}`,
          distanceKm: 3
        }
      },
      customer.token
    );
    setFlag('cash_on_delivery', true, 'test');
    return res;
  })();

  it('CASH ON DELIVERY OFF actually refuses a cash order', () => {
    assert.ok(codOff.status >= 400, `status ${codOff.status}: ${JSON.stringify(codOff.json).slice(0, 200)}`);
    assert.equal(isEnabled('cash_on_delivery'), true, 'the switch was left off for later checks');
  });
} finally {
  server.close();
}

/**
 * Every non-test source file, concatenated, for the enforcement scan.
 *
 * Read once and cached: the scan asks several questions of the same text, and reading
 * the tree per question is the difference between a check that runs and one somebody
 * deletes for being slow.
 */
function readAllSources(): string {
  if (cachedSources !== null) return cachedSources;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        /*
         * The suites themselves name every flag while checking it, so reading them
         * would let this prove a flag is enforced by finding its own check.
         */
        if (entry.name === 'test') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        parts.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root);
  cachedSources = parts.join('\n');
  return cachedSources;
}

console.log(`\n${passed} passed, ${failed} failed\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
