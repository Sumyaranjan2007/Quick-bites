/**
 * The offer badge and the home-screen banner: derived, or absent.
 *
 * Both used to be text typed into the customer app. Every restaurant card read
 * "50% OFF" and the hero read "UP TO 50% OFF - Use WELCOME50", on every phone,
 * whether or not any such coupon existed. This suite exists to make that
 * impossible to reintroduce, so almost every check here asserts an ABSENCE:
 *
 *  - no live coupon        -> no badge, no banner
 *  - an expired coupon     -> no badge
 *  - a coupon not yet live -> no badge
 *  - an exhausted coupon   -> no badge
 *  - a switched-off coupon -> no badge
 *  - another restaurant's  -> no badge on this one
 *
 * A suite that only checked "a live coupon produces a badge" would have passed
 * against the hardcoded string it is replacing.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { memoryStore } from '../db/client.ts';
import { couponRepository } from '../db/repositories/couponRepository.ts';

const PORT = 5198;
const API = `http://127.0.0.1:${PORT}/api`;

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`[PASS] ${label}`);
  } else {
    failures++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function api(path: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

/** Empties the coupon table so each case starts from "no offers exist". */
function clearCoupons() {
  memoryStore.coupons.clear();
}

async function feed() {
  const { json } = await api('/restaurants');
  return {
    restaurants: (json?.data?.restaurants || []) as any[],
    promotion: json?.data?.promotion ?? null
  };
}

async function run() {
  console.log('====================================================');
  console.log('     OFFERS - DERIVED, OR ABSENT. NEVER TYPED       ');
  console.log('====================================================\n');

  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 300));
  resetAuthRateLimit();

  const active = Array.from(memoryStore.restaurants.values()).filter(
    (r: any) => r.status === 'ACTIVE'
  ) as any[];
  if (active.length === 0) throw new Error('The seed has no active restaurant to test against.');
  const target = active[0];
  const other = active.find(r => r.id !== target.id);

  // ---------------------------------------------------------------------
  console.log('\n-- With no coupons at all');
  clearCoupons();

  let f = await feed();
  check('The feed still returns restaurants', f.restaurants.length > 0);
  check(
    'No restaurant carries an offer badge',
    f.restaurants.every(r => r.offer === null || r.offer === undefined),
    JSON.stringify(f.restaurants.find(r => r.offer)?.offer)
  );
  check('and the home screen has no banner', f.promotion === null, JSON.stringify(f.promotion));

  // ---------------------------------------------------------------------
  console.log('\n-- A coupon that is live');
  clearCoupons();
  await couponRepository.create({
    code: 'LIVE30',
    title: 'Weekend deal',
    discountType: 'PERCENTAGE',
    discountValue: 30,
    maxDiscountCap: 120,
    isActive: true,
    expiresAt: hoursFromNow(48)
  } as any);

  f = await feed();
  const badge = f.restaurants.find(r => r.id === target.id)?.offer;
  check('A live platform-wide coupon puts a badge on the card', Boolean(badge), JSON.stringify(badge));
  check('The badge says what the coupon actually is', badge?.label === '30% OFF', badge?.label);
  check('and carries the code the customer must type', badge?.code === 'LIVE30', badge?.code);
  check('and the cap, so the app can say "up to"', badge?.maxDiscountCap === 120, String(badge?.maxDiscountCap));
  check('The banner appears too', f.promotion?.code === 'LIVE30', JSON.stringify(f.promotion));
  check(
    'and its headline is the real number',
    String(f.promotion?.title).includes('30'),
    f.promotion?.title
  );

  // ---------------------------------------------------------------------
  console.log('\n-- Every way a coupon can be dead');

  clearCoupons();
  await couponRepository.create({
    code: 'EXPIRED50',
    discountType: 'PERCENTAGE',
    discountValue: 50,
    isActive: true,
    expiresAt: hoursFromNow(-1)
  } as any);
  f = await feed();
  check(
    'An EXPIRED coupon produces no badge',
    f.restaurants.every(r => !r.offer),
    JSON.stringify(f.restaurants.find(r => r.offer)?.offer)
  );
  check('and no banner', f.promotion === null, JSON.stringify(f.promotion));

  clearCoupons();
  await couponRepository.create({
    code: 'FUTURE50',
    discountType: 'PERCENTAGE',
    discountValue: 50,
    isActive: true,
    startsAt: hoursFromNow(24),
    expiresAt: hoursFromNow(48)
  } as any);
  f = await feed();
  check(
    'A coupon that has not STARTED produces no badge',
    f.restaurants.every(r => !r.offer),
    JSON.stringify(f.restaurants.find(r => r.offer)?.offer)
  );

  clearCoupons();
  await couponRepository.create({
    code: 'OFF50',
    discountType: 'PERCENTAGE',
    discountValue: 50,
    isActive: false,
    expiresAt: hoursFromNow(48)
  } as any);
  f = await feed();
  check(
    'A coupon switched OFF produces no badge',
    f.restaurants.every(r => !r.offer)
  );

  clearCoupons();
  const exhausted = await couponRepository.create({
    code: 'GONE50',
    discountType: 'PERCENTAGE',
    discountValue: 50,
    isActive: true,
    usageLimit: 2,
    expiresAt: hoursFromNow(48)
  } as any);
  // Redeemed through the real counter, not by assigning `timesUsed`. The
  // repository strips that field from an update on purpose - a redemption
  // count is a fact, not a setting - so an earlier version of this check set
  // it, silently changed nothing, and would have passed against a badge that
  // never looked at the limit at all.
  await couponRepository.recordRedemption(exhausted.code);
  await couponRepository.recordRedemption(exhausted.code);
  f = await feed();
  check(
    'A coupon whose redemptions are EXHAUSTED produces no badge',
    f.restaurants.every(r => !r.offer),
    JSON.stringify(f.restaurants.find(r => r.offer)?.offer)
  );

  // ---------------------------------------------------------------------
  console.log('\n-- A coupon that belongs to somebody else');

  if (other) {
    clearCoupons();
    await couponRepository.create({
      code: 'THEIRS40',
      discountType: 'PERCENTAGE',
      discountValue: 40,
      isActive: true,
      applicableRestaurantIds: [other.id],
      expiresAt: hoursFromNow(48)
    } as any);

    f = await feed();
    check(
      'The restaurant it applies to gets the badge',
      Boolean(f.restaurants.find(r => r.id === other.id)?.offer)
    );
    check(
      'and no OTHER restaurant does',
      !f.restaurants.find(r => r.id === target.id)?.offer,
      JSON.stringify(f.restaurants.find(r => r.id === target.id)?.offer)
    );
    check(
      'A restaurant-specific coupon never becomes the home-screen banner',
      f.promotion === null,
      JSON.stringify(f.promotion)
    );
  }

  // ---------------------------------------------------------------------
  console.log('\n-- Which offer wins');

  clearCoupons();
  // On any realistic basket a Rs 500 flat discount beats 10%. Ranking on the
  // headline number alone would put the worse offer on the card.
  await couponRepository.create({
    code: 'TEN',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    isActive: true,
    expiresAt: hoursFromNow(48)
  } as any);
  await couponRepository.create({
    code: 'FLAT500',
    discountType: 'FLAT',
    discountValue: 500,
    isActive: true,
    expiresAt: hoursFromNow(48)
  } as any);

  f = await feed();
  check(
    'The offer worth more on a typical basket wins, not the bigger number',
    f.restaurants.find(r => r.id === target.id)?.offer?.code === 'FLAT500',
    JSON.stringify(f.restaurants.find(r => r.id === target.id)?.offer)
  );

  if (other) {
    clearCoupons();
    await couponRepository.create({
      code: 'PLATFORM20',
      discountType: 'PERCENTAGE',
      discountValue: 20,
      isActive: true,
      expiresAt: hoursFromNow(48)
    } as any);
    await couponRepository.create({
      code: 'MINE20',
      discountType: 'PERCENTAGE',
      discountValue: 20,
      isActive: true,
      applicableRestaurantIds: [target.id],
      expiresAt: hoursFromNow(48)
    } as any);

    f = await feed();
    check(
      'A restaurant-specific offer beats a platform one of equal worth',
      f.restaurants.find(r => r.id === target.id)?.offer?.code === 'MINE20',
      JSON.stringify(f.restaurants.find(r => r.id === target.id)?.offer)
    );
    check(
      'while everyone else still gets the platform one',
      f.restaurants.find(r => r.id === other.id)?.offer?.code === 'PLATFORM20',
      JSON.stringify(f.restaurants.find(r => r.id === other.id)?.offer)
    );
  }

  // ---------------------------------------------------------------------
  console.log('\n-- The badge is not the string it replaced');

  clearCoupons();
  await couponRepository.create({
    code: 'FLAT99',
    discountType: 'FLAT',
    discountValue: 99,
    isActive: true,
    expiresAt: hoursFromNow(48)
  } as any);
  f = await feed();
  const flat = f.restaurants.find(r => r.id === target.id)?.offer;
  check('A flat discount reads as an amount, not a percentage', flat?.label === '₹99 OFF', flat?.label);
  check(
    'No badge anywhere says "50% OFF" unless a 50% coupon exists',
    f.restaurants.every(r => r.offer?.label !== '50% OFF'),
    JSON.stringify(f.restaurants.map(r => r.offer?.label))
  );

  /*
   * The server is closed and the process is given a moment to finish doing it.
   *
   * `server.close()` is asynchronous, and on Windows calling `process.exit()`
   * while a libuv handle is still mid-close aborts the process outright:
   * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)". Every check in
   * this suite passes and the runner still reports it as failed, because the
   * exit code is 127 rather than 0 - a suite that fails for a reason that has
   * nothing to do with what it tests. Same fix as contract.test.ts.
   */
  server.close();

  console.log('\n====================================================');
  if (failures === 0) {
    console.log('  EVERY OFFER SHOWN IS ONE THAT EXISTS              ');
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  }
  console.log(`  OFFERS BROKEN - ${failures} CHECK(S) FAILED`);
  console.log('====================================================\n');
  setTimeout(() => process.exit(1), 100);
}

run().catch(err => {
  console.error('[FAIL] Offers suite aborted:', err.message);
  process.exit(1);
});
