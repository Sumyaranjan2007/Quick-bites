/**
 * Honest delivery time (master plan B3, owner 18 Oct 2026).
 *
 *   - A kitchen's own cooking time, measured: the median of its last 20 orders of a
 *     similar cart size (accepted -> ready); the platform default until it has 20.
 *   - While the food cooks, the wait is the longer of the cooking left and the chosen
 *     rider's ride to the kitchen (they happen at the same time).
 *   - The arrival promised at checkout is frozen on the order; the estimate says
 *     "ahead" when it beats that promise by 3 minutes or more.
 *   - The quote shows the same estimate before the customer orders.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { estimateArrival, kitchenPrepMinutes, promiseAtAcceptance } from '../modules/orders/eta.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';

const PORT = 5282;
const API = `http://127.0.0.1:${PORT}/api`;
const KITCHEN = 'rst_bbh_01';

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}
async function api(pathname: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });

/** A finished order at this kitchen that took `minutes` from accept to ready, `daysAgo` old. */
const cooked = (n: number, minutes: number, items = 1, daysAgo = 0) => {
  const readyAt = Date.now() - daysAgo * 86_400_000 - n * 60_000;
  memoryStore.orders.set(`ord_eta_${items}_${daysAgo}_${n}`, {
    id: `ord_eta_${items}_${daysAgo}_${n}`,
    restaurantId: KITCHEN,
    status: 'DELIVERED',
    items: [{ dishId: 'd', name: 'x', quantity: items, unitPrice: 100, totalPrice: 100 * items }],
    acceptedAt: new Date(readyAt - minutes * 60_000).toISOString(),
    readyAt: new Date(readyAt).toISOString(),
    createdAt: new Date(readyAt - minutes * 60_000).toISOString(),
    updatedAt: new Date(readyAt).toISOString()
  } as any);
};

try {
  const kitchen: any = memoryStore.restaurants.get(KITCHEN);
  kitchen.isOpen = true;

  console.log('\n-- The kitchen\'s own cooking time');
  for (let n = 0; n < 19; n++) cooked(n, 10 + n);
  it('With 19 measured orders it still uses the platform default', () =>
    assert.equal(kitchenPrepMinutes(KITCHEN, 1), config.DEFAULT_PREP_MINUTES));
  cooked(19, 29);
  it('With 20 it uses their median (10..29 min -> 19.5)', () => assert.equal(kitchenPrepMinutes(KITCHEN, 1), 19.5));
  for (let n = 0; n < 5; n++) cooked(n, 90, 1, 10); // older, slow orders
  it('Only the last 20 count (older slow orders do not move it)', () => assert.equal(kitchenPrepMinutes(KITCHEN, 2), 19.5));
  it('A big cart is measured separately (default until it has its own 20)', () =>
    assert.equal(kitchenPrepMinutes(KITCHEN, 8), config.DEFAULT_PREP_MINUTES));

  const kitchenAt = kitchen.coordinates;
  const base: any = {
    id: 'ord_eta_live',
    restaurantId: KITCHEN,
    restaurantCoordinates: kitchenAt,
    deliveryCoordinates: { latitude: kitchenAt.latitude + 0.045, longitude: kitchenAt.longitude }, // ~5 km
    distanceKm: 5,
    items: [{ dishId: 'd', name: 'x', quantity: 1, unitPrice: 100, totalPrice: 100 }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const placed = estimateArrival({ ...base, status: 'ORDER_PLACED' });
  // The ride only: no handling minutes on the promise (owner, 21 Oct, round 5 B).
  const travel = (5 / config.DELIVERY_SPEED_KMPH) * 60;
  it('Before the kitchen accepts, no time at all (owner, 20 Oct)', () => {
    assert.equal(placed.minutesRemaining, null);
    assert.equal(placed.basis, 'AWAITING_ACCEPT');
  });

  console.log('\n-- From acceptance: cook time + ride restaurant -> customer');
  const rider: any = Array.from(memoryStore.riders.values())[0];
  rider.currentCoordinates = { latitude: kitchenAt.latitude + 0.27, longitude: kitchenAt.longitude }; // ~30 km away
  const acceptedAt = Date.now();
  const cooking: any = { ...base, status: 'PREPARING', acceptedAt: new Date(acceptedAt).toISOString(), preparationMinutes: 10, riderId: rider.id };
  cooking.promisedArrivalAt = promiseAtAcceptance(cooking, acceptedAt);
  const atAccept = estimateArrival(cooking, new Date(acceptedAt));
  it('The promise is cook 10 + ride, and a far rider does not add to it', () =>
    assert.equal(atAccept.minutesRemaining, Math.ceil(10 + travel)));
  const sixLater = estimateArrival(cooking, new Date(acceptedAt + 6 * 60_000));
  it('It counts down as the food cooks', () => assert.equal(sixLater.minutesRemaining, Math.ceil(10 + travel) - 6));
  const overdue = estimateArrival(cooking, new Date(acceptedAt + (Math.ceil(10 + travel) + 3) * 60_000));
  it('Past the promise: +3 min late', () => assert.equal(overdue.lateMinutes, 3));
  it('On time: not late', () => assert.equal(sixLater.lateMinutes, 0));
  // The owner's case (21 Oct): kitchen 15 min, Google's bike ride 4 min -> 19 min, not 43.
  const owners: any = { ...base, status: 'ACCEPTED', acceptedAt: new Date(acceptedAt).toISOString(), preparationMinutes: 15, routeMinutes: 4 };
  owners.promisedArrivalAt = promiseAtAcceptance(owners, acceptedAt);
  it('Promise = kitchen time + Google ride time, nothing added (round 5 B)', () =>
    assert.equal(estimateArrival(owners, new Date(acceptedAt)).minutesRemaining, 19));
  const farRide = (30 / config.DELIVERY_SPEED_KMPH) * 60;
  const readyWaiting = estimateArrival({ ...base, status: 'READY_FOR_PICKUP', riderId: rider.id });
  it('Food ready: the wait is the rider reaching the kitchen', () =>
    assert.ok(Math.abs(readyWaiting.minutesRemaining! - Math.ceil(farRide + travel)) <= 1, String(readyWaiting.minutesRemaining)));

  console.log('\n-- The promise, frozen, and "ahead of time"');
  const promise = new Date(Date.now() + 40 * 60_000).toISOString();
  const nearDoor = estimateArrival({
    ...base,
    status: 'OUT_FOR_DELIVERY',
    riderId: rider.id,
    riderCoordinates: { latitude: base.deliveryCoordinates.latitude - 0.009, longitude: base.deliveryCoordinates.longitude },
    promisedArrivalAt: promise
  });
  it('A rider 1 km from the door with 40 min promised: ahead of time', () => {
    assert.equal(nearDoor.promisedAt, promise);
    assert.equal(nearDoor.ahead, true);
  });
  const justInTime = estimateArrival({ ...base, status: 'READY_FOR_PICKUP', riderId: undefined, promisedArrivalAt: new Date(Date.now() + (Math.ceil(config.DELIVERY_HANDLING_MINUTES + travel) + 2) * 60_000).toISOString() });
  const atDoor = estimateArrival({ ...base, status: 'OUT_FOR_DELIVERY', riderId: rider.id, riderCoordinates: { ...base.deliveryCoordinates } });
  it('A rider at the door is 1 min away, not the 6-min handling (R3-13)', () => assert.equal(atDoor.minutesRemaining, 1));
  it('Only 2 min early is not "ahead" (needs 3)', () => assert.equal(justInTime.ahead, false));

  const customer = (await api('/auth/login', { method: 'POST', body: { email: 'customer@quickbite.app', password: 'pass123' } })).json?.data?.token;
  const quote = (await api('/orders/quote', { method: 'POST', body: { restaurantId: KITCHEN, deliveryAddressId: 'addr_sample_01', items: [{ dishId: 'dish_ck_biryani', quantity: 1 }] } }, customer)).json?.data;
  it('The quote shows the estimate before ordering', () => assert.ok(Number(quote?.estimatedDeliveryMinutes) > 0, JSON.stringify(quote?.estimatedDeliveryMinutes)));
  const placedOrder = await api('/orders', {
    method: 'POST',
    body: { restaurantId: KITCHEN, deliveryAddressId: 'addr_sample_01', items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }], paymentMethod: 'RAZORPAY_SANDBOX', idempotencyKey: crypto.randomUUID() }
  }, customer);
  const stored: any = memoryStore.orders.get(placedOrder.json?.data?.order?.id ?? placedOrder.json?.data?.id);
  it('Checkout makes no promise: the kitchen has not accepted', () =>
    assert.equal(stored?.promisedArrivalAt, undefined, `status ${placedOrder.status}`));
  await orderRepository.updateStatus(stored.id, 'ACCEPTED', 25);
  const promised = stored.promisedArrivalAt;
  it('Accepting with 25 min sets the promise: accepted + 25 + ride', () => {
    const minutes = (Date.parse(promised) - Date.parse(stored.acceptedAt)) / 60_000;
    assert.ok(minutes >= 25 && minutes < 25 + 60, String(minutes));
  });
  await orderRepository.updateStatus(stored.id, 'PREPARING', 45);
  it('...and a later status does not move it', () => assert.equal(stored.promisedArrivalAt, promised));
} finally {
  // Wait for the close: exiting while it is in flight crashes Node on Windows (UV_HANDLE_CLOSING).
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
// Exit on the next tick, like riderTripPush: an immediate exit crashes Node on Windows (UV_HANDLE_CLOSING).
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
