/**
 * Rs 10 a road km, and one figure from quote to payout (owner, 1 Oct 2026).
 *
 * The owner's rules:
 *   - a rider earns Rs 10 for every km of road from the restaurant to the
 *     customer, never less than the per-trip minimum, and the per-km amount is
 *     one global setting;
 *   - the customer's delivery fee is that pay plus the delivery markup %;
 *   - the platform fee is exactly what was set ("I do 10 and the bill shows
 *     11" — GST was added to it without a GSTIN).
 *
 * The rider's pay is frozen on the bill at checkout, so the quote, the offer,
 * the trip list and the money credited are one number. The same rider is paid
 * twice here, with the rate changed in between: the first payout is always
 * right; a defect shows on the second.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { ledger, accountFor } from '../modules/payments/ledger.ts';
import { toPaise } from '../modules/payments/money.ts';
import {
  createVersion,
  resetConfigsForTesting,
  getActiveRates,
  listConfigs,
  applyRiderPerKmDecision,
  RATE_BOUNDS
} from '../modules/payments/pricingConfig.ts';
import { effectiveCharges, setCharges } from '../modules/payments/restaurantCharges.ts';
import { saveBusinessIdentity } from '../modules/platform/businessIdentity.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { riderPayFor } from '@quick-bites/pricing-engine';

const PORT = 5293;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';
const ADMIN = 'usr_admin_01';

console.log('====================================================');
console.log('  RIDER PAY PER ROAD KM, ONE FIGURE TO THE PAYOUT    ');
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
  return { token: json?.data?.token as string, user: json?.data?.user };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });

try {
  // ------------------------------------------------------------------
  console.log('-- The owner\'s decision reaches the live rates once');
  resetConfigsForTesting();
  memoryStore.meta.delete('rates:rider-per-km-2026-10-01');
  // As production had it: Rs 25 a trip + Rs 6 a km beyond 2 km.
  createVersion({ riderBaseFeePerTrip: 25, riderBaseKm: 2, riderPerKmFee: 6 }, { userId: ADMIN }, 'As it was');
  const versionsBefore = listConfigs().length;
  const applied = applyRiderPerKmDecision();
  const versionsAfter = listConfigs().length;
  const again = applyRiderPerKmDecision();
  it('Riders move to Rs 10 a km with no base fee, in one new rates version', () => {
    assert.equal(applied, true);
    const r = getActiveRates();
    assert.equal(r.riderPerKmFee, 10);
    assert.equal(r.riderBaseFeePerTrip, 0);
    assert.equal(r.riderBaseKm, 0);
    assert.equal(versionsAfter, versionsBefore + 1);
  });
  it('and a restart never applies it again over a later change', () => {
    assert.equal(again, false);
    createVersion({ riderPerKmFee: 12 }, { userId: ADMIN }, 'Owner raised it');
    assert.equal(applyRiderPerKmDecision(), false);
    assert.equal(getActiveRates().riderPerKmFee, 12, 'a restart undid the owner\'s own change');
    createVersion({ riderPerKmFee: 10 }, { userId: ADMIN }, 'Back to 10');
  });
  it('The Rates screen offers the per-km rate and the minimum, not the retired delivery fields', () => {
    const shown = RATE_BOUNDS.filter(b => !b.retired).map(b => b.key);
    assert.ok(shown.includes('riderPerKmFee') && shown.includes('riderMinEarningPerTrip'));
    for (const gone of ['deliveryBaseFee', 'deliveryBaseKm', 'deliveryPerKmBeyond', 'riderBaseFeePerTrip', 'riderBaseKm']) {
      assert.ok(!shown.includes(gone), `${gone} is still offered`);
    }
  });

  createVersion(
    { riderHoldDays: 0, partnerHoldDays: 0, minPayoutAmount: 1, codCashCeiling: 100000, riderDeliveryMarkupPercent: 20 },
    { userId: ADMIN },
    'Release immediately; 20% delivery markup'
  );

  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const riderLogin = await login('rider@quickbite.app');
  const rider = (Array.from(memoryStore.riders.values()) as any[]).find(r => r.userId === riderLogin.user?.id);
  const RIDER_ID = rider?.id as string;
  const payable = () => ledger.balanceOf(accountFor('RIDER_PAYABLE', RIDER_ID));

  const basket = { restaurantId: RESTAURANT_ID, deliveryAddressId: ADDRESS, items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }] };
  async function place(tipAmount: number) {
    const res = await api('/orders', {
      method: 'POST',
      body: { ...basket, paymentMethod: 'CASH_ON_DELIVERY', tipAmount, idempotencyKey: crypto.randomUUID() }
    }, customer.token);
    return { res, order: res.json?.data?.order ?? res.json?.data };
  }
  async function deliver(orderId: string, deliveryOtp: string) {
    await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, riderLogin.token);
    await api(`/orders/${orderId}/status`, { method: 'PUT', body: { status: 'PREPARING', preparationMinutes: 20 } }, partner.token);
    await api(`/orders/${orderId}/status`, { method: 'PUT', body: { status: 'READY_FOR_PICKUP' } }, partner.token);
    const claim = await api(`/riders/orders/${orderId}/claim`, { method: 'POST', body: {} }, riderLogin.token);
    const active = await api('/riders/orders/active', {}, riderLogin.token);
    const pickupCode = (memoryStore.orders.get(orderId) as any)?.pickupCode;
    await api(`/riders/orders/${orderId}/verify-pickup`, { method: 'POST', body: { pickupCode } }, riderLogin.token);
    const delivered = await api(`/riders/orders/${orderId}/verify-otp`, { method: 'POST', body: { deliveryOtp } }, riderLogin.token);
    return { claim, active, delivered };
  }

  // ------------------------------------------------------------------
  console.log('\n-- The bill: pay, delivery fee, platform fee');
  const quote = await api('/orders/quote', { method: 'POST', body: { ...basket, tipAmount: 30 } }, customer.token);
  const first = await place(30);
  const bill1 = first.order?.bill;
  const rates = getActiveRates();
  it('Rider pay is Rs 10 a road km, never below the minimum, frozen on the bill', () => {
    assert.equal(first.res.status, 201, JSON.stringify(first.res.json).slice(0, 300));
    assert.ok(Number(first.order.distanceKm) > 0, 'the order has no distance');
    assert.equal(bill1.riderPay, riderPayFor(first.order.distanceKm, rates));
    assert.ok(bill1.riderPay >= rates.riderMinEarningPerTrip);
    assert.equal(bill1.riderPay, Math.max(rates.riderMinEarningPerTrip, Math.round(first.order.distanceKm * 10)));
  });
  it('The customer\'s delivery fee is rider pay plus the markup', () => {
    assert.equal(bill1.partnerDeliveryFee, bill1.riderPay);
    // Before any membership saving (the demo customer holds Gold).
    assert.equal(round2(bill1.deliveryFee + (bill1.membershipDeliverySaving || 0)), round2(bill1.riderPay * 1.2));
  });
  it('The quote shows the same rider pay and delivery fee the order charged', () => {
    const q = quote.json?.data?.bill ?? quote.json?.data?.quote?.bill ?? quote.json?.data;
    assert.equal(quote.status, 200, JSON.stringify(quote.json).slice(0, 300));
    assert.equal(q.riderPay, bill1.riderPay);
    assert.equal(q.deliveryFee, bill1.deliveryFee);
  });
  it('Without a GSTIN the platform fee is exactly what was set (10 stays 10)', () => {
    assert.equal(bill1.platformFee, effectiveCharges(RESTAURANT_ID).platformFee);
  });

  setCharges(RESTAURANT_ID, { platformFee: 10 }, ADMIN);
  const tenNoGst = await api('/orders/quote', { method: 'POST', body: basket }, customer.token);
  saveBusinessIdentity({ gstin: '29ABCDE1234F1Z5' });
  setCharges(RESTAURANT_ID, { platformGstPercent: 18 }, ADMIN);
  const tenWithGst = await api('/orders/quote', { method: 'POST', body: basket }, customer.token);
  setCharges(RESTAURANT_ID, { platformGstPercent: null, platformFee: null }, ADMIN);
  saveBusinessIdentity({ gstin: '' });
  const feeOf = (r: any) => (r.json?.data?.bill ?? r.json?.data?.quote?.bill ?? r.json?.data)?.platformFee;
  it('A Rs 10 fee is Rs 10 on the bill; GST is added only with a GSTIN', () => {
    assert.equal(feeOf(tenNoGst), 10, 'the owner\'s "I do 10 and it shows 11"');
    assert.equal(feeOf(tenWithGst), 11.8);
  });

  // ------------------------------------------------------------------
  console.log('\n-- The same rider, paid twice');
  const before1 = payable();
  const trip1 = await deliver(first.order.id, first.order.deliveryOtp);
  const after1 = payable();
  it('The offer shows pay plus the tip, once', () => {
    assert.equal(trip1.claim.status, 200, JSON.stringify(trip1.claim.json).slice(0, 300));
    assert.equal(trip1.active.json?.data?.order?.estimatedEarnings, round2(bill1.riderPay + 30));
  });
  it('First trip: the rider is credited pay + tip, exactly, and the tip once', () => {
    assert.equal(trip1.delivered.status, 200, JSON.stringify(trip1.delivered.json).slice(0, 300));
    assert.equal(after1 - before1, toPaise(bill1.riderPay + 30));
    assert.equal(memoryStore.orders.get(first.order.id).riderPayout, bill1.riderPay, 'the stored trip pay carries the tip');
  });

  const second = await place(20);
  const bill2 = second.order?.bill;
  // The rate moves after checkout. The rider was offered the old figure.
  createVersion({ riderPerKmFee: 25 }, { userId: ADMIN }, 'Raised after the order was placed');
  const before2 = payable();
  const trip2 = await deliver(second.order.id, second.order.deliveryOtp);
  const after2 = payable();
  createVersion({ riderPerKmFee: 10 }, { userId: ADMIN }, 'Back');
  it('Second trip: paid the pay frozen at checkout, not the rate changed since', () => {
    assert.equal(trip2.delivered.status, 200, JSON.stringify(trip2.delivered.json).slice(0, 300));
    assert.equal(trip2.active.json?.data?.order?.estimatedEarnings, round2(bill2.riderPay + 20));
    assert.equal(after2 - before2, toPaise(bill2.riderPay + 20));
  });

  const trips = await api('/riders/trips?range=all', {}, riderLogin.token);
  it('The trip list shows what was credited, tip included once', () => {
    const list = trips.json?.data?.trips || [];
    const t1 = list.find((t: any) => t.orderId === first.order.id);
    const t2 = list.find((t: any) => t.orderId === second.order.id);
    assert.equal(t1?.payout, round2(bill1.riderPay + 30));
    assert.equal(t2?.payout, round2(bill2.riderPay + 20));
  });

  const adminToken = (await login('admin@quickbite.app')).token;
  const driverPage = await api(`/admin/drivers/${RIDER_ID}`, {}, adminToken);
  const driverList = await api('/admin/drivers', {}, adminToken);
  it('The admin driver page and list count the tips in earnings', () => {
    // The trip pay no longer carries the tip, so these sums must add it back.
    const both = round2(bill1.riderPay + 30 + bill2.riderPay + 20);
    assert.equal(driverPage.status, 200, JSON.stringify(driverPage.json).slice(0, 200));
    assert.equal(driverPage.json.data.stats.earnings, both);
    const row = (driverList.json?.data?.drivers || driverList.json?.data?.items || []).find((d: any) => d.id === RIDER_ID);
    assert.ok(row, `driver missing from list: ${JSON.stringify(driverList.json).slice(0, 200)}`);
    assert.equal(row.earnings, both);
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
