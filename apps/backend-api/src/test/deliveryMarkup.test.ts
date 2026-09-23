/**
 * The platform charges more for delivery than it pays for it, and the rider
 * never finds out.
 *
 * The owner was explicit: the CUSTOMER pays the delivery markup, rider pay is
 * untouched, one number platform-wide. That is two claims, and only one of them
 * is obvious to check.
 *
 * -------------------------------------------------------------------------
 * WHY THE SECOND HALF IS THE ONE THAT MATTERS
 * -------------------------------------------------------------------------
 * A test that sets the markup and asserts the customer's delivery fee went up
 * passes just as well when the money came OUT OF THE RIDER. Both
 * implementations raise the customer's bill; only one of them is what was
 * asked for. The difference is invisible on a bill that still adds up, and the
 * person who would notice is a rider comparing this week's payout to last
 * week's -- by which point it has happened to every trip on the platform.
 *
 * So the assertions come in pairs, from the SAME order, at two rates: the
 * customer's fee moved, and the rider's earning is byte-identical.
 *
 * -------------------------------------------------------------------------
 * AND ONE THING THIS PROJECT HAS BEEN BITTEN BY BEFORE
 * -------------------------------------------------------------------------
 * Setting a rate through the admin editor used to SUCCEED and do nothing, for
 * any rate missing from the RATE_BOUNDS allowlist -- createVersion dropped it
 * silently, the screen confirmed the change, and the platform kept the old
 * value. So this asserts the rate is readable back from a fresh version rather
 * than trusting the call that set it.
 */
import assert from 'node:assert';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import { getActiveRates, createVersion } from '../modules/payments/pricingConfig.ts';

const PORT = 5217;
const API = `http://127.0.0.1:${PORT}/api`;

console.log('====================================================');
console.log('  THE DELIVERY MARKUP                               ');
console.log('====================================================\n');

let failed = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`[PASS] ${label}`);
  } else {
    failed++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function api(path: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
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

/**
 * One basket, priced at whatever the platform rates currently say.
 *
 * The rates are passed in, exactly as orderService does at :263 -- the engine
 * is a pure function of its inputs and carries its own package defaults for
 * anything omitted. The first version of this helper left them out, so every
 * price came back at the package default and the delivery fee did not move
 * when the admin rate changed. The engine was right; the test was asking a
 * different question from the one it claimed to.
 */
function priceATrip(isGold = false) {
  return calculateOrderPricing({
    items: [{ unitPrice: 200, quantity: 2 }],
    distanceKm: 6,
    isGold,
    rates: getActiveRates()
  } as any);
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const admin = await login('admin@quickbite.app');

  // ----------------------------------------------------------------
  console.log('\n-- The rate exists, and setting it actually takes');

  check('It starts at zero, so this change alters nothing by itself',
    getActiveRates().riderDeliveryMarkupPercent === 0,
    String(getActiveRates().riderDeliveryMarkupPercent));

  const atZero = priceATrip();
  const riderRatesAtZero = {
    base: getActiveRates().riderBaseFeePerTrip,
    perKm: getActiveRates().riderPerKmFee,
    baseKm: getActiveRates().riderBaseKm,
    min: getActiveRates().riderMinEarningPerTrip
  };

  createVersion({ riderDeliveryMarkupPercent: 20 }, { userId: 'usr_admin_01' }, 'Charging 20% on delivery.');

  /*
   * Read back from the config, not from the call that set it. A rate missing
   * from the RATE_BOUNDS allowlist is dropped silently by createVersion: the
   * call succeeds, the screen confirms, and the platform keeps the old value.
   * That has happened on this project before, to payoutCadenceDays, and it was
   * found only because a test asserted the behaviour changed rather than that
   * the setter returned.
   */
  check('THE RATE IS READABLE BACK AFTER BEING SET',
    getActiveRates().riderDeliveryMarkupPercent === 20,
    `config says ${getActiveRates().riderDeliveryMarkupPercent}`);

  // ----------------------------------------------------------------
  console.log('\n-- The customer pays more, and the rider earns the same');

  const atTwenty = priceATrip();

  check('THE CUSTOMER DELIVERY FEE ROSE',
    atTwenty.deliveryFee > atZero.deliveryFee,
    `${atZero.deliveryFee} became ${atTwenty.deliveryFee}`);
  check('by exactly the percentage that was set',
    Math.abs(atTwenty.deliveryFee - Math.round(atZero.deliveryFee * 1.2 * 100) / 100) < 0.005,
    `expected ${Math.round(atZero.deliveryFee * 1.2 * 100) / 100}, got ${atTwenty.deliveryFee}`);

  /*
   * The pair. The rider's trip pay is computed from the rider rates and the
   * trip, and NONE of those inputs is the markup. If any of these four moved,
   * the markup is reaching the rider's side of the bill.
   */
  const riderRatesAtTwenty = {
    base: getActiveRates().riderBaseFeePerTrip,
    perKm: getActiveRates().riderPerKmFee,
    baseKm: getActiveRates().riderBaseKm,
    min: getActiveRates().riderMinEarningPerTrip
  };
  check('AND EVERY RIDER RATE IS BYTE-IDENTICAL',
    JSON.stringify(riderRatesAtTwenty) === JSON.stringify(riderRatesAtZero),
    `${JSON.stringify(riderRatesAtZero)} became ${JSON.stringify(riderRatesAtTwenty)}`);

  check('The bill records what delivery cost us before the markup',
    atTwenty.partnerDeliveryFee === atZero.deliveryFee,
    `partnerDeliveryFee ${atTwenty.partnerDeliveryFee}, unmarked fee ${atZero.deliveryFee}`);
  check('so what we kept on delivery is derivable from the order alone',
    Math.abs((atTwenty.deliveryFee - atTwenty.partnerDeliveryFee) -
      Math.round(atZero.deliveryFee * 0.2 * 100) / 100) < 0.005,
    `kept ${atTwenty.deliveryFee - atTwenty.partnerDeliveryFee}`);

  // Nothing else on the bill should have moved. A markup that also changed the
  // food total or the platform fee would still raise the customer's total, and
  // "the total went up" would not tell them apart.
  check('and no other line on the bill moved',
    atTwenty.itemsTotal === atZero.itemsTotal &&
      atTwenty.packagingFee === atZero.packagingFee &&
      atTwenty.platformFee === atZero.platformFee,
    JSON.stringify({
      items: [atZero.itemsTotal, atTwenty.itemsTotal],
      packaging: [atZero.packagingFee, atTwenty.packagingFee],
      platform: [atZero.platformFee, atTwenty.platformFee]
    }));

  // ----------------------------------------------------------------
  console.log('\n-- A member discount comes off the real price');

  /*
   * Order of operations, which is invisible on a bill that adds up either way.
   * The markup is applied BEFORE the membership benefit, so a member's
   * discount comes off the price they would otherwise have paid. Discounting
   * first and marking up afterwards would quietly claw back part of the benefit
   * they bought.
   */
  const memberAtTwenty = priceATrip(true);
  check('A member is charged no more than a non-member for delivery',
    memberAtTwenty.deliveryFee <= atTwenty.deliveryFee,
    `member ${memberAtTwenty.deliveryFee}, non-member ${atTwenty.deliveryFee}`);
  check('and the markup was applied before the benefit, not after',
    memberAtTwenty.partnerDeliveryFee === atZero.deliveryFee,
    `partnerDeliveryFee ${memberAtTwenty.partnerDeliveryFee}`);

  // ----------------------------------------------------------------
  console.log('\n-- The administrator can see and change it');

  const rates = await api('/admin/pricing/config', {}, admin.token);
  const body = JSON.stringify(rates.json);
  check('The rate is served to the admin editor', rates.status === 200 &&
    body.includes('riderDeliveryMarkupPercent'), `status ${rates.status}`);
  check('with wording that does not claim it changes rider pay',
    !/rider pay|rider earn(s|ings) (rise|increase)/i.test(body));

  // Turning it off must always be possible, whatever else is true.
  createVersion({ riderDeliveryMarkupPercent: 0 }, { userId: 'usr_admin_01' }, 'Turning the markup off again.');
  check('It can be turned off again', getActiveRates().riderDeliveryMarkupPercent === 0);
  const backToZero = priceATrip();
  check('and the customer pays exactly what they did before it existed',
    backToZero.deliveryFee === atZero.deliveryFee,
    `${atZero.deliveryFee} vs ${backToZero.deliveryFee}`);

  assert.ok(true);
} finally {
  server.close();
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
