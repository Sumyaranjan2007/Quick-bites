/**
 * Pickup pay (owner, 20 Oct 2026): a rider more than 7 road km from the kitchen when
 * taking a trip is paid ALL of that distance x Rs 6, by Quick Bites, never on the bill.
 * The same rider is paid twice (far, then near): the second payout is where defects hide.
 * Also: a trip Operations hands to a rider pays them (it used to freeze no pay at all).
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { pickupPayFor, calculateTripPayout } from '../modules/riders/tripPayout.ts';
import { recordOrderEarnings } from '../modules/payments/earnings.ts';
import { ledger, accountFor } from '../modules/payments/ledger.ts';
import { getActiveRates } from '../modules/payments/pricingConfig.ts';
import { reassignTrip } from '../modules/orders/opsRescue.ts';
import { ownOrder } from './helpers/ownFixture.ts';
import { offerTo } from './helpers/offerTo.ts';

const PORT = 5279;
const API = `http://127.0.0.1:${PORT}/api`;
let failed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message}`);
  }
};
async function api(path: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

check('7 km or less earns no pickup pay', () => {
  assert.equal(pickupPayFor(7), 0);
  assert.equal(pickupPayFor(2.5), 0);
});
check('10 km away earns all 10 km x Rs 6 = Rs 60', () => assert.equal(pickupPayFor(10), 60));
check('7.5 km earns Rs 45 (all of it, not only the part over 7)', () => assert.equal(pickupPayFor(7.5), 45));
check('the two numbers are the editable rates', () =>
  assert.equal(pickupPayFor(10, { ...getActiveRates(), riderPickupPayFromKm: 5, riderPickupPerKmFee: 8 }), 80));

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 300));
resetAuthRateLimit();

try {
  const rider: any = [...memoryStore.riders.values()].find((r: any) => r.userId === 'usr_rider_01');
  const token = (await api('/auth/login', { method: 'POST', body: { email: 'rider@quickbite.app', password: 'pass123' } })).json?.data?.token;
  await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, token);
  const kitchen = { latitude: 12.8, longitude: 77.45 };
  const restaurantId = 'rst_bbh_01';
  const tripOrder = (label: string) =>
    ownOrder(label, {
      restaurantId,
      restaurantCoordinates: kitchen,
      extra: { bill: { totalAmount: 400, riderPay: 48, tipAmount: 10 }, distanceKm: 4, deliveryCoordinates: { latitude: 12.83, longitude: 77.45 } }
    });

  // 1. Far: ~0.09 deg north of the kitchen (~10 km straight; more by road).
  const far = tripOrder('pickup_far');
  rider.currentCoordinates = { latitude: kitchen.latitude + 0.09, longitude: kitchen.longitude };
  offerTo(far.id, 'usr_rider_01');
  const claimFar = await api(`/riders/orders/${far.id}/claim`, { method: 'POST', body: {} }, token);
  const storedFar: any = memoryStore.orders.get(far.id);
  check('the far rider claims the trip', () => assert.equal(claimFar.status, 200, JSON.stringify(claimFar.json).slice(0, 200)));
  check('pickup distance is recorded and over 7 km', () => assert.ok(storedFar.riderPickupKm > 7, String(storedFar.riderPickupKm)));
  check('pickup pay = all pickup km x 6', () => assert.equal(storedFar.riderPickupPay, Math.round(storedFar.riderPickupKm * 6 * 100) / 100));
  check('rider pay = trip pay + pickup pay', () => assert.equal(storedFar.riderPayout, 48 + storedFar.riderPickupPay));
  check('the customer bill is unchanged', () => assert.equal(storedFar.bill.totalAmount, 400));

  // Delivered, so the same rider is free for the next one.
  Object.assign(storedFar, { status: 'DELIVERED', deliveredAt: new Date().toISOString(), riderStage: 'DELIVERED', pickedUpAt: new Date().toISOString() });

  // 2. Near, same rider: at the kitchen.
  const near = tripOrder('pickup_near');
  rider.currentCoordinates = { ...kitchen };
  offerTo(near.id, 'usr_rider_01');
  const claimNear = await api(`/riders/orders/${near.id}/claim`, { method: 'POST', body: {} }, token);
  const storedNear: any = memoryStore.orders.get(near.id);
  check('the same rider claims a second, near trip', () => assert.equal(claimNear.status, 200, JSON.stringify(claimNear.json).slice(0, 200)));
  check('...which carries no pickup pay', () => assert.equal(storedNear.riderPickupPay, 0));
  check('...and pays the trip only', () => assert.equal(storedNear.riderPayout, 48));
  Object.assign(storedNear, { status: 'DELIVERED', deliveredAt: new Date().toISOString(), riderStage: 'DELIVERED', pickedUpAt: new Date().toISOString() });

  // 3. The ledger: the rider is owed both trips + pickup + both tips; Quick Bites pays the pickup.
  const payable = accountFor('RIDER_PAYABLE', rider.id);
  const before = ledger.balanceOf(payable);
  for (const o of [storedFar, storedNear]) recordOrderEarnings(o, { byUserId: 'test', note: 'pickup pay check' });
  const owed = ledger.balanceOf(payable) - before;
  check('the rider is owed both payouts and both tips, once each', () =>
    assert.equal(owed, Math.round((48 + storedFar.riderPickupPay + 10 + 48 + 10) * 100)));

  // 4. Operations hands a trip to a rider: they are paid for it.
  const handed = tripOrder('pickup_handed');
  rider.currentCoordinates = { latitude: kitchen.latitude + 0.09, longitude: kitchen.longitude };
  await reassignTrip(handed.id, { userId: 'usr_admin_01', name: 'Admin' } as any, { riderId: rider.id, reason: 'Assigned by operations for the check' });
  const storedHanded: any = memoryStore.orders.get(handed.id);
  check('a hand-assigned trip freezes the rider pay (was Rs 0)', () =>
    assert.equal(storedHanded.riderPayout, calculateTripPayout(storedHanded) + storedHanded.riderPickupPay));
  check('...with pickup pay when the rider was far', () => assert.ok(storedHanded.riderPickupPay > 42, String(storedHanded.riderPickupPay)));

  // 5. The assigned-trip alarm: the rider app rings until they start it (owner, 20 Oct).
  Object.assign(storedNear, { status: 'DELIVERED' });
  const active = (await api('/riders/orders/active', {}, token)).json?.data?.order;
  check('the rider sees the trip marked "assigned by Operations"', () =>
    assert.equal(active?.assignedByOperations, true, JSON.stringify(active)?.slice(0, 200)));
  const ack = await api(`/riders/orders/${handed.id}/acknowledge`, { method: 'POST' }, token);
  check('...and starting it stops the alarm', () => assert.equal(ack.json?.data?.order?.assignedByOperations, false));
} finally {
  await new Promise(r => server.close(() => r(null)));
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PICKUP PAY CHECKS PASSED');
setTimeout(() => process.exit(failed ? 1 : 0), 100);
