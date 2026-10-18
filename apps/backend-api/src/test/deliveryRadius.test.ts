/**
 * One delivery radius on the map, rider pay that falls with distance, and cash
 * only on shorter trips (owner, 18 Oct 2026; master plan Stage B1).
 *
 *   - Every kitchen is shown within the admins' radius (35 km by default),
 *     whatever radius the partner chose at sign-up; outside it, it is neither
 *     listed nor orderable. The list and checkout use the same circle.
 *   - A closed kitchen inside the radius stays in the list, marked not serving
 *     (the app words it "Not delivering currently").
 *   - Rider pay per km: full rate up to 4 km, sliding to Rs 8 at 35 km.
 *   - Cash on delivery only up to 15 road km: the quote hides it and says why,
 *     and checkout refuses it.
 *   - The owner's 35 km is applied once to the live rates and never overwrites
 *     a later admin change.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { riderPayFor } from '@quick-bites/pricing-engine';
import {
  getActiveRates,
  createVersion,
  resetConfigsForTesting,
  applyOwnerDecisions20261018
} from '../modules/payments/pricingConfig.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5280;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

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
async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return json?.data?.token as string;
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });

try {
  const customer = await login('customer@quickbite.app');
  resetConfigsForTesting();

  const home = (memoryStore.addresses.get(ADDRESS) as any).coordinates;
  const kitchen: any = memoryStore.restaurants.get(RESTAURANT_ID);
  kitchen.serviceRadiusKm = 6; // what a partner picked at sign-up: no longer decides anything
  kitchen.isOpen = true;
  /** Puts the kitchen this many degrees of latitude north of the customer (~111 km a degree). */
  const placeKitchen = (degrees: number) => {
    kitchen.coordinates = { latitude: home.latitude + degrees, longitude: home.longitude };
  };
  const listed = async () => {
    const r = await api(`/restaurants?lat=${home.latitude}&lng=${home.longitude}`);
    return (r.json?.data?.restaurants || []).find((x: any) => x.id === RESTAURANT_ID);
  };
  const quote = () => api('/orders/quote', {
    method: 'POST', body: { restaurantId: RESTAURANT_ID, deliveryAddressId: ADDRESS, items: [{ dishId: DISH, quantity: 1 }] }
  }, customer);
  const order = (paymentMethod: string) => api('/orders', {
    method: 'POST',
    body: {
      restaurantId: RESTAURANT_ID, deliveryAddressId: ADDRESS, items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
      paymentMethod, idempotencyKey: crypto.randomUUID()
    }
  }, customer);

  console.log('\n-- The radius is the admins\', not the kitchen\'s');
  it('The default radius is 35 km', () => assert.equal(getActiveRates().maxDeliveryKm, 35));
  placeKitchen(0.18); // ~20 km: far beyond the 6 km the partner picked
  const at20 = await listed();
  it('A kitchen 20 km away is listed although the partner chose 6 km', () => assert.ok(at20, 'not listed'));
  placeKitchen(0.30); // ~33 km
  const at33 = await listed();
  it('A kitchen 33 km away is listed', () => assert.ok(at33, 'not listed'));
  placeKitchen(0.33); // ~37 km
  const at37 = await listed();
  it('A kitchen 37 km away is not listed', () => assert.equal(at37, undefined));
  const outside = await quote();
  it('...and cannot be ordered from (same circle at checkout)', () =>
    assert.equal(outside.json?.error?.code, 'OUT_OF_DELIVERY_RANGE', `status ${outside.status}`));

  createVersion({ maxDeliveryKm: 10 }, { userId: 'usr_admin_01' }, 'radius check');
  placeKitchen(0.18);
  const smaller = await listed();
  it('An admin can make the radius smaller (10 km hides the 20 km kitchen)', () => assert.equal(smaller, undefined));
  createVersion({ maxDeliveryKm: 35 }, { userId: 'usr_admin_01' }, 'radius back');

  console.log('\n-- A closed kitchen stays in the list, not serving');
  placeKitchen(0.05);
  kitchen.isOpen = false;
  const closed = await listed();
  it('A closed kitchen inside the radius is still listed', () => assert.ok(closed, 'not listed'));
  it('...marked as not serving', () => assert.equal(closed?.isServing, false));
  const byRating = await api(`/restaurants?lat=${home.latitude}&lng=${home.longitude}&sort=rating`);
  const servingOrder = (byRating.json?.data?.restaurants || []).map((x: any) => x.isServing !== false);
  it('...and listed after every open kitchen, even sorted by rating', () =>
    assert.ok(servingOrder.indexOf(false) > servingOrder.lastIndexOf(true), JSON.stringify(servingOrder)));
  kitchen.isOpen = true;

  console.log('\n-- Rider pay falls with distance; cash only on shorter trips');
  placeKitchen(0.07); // ~7.8 km straight, ~10 km by road
  const near = (await quote()).json?.data;
  it('A ~10 km trip offers cash on delivery', () => assert.equal(near?.acceptsCash, true, JSON.stringify(near?.cashUnavailableReason)));
  it('...with no reason against it', () => assert.equal(near?.cashUnavailableReason, null));
  it('...and the rider pay follows the curve', () =>
    assert.equal(near?.bill?.riderPay, riderPayFor(near?.distanceKm, getActiveRates())));
  it('...which is below the old flat Rs 12/km beyond 4 km', () =>
    assert.ok(near?.bill?.riderPay < Math.round(near?.distanceKm * 12), `${near?.bill?.riderPay} vs ${near?.distanceKm} km`));

  placeKitchen(0.12); // ~13 km straight, ~17 km by road
  const far = (await quote()).json?.data;
  it('A ~17 km trip does not offer cash', () => assert.equal(far?.acceptsCash, false, `distance ${far?.distanceKm}`));
  it('...and tells the customer why, in words', () =>
    assert.match(String(far?.cashUnavailableReason), /only up to 15 km/));
  const cashFar = await order('CASH_ON_DELIVERY');
  it('Checkout refuses cash on that trip', () => assert.equal(cashFar.json?.error?.code, 'COD_TOO_FAR', `status ${cashFar.status}`));
  const onlineFar = await order('RAZORPAY_SANDBOX');
  it('...but takes online payment', () => assert.equal(onlineFar.status, 201, `status ${onlineFar.status} ${JSON.stringify(onlineFar.json).slice(0, 200)}`));

  // Security L7: an address with no pin has no measured distance, so no cash.
  const addr: any = memoryStore.addresses.get(ADDRESS);
  const pinned = addr.coordinates;
  delete addr.coordinates;
  const unpinnedQuote = (await quote()).json?.data;
  it('An address with no pin is not offered cash', () => assert.equal(unpinnedQuote?.acceptsCash, false));
  const unpinnedCash = await order('CASH_ON_DELIVERY');
  it('...and checkout refuses cash for it (COD_NEEDS_PIN)', () =>
    assert.equal(unpinnedCash.json?.error?.code, 'COD_NEEDS_PIN', `status ${unpinnedCash.status}`));
  // Review T1: when the KITCHEN has no real position, the customer cannot fix that,
  // so cash is judged as before rather than "pin your address".
  const kitchenAt = kitchen.coordinates;
  delete kitchen.coordinates;
  const kitchenUnpinned = (await quote()).json?.data;
  it('An unpinned kitchen does not ask the customer to pin their address', () =>
    assert.notEqual(kitchenUnpinned?.cashUnavailableReason, 'Pin your delivery address on the map to pay by cash on delivery, or pay online.'));
  kitchen.coordinates = kitchenAt;
  addr.coordinates = pinned;

  kitchen.acceptsCash = false;
  placeKitchen(0.07);
  const noCash = (await quote()).json?.data;
  it('A kitchen that takes no cash still says so (the reason names the kitchen)', () =>
    assert.match(String(noCash?.cashUnavailableReason), /accepts online payment only/));
  kitchen.acceptsCash = true;

  console.log('\n-- The owner\'s 35 km is applied once');
  resetConfigsForTesting();
  createVersion({ maxDeliveryKm: 0 }, { userId: 'system' }, 'a live server before 18 Oct');
  memoryStore.meta.delete('rates:radius-35-2026-10-18');
  applyOwnerDecisions20261018();
  it('A live server with no limit gets 35 km', () => assert.equal(getActiveRates().maxDeliveryKm, 35));
  createVersion({ maxDeliveryKm: 25 }, { userId: 'usr_admin_01' }, 'admin change');
  const again = applyOwnerDecisions20261018();
  it('...once only: a later admin change survives a restart', () => {
    assert.equal(again, false);
    assert.equal(getActiveRates().maxDeliveryKm, 25);
  });
} finally {
  // Wait for the close: exiting while it is in flight crashes Node on Windows (UV_HANDLE_CLOSING).
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
// A moment for Node to finish closing handles: exiting mid-close crashes it on Windows.
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
