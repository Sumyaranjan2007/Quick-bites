/**
 * THE RIDER GETS TOLD A TRIP IS WAITING.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT
 * -------------------------------------------------------------------------
 * `fcmDispatcher` had eleven notify methods and exactly one aimed at a rider —
 * the no-show warning. NOTHING pushed a rider a job.
 *
 * Trips reached riders through one path: `emitOrderAvailableForPickup`, a socket
 * event into a room. A socket needs the app open and connected, and Android kills
 * background sockets. So a rider with the phone in their pocket learned of
 * nothing, food that was ready sat on the pass, and the sweeper eventually raised
 * NO_RIDER_FOUND — an alert that reads as "no riders available" when what
 * actually happened is that nobody was asked.
 *
 * The rider app has been ready the whole time: `orderAlert.ts` creates the
 * `new-orders` channel with a looping alarm built for exactly this. The server
 * never sent to it. Same shape as the kitchen push at §8.1, and like that one it
 * reaches riders on the APK they already have.
 *
 * -------------------------------------------------------------------------
 * AND THE PUSH MUST NOT OFFER WHAT THE GATE REFUSES
 * -------------------------------------------------------------------------
 * The claim gate refuses a cash order to a rider at the cash ceiling. Waking
 * somebody for a job the server will then refuse is worse than not waking them:
 * the phone is in their pocket, they cannot see why, and after twice they turn
 * the channel off — and then the trip that needed them arrives silently.
 *
 * Writing that filter found a live defect. The offer LIST had the same mismatch
 * and nobody had noticed, because a 409 on a tap looks like bad luck rather than
 * a bug. That is V1 in the audit, and the checks for it are below.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { offerTripToNearbyRiders, eligibleRidersFor } from '../modules/orders/tripOffers.ts';
import { cashCeilingBlocks } from '../modules/orders/riderTrip.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { createVersion } from '../modules/payments/pricingConfig.ts';

const PORT = 5220;
const API = `http://127.0.0.1:${PORT}/api`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RIDER_ALERT = 'apps/delivery-mobile/src/lib/orderAlert.ts';

let failed = 0;
let passed = 0;

function check(name: string, fn: () => void) {
  const result: any = fn();
  if (result && typeof result.then === 'function') {
    failed++;
    console.log(`[FAIL] ${name}: async check in a runner that does not await.`);
    return;
  }
  passed++;
  console.log(`[PASS] ${name}`);
}

function it(name: string, fn: () => void) {
  try {
    check(name, fn);
  } catch (err: any) {
    failed++;
    passed--;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 500)}`);
  }
}

async function api(route: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${route}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  }).catch((err: any) => ({ status: 0, __error: err?.name || String(err) }) as any);
  if (!('json' in res)) return { status: 0, json: { error: (res as any).__error } };
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** App source with comments stripped — §11.2 shape 8. */
const appSource = (relative: string) =>
  fs
    .readFileSync(path.join(REPO, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

type Sent = { userId: string; title: string; body: string; channel?: string; data?: any };
let sent: Sent[] = [];
const realSend = fcmDispatcher.sendPushNotification.bind(fcmDispatcher);

function captureSends() {
  sent = [];
  (fcmDispatcher as any).sendPushNotification = async (payload: any) => {
    sent.push({
      userId: payload.userId,
      title: payload.title,
      body: payload.body,
      channel: payload.androidChannelId,
      data: payload.data
    });
    return { ...payload, sentAt: new Date().toISOString() };
  };
}

const pushedTo = (userId: string) => sent.filter(s => s.data?.type === 'RIDER_TRIP_AVAILABLE' && s.userId === userId);
const tripPushes = () => sent.filter(s => s.data?.type === 'RIDER_TRIP_AVAILABLE');

console.log('====================================================');
console.log('  A RIDER IS TOLD, AND ONLY ONE WHO COULD ACCEPT     ');
console.log('====================================================\n');

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');

try {
  /* ---------------------------------------------------------------- *
   *  THE CHANNEL IS THE ONE THE APP CREATED                          *
   * ---------------------------------------------------------------- */
  console.log('-- The channel, read out of the rider app');

  const alertSource = appSource(RIDER_ALERT);
  const declared = alertSource.match(/setNotificationChannelAsync\(\s*([A-Z_]+)/);
  const channelConst = declared?.[1];
  const channelValue = channelConst
    ? alertSource.match(new RegExp(`${channelConst}\\s*=\\s*'([^']+)'`))?.[1]
    : undefined;

  if (!channelValue) {
    throw new Error(
      'PRECONDITION: could not read the channel id out of the rider app source, so the check below would compare a constant with itself.'
    );
  }

  it('The rider app creates a channel, and the id is read from ITS source', () => {
    /*
     * Not compared against a copy of the string in this file. A constant compared
     * with itself is exactly what let `new_orders`, `new-orders` and
     * `kitchen-orders` coexist until §8.1, with the kitchen alarm addressed to a
     * channel that existed on no phone.
     */
    assert.equal(channelValue, 'new-orders', `the app creates '${channelValue}'`);
  });

  /* ---------------------------------------------------------------- *
   *  THE FIXTURE                                                     *
   * ---------------------------------------------------------------- */
  console.log('\n-- Three riders, and one trip on offer');

  createVersion({ codCashCeiling: 3000 }, { userId: 'usr_admin_trip' }, 'A known ceiling');

  const restaurant = Array.from(memoryStore.restaurants.values() as any)[0] as any;
  if (!restaurant?.coordinates) {
    throw new Error('PRECONDITION: the seeded restaurant has no coordinates, so nearest-first cannot be checked.');
  }

  /*
   * THIS SUITE OWNS ITS RIDERS.
   *
   * Reaching for whichever riders the seed happens to provide is how a check ends
   * up asserting against a fixture somebody else can change — and these checks
   * turn on one rider being eligible and another not.
   */
  const mk = (id: string, opts: { online: boolean; cash: number; km: number }) => {
    const rider: any = {
      id,
      userId: `usr_${id}`,
      fullName: id,
      phone: '9800000000',
      isOnline: opts.online,
      codCashInHand: opts.cash,
      kycStatus: 'ACTIVE',
      driverCode: 'QB-T1',
      profilePhotoUrl: 'https://example.test/p.png',
      currentCoordinates: {
        latitude: restaurant.coordinates.latitude + opts.km / 111.32,
        longitude: restaurant.coordinates.longitude
      },
      createdAt: new Date().toISOString()
    };
    memoryStore.riders.set(id, rider);
    memoryStore.users.set(rider.userId, {
      id: rider.userId,
      email: `${id}@trip.test`,
      fullName: id,
      role: 'rider',
      createdAt: new Date().toISOString()
    } as any);
    return rider;
  };

  // Every other rider offline, so only this suite's three are candidates.
  for (const r of Array.from(memoryStore.riders.values() as any) as any[]) {
    if (!String(r.id).startsWith('trp_')) r.isOnline = false;
  }

  const near = mk('trp_near', { online: true, cash: 0, km: 1 });
  const far = mk('trp_far', { online: true, cash: 0, km: 9 });
  const atCeiling = mk('trp_ceiling', { online: true, cash: 3000, km: 2 });
  const offline = mk('trp_offline', { online: false, cash: 0, km: 1 });

  const cashOrder: any = {
    id: 'ord_trip_cash',
    orderNumber: 'QB-TRIP-CASH',
    customerId: 'usr_customer_01',
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    restaurantCoordinates: restaurant.coordinates,
    status: 'READY_FOR_PICKUP',
    paymentMethod: 'CASH_ON_DELIVERY',
    bill: { totalAmount: 500 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const onlineOrder: any = { ...cashOrder, id: 'ord_trip_online', orderNumber: 'QB-TRIP-ONLINE', paymentMethod: 'ONLINE' };
  memoryStore.orders.set(cashOrder.id, cashOrder);
  memoryStore.orders.set(onlineOrder.id, onlineOrder);

  if (!cashCeilingBlocks(atCeiling.id, cashOrder).blocked) {
    throw new Error(
      'PRECONDITION: the rider at Rs 3000 is not blocked from a cash order, so every ceiling check below would pass for the wrong reason.'
    );
  }

  it('The ceiling rider is blocked from a CASH trip and not from an online one', () => {
    assert.equal(cashCeilingBlocks(atCeiling.id, cashOrder).blocked, true);
    assert.equal(
      cashCeilingBlocks(atCeiling.id, onlineOrder).blocked,
      false,
      'the ceiling is stopping them earning, not stopping cash accumulating'
    );
  });

  /* ---------------------------------------------------------------- *
   *  WHO GETS WOKEN                                                  *
   * ---------------------------------------------------------------- */
  console.log('\n-- Who is woken for a cash trip');

  captureSends();
  const cashTargets = await offerTripToNearbyRiders(cashOrder);

  it('AN ELIGIBLE RIDER IS PUSHED, on the channel the app created', () => {
    assert.ok(cashTargets.includes(near.id), `targets were ${JSON.stringify(cashTargets)}`);
    const push = pushedTo(near.userId)[0];
    assert.ok(push, 'the nearest eligible rider was not pushed');
    assert.equal(push.channel, channelValue, `sent on '${push.channel}'`);
  });

  it('AND A RIDER AT THE CASH CEILING IS NOT PUSHED A CASH TRIP', () => {
    /*
     * The half that makes this worth having. Drop the eligibility filter and the
     * check above still passes; this one stops.
     */
    assert.equal(pushedTo(atCeiling.userId).length, 0, 'woken for a trip the gate would refuse');
    assert.ok(!cashTargets.includes(atCeiling.id));
  });

  it('and an offline rider is not woken at all', () => {
    assert.equal(pushedTo(offline.userId).length, 0, 'a rider who is off shift was woken');
  });

  captureSends();
  await offerTripToNearbyRiders(onlineOrder);

  it('and the ceiling rider IS woken for an online trip', () => {
    assert.equal(
      pushedTo(atCeiling.userId).length,
      1,
      'the cash ceiling is keeping them from work they are allowed to take'
    );
  });

  /* ---------------------------------------------------------------- *
   *  NEAREST FIRST, AND NOT EVERYBODY                                *
   * ---------------------------------------------------------------- */
  console.log('\n-- Nearest to the kitchen first');

  it('The rider 1 km from the kitchen is ordered before the one 9 km away', () => {
    /*
     * Nearest to the KITCHEN rather than to the customer: the rider's first job is
     * to collect, and one three streets from the restaurant gets there while one
     * near the delivery address is still crossing town.
     */
    const order = cashTargets.indexOf(near.id);
    const later = cashTargets.indexOf(far.id);
    assert.ok(order !== -1 && later !== -1, JSON.stringify(cashTargets));
    assert.ok(order < later, `near was at ${order} and far at ${later}`);
  });

  /*
   * A SECOND ORDER, assigned to the far rider, so they are mid-trip.
   * Set up outside a check, because a check that only arranges state and asserts
   * nothing is a check that cannot fail.
   */
  {
    memoryStore.orders.set('ord_trip_busy', {
      ...cashOrder,
      id: 'ord_trip_busy',
      orderNumber: 'QB-TRIP-BUSY',
      riderId: far.id,
      riderStage: 'HEADING_TO_RESTAURANT',
      status: 'READY_FOR_PICKUP'
    } as any);
  }

  captureSends();
  const afterBusy = await offerTripToNearbyRiders(onlineOrder);

  it('and that is asserted, not just set up', () => {
    assert.ok(!afterBusy.includes(far.id), 'a rider mid-trip was offered a second one');
    assert.equal(pushedTo(far.userId).length, 0);
    assert.ok(afterBusy.includes(near.id), 'the free rider stopped being offered anything');
  });

  /* ---------------------------------------------------------------- *
   *  A TRIP THAT IS NOT ON OFFER                                     *
   * ---------------------------------------------------------------- */
  console.log('\n-- Nothing is sent for a trip nobody can take');

  captureSends();
  const claimed = await offerTripToNearbyRiders({ ...onlineOrder, riderId: near.id } as any);

  it('An order that already has a rider wakes nobody', () => {
    assert.deepEqual(claimed, []);
    assert.equal(tripPushes().length, 0, 'riders were woken for a trip that was already taken');
  });

  captureSends();
  const tooEarly = await offerTripToNearbyRiders({ ...onlineOrder, status: 'ACCEPTED' } as any);

  it('and neither does one the kitchen has not finished', () => {
    // `offerableNow` reads the restaurant's own riderOfferAtStatus, defaulting to
    // READY_FOR_PICKUP. A rider sent to a kitchen that has not started cooking
    // waits on the pavement.
    assert.deepEqual(tooEarly, []);
    assert.equal(tripPushes().length, 0);
  });

  /* ---------------------------------------------------------------- *
   *  IT CANNOT BREAK THE ORDER                                       *
   * ---------------------------------------------------------------- */
  console.log('\n-- A broken push must not stop food being marked ready');

  (fcmDispatcher as any).sendPushNotification = async () => {
    throw new Error('FCM is unreachable');
  };

  let threw: string | null = null;
  const survived = await offerTripToNearbyRiders(onlineOrder).catch((e: any) => {
    threw = e?.message || String(e);
    return null;
  });

  it('A COMPLETELY BROKEN PUSH DOES NOT THROW', () => {
    /*
     * The `tellTheKitchen` rule. Marking food ready must not fail because a Google
     * credential expired — and this is called from the status route, so a throw
     * here would 500 the kitchen's own tap.
     */
    assert.equal(threw, null, `it threw: ${threw}`);
    assert.deepEqual(survived, [], 'it reported riders it had not reached');
  });

  (fcmDispatcher as any).sendPushNotification = realSend;

  /* ---------------------------------------------------------------- *
   *  V1: THE OFFER LIST AGREES WITH THE GATE                         *
   * ---------------------------------------------------------------- */
  console.log('\n-- V1: the list no longer offers what the gate refuses');

  await riderRepository.update(atCeiling.id, { codCashInHand: 3000 } as any);
  const ceilingLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: `${atCeiling.id}@trip.test`, password: 'pass123' }
  });

  it('The offer list and the claim gate use ONE eligibility function', () => {
    /*
     * V1 turned out to be a real defect. The claim gate refused a cash order at
     * the ceiling; the list did not filter for it. So a rider at the limit was
     * SHOWN cash trips, tapped one, and got a 409 — told off for accepting an
     * offer the server had just made them. A 409 on a tap looks like bad luck
     * rather than a bug, which is why it survived.
     *
     * Asserted against the source because the fixture cannot easily sign this
     * synthetic rider in: what matters is that both paths call the same function
     * rather than keeping two copies of the rule.
     */
    const router = appSource('apps/backend-api/src/routes/riderRouter.ts');
    const uses = router.match(/cashCeilingBlocks\(/g) || [];
    assert.ok(
      uses.length >= 2,
      `cashCeilingBlocks is called ${uses.length} time(s); the list and the gate must both use it`
    );
    assert.ok(
      !router.includes('standing.canTakeCod'),
      'the gate still has its own copy of the cash rule'
    );
  });

  it('and the eligibility helper refuses that rider directly', () => {
    // The behavioural half, through the function the list now filters with.
    const eligible = cashCeilingBlocks(atCeiling.id, cashOrder);
    assert.equal(eligible.blocked, true);
    assert.ok(eligible.message && /cash/i.test(eligible.message), eligible.message || 'no message');
  });

  const eligibleForCash = await eligibleRidersFor(cashOrder);

  it('and that is asserted through the shared helper', () => {
    const ids = eligibleForCash.map(r => r.id);
    assert.ok(!ids.includes(atCeiling.id), `the ceiling rider is still eligible: ${JSON.stringify(ids)}`);
    assert.ok(ids.includes(near.id), 'the eligible rider was dropped too, so this proves nothing');
  });

  void ceilingLogin;
} catch (err: any) {
  failed++;
  console.log(`[FAIL] the suite itself threw: ${err?.stack || err}`);
} finally {
  (fcmDispatcher as any).sendPushNotification = realSend;
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
