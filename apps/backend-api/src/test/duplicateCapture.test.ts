/**
 * A customer charged twice for one order gets the second payment back.
 *
 * Razorpay lets one checkout be paid twice; both payments are captured. The
 * second used to be dropped twice over: the webhook route skipped any order
 * already PAID, and `markPaidByGateway` returned early for good measure. The
 * money stayed at the gateway, recorded nowhere.
 *
 * Driven through the WEBHOOK ROUTE, because the route's own guard was one of the
 * two places that dropped it: a check calling `markPaidByGateway` directly would
 * pass with the route still broken.
 *
 * Run: node --experimental-strip-types src/test/duplicateCapture.test.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { ledger, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { refundableRemaining } from '../modules/payments/refundCap.ts';
import { toPaise } from '../modules/payments/money.ts';
import { sendRefund } from '../modules/payments/refunds.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5265;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  CHARGED TWICE, REFUNDED ONCE                      ');
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

/*
 * The gateway. Every refund it is asked for is recorded, so a check can say
 * exactly which payment was reversed and how many times.
 */
const refundCalls: Array<{ paymentId: string; amountPaise?: number }> = [];
let gatewayUp = true;
(razorpayAdapter as any).refund = async (paymentId: string, amountPaise?: number) => {
  refundCalls.push({ paymentId, amountPaise });
  return gatewayUp ? { id: `rfnd_${paymentId}_${refundCalls.length}`, status: 'processed' } : null;
};
(razorpayAdapter as any).verifySignature = () => true;
(razorpayAdapter as any).verifyWebhook = () => true;
(fcmDispatcher as any).sendPushNotification = async (payload: any) => ({ ...payload, sentAt: new Date().toISOString() });

const callsFor = (paymentId: string) => refundCalls.filter(c => c.paymentId === paymentId);
const casesFor = (orderId: string) =>
  (Array.from(memoryStore.refundRequests.values()) as any[]).filter(r => r.orderId === orderId);
const balance = (account: string) => ledger.balanceOf(account);

try {
  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const riderLogin = await login('rider@quickbite.app');
  const admin = await login('admin@quickbite.app');

  resetLedgerForTesting();
  resetConfigsForTesting();
  createVersion(
    { riderHoldDays: 0, partnerHoldDays: 0, minPayoutAmount: 1, codCashCeiling: 100000 },
    { userId: 'usr_admin_01' },
    'Duplicate capture'
  );

  /** A card order, paid once through the customer's device. */
  async function paidOrder(firstPaymentId: string) {
    const res = await api(
      '/orders',
      {
        method: 'POST',
        body: {
          restaurantId: RESTAURANT_ID,
          deliveryAddressId: ADDRESS,
          items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
          paymentMethod: 'RAZORPAY_SANDBOX',
          idempotencyKey: crypto.randomUUID(),
          distanceKm: 3.2
        }
      },
      customer.token
    );
    const order = res.json?.data?.order ?? res.json?.data;
    assert.ok(order?.id, `could not place an order: ${JSON.stringify(res.json).slice(0, 300)}`);
    (memoryStore.orders.get(order.id) as any).razorpayOrderId = `order_${firstPaymentId}`;
    const confirm = await api(
      `/orders/${order.id}/confirm-payment`,
      { method: 'POST', body: { razorpayPaymentId: firstPaymentId, razorpaySignature: 'sig' } },
      customer.token
    );
    assert.equal(confirm.status, 200, `confirm failed: ${JSON.stringify(confirm.json).slice(0, 300)}`);
    return memoryStore.orders.get(order.id) as any;
  }

  /** Razorpay telling us a payment was captured. */
  const captured = (orderId: string, paymentId: string, amountPaise: number, eventId = crypto.randomUUID()) =>
    api('/payments/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': 'sig', 'x-razorpay-event-id': eventId },
      body: {
        id: eventId,
        event: 'payment.captured',
        payload: { payment: { entity: { id: paymentId, amount: amountPaise, notes: { quickBitesOrderId: orderId } } } }
      }
    });

  /* ================================================================ */
  console.log('-- A second payment on a paid order');

  const order = await paidOrder('pay_first');
  const totalPaise = toPaise(Number(order.bill.totalAmount));
  const before = {
    status: order.status,
    paymentStatus: order.paymentStatus,
    razorpayPaymentId: order.razorpayPaymentId,
    refundRequestId: order.refundRequestId,
    receivable: balance('GATEWAY_RECEIVABLE'),
    prepaid: balance('CUSTOMER_PREPAID')
  };

  it('Control: the order is paid once, with its own payment', () => {
    assert.equal(before.paymentStatus, 'PAID');
    assert.equal(before.razorpayPaymentId, 'pay_first');
    assert.equal(before.receivable, totalPaise, 'the first capture was not booked');
  });

  const second = await captured(order.id, 'pay_second', totalPaise, 'evt_dup_1');

  it('The webhook is acknowledged', () => {
    assert.equal(second.status, 200, `status ${second.status}: ${JSON.stringify(second.json).slice(0, 200)}`);
  });

  it('The second payment is refunded at the gateway, once, in full', () => {
    assert.equal(callsFor('pay_second').length, 1, `refunds of pay_second: ${JSON.stringify(refundCalls)}`);
    assert.equal(callsFor('pay_second')[0].amountPaise, totalPaise);
  });

  it('and the first payment is not refunded', () => {
    assert.equal(callsFor('pay_first').length, 0, `pay_first was refunded: ${JSON.stringify(refundCalls)}`);
  });

  it('A refund case records it, refunded, naming the second payment', () => {
    const cases = casesFor(order.id);
    assert.equal(cases.length, 1, `cases: ${cases.length}`);
    assert.equal(cases[0].duplicatePaymentId, 'pay_second');
    assert.equal(cases[0].status, 'REFUNDED');
    assert.equal(cases[0].refundTransactionId, 'rfnd_pay_second_1');
  });

  it('The order is exactly as it was: still paid, with its first payment, still live', () => {
    const now = memoryStore.orders.get(order.id) as any;
    assert.equal(now.status, before.status);
    assert.equal(now.paymentStatus, 'PAID');
    assert.equal(now.razorpayPaymentId, 'pay_first');
    assert.equal(now.refundRequestId, before.refundRequestId);
  });

  it('The books took the money in and sent it back: both balances end where they started', () => {
    assert.ok(ledger.hasTransaction('capture:payment:pay_second'), 'the second capture was never booked');
    assert.ok(ledger.hasTransaction('refund_paid:duplicate:pay_second'), 'its refund was never booked');
    assert.equal(balance('GATEWAY_RECEIVABLE'), before.receivable);
    assert.equal(balance('CUSTOMER_PREPAID'), before.prepaid);
  });

  const remainingAfter = await refundableRemaining(memoryStore.orders.get(order.id) as any);
  it("Returning the second payment does not use up the order's own refundable amount", () => {
    assert.equal(remainingAfter, Number(order.bill.totalAmount));
  });

  /* ================================================================ */
  console.log('\n-- Reported again');

  await captured(order.id, 'pay_second', totalPaise, 'evt_dup_2');
  it('The same second payment redelivered under a new event id refunds nothing more', () => {
    assert.equal(callsFor('pay_second').length, 1, `refunds of pay_second: ${callsFor('pay_second').length}`);
    assert.equal(casesFor(order.id).length, 1);
  });

  await captured(order.id, 'pay_first', totalPaise, 'evt_dup_3');
  it("The order's OWN payment reported by the webhook is not a duplicate", () => {
    assert.equal(callsFor('pay_first').length, 0);
    assert.equal(casesFor(order.id).length, 1);
    assert.equal(balance('GATEWAY_RECEIVABLE'), before.receivable);
  });

  const complaint = await api(
    '/support/refund-requests',
    { method: 'POST', body: { orderId: order.id, reasonCode: 'FOOD_QUALITY', description: 'Cold and late, sadly.' } },
    customer.token
  );
  it('The customer can still raise a complaint about the food on that order', () => {
    assert.ok(
      complaint.status === 200 || complaint.status === 201,
      `status ${complaint.status}: ${JSON.stringify(complaint.json).slice(0, 200)}`
    );
  });

  /* ================================================================ */
  console.log('\n-- The gateway is down when the second payment arrives');

  const stuck = await paidOrder('pay_first_b');
  const stuckTotal = toPaise(Number(stuck.bill.totalAmount));
  gatewayUp = false;
  await captured(stuck.id, 'pay_second_b', stuckTotal);
  gatewayUp = true;
  const stuckCase = casesFor(stuck.id)[0];

  it('The case is left open, never shown as refunded', () => {
    assert.ok(stuckCase, 'no case was opened');
    assert.equal(stuckCase.status, 'PROCESSING');
    assert.ok(!ledger.hasTransaction('refund_paid:duplicate:pay_second_b'), 'a refund that failed was booked');
  });

  const complaintWhileStuck = await api(
    '/support/refund-requests',
    { method: 'POST', body: { orderId: stuck.id, reasonCode: 'FOOD_QUALITY', description: 'Cold and late, sadly.' } },
    customer.token
  );
  it("and it does not block the customer's own complaint as 'already open'", () => {
    assert.ok(
      complaintWhileStuck.status === 200 || complaintWhileStuck.status === 201,
      `status ${complaintWhileStuck.status}: ${JSON.stringify(complaintWhileStuck.json).slice(0, 200)}`
    );
  });

  // The customer's complaint is settled first, for part of the bill. What is left
  // of the ORDER is now less than the second payment, and that must not matter:
  // the second payment was never the order's money.
  const complaintCase = casesFor(stuck.id).find(c => !c.duplicatePaymentId);
  const partial = await api(
    `/admin/refund-requests/${complaintCase?.id}/decision`,
    { method: 'POST', body: { action: 'REFUND', amount: 50 } },
    admin.token
  );
  it("Control: the customer's complaint is refunded in part, against the order's own payment", () => {
    assert.equal(partial.status, 200, `status ${partial.status}: ${JSON.stringify(partial.json).slice(0, 300)}`);
    assert.deepEqual(callsFor('pay_first_b').map(c => c.amountPaise), [5000]);
  });

  const retry = await api(
    `/admin/refund-requests/${stuckCase?.id}/decision`,
    { method: 'POST', body: { action: 'REFUND' } },
    admin.token
  );
  it('An administrator retrying it from the queue refunds the SECOND payment', () => {
    assert.equal(retry.status, 200, `status ${retry.status}: ${JSON.stringify(retry.json).slice(0, 300)}`);
    const settledCalls = callsFor('pay_second_b');
    assert.equal(settledCalls.length, 2, 'one failed attempt, then the retry');
    assert.equal(settledCalls[1].amountPaise, stuckTotal, 'the retry did not return the whole second payment');
    assert.equal(callsFor('pay_first_b').length, 1, "the queue reversed the order's own payment");
  });

  it('and leaves the order paid and live, not REFUNDED', () => {
    const now = memoryStore.orders.get(stuck.id) as any;
    assert.equal(now.paymentStatus, 'PAID');
    assert.notEqual(now.status, 'REFUNDED');
  });

  await captured(stuck.id, 'pay_second_b', stuckTotal);
  it('and once settled, a later redelivery sends nothing', () => {
    assert.equal(callsFor('pay_second_b').length, 2);
  });

  // The last line of defence, on its own: the gateway would refund the same
  // payment twice without complaint, so a second request must never reach it.
  const callsBeforeResend = refundCalls.length;
  const resend = await sendRefund({
    order: memoryStore.orders.get(stuck.id) as any,
    amountPaise: stuckTotal,
    reason: 'resent',
    actorUserId: 'system',
    caseId: 'case_resend',
    duplicatePaymentId: 'pay_second_b'
  });
  it('Sending the same duplicate refund again never reaches the gateway', () => {
    assert.equal(
      refundCalls.length,
      callsBeforeResend,
      `the gateway was asked again: ${JSON.stringify(refundCalls.slice(callsBeforeResend))}`
    );
    assert.equal(resend.settled, true);
  });

  /* ================================================================ */
  console.log('\n-- After delivery');

  const eaten = await paidOrder('pay_first_c');
  await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, riderLogin.token);
  await api(`/orders/${eaten.id}/status`, { method: 'PUT', body: { status: 'PREPARING', preparationMinutes: 20 } }, partner.token);
  await api(`/orders/${eaten.id}/status`, { method: 'PUT', body: { status: 'READY_FOR_PICKUP' } }, partner.token);
  await api(`/riders/orders/${eaten.id}/claim`, { method: 'POST', body: {} }, riderLogin.token);
  await api(
    `/riders/orders/${eaten.id}/verify-pickup`,
    { method: 'POST', body: { pickupCode: (memoryStore.orders.get(eaten.id) as any).pickupCode } },
    riderLogin.token
  );
  const handedOver = await api(
    `/riders/orders/${eaten.id}/verify-otp`,
    { method: 'POST', body: { deliveryOtp: (memoryStore.orders.get(eaten.id) as any).deliveryOtp } },
    riderLogin.token
  );
  it('Control: the order is delivered and the kitchen credited', () => {
    assert.equal(handedOver.status, 200, `status ${handedOver.status}: ${JSON.stringify(handedOver.json).slice(0, 200)}`);
    assert.equal((memoryStore.orders.get(eaten.id) as any).status, 'DELIVERED');
  });

  const kitchenBefore = balance(`PARTNER_PAYABLE:${RESTAURANT_ID}`);
  const lossesBefore = balance('REFUNDS_PAID');
  await captured(eaten.id, 'pay_second_c', toPaise(Number(eaten.bill.totalAmount)));

  it('A second payment found after delivery is returned too', () => {
    assert.equal(callsFor('pay_second_c').length, 1);
  });

  it("without taking the kitchen's share back, or booking it as a loss", () => {
    assert.equal(balance(`PARTNER_PAYABLE:${RESTAURANT_ID}`), kitchenBefore, 'the kitchen was charged for our refund');
    assert.equal(balance('REFUNDS_PAID'), lossesBefore, 'returning money we should never have had was booked as a loss');
  });
} catch (err: any) {
  failed++;
  console.log(`[FAIL] The suite could not complete: ${err?.stack || err}`);
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
