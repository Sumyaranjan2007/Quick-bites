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
import { estimateArrival, kitchenPrepMinutes } from '../modules/orders/eta.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { orderService } from '../modules/orders/orderService.ts';

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
  const travel = (5 / config.DELIVERY_SPEED_KMPH) * 60 + config.DELIVERY_HANDLING_MINUTES;
  it('Before the kitchen accepts, the estimate uses that kitchen\'s 19.5 min', () =>
    assert.equal(placed.minutesRemaining, Math.ceil(19.5 + travel)));

  console.log('\n-- The rider\'s ride to the kitchen');
  const rider: any = Array.from(memoryStore.riders.values())[0];
  rider.currentCoordinates = { latitude: kitchenAt.latitude + 0.27, longitude: kitchenAt.longitude }; // ~30 km away
  const cooking = { ...base, status: 'PREPARING', acceptedAt: new Date().toISOString(), preparationMinutes: 10, riderId: rider.id };
  const farRide = (30 / config.DELIVERY_SPEED_KMPH) * 60;
  const withFarRider = estimateArrival(cooking);
  it('While cooking, a rider further away than the cooking time sets the wait', () =>
    assert.ok(Math.abs(withFarRider.minutesRemaining! - Math.ceil(farRide + travel)) <= 1, `${withFarRider.minutesRemaining} vs ${Math.ceil(farRide + travel)}`));
  rider.currentCoordinates = { ...kitchenAt };
  const withNearRider = estimateArrival(cooking);
  it('...and a rider at the kitchen leaves the cooking time in charge', () =>
    assert.equal(withNearRider.minutesRemaining, Math.ceil(10 + travel)));
  rider.currentCoordinates = { latitude: kitchenAt.latitude + 0.27, longitude: kitchenAt.longitude };
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
  const justInTime = estimateArrival({ ...base, status: 'ORDER_PLACED', promisedArrivalAt: new Date(Date.now() + (Math.ceil(19.5 + travel) + 2) * 60_000).toISOString() });
  it('Only 2 min early is not "ahead" (needs 3)', () => assert.equal(justInTime.ahead, false));

  const customer = (await api('/auth/login', { method: 'POST', body: { email: 'customer@quickbite.app', password: 'pass123' } })).json?.data?.token;
  const quote = (await api('/orders/quote', { method: 'POST', body: { restaurantId: KITCHEN, deliveryAddressId: 'addr_sample_01', items: [{ dishId: 'dish_ck_biryani', quantity: 1 }] } }, customer)).json?.data;
  it('The quote shows the estimate before ordering', () => assert.ok(Number(quote?.estimatedDeliveryMinutes) > 0, JSON.stringify(quote?.estimatedDeliveryMinutes)));
  const placedOrder = await api('/orders', {
    method: 'POST',
    body: { restaurantId: KITCHEN, deliveryAddressId: 'addr_sample_01', items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }], paymentMethod: 'RAZORPAY_SANDBOX', idempotencyKey: crypto.randomUUID() }
  }, customer);
  const stored: any = memoryStore.orders.get(placedOrder.json?.data?.order?.id ?? placedOrder.json?.data?.id);
  it('Checkout freezes the promised arrival on the order', () => {
    assert.ok(stored?.promisedArrivalAt, `status ${placedOrder.status}`);
    assert.ok(Date.parse(stored.promisedArrivalAt) > Date.now());
  });
  const later = estimateArrival({ ...stored, status: 'ACCEPTED', acceptedAt: new Date().toISOString(), preparationMinutes: 45 });
  it('...and a later estimate does not move the promise', () => assert.equal(later.promisedAt, stored.promisedArrivalAt));

  // Review S5: an online order paid minutes after checkout gets its promise from the payment.
  const paidLate = [...memoryStore.orders.values()].find((o: any) => o.restaurantId === KITCHEN) as any;
  const late = {
    ...structuredClone(paidLate), id: 'ord_s5_check', status: 'PAYMENT_PENDING', paymentStatus: 'PENDING', paymentMethod: 'ONLINE',
    riderId: undefined, razorpayPaymentId: undefined, acceptedAt: undefined, createdAt: new Date().toISOString(),
    restaurantCoordinates: { latitude: 12.68, longitude: 77.47 }, deliveryCoordinates: { latitude: 12.7, longitude: 77.48 }, promisedArrivalAt: new Date(Date.now() - 3_600_000).toISOString()
  };
  memoryStore.orders.set(late.id, late);
  await orderService.markPaidByGateway(late.id, { razorpayPaymentId: 'pay_s5_check' });
  it('S5: the promise is set when the payment lands, not at checkout', () =>
    assert.ok(Date.parse((memoryStore.orders.get(late.id) as any).promisedArrivalAt) > Date.now(), (memoryStore.orders.get(late.id) as any).promisedArrivalAt));
} finally {
  // Wait for the close: exiting while it is in flight crashes Node on Windows (UV_HANDLE_CLOSING).
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
// Exit on the next tick, like riderTripPush: an immediate exit crashes Node on Windows (UV_HANDLE_CLOSING).
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
