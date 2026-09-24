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
import { offerTripToNearbyRiders, eligibleRidersFor, withdrawTripOffers } from '../modules/orders/tripOffers.ts';
import { cashCeilingBlocks } from '../modules/orders/riderTrip.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { createVersion } from '../modules/payments/pricingConfig.ts';
import { sweepStaleOrders } from '../modules/orders/orderSweeper.ts';

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

type Sent = {
  userId: string;
  title: string;
  body: string;
  channel?: string;
  androidTag?: string;
  dataOnly?: boolean;
  data?: any;
};
let sent: Sent[] = [];
/** Never cleared, so a check can assert about every push the suite ever made. */
const sentEver: Sent[] = [];
const realSend = fcmDispatcher.sendPushNotification.bind(fcmDispatcher);

function captureSends() {
  sent = [];
  (fcmDispatcher as any).sendPushNotification = async (payload: any) => {
    const record: Sent = {
      userId: payload.userId,
      title: payload.title,
      body: payload.body,
      channel: payload.androidChannelId,
      androidTag: payload.androidTag,
      dataOnly: payload.dataOnly,
      data: payload.data
    };
    sent.push(record);
    sentEver.push(record);
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

  /*
   * A FRESH ORDER, because the ones above now carry offer history.
   *
   * W1.2 added "never wake the same rider for the same order twice", which is what
   * makes the waves widen. It also means any check reusing an order a rider has
   * already been offered is asking a different question — and these two checks
   * failed on exactly that when the skip went in, correctly.
   */
  const busyProbe: any = { ...onlineOrder, id: 'ord_trip_busyprobe', orderNumber: 'QB-BUSYPROBE', offeredToRiderIds: [] };
  memoryStore.orders.set(busyProbe.id, busyProbe);

  captureSends();
  const afterBusy = await offerTripToNearbyRiders(busyProbe);

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

  // Fresh, for the same reason as `busyProbe` above.
  const ceilingProbe: any = { ...cashOrder, id: 'ord_trip_ceilprobe', orderNumber: 'QB-CEILPROBE', offeredToRiderIds: [] };
  memoryStore.orders.set(ceilingProbe.id, ceilingProbe);
  const eligibleForCash = await eligibleRidersFor(ceilingProbe);

  it('and that is asserted through the shared helper', () => {
    const ids = eligibleForCash.map(r => r.id);
    assert.ok(!ids.includes(atCeiling.id), `the ceiling rider is still eligible: ${JSON.stringify(ids)}`);
    assert.ok(ids.includes(near.id), 'the eligible rider was dropped too, so this proves nothing');
  });

  void ceilingLogin;

  /* ---------------------------------------------------------------- *
   *  W1.2: THE WAVES WIDEN                                           *
   * ---------------------------------------------------------------- */
  console.log('\n-- W1.2: the next group, not the same group again');

  const waveOrder: any = {
    ...onlineOrder,
    id: 'ord_wave',
    orderNumber: 'QB-WAVE',
    offeredToRiderIds: [],
    riderId: undefined
  };
  memoryStore.orders.set(waveOrder.id, waveOrder);

  // Five more eligible riders, so one wave of six leaves some for the next.
  const extra = [1, 2, 3, 4, 5].map(n => mk(`trp_w${n}`, { online: true, cash: 0, km: 3 + n }));
  await riderRepository.update(far.id, { isOnline: true } as any);
  memoryStore.orders.delete('ord_trip_busy');

  captureSends();
  const wave1 = await offerTripToNearbyRiders(memoryStore.orders.get(waveOrder.id) as any);

  it('A wave wakes at most six riders, not everybody online', () => {
    /*
     * Forty riders means forty alarms for one order, thirty-nine for a trip
     * somebody else takes. A rider whose phone screams for work that evaporates
     * turns the channel off, and then the trip that needed them arrives silently.
     */
    assert.ok(wave1.length > 0, 'nobody was woken at all');
    assert.ok(wave1.length <= 6, `woke ${wave1.length} riders for one trip`);
    assert.ok(extra.length >= 5, 'the fixture has too few riders to leave a second wave');
  });

  captureSends();
  const wave2 = await offerTripToNearbyRiders(memoryStore.orders.get(waveOrder.id) as any);

  it('THE SECOND WAVE ASKS DIFFERENT RIDERS', () => {
    /*
     * The whole point of W1.2. Without the already-offered skip, every wave wakes
     * the same nearest riders — the ones who have already decided not to take it —
     * while rider seven is never asked and the order waits for NO_RIDER_FOUND
     * with riders still available.
     */
    const overlap = wave2.filter(id => wave1.includes(id));
    assert.deepEqual(overlap, [], `the same riders were woken twice: ${JSON.stringify(overlap)}`);
  });

  it('and the second wave is not empty, or the check above passes by waking nobody', () => {
    assert.ok(wave2.length > 0, 'the second wave woke nobody, so widening cannot be observed');
  });

  /* ---------------------------------------------------------------- *
   *  W1.1: THE OTHER ALARMS ARE CALLED OFF                           *
   * ---------------------------------------------------------------- */
  console.log('\n-- W1.1: the riders who did not get it are told');

  const offeredNow = ((memoryStore.orders.get(waveOrder.id) as any).offeredToRiderIds || []) as string[];
  if (offeredNow.length < 2) {
    throw new Error(
      `PRECONDITION: only ${offeredNow.length} rider(s) were offered this trip, so "everybody except the winner is told" cannot fail.`
    );
  }

  const winner = offeredNow[0];
  captureSends();
  const told = await withdrawTripOffers(memoryStore.orders.get(waveOrder.id) as any, winner);

  it('EVERY OTHER RIDER OFFERED THE TRIP IS TOLD IT IS GONE', () => {
    assert.equal(told.length, offeredNow.length - 1, `told ${told.length} of ${offeredNow.length - 1}`);
    assert.ok(!told.includes(winner), 'the rider who took it was told they had lost it');
  });

  it('and the withdrawal is DATA ONLY, so it cannot ring the alarm again', () => {
    /*
     * Channel importance and sound are fixed when the app creates the channel, so
     * a visible "that trip is gone" on the rider's alarm channel would play the
     * looping sound AGAIN — worse than the stale entry it was clearing. The only
     * way to remove an entry is to tell the app in a message Android does not
     * draw.
     */
    const withdrawals = sent.filter(s => s.data?.type === 'RIDER_TRIP_WITHDRAWN');
    assert.ok(withdrawals.length > 0, 'no withdrawal was sent');
    for (const w of withdrawals) {
      assert.equal((w as any).dataOnly, true, 'a withdrawal would have been drawn by Android');
    }
  });

  /* ---------------------------------------------------------------- *
   *  THE SWEEPER WIDENS BEFORE IT GIVES UP                           *
   * ---------------------------------------------------------------- */
  console.log('\n-- The alert means everybody has been asked, not "we tried once"');

  /*
   * A fresh waiting order the sweeper will pick up. `listAwaitingAction` returns
   * READY_FOR_PICKUP orders with no rider, which is what this is.
   */
  const stuck: any = {
    ...onlineOrder,
    id: 'ord_stuck',
    orderNumber: 'QB-STUCK',
    status: 'READY_FOR_PICKUP',
    riderId: undefined,
    riderSearchAlertedAt: undefined,
    offeredToRiderIds: [],
    declinedByRiderIds: [],
    acceptedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  };
  memoryStore.orders.set(stuck.id, stuck);

  // Everybody free, so there is somebody to widen to.
  memoryStore.orders.delete('ord_trip_busy');
  for (const id of ['trp_near', 'trp_far', 'trp_w1', 'trp_w2', 'trp_w3', 'trp_w4', 'trp_w5']) {
    await riderRepository.update(id, { isOnline: true } as any);
  }

  captureSends();
  const sweep1 = await sweepStaleOrders(new Date());

  it('A SWEEP WIDENS THE SEARCH INSTEAD OF ESCALATING', () => {
    /*
     * The order has been waiting an hour, well past the alert threshold. Before
     * W1.2 this sweep would have raised NO_RIDER_FOUND — an alert about a trip
     * that had been offered to six riders once and to nobody since.
     *
     * Now it asks the next group first, and says so.
     */
    const widened = sweep1.widened.find(w => w.orderId === stuck.id);
    assert.ok(widened, `nothing widened: ${JSON.stringify(sweep1.widened)}`);
    assert.ok(widened!.riders > 0, 'widened to nobody');
    assert.ok(
      !sweep1.alerted.includes(stuck.id),
      'the owner was told "no rider found" while the platform was still asking riders'
    );
  });

  const sweeps: Array<{ widened: number; alerted: boolean }> = [];
  for (let i = 0; i < 6; i++) {
    const s = await sweepStaleOrders(new Date());
    sweeps.push({
      widened: s.widened.find(w => w.orderId === stuck.id)?.riders || 0,
      alerted: s.alerted.includes(stuck.id)
    });
  }

  it('THE ALERT FIRES ONLY ONCE NOBODY IS LEFT TO ASK', () => {
    /*
     * The sequencing B asked for. An alert raised while the search is still
     * running is an alert about a problem that may not exist, and one the reader
     * cannot act on — so NO_RIDER_FOUND now means what it says: everybody who
     * could take this has been asked and none of them took it.
     */
    const firstAlert = sweeps.findIndex(s => s.alerted);
    assert.notEqual(firstAlert, -1, `no alert after six more sweeps: ${JSON.stringify(sweeps)}`);
    assert.equal(
      sweeps[firstAlert].widened,
      0,
      'the alert fired on a sweep that had just woken more riders'
    );
  });

  it('and every sweep before it had woken somebody new', () => {
    const firstAlert = sweeps.findIndex(s => s.alerted);
    for (let i = 0; i < firstAlert; i++) {
      assert.ok(sweeps[i].widened > 0, `sweep ${i} neither widened nor alerted, so the order just sat there`);
    }
  });

  it('and the offer carries a tag, so repeated waves REPLACE rather than stack', () => {
    /*
     * The half that works on the APK riders already have. Four identical alarms
     * for one trip is how a rider learns to clear the whole channel.
     */
    const offers = sentEver.filter(s => s.data?.type === 'RIDER_TRIP_AVAILABLE');
    assert.ok(offers.length > 0, 'no offer was captured, so this proves nothing');
    for (const o of offers) {
      assert.equal((o as any).androidTag, `trip:${o.data.orderId}`, 'an offer carried no tag');
    }
  });
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
