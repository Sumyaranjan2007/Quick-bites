/**
 * Dish options, end to end (F05), and checked on every order (S10).
 *
 * A partner asks for Half / Full with real prices and extras; approval turns
 * them into option groups; the customer sees them marked up like the dish; the
 * order charges and pays out correctly; and nothing a phone sends about options
 * can move money it should not.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5268;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const BIRYANI = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  HALF, FULL AND EXTRAS, PRICED RIGHT EVERY TIME     ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 800)}`);
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
async function login(email: string) {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } });
  return json?.data?.token as string;
}
const code = (r: any) => r.json?.error?.code;

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });

try {
  resetConfigsForTesting();
  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const admin = await login('admin@quickbite.app');

  const order = (items: any[]) =>
    api('/orders', {
      method: 'POST',
      body: { restaurantId: RESTAURANT_ID, deliveryAddressId: ADDRESS, items, paymentMethod: 'CASH_ON_DELIVERY', idempotencyKey: crypto.randomUUID() }
    }, customer);
  const quote = (items: any[]) =>
    api('/orders/quote', { method: 'POST', body: { restaurantId: RESTAURANT_ID, deliveryAddressId: ADDRESS, items } }, customer);
  const placed = (r: any) => r.json?.data?.order ?? r.json?.data;

  // ------------------------------------------------------------ S10
  console.log('-- Every order checks its options against the menu (S10)');
  const unknown = await order([{ dishId: BIRYANI, quantity: 1, selectedOptions: [{ groupId: 'grp_portion', optionId: 'opt_made_up' }] }]);
  it('An option the dish does not have is refused, not silently dropped', () => {
    assert.equal(unknown.status, 400);
    assert.equal(code(unknown), 'UNKNOWN_OPTION');
  });
  const twice = await order([{ dishId: BIRYANI, quantity: 1, selectedOptions: [
    { groupId: 'grp_extras', optionId: 'opt_extra_raita' },
    { groupId: 'grp_extras', optionId: 'opt_extra_raita' }
  ] }]);
  it('The same option twice is refused', () => {
    assert.equal(twice.status, 400);
    assert.equal(code(twice), 'DUPLICATE_OPTION');
  });
  const bothSizes = await order([{ dishId: BIRYANI, quantity: 1, selectedOptions: [
    { groupId: 'grp_portion', optionId: 'opt_regular' },
    { groupId: 'grp_portion', optionId: 'opt_large' }
  ] }]);
  it('Two choices in a choose-one group are refused', () => {
    assert.equal(bothSizes.status, 400);
    assert.equal(code(bothSizes), 'TOO_MANY_OPTIONS');
  });
  const noSize = placed(await order([{ dishId: BIRYANI, quantity: 1, selectedOptions: [] }]));
  it('A required size left empty takes the cheapest, at the menu price, and the kitchen sees which', () => {
    assert.ok(noSize?.id, 'order refused');
    const line = noSize.items[0];
    assert.equal(line.addonsTotal, 0);
    assert.deepEqual(line.selectedOptions.map((o: any) => o.optionId), ['opt_regular']);
    assert.equal(line.selectedOptions[0].defaulted, true);
  });

  // The exploit: a stored negative change, added per repeat to the kitchen's share.
  const menu = memoryStore.menus.get(RESTAURANT_ID) as any;
  const biryani = menu.categories.flatMap((c: any) => c.items).find((i: any) => i.id === BIRYANI);
  biryani.optionGroups.push({
    id: 'grp_legacy', title: 'Legacy', isRequired: false, minSelections: 0, maxSelections: 1,
    options: [{ id: 'opt_minus', name: 'Half plate', priceDelta: -80 }]
  });
  memoryStore.menus.set(RESTAURANT_ID, menu);
  const minus = placed(await order([{ dishId: BIRYANI, quantity: 1, selectedOptions: [
    { groupId: 'grp_portion', optionId: 'opt_regular' },
    { groupId: 'grp_legacy', optionId: 'opt_minus' }
  ] }]));
  it('A stored negative price change counts as zero on both sides of the bill', () => {
    assert.ok(minus?.id, 'order refused');
    assert.equal(minus.items[0].addonsTotal, 0);
    assert.equal(minus.bill.partnerItemsTotal ?? minus.items[0].partnerUnitPrice, 320);
  });
  biryani.optionGroups = biryani.optionGroups.filter((g: any) => g.id !== 'grp_legacy');
  memoryStore.menus.set(RESTAURANT_ID, menu);

  // ------------------------------------------------------------ F05
  console.log('\n-- A partner asks for Half / Full and extras (F05)');
  const oneSize = await api(`/restaurants/${RESTAURANT_ID}/menu/requests`, { method: 'POST', body: {
    name: 'Paneer Tikka', price: 120, isVeg: true, categoryName: 'Starters', sizes: [{ name: 'Half', price: 120 }]
  } }, partner);
  it('One size alone is refused: give two or none', () => {
    assert.equal(oneSize.status, 400);
  });
  const negative = await api(`/restaurants/${RESTAURANT_ID}/menu/requests`, { method: 'POST', body: {
    name: 'Paneer Tikka', price: 120, isVeg: true, categoryName: 'Starters', extras: [{ name: 'Discount', price: -20 }]
  } }, partner);
  it('A negative price is refused at request time', () => {
    assert.equal(negative.status, 400);
  });
  const asked = await api(`/restaurants/${RESTAURANT_ID}/menu/requests`, { method: 'POST', body: {
    name: 'Paneer Tikka', price: 120, isVeg: true, categoryName: 'Starters',
    sizes: [{ name: 'Full', price: 200 }, { name: 'Half', price: 120 }],
    extras: [{ name: 'Mint chutney', price: 30 }]
  } }, partner);
  it('Half 120 / Full 200 with an extra is accepted for review', () => {
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
  });
  const approved = await api(`/admin/menu-requests/${asked.json?.data?.request?.id}/review`, { method: 'POST', body: { action: 'APPROVE' } }, admin);
  const dishId = approved.json?.data?.item?.id ?? approved.json?.data?.dish?.id ?? asked.json?.data?.request?.id;
  const liveDish = () =>
    (memoryStore.menus.get(RESTAURANT_ID) as any).categories.flatMap((c: any) => c.items).find((i: any) => i.name === 'Paneer Tikka');
  it('Approval: the cheapest size is the dish price, the other a positive change', () => {
    assert.equal(approved.status, 200, JSON.stringify(approved.json).slice(0, 300));
    const d = liveDish();
    assert.ok(d, `dish not on the menu (${dishId})`);
    assert.equal(d.price, 120);
    const size = d.optionGroups.find((g: any) => g.kind === 'SIZE');
    assert.deepEqual(size.options.map((o: any) => [o.name, o.priceDelta]), [['Half', 0], ['Full', 80]]);
    assert.equal(size.isRequired, true);
    assert.equal(size.maxSelections, 1);
    const extra = d.optionGroups.find((g: any) => g.kind === 'EXTRAS');
    assert.deepEqual(extra.options.map((o: any) => [o.name, o.priceDelta]), [['Mint chutney', 30]]);
  });

  // The owner's markup applies to sizes and extras as it does to the dish.
  const markup = await api(`/admin/rates/restaurants/${RESTAURANT_ID}`, { method: 'PUT', body: { foodMarkupPercent: 10, note: 'F05 check' } }, admin);
  const publicMenu = await api(`/restaurants/${RESTAURANT_ID}/menu`, {}, customer);
  const shown = (publicMenu.json?.data?.menu ?? publicMenu.json?.data)?.categories
    ?.flatMap((c: any) => c.items)
    .find((i: any) => i.name === 'Paneer Tikka');
  it('With a 10% markup the customer sees Half 132 and Full 220 (and the extra +33)', () => {
    assert.equal(markup.status, 200, JSON.stringify(markup.json).slice(0, 300));
    assert.ok(shown, 'dish missing from the customer menu');
    const size = shown.optionGroups.find((g: any) => g.kind === 'SIZE');
    assert.equal(shown.price, 132);
    assert.equal(shown.price + size.options.find((o: any) => o.name === 'Full').priceDelta, 220);
    assert.equal(shown.optionGroups.find((g: any) => g.kind === 'EXTRAS').options[0].priceDelta, 33);
  });

  const d = liveDish();
  const size = d.optionGroups.find((g: any) => g.kind === 'SIZE');
  const extra = d.optionGroups.find((g: any) => g.kind === 'EXTRAS');
  const fullAndChutney = [{ dishId: d.id, quantity: 2, selectedOptions: [
    { groupId: size.id, optionId: size.options.find((o: any) => o.name === 'Full').id },
    { groupId: extra.id, optionId: extra.options[0].id }
  ] }];
  const q = await quote(fullAndChutney);
  const o = placed(await order(fullAndChutney));
  it('Two Full with chutney: the customer pays 2 x 253, the kitchen is owed 2 x 230', () => {
    assert.ok(o?.id, 'order refused');
    assert.equal(o.items[0].totalPrice, 506);
    assert.equal(o.bill.partnerItemsTotal, 460);
    assert.deepEqual(o.items[0].selectedOptions.map((x: any) => x.optionName), ['Full', 'Mint chutney']);
  });
  it('and the cart quote said the same', () => {
    const bill = q.json?.data?.bill ?? q.json?.data;
    assert.equal(bill?.totalAmount, o.bill.totalAmount);
  });

  // An edit that keeps the sizes keeps their ids, so carts are not broken.
  const fullId = size.options.find((x: any) => x.name === 'Full').id;
  const edit = await api(`/restaurants/${RESTAURANT_ID}/menu/requests`, { method: 'POST', body: {
    kind: 'EDIT_ITEM', dishId: d.id, name: 'Paneer Tikka', price: 130, isVeg: true, categoryName: 'Starters',
    sizes: [{ name: 'Half', price: 130 }, { name: 'Full', price: 220 }], extras: []
  } }, partner);
  await api(`/admin/menu-requests/${edit.json?.data?.request?.id}/review`, { method: 'POST', body: { action: 'APPROVE' } }, admin);
  it('An edit re-prices the sizes, keeps their ids, and [] removes the extras', () => {
    const after = liveDish();
    assert.equal(after.price, 130);
    const s2 = after.optionGroups.find((g: any) => g.kind === 'SIZE');
    assert.equal(s2.options.find((x: any) => x.name === 'Full').id, fullId);
    assert.equal(s2.options.find((x: any) => x.name === 'Full').priceDelta, 90);
    assert.equal(after.optionGroups.find((g: any) => g.kind === 'EXTRAS'), undefined);
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
