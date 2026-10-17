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
 *
 * Since 18 Oct 2026 (owner Q6, master plan B4) a trip goes to ONE rider at a time,
 * nearest first, for 108 s; a decline or expiry moves it to the next rider; after
 * five riders operations is alerted once and the offers keep cycling; only the
 * offered rider can accept, and only in time.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { offerTripToNearbyRiders, eligibleRidersFor, withdrawTripOffers, moveOfferOnAfterDecline } from '../modules/orders/tripOffers.ts';
import { offerTo } from './helpers/offerTo.ts';
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

  /** Ends every running offer, so a check about one rule is not decided by an earlier offer (B4: one per rider). */
  const clearOffers = () => {
    for (const o of memoryStore.orders.values() as any) delete o.riderOffer;
  };
  /** Makes a trip's running offer run out now, as 108 s passing would. */
  const expire = (orderId: string) => {
    const o: any = memoryStore.orders.get(orderId);
    o.riderOffer = { ...o.riderOffer, expiresAt: new Date(Date.now() - 1000).toISOString() };
  };

  /* ---------------------------------------------------------------- *
   *  ONE RIDER AT A TIME, NEAREST FIRST (owner Q6, B4)               *
   * ---------------------------------------------------------------- */
  console.log('\n-- One rider at a time, nearest to the kitchen first');

  it('A trip is offered to ONE rider, not a group', () => {
    assert.deepEqual(cashTargets, [near.id], `offered to ${JSON.stringify(cashTargets)}`);
    assert.equal(tripPushes().length === 0 ? 0 : 1, 1);
  });

  clearOffers();
  // A fresh trip: riders already asked about one rank after those who have not been.
  const ranked = (await eligibleRidersFor({ ...cashOrder, id: 'ord_rank_probe', offeredToRiderIds: [] })).map(r => r.id);
  it('The rider 1 km from the kitchen ranks before the one 9 km away', () => {
    const a = ranked.indexOf(near.id);
    const b = ranked.indexOf(far.id);
    assert.ok(a !== -1 && b !== -1, JSON.stringify(ranked));
    assert.ok(a < b, `near was at ${a} and far at ${b}`);
  });

  // The far rider mid-trip, set up outside a check (a check that only arranges state cannot fail).
  memoryStore.orders.set('ord_trip_busy', {
    ...cashOrder,
    id: 'ord_trip_busy',
    orderNumber: 'QB-TRIP-BUSY',
    riderId: far.id,
    riderStage: 'HEADING_TO_RESTAURANT',
    status: 'READY_FOR_PICKUP'
  } as any);
  const busyProbe: any = { ...onlineOrder, id: 'ord_trip_busyprobe', orderNumber: 'QB-BUSYPROBE', offeredToRiderIds: [] };
  memoryStore.orders.set(busyProbe.id, busyProbe);
  const busyRanked = (await eligibleRidersFor(busyProbe)).map(r => r.id);

  it('A rider mid-trip is not offered a second one', () => {
    assert.ok(!busyRanked.includes(far.id), 'a rider mid-trip is eligible');
    assert.ok(busyRanked.includes(near.id), 'the free rider was dropped too, so this proves nothing');
  });

  /* ---------------------------------------------------------------- *
   *  A TRIP THAT IS NOT ON OFFER                                     *
   * ---------------------------------------------------------------- */
  console.log('\n-- Nothing is sent for a trip nobody can take');

  captureSends();
  const claimed = await offerTripToNearbyRiders({ ...onlineOrder, id: 'ord_not_stored', riderId: near.id } as any);
  it('An order that already has a rider wakes nobody', () => {
    assert.deepEqual(claimed, []);
    assert.equal(tripPushes().length, 0, 'riders were woken for a trip that was already taken');
  });

  captureSends();
  const tooEarly = await offerTripToNearbyRiders({ ...onlineOrder, id: 'ord_not_stored2', status: 'ACCEPTED' } as any);
  it('and neither does one the kitchen has not finished', () => {
    assert.deepEqual(tooEarly, []);
    assert.equal(tripPushes().length, 0);
  });

  /* ---------------------------------------------------------------- *
   *  IT CANNOT BREAK THE ORDER                                       *
   * ---------------------------------------------------------------- */
  console.log('\n-- A broken push must not stop food being marked ready');

  clearOffers();
  (fcmDispatcher as any).sendPushNotification = async () => {
    throw new Error('FCM is unreachable');
  };
  let threw: string | null = null;
  const survived = await offerTripToNearbyRiders(memoryStore.orders.get(onlineOrder.id) as any).catch((e: any) => {
    threw = e?.message || String(e);
    return null;
  });
  it('A COMPLETELY BROKEN PUSH DOES NOT THROW', () => {
    assert.equal(threw, null, `it threw: ${threw}`);
    assert.deepEqual(survived, [], 'it reported a rider it had not reached');
  });
  (fcmDispatcher as any).sendPushNotification = realSend;

  /* ---------------------------------------------------------------- *
   *  V1: THE OFFER LIST AGREES WITH THE GATE                         *
   * ---------------------------------------------------------------- */
  console.log('\n-- V1: the list no longer offers what the gate refuses');

  await riderRepository.update(atCeiling.id, { codCashInHand: 3000 } as any);
  it('The offer list and the claim gate use ONE eligibility function', () => {
    const router = appSource('apps/backend-api/src/routes/riderRouter.ts');
    const uses = router.match(/cashCeilingBlocks\(/g) || [];
    assert.ok(uses.length >= 2, `cashCeilingBlocks is called ${uses.length} time(s); the list and the gate must both use it`);
    assert.ok(!router.includes('standing.canTakeCod'), 'the gate still has its own copy of the cash rule');
  });
  it('and the eligibility helper refuses that rider directly', () => {
    const eligible = cashCeilingBlocks(atCeiling.id, cashOrder);
    assert.equal(eligible.blocked, true);
    assert.ok(eligible.message && /cash/i.test(eligible.message), eligible.message || 'no message');
  });
  clearOffers();
  const ceilingProbe: any = { ...cashOrder, id: 'ord_trip_ceilprobe', orderNumber: 'QB-CEILPROBE', offeredToRiderIds: [] };
  memoryStore.orders.set(ceilingProbe.id, ceilingProbe);
  const eligibleForCash = await eligibleRidersFor(ceilingProbe);
  it('and that is asserted through the shared helper', () => {
    const ids = eligibleForCash.map(r => r.id);
    assert.ok(!ids.includes(atCeiling.id), `the ceiling rider is still eligible: ${JSON.stringify(ids)}`);
    assert.ok(ids.includes(near.id), 'the eligible rider was dropped too, so this proves nothing');
  });

  /* ---------------------------------------------------------------- *
   *  THE OFFER MOVES ON: 108 s, OR A DECLINE                         *
   * ---------------------------------------------------------------- */
  console.log('\n-- The offer moves to the next rider when time runs out or they pass');

  memoryStore.orders.delete('ord_trip_busy');
  for (const id of ['ord_trip_cash', 'ord_trip_online', 'ord_trip_busyprobe', 'ord_trip_ceilprobe']) memoryStore.orders.delete(id);
  const extra = [1, 2, 3, 4, 5].map(n => mk(`trp_w${n}`, { online: true, cash: 0, km: 3 + n }));
  await riderRepository.update(far.id, { isOnline: true } as any);
  const waveOrder: any = { ...onlineOrder, id: 'ord_wave', orderNumber: 'QB-WAVE', offeredToRiderIds: [], declinedByRiderIds: [] };
  memoryStore.orders.set(waveOrder.id, waveOrder);

  captureSends();
  const first = await offerTripToNearbyRiders(waveOrder);
  const firstOffer = { ...(memoryStore.orders.get(waveOrder.id) as any).riderOffer };
  it('The nearest free rider gets it, for 108 seconds', () => {
    assert.deepEqual(first, [near.id]);
    const seconds = (Date.parse(firstOffer.expiresAt) - Date.parse(firstOffer.offeredAt)) / 1000;
    assert.equal(seconds, 108);
    assert.equal(firstOffer.round, 1);
  });
  const again = await offerTripToNearbyRiders(waveOrder);
  it('Asked again while that offer runs, nobody else is offered it', () => assert.deepEqual(again, []));
  const otherTrip: any = { ...onlineOrder, id: 'ord_other', orderNumber: 'QB-OTHER', offeredToRiderIds: [], declinedByRiderIds: [] };
  memoryStore.orders.set(otherTrip.id, otherTrip);
  const forOther = await offerTripToNearbyRiders(otherTrip);
  it('A rider holding one offer is not offered a second trip meanwhile (review D4)', () => {
    assert.equal(forOther.length, 1);
    assert.notEqual(forOther[0], near.id);
  });
  memoryStore.orders.delete(otherTrip.id);

  // Review S1: two callers at the same instant (a decline and a sweep, say).
  const savedWaveOffer = (memoryStore.orders.get(waveOrder.id) as any).riderOffer;
  clearOffers();
  const raceOrder: any = { ...onlineOrder, id: 'ord_race', orderNumber: 'QB-RACE', offeredToRiderIds: [], declinedByRiderIds: [] };
  memoryStore.orders.set(raceOrder.id, raceOrder);
  captureSends();
  const [r1, r2] = await Promise.all([offerTripToNearbyRiders(raceOrder), offerTripToNearbyRiders(raceOrder)]);
  it('Two offers for one trip at the same instant: one rider asked, once (review S1)', () => {
    assert.equal(r1.length + r2.length, 1, `${JSON.stringify(r1)} ${JSON.stringify(r2)}`);
    assert.equal(tripPushes().length, 1);
    assert.equal((memoryStore.orders.get(raceOrder.id) as any).riderOffer.round, 1);
  });
  clearOffers();
  const raceA: any = { ...onlineOrder, id: 'ord_race_a', orderNumber: 'QB-RA', offeredToRiderIds: [], declinedByRiderIds: [] };
  const raceB: any = { ...onlineOrder, id: 'ord_race_b', orderNumber: 'QB-RB', offeredToRiderIds: [], declinedByRiderIds: [] };
  memoryStore.orders.set(raceA.id, raceA);
  memoryStore.orders.set(raceB.id, raceB);
  const [ra, rb] = await Promise.all([offerTripToNearbyRiders(raceA), offerTripToNearbyRiders(raceB)]);
  it('...and two trips ready at once go to two different riders (D4 holds)', () => {
    assert.equal(ra.length, 1);
    assert.equal(rb.length, 1);
    assert.notEqual(ra[0], rb[0]);
  });
  // Review S6: an order cancelled while riders are being ranked gets no offer.
  clearOffers();
  const cancelMid: any = { ...onlineOrder, id: 'ord_cancel_mid', orderNumber: 'QB-CM', offeredToRiderIds: [], declinedByRiderIds: [] };
  memoryStore.orders.set(cancelMid.id, cancelMid);
  const pending = offerTripToNearbyRiders(cancelMid);
  cancelMid.status = 'CANCELLED';
  const afterCancel = await pending;
  it('An order cancelled during the ranking is not offered (review S6)', () => assert.deepEqual(afterCancel, []));
  for (const id of [raceOrder.id, raceA.id, raceB.id, cancelMid.id]) memoryStore.orders.delete(id);
  (memoryStore.orders.get(waveOrder.id) as any).riderOffer = savedWaveOffer;

  expire(waveOrder.id);
  captureSends();
  const second = await offerTripToNearbyRiders(waveOrder);
  it('When the 108 s run out it goes to the NEXT rider', () => {
    assert.equal(second.length, 1);
    assert.notEqual(second[0], near.id, 'the same rider was asked again while others had not been');
    assert.equal((memoryStore.orders.get(waveOrder.id) as any).riderOffer.round, 2);
  });
  it('...and the rider whose time ran out is told it is gone, silently (data only)', () => {
    const gone = sent.filter(s => s.data?.type === 'RIDER_TRIP_WITHDRAWN' && s.userId === near.userId);
    assert.equal(gone.length, 1);
    assert.equal((gone[0] as any).dataOnly, true);
  });

  await (await import('../db/repositories/orderRepository.ts')).orderRepository.declineByRider(waveOrder.id, second[0]);
  const third = await moveOfferOnAfterDecline(waveOrder.id, second[0]);
  it('A decline moves it on at once, not after 108 s', () => {
    assert.equal(third.length, 1);
    assert.ok(![near.id, second[0]].includes(third[0]), JSON.stringify(third));
  });

  /* ---------------------------------------------------------------- *
   *  W1.1: THE OTHER ALARMS ARE CALLED OFF                           *
   * ---------------------------------------------------------------- */
  console.log('\n-- W1.1: the riders who did not get it are told');

  const offeredNow = ((memoryStore.orders.get(waveOrder.id) as any).offeredToRiderIds || []) as string[];
  if (offeredNow.length < 2) {
    throw new Error(`PRECONDITION: only ${offeredNow.length} rider(s) were offered this trip, so "everybody except the winner is told" cannot fail.`);
  }
  const winner = offeredNow[0];
  captureSends();
  const told = await withdrawTripOffers(memoryStore.orders.get(waveOrder.id) as any, winner);
  it('EVERY OTHER RIDER OFFERED THE TRIP IS TOLD IT IS GONE', () => {
    assert.equal(told.length, offeredNow.length - 1, `told ${told.length} of ${offeredNow.length - 1}`);
    assert.ok(!told.includes(winner), 'the rider who took it was told they had lost it');
  });
  it('and the withdrawal is DATA ONLY, so it cannot ring the alarm again', () => {
    const withdrawals = sent.filter(s => s.data?.type === 'RIDER_TRIP_WITHDRAWN');
    assert.ok(withdrawals.length > 0, 'no withdrawal was sent');
    for (const w of withdrawals) assert.equal((w as any).dataOnly, true, 'a withdrawal would have been drawn by Android');
  });

  /* ---------------------------------------------------------------- *
   *  AFTER FIVE RIDERS, OPERATIONS IS TOLD ONCE; OFFERS KEEP CYCLING *
   * ---------------------------------------------------------------- */
  console.log('\n-- Five riders asked: one alert, and the offers keep going');

  clearOffers();
  memoryStore.orders.delete(waveOrder.id);
  const stuck: any = {
    ...onlineOrder,
    id: 'ord_stuck',
    orderNumber: 'QB-STUCK',
    riderId: undefined,
    riderSearchAlertedAt: undefined,
    offeredToRiderIds: [],
    declinedByRiderIds: [],
    acceptedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  };
  memoryStore.orders.set(stuck.id, stuck);
  for (const id of ['trp_near', 'trp_far', 'trp_w1', 'trp_w2', 'trp_w3', 'trp_w4', 'trp_w5']) {
    await riderRepository.update(id, { isOnline: true } as any);
  }

  const rounds: Array<{ asked: number; alertedAfter: boolean }> = [];
  for (let i = 0; i < 7; i++) {
    const s = await sweepStaleOrders(new Date());
    const now: any = memoryStore.orders.get(stuck.id);
    rounds.push({ asked: s.widened.find(w => w.orderId === stuck.id)?.riders || 0, alertedAfter: Boolean(now.riderSearchAlertedAt) });
    expire(stuck.id);
  }
  it('Each sweep (or expiry) asks exactly one new rider', () =>
    assert.deepEqual(rounds.map(r => r.asked), [1, 1, 1, 1, 1, 1, 1], JSON.stringify(rounds)));
  it('Operations is alerted after the fifth rider, not before (waited an hour, yet no early alert)', () =>
    assert.deepEqual(rounds.map(r => r.alertedAfter), [false, false, false, false, true, true, true], JSON.stringify(rounds)));
  it('...and the alert stayed at one while offers kept cycling', () => {
    const order: any = memoryStore.orders.get(stuck.id);
    assert.equal(order.riderOffer.round, 7);
  });

  // Nobody left to ask: every online rider has passed on it.
  clearOffers();
  const nobody: any = { ...stuck, id: 'ord_nobody', orderNumber: 'QB-NOBODY', riderSearchAlertedAt: undefined, offeredToRiderIds: [],
    declinedByRiderIds: Array.from(memoryStore.riders.keys()) };
  memoryStore.orders.set(nobody.id, nobody);
  const lonely = await sweepStaleOrders(new Date());
  it('With nobody left to ask, the time-based alert still fires', () => assert.ok(lonely.alerted.includes(nobody.id)));
  memoryStore.orders.delete(nobody.id);

  it('and the offer carries a tag, so repeated offers REPLACE rather than stack', () => {
    const offers = sentEver.filter(s => s.data?.type === 'RIDER_TRIP_AVAILABLE');
    assert.ok(offers.length > 0, 'no offer was captured, so this proves nothing');
    for (const o of offers) assert.equal((o as any).androidTag, `trip:${o.data.orderId}`, 'an offer carried no tag');
  });

  /* ---------------------------------------------------------------- *
   *  THE APP'S LIST AND THE CLAIM GATE (review D5)                   *
   * ---------------------------------------------------------------- */
  console.log('\n-- The rider app: only the offered rider sees it and can accept, before it runs out');

  clearOffers();
  memoryStore.orders.delete(stuck.id);
  const loginRes = await api('/auth/login', { method: 'POST', body: { email: 'rider@quickbite.app', password: 'pass123' } });
  const riderToken = loginRes.json?.data?.token as string;
  const seededRider: any = Array.from(memoryStore.riders.values() as any).find((r: any) => r.userId === 'usr_rider_01');
  await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, riderToken);
  const appTrip: any = { ...onlineOrder, id: 'ord_app_trip', orderNumber: 'QB-APP', offeredToRiderIds: [], declinedByRiderIds: [] };
  memoryStore.orders.set(appTrip.id, appTrip);

  offerTo(appTrip.id, near.id);
  const notMineList = (await api('/riders/orders/broadcast', {}, riderToken)).json?.data?.broadcasts || [];
  const notMine = await api(`/riders/orders/${appTrip.id}/claim`, { method: 'POST', body: {} }, riderToken);
  it('A trip offered to another rider is not in this rider\'s list', () => assert.ok(!notMineList.some((o: any) => o.id === appTrip.id)));
  it('...and accepting it is refused', () => assert.equal(notMine.json?.error?.code, 'OFFER_NOT_YOURS', `status ${notMine.status}`));

  offerTo(appTrip.id, seededRider.id);
  const mineList = (await api('/riders/orders/broadcast', {}, riderToken)).json?.data?.broadcasts || [];
  it('Offered to this rider: it is in their list with its countdown', () => {
    const row = mineList.find((o: any) => o.id === appTrip.id);
    assert.ok(row, JSON.stringify(mineList).slice(0, 200));
    assert.ok(Date.parse(row.offerExpiresAt) > Date.now());
  });
  expire(appTrip.id);
  const late = await api(`/riders/orders/${appTrip.id}/claim`, { method: 'POST', body: {} }, riderToken);
  it('Accepting after the 108 s is refused', () => assert.equal(late.json?.error?.code, 'OFFER_EXPIRED', `status ${late.status}`));
  offerTo(appTrip.id, seededRider.id);
  const ok = await api(`/riders/orders/${appTrip.id}/claim`, { method: 'POST', body: {} }, riderToken);
  it('Accepting in time works, and the offer is over', () => {
    assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 200));
    assert.equal((memoryStore.orders.get(appTrip.id) as any).riderOffer, undefined);
  });
  void extra;
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
