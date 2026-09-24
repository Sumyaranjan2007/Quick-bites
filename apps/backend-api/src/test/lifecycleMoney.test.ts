/**
 * Whole order lifecycles, over HTTP, with the books checked after every step.
 *
 * -------------------------------------------------------------------------
 * WHAT NOTHING ELSE WAS ASKING
 * -------------------------------------------------------------------------
 * `pipeline.test.ts` already drives the entire journey the way the four apps do —
 * four logins, live sockets, real routes. It asserts nothing about money. Not one
 * mention of the ledger, the receivable, or what a rider is carrying.
 *
 * Every money check on this platform is at the module level: call
 * `recordOrderEarnings`, assert the postings. Those are the right checks and they
 * cannot see a whole class of defect — a route that skips the module, a route that
 * calls it twice, a transition that moves money and a second transition that moves
 * it again. The admin cancellation that credited a dead wallet and posted nothing
 * survived every module check on the platform, because no module check called it.
 *
 * So this drives the routes and asks, after each step, whether the books still
 * balance and whether each account holds what it should. The invariant is stricter
 * than a total: money is in exactly one place at a time, and at the end of a
 * lifecycle every temporary holding account is back to zero.
 *
 * -------------------------------------------------------------------------
 * BALANCED IS NOT ENOUGH, AND SAYING WHY
 * -------------------------------------------------------------------------
 * `ledger.audit().balanced` only says every transaction had equal debits and
 * credits. A transaction that moves Rs 500 from the wrong account to the wrong
 * account balances perfectly. So the accounts are named and checked individually,
 * and `balanced` is the floor rather than the assertion.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise, formatPaise } from '../modules/payments/money.ts';
import { customerPrepaidPaise, captureBooked } from '../modules/payments/capture.ts';
import {
  gatewayReceivablePaise,
  gatewayFeesPaise
} from '../modules/payments/gatewaySettlements.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';

const PORT = 5249;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  WHOLE LIFECYCLES, AND THE BOOKS AFTER EACH STEP   ');
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
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

/** Where all the money is right now. */
function books(riderId: string) {
  return {
    bank: ledger.balanceOf('PLATFORM_BANK'),
    officeCash: ledger.balanceOf('PLATFORM_CASH'),
    riderCash: ledger.balanceOf(accountFor('RIDER_CASH', riderId)),
    receivable: gatewayReceivablePaise(),
    prepaid: customerPrepaidPaise(),
    gatewayFees: gatewayFeesPaise(),
    partnerPayable: ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT_ID)),
    riderPayable: ledger.balanceOf(accountFor('RIDER_PAYABLE', riderId)),
    refundsPaid: ledger.balanceOf('REFUNDS_PAID'),
    revenue: ledger.balanceOf('REVENUE_COMMISSION') + ledger.balanceOf('REVENUE_FEES')
  };
}

/**
 * The books balance, said after every step rather than once at the end.
 *
 * Checked as it goes because an imbalance introduced in step two and corrected by
 * accident in step six passes a check at the end, and the transaction that caused
 * it is the thing worth knowing about.
 */
function balancedAfter(step: string) {
  const audit = ledger.audit();
  assert.equal(
    audit.balanced,
    true,
    `the books stopped balancing after ${step}: ${JSON.stringify(audit.unbalancedTransactions).slice(0, 200)}`
  );
  assert.equal(
    audit.fractionalAmounts.length,
    0,
    `fractional paise appeared after ${step}`
  );
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

/** A gateway that reverses on request, and a note of whether it was asked. */
let refundsAsked: string[] = [];
const realRefund = razorpayAdapter.refund;
const realVerify = razorpayAdapter.verifySignature;
(razorpayAdapter as any).refund = async (paymentId: string) => {
  refundsAsked.push(paymentId);
  return { id: `rfnd_${paymentId}`, status: 'processed' };
};
// The customer's device returning from checkout. Verifying a real signature needs
// live keys; what is under test here is where the money goes afterwards.
(razorpayAdapter as any).verifySignature = () => true;

try {
  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const riderLogin = await login('rider@quickbite.app');
  const admin = await login('admin@quickbite.app');

  const rider = (Array.from(memoryStore.riders.values()) as any[]).find(
    r => r.userId === riderLogin.user?.id
  );
  const RIDER_ID = rider?.id as string;

  resetConfigsForTesting();
  createVersion(
    { riderHoldDays: 0, partnerHoldDays: 0, minPayoutAmount: 1, codCashCeiling: 100000 },
    { userId: 'usr_admin_01' },
    'Release immediately for the lifecycle sweep'
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
    return { res, order };
  }

  async function deliver(orderId: string, deliveryOtp: string) {
    await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, riderLogin.token);
    await api(
      `/orders/${orderId}/status`,
      { method: 'PUT', body: { status: 'PREPARING', preparationMinutes: 20 } },
      partner.token
    );
    await api(
      `/orders/${orderId}/status`,
      { method: 'PUT', body: { status: 'READY_FOR_PICKUP' } },
      partner.token
    );
    const claim = await api(`/riders/orders/${orderId}/claim`, { method: 'POST', body: {} }, riderLogin.token);
    const pickupCode = (memoryStore.orders.get(orderId) as any)?.pickupCode;
    const pickup = await api(
      `/riders/orders/${orderId}/verify-pickup`,
      { method: 'POST', body: { pickupCode } },
      riderLogin.token
    );
    const delivered = await api(
      `/riders/orders/${orderId}/verify-otp`,
      { method: 'POST', body: { deliveryOtp } },
      riderLogin.token
    );
    return { claim, pickup, delivered };
  }

  /* ================================================================ *
   *  1. CASH ON DELIVERY, ALL THE WAY TO THE BANK                     *
   * ================================================================ */
  console.log('-- Cash on delivery: pocket, then desk, then bank');

  resetLedgerForTesting();
  const cod = await place('CASH_ON_DELIVERY');

  it('A cash order is placed and the books are untouched', () => {
    assert.ok(cod.order?.id, `order not created: ${JSON.stringify(cod.res.json).slice(0, 250)}`);
    const b = books(RIDER_ID);
    assert.equal(b.riderCash, 0, 'a rider is carrying cash before the food moved');
    assert.equal(b.partnerPayable, 0, 'the kitchen is owed money before it cooked');
    balancedAfter('placing a cash order');
  });

  const codTotalPaise = toPaise(Number(cod.order?.bill?.totalAmount) || 0);
  const codSteps = await deliver(cod.order.id, cod.order.deliveryOtp);

  it('and delivering it puts the money in the RIDER’S POCKET, not the bank', () => {
    assert.equal(codSteps.delivered.status, 200,
      `delivery failed: ${JSON.stringify(codSteps.delivered.json).slice(0, 250)}`);
    const b = books(RIDER_ID);
    assert.equal(b.riderCash, codTotalPaise,
      `the rider is carrying ${formatPaise(b.riderCash)} of ${formatPaise(codTotalPaise)}`);
    assert.equal(b.bank, 0, 'cash in a rider’s pocket was recorded as bank money');
    assert.ok(b.partnerPayable > 0, 'the kitchen was not paid for the food');
    balancedAfter('a cash delivery');
  });

  it('and nothing at the gateway moved, because no gateway was involved', () => {
    const b = books(RIDER_ID);
    assert.equal(b.receivable, 0, 'a cash order put money at the payment gateway');
    assert.equal(b.prepaid, 0, 'a cash order created a prepaid debt');
  });

  const declared = await api(
    '/cash/deposits',
    { method: 'POST', body: { amount: Number(cod.order.bill.totalAmount) } },
    riderLogin.token
  );
  const depositId = declared.json?.data?.deposit?.id;

  it('The rider declares the cash, and declaring alone moves nothing', () => {
    assert.equal(declared.status === 200 || declared.status === 201, true,
      `status ${declared.status}: ${JSON.stringify(declared.json).slice(0, 250)}`);
    const b = books(RIDER_ID);
    assert.equal(b.riderCash, codTotalPaise,
      'declaring an intention moved the money before anybody counted it');
    assert.equal(b.officeCash, 0);
    balancedAfter('declaring a deposit');
  });

  const confirmed = await api(
    `/admin/cash/deposits/${depositId}/confirm`,
    { method: 'POST', body: { receivedAmount: Number(cod.order.bill.totalAmount) } },
    admin.token
  );

  it('and COUNTING IT IN moves it from the pocket to the office', () => {
    assert.equal(confirmed.status, 200, `status ${confirmed.status}: ${JSON.stringify(confirmed.json).slice(0, 250)}`);
    const b = books(RIDER_ID);
    assert.equal(b.riderCash, 0, 'the rider is still shown carrying money they handed over');
    assert.equal(b.officeCash, codTotalPaise,
      `the office holds ${formatPaise(b.officeCash)} of ${formatPaise(codTotalPaise)}`);
    assert.equal(b.bank, 0, 'cash in a drawer was recorded as being in the bank');
    balancedAfter('counting cash in');
  });

  const banked = await api(
    '/admin/cash/bank-deposits',
    { method: 'POST', body: { amount: Number(cod.order.bill.totalAmount), reference: 'DEP-LIFECYCLE-1' } },
    admin.token
  );

  it('and BANKING IT is the third move, not the second', () => {
    /*
     * Three places, three moves. The pocket, the drawer and the bank are different
     * places with different risks, and the ledger used to model two — so from the
     * moment a rider reached the desk the platform believed it held bank money that
     * was physically in a drawer.
     */
    assert.equal(banked.status, 200, `status ${banked.status}: ${JSON.stringify(banked.json).slice(0, 250)}`);
    const b = books(RIDER_ID);
    assert.equal(b.officeCash, 0, 'the office still holds money that went to the bank');
    assert.equal(b.bank, codTotalPaise, `the bank holds ${formatPaise(b.bank)}`);
    assert.equal(b.riderCash, 0);
    balancedAfter('banking office cash');
  });

  /* ================================================================ *
   *  2. PAID ONLINE, ALL THE WAY TO SETTLEMENT                        *
   * ================================================================ */
  console.log('\n-- Online: gateway, then bank, with the fee recorded');

  resetLedgerForTesting();
  const online = await place('RAZORPAY_SANDBOX');
  const onlineTotalPaise = toPaise(Number(online.order?.bill?.totalAmount) || 0);

  // The device coming back from checkout. The order carries the gateway's own order
  // id from creation; this is the customer's confirmation of the payment.
  (memoryStore.orders.get(online.order.id) as any).razorpayOrderId = 'order_lifecycle_1';
  const confirmedPayment = await api(
    `/orders/${online.order.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_lifecycle_1', razorpaySignature: 'sig' } },
    customer.token
  );

  it('PAYING puts the money at the gateway and owes the customer food', () => {
    assert.equal(confirmedPayment.status, 200,
      `status ${confirmedPayment.status}: ${JSON.stringify(confirmedPayment.json).slice(0, 250)}`);
    assert.equal(captureBooked(online.order.id), true, 'the payment was not booked at all');
    const b = books(RIDER_ID);
    assert.equal(b.receivable, onlineTotalPaise,
      `the gateway holds ${formatPaise(b.receivable)} of ${formatPaise(onlineTotalPaise)}`);
    assert.equal(b.prepaid, onlineTotalPaise, 'the platform does not owe the customer their food');
    assert.equal(b.bank, 0, 'money still at the gateway was recorded as bank money');
    assert.equal(b.partnerPayable, 0, 'the kitchen was paid before it cooked');
    balancedAfter('an online payment');
  });

  const onlineSteps = await deliver(online.order.id, online.order.deliveryOtp);

  it('and DELIVERING discharges that debt rather than booking the money twice', () => {
    assert.equal(onlineSteps.delivered.status, 200,
      `delivery failed: ${JSON.stringify(onlineSteps.delivered.json).slice(0, 250)}`);
    const b = books(RIDER_ID);
    assert.equal(b.receivable, onlineTotalPaise,
      'delivery debited the gateway again, counting one payment twice');
    assert.equal(b.prepaid, 0, 'the customer is still owed food after it arrived');
    assert.ok(b.partnerPayable > 0, 'the kitchen was not paid');
    assert.ok(b.riderPayable > 0, 'the rider was not paid for the trip');
    assert.equal(b.riderCash, 0, 'an online order put cash in a rider’s pocket');
    balancedAfter('an online delivery');
  });

  const settlement = await api(
    '/admin/gateway/settlements',
    {
      method: 'POST',
      body: {
        amountSettled: Number((Number(online.order.bill.totalAmount) * 0.9764).toFixed(2)),
        fees: Number((Number(online.order.bill.totalAmount) * 0.02).toFixed(2)),
        tax: Number((Number(online.order.bill.totalAmount) * 0.0036).toFixed(2)),
        reference: 'setl_lifecycle_1'
      }
    },
    admin.token
  );

  it('and SETTLING moves it into the bank with the fee on the books', () => {
    assert.equal(settlement.status, 200, `status ${settlement.status}: ${JSON.stringify(settlement.json).slice(0, 300)}`);
    const b = books(RIDER_ID);
    assert.ok(b.bank > 0, 'nothing reached the bank');
    assert.ok(b.gatewayFees > 0, 'the gateway kept its fee and nothing recorded it');
    assert.equal(
      b.bank + b.gatewayFees + b.receivable,
      onlineTotalPaise,
      `the customer's ${formatPaise(onlineTotalPaise)} is not all accounted for: ` +
        `bank ${formatPaise(b.bank)} + fees ${formatPaise(b.gatewayFees)} + still held ${formatPaise(b.receivable)}`
    );
    balancedAfter('a gateway settlement');
  });

  /* ================================================================ *
   *  3. PAID, THEN CANCELLED BY THE CUSTOMER                          *
   * ================================================================ */
  console.log('\n-- Paid and cancelled: money in, money straight back out');

  resetLedgerForTesting();
  refundsAsked = [];
  const doomed = await place('RAZORPAY_SANDBOX');
  (memoryStore.orders.get(doomed.order.id) as any).razorpayOrderId = 'order_lifecycle_2';
  await api(
    `/orders/${doomed.order.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_lifecycle_2', razorpaySignature: 'sig' } },
    customer.token
  );
  const beforeCancel = books(RIDER_ID);

  const cancelled = await api(
    `/orders/${doomed.order.id}/status`,
    { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'CHANGED_MY_MIND' } },
    customer.token
  );
  await new Promise(r => setTimeout(r, 40));

  it('A CUSTOMER CANCELLING A PAID ORDER GETS THE GATEWAY ASKED', () => {
    assert.equal(cancelled.status, 200, `status ${cancelled.status}: ${JSON.stringify(cancelled.json).slice(0, 300)}`);
    assert.deepEqual(refundsAsked, ['pay_lifecycle_2'], `the gateway was asked for ${JSON.stringify(refundsAsked)}`);
  });

  it('and BOTH holding accounts come back to zero', () => {
    /*
     * The invariant that matters, and the one the old admin cancellation broke: a
     * cancelled prepaid order leaves NOTHING behind. Money came in, no food was
     * made, the money went back.
     */
    const b = books(RIDER_ID);
    assert.equal(b.receivable, 0,
      `the gateway is still shown holding ${formatPaise(b.receivable)} that went back to the customer`);
    assert.equal(b.prepaid, 0, `the platform still owes ${formatPaise(b.prepaid)} of food`);
    balancedAfter('a cancelled prepaid order');
  });

  it('and it is not recorded as a LOSS, because nothing was earned or lost', () => {
    const b = books(RIDER_ID);
    assert.equal(b.refundsPaid, beforeCancel.refundsPaid,
      'a cancelled order was booked as shrinkage');
    assert.equal(b.partnerPayable, 0,
      'a kitchen was docked for an order it was never asked to cook');
    assert.equal(b.revenue, 0, 'a cancelled order was recorded as trading');
  });

  /* ================================================================ *
   *  4. PAID, THEN REJECTED BY THE RESTAURANT                         *
   * ================================================================ */
  console.log('\n-- Paid and rejected by the kitchen');

  resetLedgerForTesting();
  refundsAsked = [];
  const rejected = await place('RAZORPAY_SANDBOX');
  (memoryStore.orders.get(rejected.order.id) as any).razorpayOrderId = 'order_lifecycle_3';
  await api(
    `/orders/${rejected.order.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_lifecycle_3', razorpaySignature: 'sig' } },
    customer.token
  );

  const kitchenSaidNo = await api(
    `/orders/${rejected.order.id}/status`,
    { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'ITEM_UNAVAILABLE' } },
    partner.token
  );
  await new Promise(r => setTimeout(r, 40));

  it('A KITCHEN REJECTING A PAID ORDER REFUNDS IT THE SAME WAY', () => {
    /*
     * A different actor, a different reason code, and the same money path. Three
     * cancellation implementations existed on this platform and they disagreed; this
     * is the check that the remaining one behaves identically whoever calls it.
     */
    assert.equal(kitchenSaidNo.status, 200,
      `status ${kitchenSaidNo.status}: ${JSON.stringify(kitchenSaidNo.json).slice(0, 300)}`);
    assert.deepEqual(refundsAsked, ['pay_lifecycle_3'], `asked for ${JSON.stringify(refundsAsked)}`);
    const b = books(RIDER_ID);
    assert.equal(b.receivable, 0, 'money stayed at the gateway after a rejection');
    assert.equal(b.prepaid, 0, 'the platform still owes food for a rejected order');
    assert.equal(b.refundsPaid, 0, 'a rejection was booked as a loss');
    balancedAfter('a kitchen rejection');
  });

  /* ================================================================ *
   *  5. AND THE WHOLE SWEEP LEAVES NOTHING STRANDED                   *
   * ================================================================ */
  console.log('\n-- Nothing left in a holding account');

  it('EVERY TEMPORARY HOLDING ACCOUNT IS EMPTY OR EXPLAINED', () => {
    /*
     * The last question, and the one a per-step check cannot answer. `CUSTOMER_PREPAID`
     * and `RIDER_CASH` are places money PASSES THROUGH. A balance left in either at
     * the end of a lifecycle is money the platform is holding and cannot name — which
     * is exactly the shape of the stranded capture a cancelled order used to leave.
     */
    const b = books(RIDER_ID);
    assert.equal(b.prepaid, 0, `${formatPaise(b.prepaid)} of customer money is unaccounted for`);
    assert.equal(b.riderCash, 0, `${formatPaise(b.riderCash)} is stranded in a rider's pocket`);
    assert.equal(b.officeCash, 0, `${formatPaise(b.officeCash)} is stranded in the office`);
    assert.equal(ledger.audit().duplicateKeys.length, 0, 'the same movement was recorded twice');
    balancedAfter('the whole sweep');
  });
} finally {
  (razorpayAdapter as any).refund = realRefund;
  (razorpayAdapter as any).verifySignature = realVerify;
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
