/**
 * The platform's margin per order: a floor at checkout, and a report of losses
 * (N11 / S6 + A7). Driven through the routes the apps call.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { contributionPaise } from '../modules/payments/orderMargin.ts';
import { digestBody, digestCounts } from '../notifications/adminDigest.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5264;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  EVERY ORDER KEEPS WHAT THE OWNER SAID IT MUST     ');
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
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 600)}`);
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

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });

try {
  resetConfigsForTesting();
  const customer = await login('customer@quickbite.app');
  const admin = await login('admin@quickbite.app');
  const setRates = (rates: Record<string, number>) =>
    api('/admin/pricing/config', { method: 'PUT', body: { rates, note: 'margin guard check' } }, admin);

  await api('/admin/coupons', {
    method: 'POST',
    body: { code: 'BIGLOSS', discountType: 'FLAT', discountValue: 300 }
  }, admin);

  const basket = (extra: any = {}) => ({
    restaurantId: RESTAURANT_ID,
    deliveryAddressId: ADDRESS,
    items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
    ...extra
  });
  const place = async (extra: any = {}) => {
    const res = await api('/orders', {
      method: 'POST',
      body: { ...basket(extra), paymentMethod: 'CASH_ON_DELIVERY', idempotencyKey: crypto.randomUUID() }
    }, customer);
    return res.json?.data?.order ?? res.json?.data;
  };

  // --- Floor off (default): the coupon is honoured in full, and the order loses money.
  const loser = await place({ couponCode: 'BIGLOSS' });
  it('Control: with the floor off, a big coupon is given in full', () => {
    assert.ok(loser?.id, 'order not placed');
    assert.equal(loser.bill.couponDiscount, Math.min(300, loser.bill.itemsTotal));
  });
  it('and that order loses the platform money', () => {
    assert.ok(contributionPaise(loser) < 0, `contribution ${contributionPaise(loser)} paise`);
  });

  // --- Floor on: the coupon is trimmed so the order keeps at least the floor.
  await setRates({ minPlatformMarginPerOrder: 20 });
  const quote = await api('/orders/quote', { method: 'POST', body: basket({ couponCode: 'BIGLOSS' }) }, customer);
  const guarded = await place({ couponCode: 'BIGLOSS' });
  it('With a Rs 20 floor, the coupon is trimmed, not refused', () => {
    assert.ok(guarded?.id, 'order refused');
    assert.equal(guarded.couponCode, 'BIGLOSS');
    assert.ok(guarded.bill.couponDiscount > 0 && guarded.bill.couponDiscount < loser.bill.couponDiscount,
      `discount ${guarded.bill.couponDiscount} vs ${loser.bill.couponDiscount}`);
    assert.ok(guarded.bill.couponTrimmedBy > 0);
  });
  it('and the order keeps at least the floor', () => {
    assert.ok(contributionPaise(guarded) >= 2000 - 1, `contribution ${contributionPaise(guarded)} paise`);
  });
  it('and the cart quote showed exactly what was charged', () => {
    const q = quote.json?.data?.bill ?? quote.json?.data;
    assert.equal(q?.totalAmount, guarded.bill.totalAmount, `quote ${q?.totalAmount} vs order ${guarded.bill.totalAmount}`);
  });
  const plain = await place();
  it('Control: an order with no coupon is untouched by the floor', () => {
    assert.equal(plain.bill.couponDiscount, 0);
    assert.equal(plain.bill.couponTrimmedBy, undefined);
  });
  await setRates({ minPlatformMarginPerOrder: 0 });

  // --- The report and the digest.
  const now = new Date().toISOString();
  for (const o of [loser, plain]) {
    Object.assign(memoryStore.orders.get(o.id) as any, { status: 'DELIVERED', deliveredAt: now, riderPayout: 30 });
  }
  const report = await api('/admin/reports/losses?days=1', {}, admin);
  it('The loss report lists the order that lost money', () => {
    assert.equal(report.status, 200, `status ${report.status}`);
    const row = report.json.data.orders.find((r: any) => r.orderId === loser.id);
    assert.ok(row, 'the losing order is missing');
    assert.ok(row.contribution < 0);
    assert.ok(report.json.data.totalLoss >= -row.contribution - 0.01);
  });
  it('and does not list a profitable one', () => {
    assert.ok(!report.json.data.orders.some((r: any) => r.orderId === plain.id));
  });
  const body = digestBody(digestCounts(new Date()), 'today') || '';
  it('The admin digest says how many orders lost money and how much', () => {
    assert.match(body, /order(s)? lost us Rs /, body);
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
