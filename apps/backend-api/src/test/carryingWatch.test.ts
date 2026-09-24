/**
 * THE RIDER WHO HAS THE FOOD, WHICH NOTHING WATCHED.
 *
 * -------------------------------------------------------------------------
 * THE GAP
 * -------------------------------------------------------------------------
 * `orderSweeper` iterated exactly two lists: orders awaiting action, and trips
 * accepted but not collected. AFTER PICKUP, NOBODY WAS LOOKING — I grepped the
 * whole tree for any overdue-delivery or stale-location detection and there was
 * none.
 *
 * So a rider who collected the food and then stopped — a crash, a dead phone, or
 * walking off with a cash order — left the order out for delivery forever. No
 * alert anywhere. The customer watched a map that had stopped moving, and on a
 * cash order an unseen person held both the food and the money.
 *
 * It is the one case re-offering cannot recover, because the food has left the
 * building.
 *
 * -------------------------------------------------------------------------
 * THE CHECK THAT MATTERS MOST IS THE NEGATIVE
 * -------------------------------------------------------------------------
 * Every order ever delivered carries a `riderLocationUpdatedAt`, and most of them
 * are months old. A staleness detector that does not exclude them fires on the
 * entire history on the day it ships — hundreds of urgent alerts, and an urgent
 * channel that does that once is muted forever.
 *
 * So: a DELIVERED order raises neither tier, and that is asserted before anything
 * else.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { sweepStaleOrders } from '../modules/orders/orderSweeper.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { createVersion, getActiveRates } from '../modules/payments/pricingConfig.ts';
import { ownOrder, ownRider } from './helpers/ownFixture.ts';

const PORT = 5221;

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

const ofType = (type: string) => sent.filter(s => s.data?.type === type);
const minutesAgo = (n: number) => new Date(Date.now() - n * 60000).toISOString();

console.log('====================================================');
console.log('  SOMEBODY IS WATCHING THE RIDER WITH THE FOOD       ');
console.log('====================================================\n');

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');

try {
  createVersion(
    { riderLocationSilentMinutes: 10, deliveryOverdueMinutes: 15 },
    { userId: 'usr_admin_w21' },
    'Known thresholds'
  );

  const rates = getActiveRates();
  if (rates.riderLocationSilentMinutes !== 10 || rates.deliveryOverdueMinutes !== 15) {
    throw new Error(
      `PRECONDITION: the thresholds did not take (silent ${rates.riderLocationSilentMinutes}, overdue ${rates.deliveryOverdueMinutes}). ` +
        'A rate absent from RATE_BOUNDS is silently dropped, and every check below would be measuring against a default nobody set.'
    );
  }

  it('The two thresholds are settable rates, not constants', () => {
    /*
     * They have to be in RATE_BOUNDS to exist at all — `createVersion` silently
     * drops any key not listed there, which is the trap §6.2 fell into: a rate
     * that is editable, displayed, and read by nothing.
     */
    assert.equal(rates.riderLocationSilentMinutes, 10);
    assert.equal(rates.deliveryOverdueMinutes, 15);
  });

  const restaurant = Array.from(memoryStore.restaurants.values() as any)[0] as any;
  const rider = ownRider('w21rider', { isOnline: true });

  /* ---------------------------------------------------------------- *
   *  THE NEGATIVE, FIRST                                             *
   * ---------------------------------------------------------------- */
  console.log('-- A delivered order raises nothing');

  const delivered = ownOrder('w21delivered', {
    restaurantId: restaurant.id,
    status: 'DELIVERED',
    riderId: rider.id,
    riderStage: 'DELIVERED',
    extra: {
      pickedUpAt: minutesAgo(600),
      riderLocationUpdatedAt: minutesAgo(600),
      deliveredAt: minutesAgo(590)
    }
  });

  captureSends();
  const sweepDelivered = await sweepStaleOrders(new Date());

  it('A DELIVERED ORDER TEN HOURS OLD RAISES NEITHER TIER', () => {
    /*
     * The check that decides whether this feature is shippable. Every order ever
     * delivered carries a stale `riderLocationUpdatedAt`, so a detector that does
     * not exclude them alerts on the whole history on day one — and an urgent
     * channel that does that once is muted forever.
     *
     * Excluded by construction rather than by a filter: `listCarrying` asks
     * `isCarrying`, which is false for a delivered rider stage.
     */
    const flagged = sweepDelivered.carryingFlagged.find(f => f.orderId === delivered.id);
    assert.equal(flagged, undefined, `a delivered order was flagged: ${JSON.stringify(flagged)}`);
    assert.equal(ofType('ADMIN_RIDER_WENT_SILENT').length, 0, 'an urgent alert fired for delivered food');
    assert.equal(ofType('ADMIN_DELIVERY_OVERDUE').length, 0);
    assert.equal(ofType('DELIVERY_DELAYED').length, 0, 'a customer was told their delivered order was late');
  });

  const carryingNow = await orderRepository.listCarrying();

  it('and that is asserted against the list itself', () => {
    assert.ok(
      !carryingNow.some(o => o.id === delivered.id),
      'a delivered order is still considered to be carried'
    );
  });

  /* ---------------------------------------------------------------- *
   *  SILENCE WHILE CARRYING                                          *
   * ---------------------------------------------------------------- */
  console.log('\n-- A rider carrying food who has gone quiet');

  const silent = ownOrder('w21silent', {
    restaurantId: restaurant.id,
    riderId: rider.id,
    riderStage: 'PICKED_UP',
    status: 'OUT_FOR_DELIVERY',
    paymentMethod: 'CASH_ON_DELIVERY',
    extra: { pickedUpAt: minutesAgo(40), riderLocationUpdatedAt: minutesAgo(25) }
  });

  captureSends();
  const sweepSilent = await sweepStaleOrders(new Date());

  it('TWENTY-FIVE MINUTES OF SILENCE IS RAISED, AND RAISED AS URGENT', () => {
    const flagged = sweepSilent.carryingFlagged.find(f => f.orderId === silent.id);
    assert.ok(flagged, `nothing flagged: ${JSON.stringify(sweepSilent.carryingFlagged)}`);
    assert.equal(flagged!.tier, 'SILENT');

    const push = ofType('ADMIN_RIDER_WENT_SILENT')[0];
    assert.ok(push, 'no urgent push was sent');
    assert.equal(push.channel, 'admin-urgent', `sent on ${push.channel}`);
  });

  it('and it says it is a cash order, because that changes the answer', () => {
    /*
     * A silent rider carrying somebody else's dinner is one problem. A silent
     * rider carrying the dinner AND the cash for it is a different one, and the
     * person deciding whether to phone or to escalate needs to know which.
     */
    const push = ofType('ADMIN_RIDER_WENT_SILENT')[0];
    assert.ok(/cash/i.test(push.body), push.body);
  });

  it('and the CUSTOMER is told honestly rather than left with a frozen map', () => {
    /*
     * Until now this produced nothing at all: the marker stopped and the customer
     * could not tell whether the app was broken, the rider was lost, or the food
     * was coming. Silence makes them assume the worst and phone support.
     */
    const told = ofType('DELIVERY_DELAYED')[0];
    assert.ok(told, 'the customer was told nothing');
    assert.ok(/lost contact/i.test(told.body), told.body);
    assert.ok(
      !/crash|accident|hurt|injur/i.test(told.body),
      `the customer was told what might have happened to the rider: ${told.body}`
    );
  });

  captureSends();
  const sweepAgain = await sweepStaleOrders(new Date());

  it('THE SAME TIER DOES NOT FIRE TWICE', () => {
    /*
     * The sweeper runs every thirty seconds. Without this, one lost rider is an
     * urgent alarm twice a minute until somebody resolves it — and two minutes of
     * that teaches the reader to swipe the urgent channel, which is the channel
     * carrying the SOS.
     */
    assert.equal(
      sweepAgain.carryingFlagged.filter(f => f.orderId === silent.id).length,
      0,
      'the same silent rider was raised again on the next sweep'
    );
    assert.equal(ofType('ADMIN_RIDER_WENT_SILENT').length, 0);
  });

  it('and the customer is not told a second time either', () => {
    assert.equal(ofType('DELIVERY_DELAYED').length, 0, 'two messages about one late dinner');
  });

  /* ---------------------------------------------------------------- *
   *  LATE, BUT STILL MOVING                                          *
   * ---------------------------------------------------------------- */
  console.log('\n-- Late, with the rider still transmitting');

  const late = ownOrder('w21late', {
    restaurantId: restaurant.id,
    riderId: rider.id,
    riderStage: 'PICKED_UP',
    status: 'OUT_FOR_DELIVERY',
    extra: {
      // Out for 40 minutes: past the 15-minute overdue threshold.
      pickedUpAt: minutesAgo(40),
      // Transmitting NOW, so this is not silence.
      riderLocationUpdatedAt: new Date().toISOString()
    }
  });

  captureSends();
  const sweepLate = await sweepStaleOrders(new Date());
  const lateFlag = sweepLate.carryingFlagged.find(f => f.orderId === late.id);

  it('A RIDER WHO IS LATE BUT MOVING IS FLAGGED, AND NOT AS URGENT', () => {
    /*
     * The distinction that keeps the urgent tier worth reading. This rider is
     * transmitting — they are simply late, which on a wet Friday is most of them.
     * Waking somebody for traffic is how the channel that carries "we have lost a
     * rider" stops being read.
     *
     * ASSERTED UNCONDITIONALLY. My first version wrapped this in `if (lateFlag)`,
     * so it would have passed silently whenever the overdue tier never fired —
     * which is exactly what was happening: I was comparing `now` against
     * `estimateArrival().arrivingAt`, and that function recomputes from the
     * rider's current position every call, so it is always in the future and
     * "past the estimate" was always negative. The tier could never fire at all.
     */
    assert.ok(lateFlag, `a 40-minute-old delivery was not flagged: ${JSON.stringify(sweepLate.carryingFlagged)}`);
    assert.equal(lateFlag!.tier, 'OVERDUE', `a moving rider was flagged ${lateFlag!.tier}`);

    const push = ofType('ADMIN_DELIVERY_OVERDUE')[0];
    assert.ok(push, 'flagged overdue but nothing was sent');
    assert.equal(push.channel, 'admin-attention', `sent on ${push.channel}`);
    assert.ok(/40 minutes/.test(push.body), push.body);

    assert.equal(
      ofType('ADMIN_RIDER_WENT_SILENT').length,
      0,
      'a rider transmitting right now was reported as silent'
    );
  });

  it('and the customer is told it is late without being told anything is wrong', () => {
    const told = ofType('DELIVERY_DELAYED')[0];
    assert.ok(told, 'the customer was not told their order is late');
    assert.ok(/running late/i.test(told.title), told.title);
    assert.ok(
      !/lost contact/i.test(told.body),
      `a merely-late order told the customer we had lost the rider: ${told.body}`
    );
  });

  /* ---------------------------------------------------------------- *
   *  ESCALATION IS NEWS                                              *
   * ---------------------------------------------------------------- */
  console.log('\n-- Traffic becoming silence is worth a second alert');

  const escalating = ownOrder('w21escalate', {
    restaurantId: restaurant.id,
    riderId: rider.id,
    riderStage: 'PICKED_UP',
    status: 'OUT_FOR_DELIVERY',
    extra: {
      pickedUpAt: minutesAgo(90),
      riderLocationUpdatedAt: new Date().toISOString(),
      // Pre-set so this order is already known to be merely late.
      carryingAlertTier: 'OVERDUE'
    }
  });

  // Now the rider goes quiet.
  escalating.riderLocationUpdatedAt = minutesAgo(30);
  memoryStore.orders.set(escalating.id, escalating);

  captureSends();
  const sweepEscalate = await sweepStaleOrders(new Date());

  it('AN ORDER ALREADY FLAGGED LATE IS RAISED AGAIN WHEN IT GOES SILENT', () => {
    /*
     * Stored as the TIER rather than a boolean for exactly this. An order that was
     * merely late and has now lost its rider is a different and worse problem, and
     * a boolean "already alerted" would have swallowed it.
     */
    const flagged = sweepEscalate.carryingFlagged.find(f => f.orderId === escalating.id);
    assert.ok(flagged, 'the escalation was swallowed as a duplicate');
    assert.equal(flagged!.tier, 'SILENT');
    assert.ok(ofType('ADMIN_RIDER_WENT_SILENT').length >= 1);
  });

  /* ---------------------------------------------------------------- *
   *  NEVER TRANSMITTED AT ALL                                        *
   * ---------------------------------------------------------------- */
  console.log('\n-- A rider who has not transmitted since collecting');

  const neverPinged = ownOrder('w21never', {
    restaurantId: restaurant.id,
    riderId: rider.id,
    riderStage: 'PICKED_UP',
    status: 'OUT_FOR_DELIVERY',
    // No riderLocationUpdatedAt at all.
    extra: { pickedUpAt: minutesAgo(45) }
  });

  captureSends();
  const sweepNever = await sweepStaleOrders(new Date());

  it('SILENCE IS MEASURED FROM PICKUP WHEN THERE HAS NEVER BEEN A PING', () => {
    /*
     * The worst case, and the one a naive check misses. `minutesSince` returns 0
     * for a missing timestamp — the safe direction for staleness generally, and
     * exactly the wrong answer here: a rider who has sent nothing at all since
     * collecting would have read as "just heard from them".
     */
    const flagged = sweepNever.carryingFlagged.find(f => f.orderId === neverPinged.id);
    assert.ok(flagged, 'a rider who never transmitted was not flagged at all');
    assert.equal(flagged!.tier, 'SILENT');
  });

  /* ---------------------------------------------------------------- *
   *  IT CANNOT BREAK THE SWEEP                                       *
   * ---------------------------------------------------------------- */
  console.log('\n-- A broken push must not stop the sweep');

  (fcmDispatcher as any).sendPushNotification = async () => {
    throw new Error('FCM is unreachable');
  };

  const breaker = ownOrder('w21breaker', {
    restaurantId: restaurant.id,
    riderId: rider.id,
    riderStage: 'PICKED_UP',
    status: 'OUT_FOR_DELIVERY',
    extra: { pickedUpAt: minutesAgo(50), riderLocationUpdatedAt: minutesAgo(40) }
  });

  let threw: string | null = null;
  const survived = await sweepStaleOrders(new Date()).catch((e: any) => {
    threw = e?.message || String(e);
    return null;
  });

  it('THE SWEEP SURVIVES A COMPLETELY BROKEN PUSH SERVICE', () => {
    assert.equal(threw, null, `the sweep threw: ${threw}`);
    assert.ok(survived, 'the sweep returned nothing');
    assert.ok(
      survived!.carryingFlagged.some(f => f.orderId === breaker.id),
      'the order was not flagged, so the failure was not on the push path'
    );
  });

  (fcmDispatcher as any).sendPushNotification = realSend;
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
