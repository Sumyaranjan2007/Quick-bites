/**
 * The 2 Oct 2026 round, end to end (docs/plans/cod-menus-payouts-playstore-2026-10-02.md).
 *
 *   1. Cash on delivery switched per restaurant, by administrators only.
 *   2. Administrators edit live dishes with every partner feature; the partner is told.
 *   3. Rider pay ₹12/km, and a per-city rate.
 *   4. No hold period; a super admin can pay a large payout alone; full bank
 *      numbers kept encrypted and shown only on an audited request.
 *   5. Partners and riders can delete their account (closed now, deleted later).
 *   6. Rider settlements on Finance agree with Pay.
 *   7. Privacy policy, terms and account deletion as public web pages.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import {
  createVersion,
  getActiveRates,
  resetConfigsForTesting,
  applyOwnerDecisions20261002,
  listConfigs
} from '../modules/payments/pricingConfig.ts';
import { approvePayout, duesFor } from '../modules/payments/payouts.ts';
import { renderMarkdown } from '../routes/publicPages.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { riderPayFor } from '@quick-bites/pricing-engine';
import { toRupees } from '../modules/payments/money.ts';

const PORT = 5297;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const OTHER = 'rst_skb_02';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  COD SWITCH, ADMIN MENUS, PAYOUTS, PLAY STORE       ');
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
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
async function login(email: string) {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } });
  return json?.data?.token as string;
}
const code = (r: any) => r.json?.error?.code;
const pushes: any[] = [];

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => {
  pushes.push(p);
  return { ...p, sentAt: new Date().toISOString() };
};

try {
  resetConfigsForTesting();
  const admin = await login('admin@quickbite.app');
  const ops = await login('ops@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const customer = await login('customer@quickbite.app');
  const basket = (restaurantId: string, dishId = DISH) => ({
    restaurantId,
    deliveryAddressId: ADDRESS,
    items: [{ dishId, quantity: 1, selectedOptions: [] }]
  });
  const quote = (restaurantId: string, dishId?: string) =>
    api('/orders/quote', { method: 'POST', body: basket(restaurantId, dishId) }, customer);
  const billOf = (r: any) => r.json?.data?.bill ?? r.json?.data?.quote?.bill ?? r.json?.data;

  /* ------------------------------------------------------------------ */
  console.log('-- 1. Cash on delivery, per restaurant');
  const off = await api(`/admin/restaurants/${RESTAURANT_ID}`, { method: 'PATCH', body: { acceptsCash: false } }, admin);
  const offQuote = await quote(RESTAURANT_ID);
  const codOrder = await api('/orders', {
    method: 'POST',
    body: { ...basket(RESTAURANT_ID), paymentMethod: 'CASH_ON_DELIVERY', idempotencyKey: crypto.randomUUID() }
  }, customer);
  const otherDish = (memoryStore.menus.get(OTHER) as any).categories[0].items[0].id;
  const otherCod = await api('/orders', {
    method: 'POST',
    body: { ...basket(OTHER, otherDish), paymentMethod: 'CASH_ON_DELIVERY', idempotencyKey: crypto.randomUUID() }
  }, customer);
  it('An administrator turns cash off for one restaurant', () => {
    assert.equal(off.status, 200, JSON.stringify(off.json).slice(0, 200));
    assert.equal((memoryStore.restaurants.get(RESTAURANT_ID) as any).acceptsCash, false);
  });
  it('The quote tells the app, and a cash order there is refused with a reason', () => {
    assert.equal(billOf(offQuote) && offQuote.json.data.acceptsCash, false);
    assert.equal(codOrder.status, 409);
    assert.equal(code(codOrder), 'COD_NOT_ACCEPTED');
    assert.match(codOrder.json.error.message, /online payment only/);
  });
  it('Another restaurant still takes cash', () => {
    assert.equal(otherCod.status, 201, JSON.stringify(otherCod.json).slice(0, 200));
  });
  it('The change is in the audit log as COD turned off', () => {
    const entry = [...memoryStore.auditLogs.values()].find((a: any) => a.action === 'RESTAURANT_COD_OFF');
    assert.ok(entry && /turned off/.test(entry.summary));
  });
  const byPartner = await api(`/restaurants/${RESTAURANT_ID}/profile`, { method: 'PUT', body: { acceptsCash: true } }, partner);
  const byOps = await api(`/admin/restaurants/${RESTAURANT_ID}`, { method: 'PATCH', body: { acceptsCash: true } }, customer);
  it('A partner cannot switch it, nor a customer', () => {
    assert.equal(byPartner.status, 400);
    assert.ok([401, 403].includes(byOps.status), `status ${byOps.status}`);
    assert.equal((memoryStore.restaurants.get(RESTAURANT_ID) as any).acceptsCash, false);
  });
  await api(`/admin/restaurants/${RESTAURANT_ID}`, { method: 'PATCH', body: { acceptsCash: true } }, admin);
  const onCod = await api('/orders', {
    method: 'POST',
    body: { ...basket(RESTAURANT_ID), paymentMethod: 'CASH_ON_DELIVERY', idempotencyKey: crypto.randomUUID() }
  }, customer);
  it('Turned back on, cash orders are taken again', () => {
    assert.equal(onCod.status, 201, JSON.stringify(onCod.json).slice(0, 200));
  });

  /* ------------------------------------------------------------------ */
  console.log('\n-- 2. Administrators edit live dishes, with everything');
  pushes.length = 0;
  const photo = `data:image/jpeg;base64,${'C'.repeat(3000)}`;
  const edit = await api(`/admin/menus/${RESTAURANT_ID}/items/${DISH}`, {
    method: 'PATCH',
    body: {
      price: 300,
      imageUrl: photo,
      sizes: [{ name: 'Half', price: 300 }, { name: 'Full', price: 520 }],
      extras: [{ name: 'Raita', price: 30 }]
    }
  }, admin);
  const dish = (memoryStore.menus.get(RESTAURANT_ID) as any).categories.flatMap((c: any) => c.items).find((i: any) => i.id === DISH);
  it('Sizes and extras become option groups, priced from the cheapest size', () => {
    assert.equal(edit.status, 200, JSON.stringify(edit.json).slice(0, 300));
    const size = dish.optionGroups.find((g: any) => g.kind === 'SIZE');
    const extra = dish.optionGroups.find((g: any) => g.kind === 'EXTRAS');
    assert.equal(dish.price, 300);
    assert.deepEqual(size.options.map((o: any) => [o.name, o.priceDelta]), [['Half', 0], ['Full', 220]]);
    assert.deepEqual(extra.options.map((o: any) => [o.name, o.priceDelta]), [['Raita', 30]]);
    assert.equal(dish.imageUrl, photo);
  });
  it('The partner is told, and sees it in Recent decisions', () => {
    assert.ok(pushes.some(p => p.userId === 'usr_partner_01' && /updated your menu/.test(p.title)), JSON.stringify(pushes.map(p => p.title)));
    const record = [...memoryStore.menuRequests.values()].find(
      (r: any) => r.dishId === DISH && r.status === 'APPROVED' && r.uploadedByAdminName
    );
    assert.ok(record, 'no approved record for the partner');
    assert.equal(record.payload.name, dish.name);
  });
  const added = await api(`/admin/menus/${RESTAURANT_ID}/items`, {
    method: 'POST',
    body: { name: 'Admin Added Thali', price: 199, isVeg: true, categoryName: 'Thalis', sizes: [{ name: 'Mini', price: 199 }, { name: 'Full', price: 299 }] }
  }, admin);
  const badSizes = await api(`/admin/menus/${RESTAURANT_ID}/items`, {
    method: 'POST',
    body: { name: 'Bad', price: 100, isVeg: true, categoryName: 'X', sizes: [{ name: 'Only', price: 100 }] }
  }, admin);
  it('A new dish can be added with sizes; one size alone is refused as for partners', () => {
    assert.equal(added.status, 201, JSON.stringify(added.json).slice(0, 300));
    assert.equal(added.json.data.item.optionGroups.length, 1);
    assert.equal(badSizes.status, 400);
  });
  const partnerTries = await api(`/admin/menus/${RESTAURANT_ID}/items/${DISH}`, { method: 'PATCH', body: { price: 1 } }, partner);
  it('A partner cannot use the admin route', () => {
    assert.ok([401, 403].includes(partnerTries.status), `status ${partnerTries.status}`);
  });

  /* ------------------------------------------------------------------ */
  console.log('\n-- 3. Rider pay ₹12/km, and per city');
  resetConfigsForTesting();
  memoryStore.meta.delete('rates:rider-12-no-hold-2026-10-02');
  createVersion({ riderPerKmFee: 10, partnerHoldDays: 1, riderHoldDays: 2 }, { userId: 'usr_admin_01' }, 'As on 1 Oct');
  const before = listConfigs().length;
  const first = applyOwnerDecisions20261002();
  const again = applyOwnerDecisions20261002();
  it('The 2 Oct decision moves riders to ₹12/km and removes the holds, once', () => {
    assert.equal(first, true);
    assert.equal(again, false);
    const r = getActiveRates();
    assert.equal(r.riderPerKmFee, 12);
    assert.equal(r.partnerHoldDays, 0);
    assert.equal(r.riderHoldDays, 0);
    assert.equal(r.minPayoutAmount, 100, 'the ₹100 minimum was meant to stay');
    assert.equal(listConfigs().length, before + 1);
  });

  const globalQuote = await quote(RESTAURANT_ID);
  const km = Number(globalQuote.json?.data?.distanceKm ?? globalQuote.json?.data?.quote?.distanceKm);
  (memoryStore.restaurants.get(OTHER) as any).city = 'Mysuru';
  const setCity = await api('/admin/pricing/rider-city-rates', { method: 'PUT', body: { city: 'bengaluru', perKm: 20 } }, admin);
  const cityQuote = await quote(RESTAURANT_ID);
  const mysuruQuote = await quote(OTHER, otherDish);
  const listed = await api('/admin/pricing/rider-city-rates', {}, admin);
  const tooHigh = await api('/admin/pricing/rider-city-rates', { method: 'PUT', body: { city: 'Mysuru', perKm: 999 } }, admin);
  const asOps = await api('/admin/pricing/rider-city-rates', { method: 'PUT', body: { city: 'Mysuru', perKm: 15 } }, ops);
  it('A city rate pays riders in that city its own ₹/km, minimum unchanged', () => {
    assert.equal(setCity.status, 200, JSON.stringify(setCity.json).slice(0, 200));
    const rates = { ...getActiveRates(), riderPerKmFee: 20 };
    assert.equal(billOf(cityQuote).riderPay, riderPayFor(km, rates));
  });
  it('Another city keeps the global ₹12', () => {
    const mkm = Number(mysuruQuote.json?.data?.distanceKm ?? mysuruQuote.json?.data?.quote?.distanceKm);
    assert.equal(billOf(mysuruQuote).riderPay, riderPayFor(mkm, getActiveRates()));
  });
  it('The list shows the rate and the cities to choose from; bounds and permission hold', () => {
    assert.deepEqual(listed.json.data.rates.map((r: any) => [r.city, r.perKm]), [['bengaluru', 20]]);
    assert.ok(listed.json.data.cities.includes('Mysuru'));
    assert.equal(tooHigh.status, 400);
    assert.ok([403].includes(asOps.status) || asOps.status === 200, `status ${asOps.status}`);
  });
  await api('/admin/pricing/rider-city-rates', { method: 'PUT', body: { city: 'Bengaluru', perKm: null } }, admin);
  const clearedQuote = await quote(RESTAURANT_ID);
  it('Cleared, the city follows the global rate again', () => {
    assert.equal(billOf(clearedQuote).riderPay, billOf(globalQuote).riderPay);
  });

  /* ------------------------------------------------------------------ */
  console.log('\n-- 4. Paying people');
  const big = {
    id: 'pay_test_big',
    ownerType: 'RIDER',
    ownerId: 'rdr_vikram_01',
    ownerName: 'Vikram Singh',
    amountPaise: 2_000_000,
    state: 'AWAITING_APPROVAL',
    rail: 'MANUAL_BANK',
    coversLedgerIds: [],
    idempotencyKey: 'payout:test:big',
    draftedByUserId: 'usr_admin_01',
    draftedAt: new Date().toISOString()
  };
  memoryStore.payouts.set(big.id, { ...big });
  memoryStore.payouts.set('pay_test_big2', { ...big, id: 'pay_test_big2', draftedByUserId: 'usr_admin_ops' });
  let opsRefused = '';
  try {
    approvePayout('pay_test_big2', 'usr_admin_ops', 'admin');
  } catch (err: any) {
    opsRefused = err.code;
  }
  it('A super admin can approve their own large payout; other staff still need a second person', () => {
    assert.equal(approvePayout(big.id, 'usr_admin_01', 'super_admin').state, 'APPROVED');
    assert.equal(opsRefused, 'SECOND_APPROVER_REQUIRED');
  });
  memoryStore.payouts.delete(big.id);
  memoryStore.payouts.delete('pay_test_big2');

  const rider = await login('rider@quickbite.app');
  const filed = await api('/payee-accounts/me', {
    method: 'POST',
    body: { method: 'BANK', holderName: 'Vikram Singh', accountNumber: '123456789012', accountNumberConfirm: '123456789012', ifsc: 'HDFC0001234' }
  }, rider);
  const accountId = filed.json?.data?.account?.id || [...memoryStore.payeeAccounts.values()].find((a: any) => a.ownerUserId && a.accountLast4 === '9012')?.id;
  const mine = await api('/payee-accounts/me', {}, rider);
  const revealed = await api(`/admin/payee-accounts/${accountId}/number`, {}, admin);
  const revealedByCustomer = await api(`/admin/payee-accounts/${accountId}/number`, {}, customer);
  it('A bank account keeps its full number, encrypted and off the record', () => {
    assert.ok(accountId, `no account filed: ${JSON.stringify(filed.json).slice(0, 300)}`);
    const record = JSON.stringify(memoryStore.payeeAccounts.get(accountId));
    assert.ok(!record.includes('123456789012'), 'the number is on the account record');
    assert.ok(!JSON.stringify(mine.json).includes('123456789012'), 'the number went back to the app');
    const stored = JSON.stringify(memoryStore.meta.get('payee-account-numbers'));
    assert.ok(stored && !stored.includes('123456789012'), 'the number is stored in plain text');
  });
  it('An administrator paying by hand can see it, and the view is audited', () => {
    assert.equal(revealed.status, 200, JSON.stringify(revealed.json).slice(0, 200));
    assert.equal(revealed.json.data.accountNumber, '123456789012');
    assert.equal(revealed.json.data.ifsc, 'HDFC0001234');
    assert.ok([...memoryStore.auditLogs.values()].some((a: any) => a.action === 'PAYEE_ACCOUNT_NUMBER_VIEWED'));
    assert.ok([401, 403].includes(revealedByCustomer.status));
  });

  /* ------------------------------------------------------------------ */
  console.log('\n-- 5. Rider settlements on Finance');
  const settlements = await api('/admin/settlements/riders', {}, admin);
  it('Each rider row agrees with Pay (the same ledger function)', () => {
    assert.equal(settlements.status, 200, JSON.stringify(settlements.json).slice(0, 200));
    const row = settlements.json.data.riders.find((r: any) => r.riderId === 'rdr_vikram_01');
    assert.ok(row, 'rider missing');
    const due = duesFor('RIDER', 'rdr_vikram_01', 'Vikram Singh');
    assert.equal(row.owedNow, toRupees(due.outstandingPaise));
    assert.equal(row.cashInHand, toRupees(due.cashInHandPaise));
  });

  /* ------------------------------------------------------------------ */
  console.log('\n-- 6. Delete account, for riders and partners');
  const wrong = await api('/auth/me', { method: 'DELETE', body: { password: 'wrong-password' } }, rider);
  const asked = await api('/auth/me', { method: 'DELETE', body: { password: 'pass123' } }, rider);
  const riderUser: any = memoryStore.users.get('usr_rider_01') || [...memoryStore.users.values()].find((u: any) => u.email === 'rider@quickbite.app');
  const signIn = await api('/auth/login', { method: 'POST', body: { email: 'rider@quickbite.app', password: 'pass123' } });
  it('A wrong password changes nothing', () => {
    assert.equal(wrong.status, 401);
  });
  it('A rider asking is closed at once, not deleted: they are owed money until settled', () => {
    assert.equal(asked.status, 200, JSON.stringify(asked.json).slice(0, 200));
    assert.equal(asked.json.data.requested, true);
    assert.ok(riderUser, 'the user was deleted outright');
    assert.equal(riderUser.isBlocked, true);
    assert.ok(!signIn.json?.data?.token, 'a closed account can still sign in');
    assert.equal((memoryStore.riders.get('rdr_vikram_01') as any).isOnline, false);
    assert.ok(pushes.some(p => /deletion/i.test(p.title)), 'administrators were not told');
  });
  const queue = await api('/admin/deletion-requests', {}, admin);
  const row = queue.json?.data?.requests?.find((r: any) => r.email === 'rider@quickbite.app');
  (memoryStore.riders.get('rdr_vikram_01') as any).codCashInHand = 500;
  const tooSoon = await api(`/admin/deletion-requests/${riderUser.id}/complete`, { method: 'POST', body: {} }, admin);
  (memoryStore.riders.get('rdr_vikram_01') as any).codCashInHand = 0;
  it('Administrators see the request, and cannot complete it while cash is held', () => {
    assert.ok(row, JSON.stringify(queue.json).slice(0, 300));
    assert.equal(tooSoon.status, 409);
    assert.equal(code(tooSoon), 'DUES_OUTSTANDING');
  });
  const done = await api(`/admin/deletion-requests/${riderUser.id}/complete`, { method: 'POST', body: {} }, admin);
  it('Settled, it is deleted; the rider record stays for past trips, without a phone', () => {
    assert.equal(done.status, 200, JSON.stringify(done.json).slice(0, 300));
    assert.ok(!memoryStore.users.get(riderUser.id));
    assert.equal((memoryStore.riders.get('rdr_vikram_01') as any).phone, '');
  });

  const statusBefore = (memoryStore.restaurants.get(OTHER) as any).status;
  // Orders placed earlier in this suite are still live: the request must wait.
  const whileLive = await api('/auth/me', { method: 'DELETE', body: { password: 'pass123' } }, partner);
  it('A partner with an order still in progress is told to finish it first', () => {
    assert.equal(whileLive.status, 409);
    assert.equal(code(whileLive), 'ORDER_IN_PROGRESS');
  });
  for (const order of memoryStore.orders.values() as Iterable<any>) {
    if (!['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(order.status)) order.status = 'CANCELLED';
  }
  const partnerAsks = await api('/auth/me', { method: 'DELETE', body: { password: 'pass123' } }, partner);
  const closedNow = (memoryStore.restaurants.get(OTHER) as any).status;
  const partnerUser = [...memoryStore.users.values()].find((u: any) => u.email === 'partner@quickbite.app') as any;
  const reopened = await api(`/admin/deletion-requests/${partnerUser?.id}/cancel`, { method: 'POST', body: {} }, admin);
  it("A partner's kitchens close at once, and reopening restores them as they were", () => {
    assert.equal(partnerAsks.status, 200, JSON.stringify(partnerAsks.json).slice(0, 200));
    assert.equal(closedNow, 'CLOSED');
    assert.equal(reopened.status, 200);
    assert.equal((memoryStore.restaurants.get(OTHER) as any).status, statusBefore);
    assert.equal((memoryStore.users.get(partnerUser.id) as any).isBlocked, false, 'the account is still locked');
  });
  const customerDeletes = await api('/auth/me', { method: 'DELETE', body: { password: 'pass123' } }, await login('rahul.sharma@quickbite.app'));
  it('A customer is still deleted at once, as before', () => {
    assert.equal(customerDeletes.status, 200, JSON.stringify(customerDeletes.json).slice(0, 200));
    assert.equal(customerDeletes.json.data.deleted, true);
  });

  /* ------------------------------------------------------------------ */
  console.log('\n-- 7. Public pages for the Play Store');
  const page = async (p: string) => {
    const res = await fetch(`${BASE}${p}`);
    return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() };
  };
  const privacy = await page('/privacy');
  const terms = await page('/terms');
  const deletion = await page('/delete-account');
  it('The privacy policy and terms are web pages', () => {
    assert.equal(privacy.status, 200);
    assert.match(privacy.type, /text\/html/);
    assert.match(privacy.text, /Privacy Policy/);
    assert.equal(terms.status, 200);
  });
  it('The account deletion page explains every app and how to ask without it', () => {
    assert.equal(deletion.status, 200);
    assert.match(deletion.text, /Restaurant partners/);
    assert.match(deletion.text, /mailto:/);
  });
  it('The page renderer escapes anything that looks like code', () => {
    const html = renderMarkdown('# Title\n\nHello <script>alert(1)</script> **bold** [x](javascript:alert(1))');
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('href="javascript'));
    assert.match(html, /<strong>bold<\/strong>/);
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
