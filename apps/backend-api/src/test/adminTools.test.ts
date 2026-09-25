/**
 * The admin phone app's remaining tools, through the routes it calls:
 * kitchen steps for staff (A4), cash on delivery per customer (A8), and the
 * business registration (A31).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5270;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  STAFF CAN HANDLE THE LAST FEW CASES FROM A PHONE   ');
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
  return { token: json?.data?.token as string, user: json?.data?.user };
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });

try {
  resetConfigsForTesting();
  const customer = await login('customer@quickbite.app');
  const admin = await login('admin@quickbite.app');
  const ops = await login('ops@quickbite.app');
  const place = (paymentMethod = 'CASH_ON_DELIVERY') =>
    api('/orders', {
      method: 'POST',
      body: {
        restaurantId: RESTAURANT_ID,
        deliveryAddressId: ADDRESS,
        items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
        paymentMethod,
        idempotencyKey: crypto.randomUUID()
      }
    }, customer.token);
  const idOf = (r: any) => (r.json?.data?.order ?? r.json?.data)?.id;

  // ------------------------------------------------------------ A4
  console.log('-- A4: staff move the kitchen steps, and only those');
  const orderId = idOf(await place());
  const step = (status: string, extra: any = {}) =>
    api(`/admin/orders/${orderId}/status`, { method: 'PUT', body: { status, ...extra } }, ops.token);
  const noReason = await step('ACCEPTED', { preparationMinutes: 20 });
  const accepted = await step('ACCEPTED', { preparationMinutes: 20, reason: 'Kitchen confirmed on call' });
  const cooking = await step('PREPARING', { reason: 'Kitchen confirmed on call' });
  const ready = await step('READY_FOR_PICKUP', { reason: 'Rider is waiting, food on the counter' });
  it('Accept, cooking and ready work with a reason, and are audited', () => {
    assert.equal(noReason.status, 400);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json).slice(0, 200));
    assert.equal(cooking.status, 200);
    assert.equal(ready.status, 200);
    assert.equal((memoryStore.orders.get(orderId) as any).status, 'READY_FOR_PICKUP');
    const rows = (Array.from(memoryStore.auditLogs.values()) as any[]).filter(a => a.action === 'ORDER_STATUS_OVERRIDE' && a.entityId === orderId);
    assert.equal(rows.length, 3);
  });
  const skipToDelivered = await step('DELIVERED', { reason: 'just close it' });
  const skipToCancelled = await step('CANCELLED', { reason: 'just close it' });
  it('but not delivered or cancelled: those have their own checks', () => {
    assert.equal(skipToDelivered.status, 400);
    assert.equal(skipToCancelled.status, 400);
    assert.equal((memoryStore.orders.get(orderId) as any).status, 'READY_FOR_PICKUP');
  });

  // ------------------------------------------------------------ A8
  console.log('\n-- A8: cash on delivery for one customer');
  const cod = (override: string, reason?: string) =>
    api(`/admin/customers/${customer.user.id}`, { method: 'PATCH', body: { codOverride: override, ...(reason ? { codOverrideReason: reason } : {}) } }, admin.token);
  const offNoReason = await cod('OFF');
  const off = await cod('OFF', 'Refused three cash orders at the door');
  const refusedCash = await place();
  const onlineOk = await place('RAZORPAY_SANDBOX');
  it('Staff switch cash off (with a reason); the customer can then only pay online', () => {
    assert.equal(offNoReason.status, 400);
    assert.equal(off.status, 200, JSON.stringify(off.json).slice(0, 200));
    assert.equal(refusedCash.status, 409);
    assert.equal(refusedCash.json?.error?.code, 'COD_DISABLED_FOR_ACCOUNT');
    assert.ok(idOf(onlineOk), JSON.stringify(onlineOk.json).slice(0, 200));
  });
  const detail = await api(`/admin/customers/${customer.user.id}`, {}, admin.token);
  it('and the customer page says so, and who decided', () => {
    assert.equal(detail.json?.data?.cash?.allowed, false);
    assert.equal(detail.json?.data?.cash?.override, 'OFF');
  });
  await cod('AUTO');
  const backToCash = await place();
  it('Back to automatic, cash works again', () => {
    assert.ok(idOf(backToCash), JSON.stringify(backToCash.json).slice(0, 200));
  });
  memoryStore.users.set(customer.user.id, { ...(memoryStore.users.get(customer.user.id) as any) });
  const limitSet = await api('/admin/pricing/config', { method: 'PUT', body: { rates: { codCancelLimit: 1 }, note: 'Cash limit for A8' } }, admin.token);
  if (limitSet.status !== 200) console.log('   limit not set:', JSON.stringify(limitSet.json).slice(0, 300));
  memoryStore.orders.set('ord_a8_late', {
    id: 'ord_a8_late', orderNumber: 'QB-A8', customerId: customer.user.id, paymentMethod: 'CASH_ON_DELIVERY',
    status: 'CANCELLED', cancelledByRole: 'customer', cancelledFromStatus: 'PREPARING', restaurantId: RESTAURANT_ID,
    items: [], bill: { totalAmount: 100 }, createdAt: new Date().toISOString()
  } as any);
  const autoOff = await place();
  await cod('ON', 'Genuine emergency, forgiven');
  const forgiven = await place();
  it('Allow cash forgives the automatic switch-off', () => {
    assert.equal(autoOff.status, 409, JSON.stringify(autoOff.json).slice(0, 300));
    assert.ok(idOf(forgiven), JSON.stringify(forgiven.json).slice(0, 200));
  });

  // ------------------------------------------------------------ A31
  console.log('\n-- A31: the business registration from the phone');
  const byOps = await api('/admin/platform/business', { method: 'PUT', body: { gstin: '29ABCDE1234F1Z5' } }, ops.token);
  const badGstin = await api('/admin/platform/business', { method: 'PUT', body: { gstin: '29ABC' } }, admin.token);
  const good = await api('/admin/platform/business', { method: 'PUT', body: { gstin: '29abcde1234f1z5', legalName: 'Quick Bites Foods' } }, admin.token);
  const read = await api('/admin/platform/business', {}, admin.token);
  it('Only a super administrator can set it; a wrong GSTIN is refused; a right one is saved', () => {
    assert.equal(byOps.status, 403);
    assert.equal(badGstin.status, 400);
    assert.equal(good.status, 200, JSON.stringify(good.json).slice(0, 200));
    assert.equal(read.json?.data?.identity?.gstin, '29ABCDE1234F1Z5');
  });

  // ------------------------------------------------------------ A6
  console.log('\n-- A6: a kitchen that keeps rejecting orders');
  const partner = await login('partner@quickbite.app');
  await cod('AUTO');
  const setRate = (rates: Record<string, number>) =>
    api('/admin/pricing/config', { method: 'PUT', body: { rates, note: 'Kitchen rejection watch' } }, admin.token);
  const reject = async () => {
    const id = idOf(await place('RAZORPAY_SANDBOX'));
    (memoryStore.orders.get(id) as any).status = 'ORDER_PLACED';
    return api(`/orders/${id}/status`, { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'KITCHEN_OVERLOADED' } }, partner.token);
  };
  const quiet = await reject();
  const kitchen = () => memoryStore.restaurants.get(RESTAURANT_ID) as any;
  it('Control: with the alert off, rejections change nothing', () => {
    assert.equal(quiet.status, 200, JSON.stringify(quiet.json).slice(0, 200));
    assert.equal(kitchen().rejectionAlertedOn, undefined);
  });
  await setRate({ rejectionAlertPercent: 20 });
  await reject();
  await reject();
  it('Above the owner\'s rate, the control room is alerted, and the kitchen stays open', () => {
    assert.ok(kitchen().rejectionAlertedOn, 'no alert recorded');
    assert.notEqual(kitchen().isOpen, false);
  });
  await setRate({ rejectionAutoPause: 1 });
  await reject();
  it('With auto-close switched on, the kitchen is closed until staff reopen it', () => {
    assert.equal(kitchen().isOpen, false);
    assert.ok(kitchen().pausedForRejectionsAt);
  });

  // ------------------------------------------------------------ owner lookup
  console.log('\n-- The partner app\'s restaurant lookup answers only the owner');
  const ownerId = (memoryStore.restaurants.get(RESTAURANT_ID) as any).ownerId;
  const own = await api(`/restaurants/owner/${ownerId}`, {}, partner.token);
  const stranger = await api(`/restaurants/owner/${ownerId}`, {}, customer.token);
  const anonymous = await api(`/restaurants/owner/${ownerId}`);
  it('The owner reads their restaurant; another account and no account are refused', () => {
    assert.equal(own.status, 200, JSON.stringify(own.json).slice(0, 200));
    assert.equal(own.json?.data?.restaurant?.id, RESTAURANT_ID);
    assert.equal(stranger.status, 403);
    assert.equal(anonymous.status, 401);
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
