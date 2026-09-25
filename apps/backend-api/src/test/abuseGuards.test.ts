/**
 * The ways an order could be walked backwards, sideways or for free.
 *
 * Each block drives the ROUTE an app or an attacker actually calls, never the
 * module underneath it (full-audit §11: "when the fix is 'the route now calls
 * the module', the check must drive the ROUTE"). Every refusal is paired with a
 * control that must still be ACCEPTED, so a guard that refuses everything
 * cannot pass.
 *
 * Plan: docs/plans/deep-audit-2026-09-25.md, N1 N3 N4 N21.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { ownOrder } from './helpers/ownFixture.ts';

const PORT = 5261;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  NO ORDER GOES BACKWARDS, SIDEWAYS OR FOR FREE     ');
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
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
}

async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

const code = (r: { json: any }) => r.json?.error?.code ?? r.json?.code;

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

(fcmDispatcher as any).sendPushNotification = async (payload: any) => ({ ...payload, sentAt: new Date().toISOString() });
(razorpayAdapter as any).refund = async (paymentId: string) => ({ id: `rfnd_${paymentId}`, status: 'processed' });
(razorpayAdapter as any).verifySignature = () => true;

try {
  const customer = await login('customer@quickbite.app');
  const stranger = await login('rahul.sharma@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const riderLogin = await login('rider@quickbite.app');
  const rider = (Array.from(memoryStore.riders.values()) as any[]).find(r => r.userId === riderLogin.user?.id);
  const RIDER_ID = rider?.id as string;

  resetLedgerForTesting();
  resetConfigsForTesting();
  createVersion(
    { riderHoldDays: 0, partnerHoldDays: 0, minPayoutAmount: 1, codCashCeiling: 100000 },
    { userId: 'usr_admin_01' },
    'Abuse guards'
  );

  async function place(paymentMethod: string) {
    const res = await api(
      '/orders',
      {
        method: 'POST',
        body: {
          restaurantId: RESTAURANT_ID,
          deliveryAddressId: ADDRESS,
          items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
          paymentMethod,
          idempotencyKey: crypto.randomUUID(),
          distanceKm: 3.2
        }
      },
      customer.token
    );
    const order = res.json?.data?.order ?? res.json?.data;
    assert.ok(order?.id, `could not place an order: ${JSON.stringify(res.json).slice(0, 300)}`);
    return order;
  }

  const setStatus = (orderId: string, status: string, token: string, extra: any = {}) =>
    api(`/orders/${orderId}/status`, { method: 'PUT', body: { status, ...extra } }, token);

  async function readyAndClaimed(paymentMethod = 'CASH_ON_DELIVERY') {
    const order = await place(paymentMethod);
    await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, riderLogin.token);
    await setStatus(order.id, 'PREPARING', partner.token, { preparationMinutes: 20 });
    await setStatus(order.id, 'READY_FOR_PICKUP', partner.token);
    const claim = await api(`/riders/orders/${order.id}/claim`, { method: 'POST', body: {} }, riderLogin.token);
    assert.equal(claim.status, 200, `claim failed: ${JSON.stringify(claim.json).slice(0, 300)}`);
    return order;
  }

  // ---------------------------------------------------------------------
  console.log('\n-- N1: a paid confirmation cannot be replayed');

  const paid = await place('RAZORPAY_SANDBOX');
  (memoryStore.orders.get(paid.id) as any).razorpayOrderId = 'order_abuse_1';

  const byStranger = await api(
    `/orders/${paid.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_abuse_1', razorpaySignature: 'sig' } },
    stranger.token
  );
  it('Another customer cannot confirm payment on your order', () => {
    assert.equal(byStranger.status, 403, `status ${byStranger.status}`);
    assert.equal((memoryStore.orders.get(paid.id) as any).status, 'PAYMENT_PENDING');
  });

  const first = await api(
    `/orders/${paid.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_abuse_1', razorpaySignature: 'sig' } },
    customer.token
  );
  it('Control: the owner confirming a pending order is accepted', () => {
    assert.equal(first.status, 200, `status ${first.status}: ${JSON.stringify(first.json).slice(0, 200)}`);
    assert.equal((memoryStore.orders.get(paid.id) as any).status, 'ORDER_PLACED');
  });

  const retry = await api(
    `/orders/${paid.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_abuse_1', razorpaySignature: 'sig' } },
    customer.token
  );
  it('A retry on a paid order is answered, not re-processed', () => {
    assert.equal(retry.status, 200);
    assert.equal((memoryStore.orders.get(paid.id) as any).status, 'ORDER_PLACED');
  });

  const cancelled = await setStatus(paid.id, 'CANCELLED', customer.token, { cancellationReasonCode: 'CHANGED_MY_MIND' });
  it('Control: the customer cancels and is refunded', () => {
    assert.equal(cancelled.status, 200, `status ${cancelled.status}: ${JSON.stringify(cancelled.json).slice(0, 200)}`);
    assert.ok(['REFUNDED', 'CANCELLED'].includes((memoryStore.orders.get(paid.id) as any).status));
  });
  const statusAfterRefund = (memoryStore.orders.get(paid.id) as any).status;

  const replay = await api(
    `/orders/${paid.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_abuse_1', razorpaySignature: 'sig' } },
    customer.token
  );
  it('REPLAYING the confirmation after the refund does not bring the order back', () => {
    const now = memoryStore.orders.get(paid.id) as any;
    assert.equal(now.status, statusAfterRefund, `the refunded order is now ${now.status}`);
    assert.notEqual(now.status, 'ORDER_PLACED', 'the kitchen was sent a refunded order to cook');
    assert.ok(replay.status >= 400 || now.status === statusAfterRefund);
  });

  // The gateway reporting a capture on an order already abandoned.
  const abandoned = await place('RAZORPAY_SANDBOX');
  await setStatus(abandoned.id, 'CANCELLED', customer.token, { cancellationReasonCode: 'CHANGED_MY_MIND' });
  await orderService.markPaidByGateway(abandoned.id, { razorpayPaymentId: 'pay_late_1', amountPaise: 1000 });
  it('A capture arriving after cancellation refunds the money and keeps the order cancelled', () => {
    const now = memoryStore.orders.get(abandoned.id) as any;
    assert.ok(['CANCELLED', 'REFUNDED'].includes(now.status), `the abandoned order is now ${now.status}`);
    assert.ok(now.refundRequestId, 'the late payment was kept with no refund case');
  });

  const startOnCancelled = await api('/payments/start', { method: 'POST', body: { orderId: abandoned.id } }, customer.token);
  it('A cancelled order cannot start a new payment', () => {
    assert.equal(startOnCancelled.status, 409, `status ${startOnCancelled.status}`);
  });

  // ---------------------------------------------------------------------
  console.log('\n-- N3/N4: each role moves only its own steps');

  const trip = await readyAndClaimed();

  const riderCancel = await setStatus(trip.id, 'CANCELLED', riderLogin.token, { cancellationReasonCode: 'OTHER', cancellationNote: 'x' });
  it('A rider cannot cancel an order through the status route', () => {
    assert.equal(riderCancel.status, 403, `status ${riderCancel.status}`);
    assert.equal((memoryStore.orders.get(trip.id) as any).status, 'READY_FOR_PICKUP');
  });

  const riderSkip = await setStatus(trip.id, 'OUT_FOR_DELIVERY', riderLogin.token);
  it('A rider cannot skip the pickup code through the status route', () => {
    assert.equal(riderSkip.status, 403, `status ${riderSkip.status}`);
    assert.equal((memoryStore.orders.get(trip.id) as any).status, 'READY_FOR_PICKUP');
  });

  const kitchenSkip = await setStatus(trip.id, 'OUT_FOR_DELIVERY', partner.token);
  it('The kitchen cannot mark its own order out for delivery', () => {
    assert.equal(kitchenSkip.status, 403, `status ${kitchenSkip.status}`);
  });

  const handed = await setStatus(trip.id, 'HANDED_TO_RIDER', partner.token);
  it('Control: the kitchen can hand over to the assigned rider', () => {
    assert.equal(handed.status, 200, `status ${handed.status}: ${JSON.stringify(handed.json).slice(0, 200)}`);
  });

  // Pickup code guessing.
  const wrongs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await api(`/riders/orders/${trip.id}/verify-pickup`, { method: 'POST', body: { pickupCode: '0000x' } }, riderLogin.token);
    wrongs.push(r.status);
  }
  const rightButLocked = await api(
    `/riders/orders/${trip.id}/verify-pickup`,
    { method: 'POST', body: { pickupCode: (memoryStore.orders.get(trip.id) as any).pickupCode } },
    riderLogin.token
  );
  it('Five wrong pickup codes lock the code, even the right one', () => {
    assert.ok(wrongs.every(s => s >= 400), `a wrong code was accepted: ${wrongs}`);
    assert.ok(rightButLocked.status >= 400, `status ${rightButLocked.status}`);
    assert.equal(code(rightButLocked), 'CODE_LOCKED');
  });

  (memoryStore.orders.get(trip.id) as any).codeAttempts.lockedUntil = new Date(Date.now() - 1000).toISOString();
  const pickedUp = await api(
    `/riders/orders/${trip.id}/verify-pickup`,
    { method: 'POST', body: { pickupCode: (memoryStore.orders.get(trip.id) as any).pickupCode } },
    riderLogin.token
  );
  it('Control: once the lock expires the right code is accepted', () => {
    assert.equal(pickedUp.status, 200, `status ${pickedUp.status}: ${JSON.stringify(pickedUp.json).slice(0, 200)}`);
    assert.equal((memoryStore.orders.get(trip.id) as any).status, 'OUT_FOR_DELIVERY');
  });

  const kitchenLateCancel = await setStatus(trip.id, 'CANCELLED', partner.token, { cancellationReasonCode: 'ITEM_UNAVAILABLE' });
  it('The kitchen cannot cancel once the food has left', () => {
    assert.equal(kitchenLateCancel.status, 409, `status ${kitchenLateCancel.status}`);
    assert.equal((memoryStore.orders.get(trip.id) as any).status, 'OUT_FOR_DELIVERY');
  });

  const releaseAfterPickup = await api(`/riders/orders/${trip.id}/cancel`, { method: 'POST', body: { reason: 'bike broke' } }, riderLogin.token);
  it('N21: a rider holding the food cannot put it back on offer', () => {
    assert.equal(releaseAfterPickup.status, 409, `status ${releaseAfterPickup.status}`);
    const now = memoryStore.orders.get(trip.id) as any;
    assert.equal(now.status, 'OUT_FOR_DELIVERY');
    assert.equal(now.riderId, RIDER_ID);
  });

  // Doorstep code guessing.
  const otpWrongs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await api(`/riders/orders/${trip.id}/verify-otp`, { method: 'POST', body: { deliveryOtp: '99999' } }, riderLogin.token);
    otpWrongs.push(r.status);
  }
  const otpLocked = await api(
    `/riders/orders/${trip.id}/verify-otp`,
    { method: 'POST', body: { deliveryOtp: (memoryStore.orders.get(trip.id) as any).deliveryOtp } },
    riderLogin.token
  );
  it('Five wrong doorstep codes lock delivery, even with the right code', () => {
    assert.ok(otpWrongs.every(s => s >= 400), `a wrong code was accepted: ${otpWrongs}`);
    assert.equal(code(otpLocked), 'CODE_LOCKED', `status ${otpLocked.status}`);
    assert.equal((memoryStore.orders.get(trip.id) as any).status, 'OUT_FOR_DELIVERY');
  });

  (memoryStore.orders.get(trip.id) as any).codeAttempts.lockedUntil = new Date(Date.now() - 1000).toISOString();
  const delivered = await api(
    `/riders/orders/${trip.id}/verify-otp`,
    { method: 'POST', body: { deliveryOtp: (memoryStore.orders.get(trip.id) as any).deliveryOtp } },
    riderLogin.token
  );
  it('Control: the right doorstep code delivers once unlocked', () => {
    assert.equal(delivered.status, 200, `status ${delivered.status}: ${JSON.stringify(delivered.json).slice(0, 200)}`);
  });

  // ---------------------------------------------------------------------
  console.log('\n-- N21: handing a trip back touches only the rider track');

  const early = ownOrder('early_release', {
    restaurantId: RESTAURANT_ID,
    status: 'PREPARING',
    riderId: RIDER_ID,
    riderStage: 'HEADING_TO_RESTAURANT'
  });
  const releaseEarly = await api(`/riders/orders/${early.id}/cancel`, { method: 'POST', body: { reason: 'flat tyre' } }, riderLogin.token);
  it('Control: a rider can hand back a trip before pickup', () => {
    assert.equal(releaseEarly.status, 200, `status ${releaseEarly.status}: ${JSON.stringify(releaseEarly.json).slice(0, 200)}`);
    assert.equal((memoryStore.orders.get(early.id) as any).riderId, undefined);
  });
  it('and the kitchen’s food is NOT jumped forward to ready', () => {
    assert.equal((memoryStore.orders.get(early.id) as any).status, 'PREPARING');
  });
  it('and the live order is not stamped as cancelled', () => {
    const now = memoryStore.orders.get(early.id) as any;
    assert.equal(now.cancelledAt, undefined);
    assert.equal(now.riderReleases?.length, 1);
  });

  const dead = ownOrder('dead_release', {
    restaurantId: RESTAURANT_ID,
    status: 'CANCELLED',
    riderId: RIDER_ID,
    riderStage: 'HEADING_TO_RESTAURANT',
    extra: { readyAt: new Date().toISOString(), pickupCode: '4321' }
  });
  const releaseDead = await api(`/riders/orders/${dead.id}/cancel`, { method: 'POST', body: { reason: 'whatever' } }, riderLogin.token);
  it('A cancelled order cannot be revived by handing it back', () => {
    assert.equal(releaseDead.status, 409, `status ${releaseDead.status}`);
    assert.equal((memoryStore.orders.get(dead.id) as any).status, 'CANCELLED');
  });

  const collectDead = await api(`/riders/orders/${dead.id}/verify-pickup`, { method: 'POST', body: { pickupCode: '4321' } }, riderLogin.token);
  it('and a cancelled order that was once ready cannot be collected', () => {
    assert.ok(collectDead.status >= 400, `status ${collectDead.status}`);
    assert.equal((memoryStore.orders.get(dead.id) as any).status, 'CANCELLED');
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
