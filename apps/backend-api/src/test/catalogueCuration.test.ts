/**
 * Master plan B5 (owner, 18 Oct 2026): what customers are shown about a kitchen and in
 * what order.
 *
 *   - Kitchen type VEG / NON_VEG / BOTH is the partner's own word (a reviewed profile
 *     edit). The Pure Veg SEAL (`isPureVeg`) is given only by staff holding
 *     `catalog.restaurants.pureVegSeal`; it outranks the partner's word and drives
 *     the Pure Veg filter. A partner's sign-up tick no longer grants it.
 *   - A whole menu section can be switched off (optionally until a time): every dish
 *     in it is unavailable on the menu, in the quote, at checkout and in search;
 *     switching it on restores each dish as it was.
 *   - Admins (`catalog.restaurants.recommend`) choose recommended kitchens: first on
 *     the home, and the whole list when the customer has not set a location.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { reopenSectionsDue } from '../modules/restaurants/menuSections.ts';
import { searchDishesInMenus } from '../modules/search/menuFallbackSearch.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5281;
const API = `http://127.0.0.1:${PORT}/api`;
const KITCHEN = 'rst_bbh_01';
const SECTION = 'cat_biryani';
const CHICKEN = 'dish_ck_biryani';
const MUTTON = 'dish_mutton_biryani';
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
  const superAdmin = await login('admin@quickbite.app');
  const ops = await login('ops@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const otherPartner = await login('sunita.partner@quickbite.app');
  const customer = await login('customer@quickbite.app');
  const kitchen: any = memoryStore.restaurants.get(KITCHEN);
  kitchen.isOpen = true;
  const home = (memoryStore.addresses.get(ADDRESS) as any).coordinates;

  console.log('\n-- Kitchen type is the partner\'s word; the Pure Veg seal is staff-only');
  const typeEdit = await api(`/restaurants/${KITCHEN}/profile`, { method: 'PUT', body: { cuisineType: 'BOTH' } }, partner);
  it('A partner asks for kitchen type "both" through a profile edit', () => assert.equal(typeEdit.status, 201, JSON.stringify(typeEdit.json).slice(0, 200)));
  const badType = await api(`/restaurants/${KITCHEN}/profile`, { method: 'PUT', body: { cuisineType: 'MEAT' } }, partner);
  it('...and an unknown type is refused', () => assert.equal(badType.status, 400));
  const editId = typeEdit.json?.data?.edit?.id;
  const reviewed = await api(`/admin/profile-edits/${editId}/review`, { method: 'POST', body: { approve: ['cuisineType'], reject: [] } }, superAdmin);
  it('An admin approves it and the kitchen is "both"', () => {
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json).slice(0, 200));
    assert.equal(kitchen.cuisineType, 'BOTH');
  });

  const opsSeal = await api(`/admin/restaurants/${KITCHEN}`, { method: 'PATCH', body: { isPureVeg: true } }, ops);
  it('Staff without the seal permission cannot give the seal', () => {
    assert.equal(opsSeal.status, 403);
    assert.equal(kitchen.isPureVeg, false);
  });
  const opsOther = await api(`/admin/restaurants/${KITCHEN}`, { method: 'PATCH', body: { isPureVeg: false, city: 'Harohalli' } }, ops);
  it('...but can still save other fields with the seal unchanged (what the admin app sends)', () => assert.equal(opsOther.status, 200));
  const meat = await api(`/admin/restaurants/${KITCHEN}`, { method: 'PATCH', body: { isPureVeg: true } }, superAdmin);
  it('T-3: a menu with non-veg dishes is named before the seal goes on', () => {
    assert.equal(meat.json?.error?.code, 'NON_VEG_DISHES');
    assert.equal(kitchen.isPureVeg, false);
  });
  const sealed = await api(`/admin/restaurants/${KITCHEN}`, { method: 'PATCH', body: { isPureVeg: true, confirmNonVeg: true } }, superAdmin);
  it('A super admin gives the seal (confirming the non-veg dishes)', () => assert.equal(sealed.status, 200));
  const shown = (await api(`/restaurants/${KITCHEN}`)).json?.data?.restaurant;
  it('Customers see the seal, and it outranks the partner\'s "both"', () => {
    assert.equal(shown?.isPureVeg, true);
    assert.equal(shown?.cuisineType, 'VEG');
  });
  const vegOnly = (await api('/restaurants?isPureVeg=true')).json?.data?.restaurants || [];
  const other: any = memoryStore.restaurants.get('rst_skb_02');
  other.cuisineType = 'VEG';
  other.isPureVeg = false;
  const vegOnly2 = (await api('/restaurants?isPureVeg=true')).json?.data?.restaurants || [];
  it('The Pure Veg filter lists the sealed kitchen', () => assert.ok(vegOnly.some((r: any) => r.id === KITCHEN)));
  it('...and not a kitchen that only says "veg" without the seal', () => assert.ok(!vegOnly2.some((r: any) => r.id === 'rst_skb_02')));

  resetAuthRateLimit();
  const signUp = await api('/auth/register/partner', {
    method: 'POST',
    body: {
      fullName: 'Veg Owner', email: `veg_${Date.now()}@kitchen.test`, phone: '9876500188', password: 'kitchen-pass-1',
      restaurantName: 'Veg Corner', addressLine: '1 Main Road', city: 'Harohalli', pincode: '562112', isPureVeg: true
    }
  });
  const signed: any = memoryStore.restaurants.get(signUp.json?.data?.restaurant?.id);
  it('A partner\'s "pure veg" tick at sign-up sets their type, not the seal', () => {
    assert.equal(signUp.status, 201, JSON.stringify(signUp.json).slice(0, 200));
    assert.equal(signed?.isPureVeg, false);
    assert.equal(signed?.cuisineType, 'VEG');
  });

  console.log('\n-- A whole menu section off, then on');
  const switchPath = `/restaurants/${KITCHEN}/menu/sections/${SECTION}/availability`;
  await api(`/restaurants/${KITCHEN}/menu/toggle-stock`, { method: 'POST', body: { dishId: MUTTON, isAvailable: false } }, partner);
  const off = await api(switchPath, { method: 'POST', body: { isAvailable: false } }, partner);
  it('The partner switches the biryani section off', () => assert.equal(off.json?.data?.section?.isAvailable, false, `status ${off.status}`));
  const dishOf = async (id: string) => {
    const menu = (await api(`/restaurants/${KITCHEN}/menu`)).json?.data?.menu;
    for (const c of menu?.categories || []) for (const d of c.items) if (d.id === id) return d;
  };
  const chickenOff = await dishOf(CHICKEN);
  it('...the chicken biryani shows unavailable on the menu', () => assert.equal(chickenOff?.isAvailable, false));
  const quote = (await api('/orders/quote', { method: 'POST', body: { restaurantId: KITCHEN, deliveryAddressId: ADDRESS, items: [{ dishId: CHICKEN, quantity: 1 }] } }, customer)).json?.data;
  it('...the quote reports it unavailable', () => assert.ok((quote?.unavailableItems || []).length === 1, JSON.stringify(quote?.unavailableItems)));
  const order = await api('/orders', {
    method: 'POST',
    body: { restaurantId: KITCHEN, deliveryAddressId: ADDRESS, items: [{ dishId: CHICKEN, quantity: 1, selectedOptions: [] }], paymentMethod: 'RAZORPAY_SANDBOX', idempotencyKey: crypto.randomUUID() }
  }, customer);
  it('...checkout refuses it', () => assert.equal(order.json?.error?.code, 'DISH_OUT_OF_STOCK', `status ${order.status}`));
  it('...and search does not offer it', () => assert.ok(!searchDishesInMenus('chicken').some(h => h.id === CHICKEN)));
  const stored = memoryStore.menus.get(KITCHEN) as any;
  it('The dishes keep their own switches while the section is off', () =>
    assert.equal(stored.categories.find((c: any) => c.id === SECTION).items.find((d: any) => d.id === CHICKEN).isAvailable, true));

  const on = await api(switchPath, { method: 'POST', body: { isAvailable: true } }, partner);
  const chickenOn = await dishOf(CHICKEN);
  const muttonOn = await dishOf(MUTTON);
  it('Switched back on, each dish is as it was: chicken on', () => {
    assert.equal(on.json?.data?.section?.isAvailable, true);
    assert.equal(chickenOn?.isAvailable, true);
  });
  it('...and the mutton the partner had switched off alone stays off', () => assert.equal(muttonOn?.isAvailable, false));

  const intruder = await api(switchPath, { method: 'POST', body: { isAvailable: false } }, otherPartner);
  it('Another partner cannot switch this kitchen\'s section', () => assert.equal(intruder.status, 403));
  const opsSwitch = await api(`/admin/menus/${KITCHEN}/sections/${SECTION}/availability`, { method: 'POST', body: { isAvailable: false } }, ops);
  it('Staff without menu-edit permission cannot either', () => assert.equal(opsSwitch.status, 403));
  const adminSwitch = await api(`/admin/menus/${KITCHEN}/sections/${SECTION}/availability`, { method: 'POST', body: { isAvailable: false } }, superAdmin);
  it('A super admin can', () => assert.equal(adminSwitch.json?.data?.section?.isAvailable, false, `status ${adminSwitch.status}`));
  const missing = await api(`/restaurants/${KITCHEN}/menu/sections/cat_nope/availability`, { method: 'POST', body: { isAvailable: false } }, partner);
  it('An unknown section is a 404', () => assert.equal(missing.status, 404));

  console.log('\n-- "Back at" a time');
  const past = await api(switchPath, { method: 'POST', body: { isAvailable: false, backAt: new Date(Date.now() - 60_000).toISOString() } }, partner);
  it('A "back at" time in the past is refused', () => assert.equal(past.json?.error?.code, 'INVALID_BACK_AT', `status ${past.status}`));
  const later = await api(switchPath, { method: 'POST', body: { isAvailable: false, backAt: new Date(Date.now() + 3_600_000).toISOString() } }, partner);
  it('Off until an hour from now', () => assert.ok(later.json?.data?.section?.backAt));
  const cat = stored.categories.find((c: any) => c.id === SECTION);
  cat.backAt = new Date(Date.now() - 1000).toISOString(); // the hour has passed, no sweep yet
  const afterTime = await dishOf(CHICKEN);
  it('Once the time passes, customers see it on before any sweep runs', () => assert.equal(afterTime?.isAvailable, true));
  const reopened = reopenSectionsDue();
  it('...and the sweeper clears it, so the partner\'s screen shows it on too', () => {
    assert.deepEqual(reopened, [KITCHEN]);
    assert.equal(cat.isAvailable, undefined);
  });

  console.log('\n-- Recommended restaurants');
  const opsList = await api('/admin/recommended-restaurants', { method: 'PUT', body: { restaurantIds: ['rst_pgt_03'] } }, ops);
  it('Staff without the permission cannot set the list', () => assert.equal(opsList.status, 403));
  const bad = await api('/admin/recommended-restaurants', { method: 'PUT', body: { restaurantIds: ['rst_nope'] } }, superAdmin);
  it('An id that is not a restaurant is refused', () => assert.equal(bad.status, 400));
  for (const id of ['rst_pgt_03', KITCHEN, 'rst_skb_02', 'rst_map_04']) {
    const r: any = memoryStore.restaurants.get(id);
    r.isOpen = true;
    r.status = 'ACTIVE';
  }
  const set = await api('/admin/recommended-restaurants', { method: 'PUT', body: { restaurantIds: ['rst_pgt_03', KITCHEN, 'rst_pgt_03'] } }, superAdmin);
  it('A super admin sets two, in order (repeats dropped)', () => assert.deepEqual(set.json?.data?.restaurantIds, ['rst_pgt_03', KITCHEN]));
  const listed = (await api('/admin/recommended-restaurants', {}, superAdmin)).json?.data?.restaurants || [];
  it('...and reads them back with their state', () => assert.deepEqual(listed.map((r: any) => r.id), ['rst_pgt_03', KITCHEN]));

  const noLocation = (await api('/restaurants')).json?.data;
  it('No location: the list is only the recommended ones, in order', () =>
    assert.deepEqual(noLocation?.restaurants.map((r: any) => r.id), ['rst_pgt_03', KITCHEN]));
  it('...flagged so the app asks for a location', () => {
    assert.equal(noLocation?.needsLocation, true);
    assert.equal(noLocation?.listKind, 'recommended');
  });
  const searching = (await api('/restaurants?q=a')).json?.data;
  it('Searching by name without a location is not limited to them', () => assert.ok(searching?.restaurants.length > 2, String(searching?.restaurants.length)));

  const nearby = (await api(`/restaurants?lat=${home.latitude}&lng=${home.longitude}`)).json?.data;
  const ids = (nearby?.restaurants || []).map((r: any) => r.id);
  it('With a location: everything nearby, recommended first in their order', () => {
    assert.equal(nearby?.listKind, 'nearby');
    assert.deepEqual(ids.slice(0, 2), ['rst_pgt_03', KITCHEN]);
    assert.ok(ids.length > 2, String(ids.length));
  });
  it('...each card says whether it is recommended', () =>
    assert.deepEqual(nearby.restaurants.map((r: any) => r.isRecommended), ids.map((id: string) => id === 'rst_pgt_03' || id === KITCHEN)));

  (memoryStore.restaurants.get('rst_pgt_03') as any).status = 'SUSPENDED';
  const suspended = (await api('/restaurants')).json?.data?.restaurants.map((r: any) => r.id);
  it('A recommended kitchen that is suspended is not shown', () => assert.deepEqual(suspended, [KITCHEN]));

  await api('/admin/recommended-restaurants', { method: 'PUT', body: { restaurantIds: [] } }, superAdmin);
  const empty = (await api('/restaurants')).json?.data;
  it('With no recommended kitchens, a customer without a location sees every kitchen as before', () => {
    assert.equal(empty?.listKind, 'all');
    assert.ok(empty?.restaurants.length > 1);
  });
} finally {
  // Wait for the close: exiting while it is in flight crashes Node on Windows (UV_HANDLE_CLOSING).
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
