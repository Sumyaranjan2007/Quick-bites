/**
 * A save writes what changed, and nothing changes without being marked (S1).
 *
 * The database save used to re-serialise every document on every flush. It now
 * writes the ids each collection's set/delete marked. That is only safe if
 * EVERY write path marks what it changes, so the main check drives a whole day
 * through the routes the apps call, then runs the full diff the backstop runs,
 * and requires it to find nothing changed that was not marked.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore, peekDirty } from '../db/client.ts';
import { computeChanges, markEverythingPersistedForTesting } from '../db/postgresStore.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { resetConfigsForTesting, createVersion } from '../modules/payments/pricingConfig.ts';
import { resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { sweepStaleOrders } from '../modules/orders/orderSweeper.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5265;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  A SAVE WRITES WHAT CHANGED, AND ALL THAT CHANGED  ');
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
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 1500)}`);
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

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });
(razorpayAdapter as any).refund = async (id: string) => ({ id: `rfnd_${id}`, status: 'processed' });
(razorpayAdapter as any).verifySignature = () => true;

try {
  resetConfigsForTesting();
  resetLedgerForTesting();
  createVersion({ riderHoldDays: 0, partnerHoldDays: 0, minPayoutAmount: 1, codCashCeiling: 100000 }, { userId: 'usr_admin_01' }, 'tracking');

  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const rider = await login('rider@quickbite.app');
  const admin = await login('admin@quickbite.app');
  const riderRecord = (Array.from(memoryStore.riders.values()) as any[]).find(r => r.userId === rider.user.id);

  // ---------------------------------------------------------------------
  console.log('-- A single change writes a single document');
  markEverythingPersistedForTesting();
  const rst0 = memoryStore.restaurants.get(RESTAURANT_ID) as any;
  memoryStore.restaurants.set(RESTAURANT_ID, { ...rst0, note: 'one change' });
  const one = computeChanges('changed');
  it('One document changed: one row written, not the whole store', () => {
    assert.deepEqual(one.upserts.map(u => `${u.collection}/${u.id}`), [`restaurants/${RESTAURANT_ID}`]);
    const total = Object.values(memoryStore).reduce((t: number, m: any) => t + m.size, 0);
    assert.ok(total > 20, `store has only ${total} documents, so the check proves nothing`);
  });
  markEverythingPersistedForTesting();
  memoryStore.coupons.delete('FREEDEL');
  const del = computeChanges('changed');
  it('A deletion is written', () => {
    assert.deepEqual(del.deletions.map(d => `${d.collection}/${d.id}`), ['coupons/FREEDEL']);
  });

  // ---------------------------------------------------------------------
  console.log('\n-- A whole day, then the backstop finds nothing unmarked');
  markEverythingPersistedForTesting();

  const place = async (paymentMethod: string, extra: any = {}) => {
    const res = await api('/orders', {
      method: 'POST',
      body: {
        restaurantId: RESTAURANT_ID,
        deliveryAddressId: ADDRESS,
        items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
        paymentMethod,
        idempotencyKey: crypto.randomUUID(),
        ...extra
      }
    }, customer.token);
    return res.json?.data?.order ?? res.json?.data;
  };
  const status = (id: string, s: string, token: string, extra: any = {}) =>
    api(`/orders/${id}/status`, { method: 'PUT', body: { status: s, ...extra } }, token);

  // Cash order end to end.
  await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, rider.token);
  await api('/riders/location', { method: 'POST', body: { lat: 12.689, lng: 77.48 } }, rider.token);
  const cod = await place('CASH_ON_DELIVERY', { tipAmount: 20 });
  await status(cod.id, 'ACCEPTED', partner.token, { preparationMinutes: 15 });
  await status(cod.id, 'PREPARING', partner.token, { preparationMinutes: 15 });
  await status(cod.id, 'READY_FOR_PICKUP', partner.token);
  await api(`/riders/orders/${cod.id}/claim`, { method: 'POST', body: {} }, rider.token);
  await status(cod.id, 'HANDED_TO_RIDER', partner.token);
  await api(`/riders/orders/${cod.id}/verify-pickup`, { method: 'POST', body: { pickupCode: (memoryStore.orders.get(cod.id) as any).pickupCode } }, rider.token);
  await api('/riders/telemetry', { method: 'POST', body: { orderId: cod.id, lat: 12.69, lng: 77.481 } }, rider.token);
  await api(`/orders/${cod.id}/messages`, { method: 'POST', body: { body: 'At the gate' } }, rider.token);
  await api(`/riders/orders/${cod.id}/verify-otp`, { method: 'POST', body: { deliveryOtp: cod.deliveryOtp } }, rider.token);
  await api(`/orders/${cod.id}/rating`, { method: 'POST', body: { rating: 5, comment: 'hot' } }, customer.token);

  // Online order, paid, cancelled and refunded; then a case on a delivered one.
  const online = await place('RAZORPAY_SANDBOX');
  (memoryStore.orders.get(online.id) as any).razorpayOrderId = 'order_track_1';
  memoryStore.orders.set(online.id, memoryStore.orders.get(online.id));
  await api(`/orders/${online.id}/confirm-payment`, { method: 'POST', body: { razorpayPaymentId: 'pay_track_1', razorpaySignature: 's' } }, customer.token);
  await status(online.id, 'CANCELLED', customer.token, { cancellationReasonCode: 'CHANGED_MY_MIND' });
  await api('/support/refund-requests', { method: 'POST', body: { orderId: cod.id, reasonCode: 'OTHER', description: 'cold food', requestedAmount: 10 } }, customer.token);
  await api('/support/tickets', { method: 'POST', body: { subject: 'Late', category: 'ORDER', message: 'was late', orderId: cod.id } }, customer.token);

  // Cash comes in, office to bank; a payout runs.
  const dep = await api('/cash/deposits', { method: 'POST', body: { amount: Number(cod.bill.totalAmount) } }, rider.token);
  await api(`/admin/cash/deposits/${dep.json?.data?.deposit?.id}/confirm`, { method: 'POST', body: { receivedAmount: Number(cod.bill.totalAmount) } }, admin.token);
  await api('/admin/cash/bank-deposits', { method: 'POST', body: { amount: 10, reference: 'SLIP-1' } }, admin.token);
  await api('/admin/payouts/backfill', { method: 'POST', body: {} }, admin.token);

  // Admin edits and switches.
  await api('/admin/pricing/config', { method: 'PUT', body: { rates: { packagingFeeDefault: 22 }, note: 'track' } }, admin.token);
  await api('/admin/coupons', { method: 'POST', body: { code: 'TRACKME', discountType: 'FLAT', discountValue: 10 } }, admin.token);
  await api('/admin/settings/flags/coupons', { method: 'PUT', body: { enabled: true, note: 'track' } }, admin.token);
  await api('/addresses', { method: 'POST', body: { label: 'Gym', addressLine: '5 Track Road', city: 'Bengaluru', pincode: '560001', coordinates: { latitude: 12.69, longitude: 77.48 } } }, customer.token);
  const addr = (Array.from(memoryStore.addresses.values()) as any[]).find(a => a.label === 'Gym');
  await api(`/addresses/${addr?.id}`, { method: 'PUT', body: { isDefault: true } }, customer.token);
  await api('/auth/me', { method: 'PATCH', body: { fullName: 'Tracked Customer' } }, customer.token);

  // The sweeper, which writes on its own timer.
  const stale = await place('CASH_ON_DELIVERY');
  (memoryStore.orders.get(stale.id) as any).createdAt = new Date(Date.now() - 3 * 3600_000).toISOString();
  memoryStore.orders.set(stale.id, memoryStore.orders.get(stale.id));
  await sweepStaleOrders();

  const audit = computeChanges('full');
  const report = audit.misses.map(m => `${m.collection}/${m.id}`);
  console.log(`   (the day wrote ${audit.upserts.length} documents and deleted ${audit.deletions.length})`);
  it('after a whole day, the full diff finds NOTHING changed that was not marked', () => {
    assert.equal(report.length, 0, `changed in place without set():\n  ${report.join('\n  ')}`);
  });
  it('and the day did write something (so the check above is not empty)', () => {
    assert.ok(audit.upserts.length > 20, `only ${audit.upserts.length} documents written`);
    assert.ok(riderRecord, 'rider not found');
  });

  // ---------------------------------------------------------------------
  console.log('\n-- The backstop still catches an unmarked change');
  markEverythingPersistedForTesting();
  (memoryStore.orders.get(cod.id) as any).note = 'mutated in place, no set()';
  const missed = computeChanges('changed');
  const caught = computeChanges('full');
  it('An in-place change is NOT written by a changed-only save', () => {
    assert.ok(!missed.upserts.some(u => u.id === cod.id));
    assert.equal(peekDirty('orders', cod.id), false);
  });
  it('but the full diff writes it AND reports it as a miss', () => {
    assert.ok(caught.upserts.some(u => u.id === cod.id));
    assert.ok(caught.misses.some(m => m.id === cod.id));
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
