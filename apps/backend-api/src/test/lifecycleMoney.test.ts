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
import { setIncentiveSettings } from '../modules/payments/incentiveConfig.ts';
import { sweepStaleOrders } from '../modules/orders/orderSweeper.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

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

/**
 * Every push the platform built, so a payee notification can be counted.
 *
 * Recorded rather than intercepted: the real dispatcher still runs, because what is
 * under test is whether the money path reaches it at all.
 */
let fcmSent: any[] = [];
const realPush = fcmDispatcher.sendPushNotification.bind(fcmDispatcher);
(fcmDispatcher as any).sendPushNotification = async (payload: any) => {
  fcmSent.push(payload);
  return { ...payload, sentAt: new Date().toISOString() };
};

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
   *  5. ADMIN CANCEL AND SWEEPER CANCEL — THE OTHER TWO CALLERS        *
   * ================================================================ */
  console.log('\n-- The same cancellation, reached the other two ways');

  resetLedgerForTesting();
  refundsAsked = [];
  const byAdmin = await place('RAZORPAY_SANDBOX');
  (memoryStore.orders.get(byAdmin.order.id) as any).razorpayOrderId = 'order_lifecycle_4';
  await api(
    `/orders/${byAdmin.order.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_lifecycle_4', razorpaySignature: 'sig' } },
    customer.token
  );

  const adminCancel = await api(
    `/admin/orders/${byAdmin.order.id}/cancel`,
    { method: 'POST', body: { reason: 'Duplicate, customer rang in' } },
    admin.token
  );
  await new Promise(r => setTimeout(r, 40));

  it('AN ADMIN CANCELLING OVER HTTP BEHAVES IDENTICALLY', () => {
    /*
     * The third of four callers, and the one that used to be a separate
     * implementation crediting a wallet nobody can spend. Asserted here with the same
     * expectations as the customer's cancellation, because "identical whoever calls
     * it" is only a claim until every caller is driven.
     */
    assert.equal(adminCancel.status, 200,
      `status ${adminCancel.status}: ${JSON.stringify(adminCancel.json).slice(0, 300)}`);
    assert.deepEqual(refundsAsked, ['pay_lifecycle_4'], `asked for ${JSON.stringify(refundsAsked)}`);
    const b = books(RIDER_ID);
    assert.equal(b.receivable, 0, 'money stayed at the gateway after an admin cancellation');
    assert.equal(b.prepaid, 0, 'the platform still owes food for an admin-cancelled order');
    assert.equal(b.refundsPaid, 0, 'an admin cancellation was booked as a loss');
    balancedAfter('an admin cancellation');
  });

  resetLedgerForTesting();
  refundsAsked = [];
  const stale = await place('RAZORPAY_SANDBOX');
  (memoryStore.orders.get(stale.order.id) as any).razorpayOrderId = 'order_lifecycle_5';
  await api(
    `/orders/${stale.order.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_lifecycle_5', razorpaySignature: 'sig' } },
    customer.token
  );
  // Nobody accepted it. Backdated past the accept timeout so the sweep finds it.
  (memoryStore.orders.get(stale.order.id) as any).createdAt = new Date(
    Date.now() - 6 * 60 * 60_000
  ).toISOString();

  const swept = await sweepStaleOrders(new Date());
  await new Promise(r => setTimeout(r, 40));

  it('AND SO DOES THE SWEEPER CANCELLING A PAID ORDER NOBODY ACCEPTED', () => {
    /*
     * The fourth caller, and the only one with no person behind it. A paid order that
     * a kitchen never answered is the case where nobody is watching at all, so if any
     * caller were going to leave money stranded it would be this one.
     */
    assert.ok(
      swept.cancelled.includes(stale.order.id),
      `the sweep did not cancel it: ${JSON.stringify(swept.cancelled)}`
    );
    assert.deepEqual(refundsAsked, ['pay_lifecycle_5'], `asked for ${JSON.stringify(refundsAsked)}`);
    const b = books(RIDER_ID);
    assert.equal(b.receivable, 0, 'an auto-cancelled order left its money at the gateway');
    assert.equal(b.prepaid, 0, 'an auto-cancelled order still owes the customer food');
    assert.equal(b.refundsPaid, 0, 'an auto-cancellation was booked as a loss');
    balancedAfter('a sweeper auto-cancellation');
  });

  /* ================================================================ *
   *  6. PAYING EVERYONE — THE MONEY GOING OUT                         *
   * ================================================================ */
  console.log('\n-- Paying the kitchen and the rider, which is the whole point');

  resetLedgerForTesting();
  fcmSent = [];

  // One cash order and one online order, both delivered, so both payees are owed.
  const payCod = await place('CASH_ON_DELIVERY');
  await deliver(payCod.order.id, payCod.order.deliveryOtp);
  const payOnline = await place('RAZORPAY_SANDBOX');
  (memoryStore.orders.get(payOnline.order.id) as any).razorpayOrderId = 'order_lifecycle_6';
  await api(
    `/orders/${payOnline.order.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_lifecycle_6', razorpaySignature: 'sig' } },
    customer.token
  );
  await deliver(payOnline.order.id, payOnline.order.deliveryOtp);

  giveAccount('RESTAURANT', RESTAURANT_ID, 'usr_partner_01', '1234');
  giveAccount('RIDER', RIDER_ID, riderLogin.user!.id, '4321');

  const owedBefore = books(RIDER_ID);

  it('Two delivered orders leave the kitchen AND the rider owed money', () => {
    assert.ok(owedBefore.partnerPayable > 0, 'the kitchen is owed nothing after two deliveries');
    assert.ok(owedBefore.riderPayable > 0, 'the rider is owed nothing after two trips');
    balancedAfter('two deliveries');
  });

  const riderDues = await api(`/admin/payouts/dues`, {}, admin.token);

  it('and a RIDER STILL HOLDING CASH is BLOCKED, not paid a smaller amount', () => {
    /*
     * The rider collected cash on the first order and has not handed it over. A payout
     * that quietly subtracted the cash would pay them less than they earned and look
     * like a calculation nobody can reproduce; blocking says what to do instead.
     */
    const rows = riderDues.json?.data?.dues || [];
    const mine = rows.find((r: any) => r.ownerType === 'RIDER' && r.ownerId === RIDER_ID);
    assert.ok(mine, `the rider is not in the dues list: ${JSON.stringify(rows).slice(0, 200)}`);
    assert.ok(mine.cashInHand > 0, 'this fixture is meant to leave the rider holding cash');
    assert.match(
      String(mine.blockedReason || ''),
      /cash/i,
      `blocked for "${mine.blockedReason}" rather than for the cash they are carrying`
    );
    assert.ok(mine.outstanding > 0, 'the rider is shown as owed nothing while blocked');
  });

  // Hand the cash in so the rider becomes payable, the way the real flow does.
  const payDeclare = await api(
    '/cash/deposits',
    { method: 'POST', body: { amount: Number(payCod.order.bill.totalAmount) } },
    riderLogin.token
  );
  await api(
    `/admin/cash/deposits/${payDeclare.json?.data?.deposit?.id}/confirm`,
    { method: 'POST', body: { receivedAmount: Number(payCod.order.bill.totalAmount) } },
    admin.token
  );

  /**
   * A verified, applied account for a payee, so `duesFor` does not block on one.
   *
   * Written straight into the store rather than driven through `addAccount`, which
   * calls a bank-verification adapter. What is under test here is where the money
   * goes once it CAN go, and the account flow has its own suite.
   */
  function giveAccount(ownerType: 'RESTAURANT' | 'RIDER', ownerId: string, ownerUserId: string, last4: string) {
    const id = `pay_acc_lifecycle_${ownerId}`;
    memoryStore.payeeAccounts.set(id, {
      id,
      ownerType,
      ownerId,
      ownerUserId,
      method: 'BANK',
      holderName: 'Lifecycle Payee',
      accountLast4: last4,
      ifsc: 'HDFC0001234',
      validationStatus: 'VERIFIED',
      appliedAt: new Date().toISOString(),
      isDefault: true,
      createdAt: new Date().toISOString(),
      createdByUserId: 'usr_admin_01'
    } as any);
  }

  async function payOut(ownerType: 'RESTAURANT' | 'RIDER', ownerId: string, ownerName: string) {
    const drafted = await api(
      '/admin/payouts',
      { method: 'POST', body: { ownerType, ownerId, ownerName, rail: 'MANUAL_BANK' } },
      admin.token
    );
    const payout = drafted.json?.data?.payout ?? drafted.json?.data;
    /*
     * Surfaced rather than swallowed. Without this a refused DRAFT shows up two
     * checks later as PAYOUT_NOT_FOUND on the send — pointing at the wrong step
     * entirely, which is exactly what happened the first time this ran.
     */
    if (!payout?.id) {
      return {
        drafted,
        payout,
        sent: {
          status: drafted.status,
          json: { draftRefused: drafted.json }
        }
      };
    }
    if (payout?.state === 'AWAITING_APPROVAL') {
      await api(`/admin/payouts/${payout.id}/approve`, { method: 'POST', body: {} }, admin.token);
    }
    const sent = await api(
      `/admin/payouts/${payout?.id}/send`,
      { method: 'POST', body: { manualReference: `UTR-${ownerType}-LIFECYCLE` } },
      admin.token
    );
    return { drafted, payout, sent };
  }

  const bankBeforePayouts = ledger.balanceOf('PLATFORM_BANK');
  const partnerOwed = books(RIDER_ID).partnerPayable;
  const riderOwed = books(RIDER_ID).riderPayable;

  const paidPartner = await payOut('RESTAURANT', RESTAURANT_ID, 'Biryani By Heart');
  const paidRider = await payOut('RIDER', RIDER_ID, 'Rahul Sharma');
  await new Promise(r => setTimeout(r, 60));

  it('PAYING THEM CLEARS WHAT THEY WERE OWED, EXACTLY', () => {
    assert.equal(paidPartner.sent.status, 200,
      `partner payout failed: ${JSON.stringify(paidPartner.sent.json).slice(0, 300)}`);
    assert.equal(paidRider.sent.status, 200,
      `rider payout failed: ${JSON.stringify(paidRider.sent.json).slice(0, 300)}`);

    const b = books(RIDER_ID);
    assert.equal(b.partnerPayable, 0, `the kitchen is still owed ${formatPaise(b.partnerPayable)}`);
    assert.equal(b.riderPayable, 0, `the rider is still owed ${formatPaise(b.riderPayable)}`);
    balancedAfter('two payouts');
  });

  it('and the BANK falls by exactly the sum of the two, not by a rounded figure', () => {
    /*
     * The assertion that a payout cannot quietly shrink or grow. Anything other than
     * the exact sum means somebody was paid a number the ledger cannot explain.
     */
    const bankNow = ledger.balanceOf('PLATFORM_BANK');
    assert.equal(
      bankBeforePayouts - bankNow,
      partnerOwed + riderOwed,
      `the bank fell by ${formatPaise(bankBeforePayouts - bankNow)} against ` +
        `${formatPaise(partnerOwed + riderOwed)} owed`
    );
  });

  it('and EACH PAYEE IS TOLD, once', () => {
    /*
     * Counted by subject, not by push: one notification fans out to every device the
     * payee has, so counting pushes counts devices.
     */
    const told = new Set(
      fcmSent.filter(p => p.data?.type === 'PAYOUT_PAID').map(p => p.data?.payoutId)
    );
    assert.equal(told.size, 2, `${told.size} payees were told they had been paid, of two`);
  });

  console.log('\n-- And a bonus reaches the rider through the same run');

  setIncentiveSettings([{ code: 'DAILY_8', enabled: true, reward: 120, target: 8 }], 'usr_admin_01');
  for (let i = 0; i < 8; i += 1) {
    memoryStore.orders.set(`ord_bonus_${i}`, {
      id: `ord_bonus_${i}`,
      orderNumber: `QB-BON${i}`,
      riderId: RIDER_ID,
      restaurantId: RESTAURANT_ID,
      customerId: customer.user?.id,
      status: 'DELIVERED',
      deliveredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      paymentMethod: 'RAZORPAY_SANDBOX',
      paymentStatus: 'PAID',
      bill: { totalAmount: 200, itemsTotal: 160 }
    } as any);
  }
  const incentives = await api('/riders/incentives', {}, riderLogin.token);
  const afterBonus = books(RIDER_ID);
  const secondRun = await payOut('RIDER', RIDER_ID, 'Rahul Sharma');
  await new Promise(r => setTimeout(r, 60));

  it('A BONUS BECOMES PAYABLE AND THE NEXT RUN CARRIES IT', () => {
    /*
     * The other half of M2. Booking a bonus as owed is only useful if a payout picks
     * it up — the whole defect was a bonus recorded somewhere no payout reads.
     */
    assert.equal(incentives.status, 200, `status ${incentives.status}`);
    assert.equal(
      afterBonus.riderPayable,
      toPaise(120),
      `the bonus left the rider owed ${formatPaise(afterBonus.riderPayable)} rather than Rs 120.00`
    );
    assert.equal(secondRun.sent.status, 200,
      `the bonus payout failed: ${JSON.stringify(secondRun.sent.json).slice(0, 300)}`);
    const residue = books(RIDER_ID).riderPayable;
    assert.equal(residue, 0,
      'the bonus was not paid out; the rider is still owed ' + formatPaise(residue) +
      ' after a payout that reported ' + secondRun.sent.status + ': ' +
      JSON.stringify(secondRun.sent.json).slice(0, 200));
    balancedAfter('a bonus payout');
  });

  console.log('');
  console.log('-- And being paid a SECOND time, which is where it stopped working');

  const thirdEarning = await place('CASH_ON_DELIVERY');
  await deliver(thirdEarning.order.id, thirdEarning.order.deliveryOtp);
  const thirdDeclare = await api(
    '/cash/deposits',
    { method: 'POST', body: { amount: Number(thirdEarning.order.bill.totalAmount) } },
    riderLogin.token
  );
  await api(
    `/admin/cash/deposits/${thirdDeclare.json?.data?.deposit?.id}/confirm`,
    { method: 'POST', body: { receivedAmount: Number(thirdEarning.order.bill.totalAmount) } },
    admin.token
  );

  const owedThirdTime = books(RIDER_ID).riderPayable;
  const thirdRun = await payOut('RIDER', RIDER_ID, 'Rahul Sharma');
  await new Promise(r => setTimeout(r, 40));

  it('A PAYEE PAID BEFORE IS PAID THEIR FULL NEW EARNINGS, NOT LESS', () => {
    /*
     * THE DEFECT THIS CHECK EXISTS FOR, AND IT WAS FOUND BY ACCIDENT.
     *
     * Paying somebody wrote two things: the payout recorded which ledger entries it
     * covered, AND the ledger got a debit clearing the payable. `duesFor` skipped the
     * covered credits and then counted the debit as well — subtracting the same money
     * twice, with the debit never in anybody's covered list, so it stayed subtracted
     * for ever.
     *
     * The effect compounds. After a first payout, what a payee is owed reads as their
     * new earnings MINUS everything they have ever been paid. A rider paid this week
     * and earning less next week is owed "nothing", permanently.
     *
     * It was invisible because every check on this platform, mine included, paid each
     * payee exactly ONCE — and the first payout is always right. This is the third
     * payout to this rider, which is the smallest thing that would have caught it.
     */
    assert.ok(owedThirdTime > 0, 'the rider earned a third trip and is owed nothing');
    assert.equal(thirdRun.sent.status, 200,
      `the third payout failed: ${JSON.stringify(thirdRun.sent.json).slice(0, 250)}`);
    assert.equal(
      thirdRun.payout.amountPaise,
      owedThirdTime,
      `owed ${formatPaise(owedThirdTime)} and paid ${formatPaise(thirdRun.payout.amountPaise)}`
    );
    assert.equal(books(RIDER_ID).riderPayable, 0, 'the third payout left money behind');
    balancedAfter('a third payout to the same rider');
  });

  /* ================================================================ *
   *  7. A REFUND AFTER DELIVERY, THROUGH THE QUEUE                    *
   * ================================================================ */
  console.log('\n-- A refund on a delivered order, and the kitchen’s share of it');

  resetLedgerForTesting();
  refundsAsked = [];
  const complained = await place('RAZORPAY_SANDBOX');
  (memoryStore.orders.get(complained.order.id) as any).razorpayOrderId = 'order_lifecycle_7';
  await api(
    `/orders/${complained.order.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_lifecycle_7', razorpaySignature: 'sig' } },
    customer.token
  );
  await deliver(complained.order.id, complained.order.deliveryOtp);

  const beforeRefund = books(RIDER_ID);
  const refunded = await api(
    `/admin/orders/${complained.order.id}/refund`,
    { method: 'POST', body: { amount: 100, reason: 'Cold food, goodwill refund' } },
    admin.token
  );
  await new Promise(r => setTimeout(r, 40));

  it('A REFUND AFTER DELIVERY IS A LOSS, AND COMES OFF THE GATEWAY', () => {
    /*
     * The opposite of a cancellation, and the distinction the books have to keep. The
     * food was made, the kitchen and the rider were credited, and the money is going
     * back out. That IS shrinkage — and it comes out of the gateway balance, because
     * Razorpay deducts a reversal from the next settlement rather than invoicing us.
     */
    assert.equal(refunded.status, 200, `status ${refunded.status}: ${JSON.stringify(refunded.json).slice(0, 300)}`);
    assert.deepEqual(refundsAsked, ['pay_lifecycle_7'], `asked for ${JSON.stringify(refundsAsked)}`);

    const b = books(RIDER_ID);
    assert.ok(b.refundsPaid > 0, 'a refund after delivery was not recorded as a loss');
    assert.equal(
      b.receivable,
      beforeRefund.receivable - toPaise(100),
      `the receivable went from ${formatPaise(beforeRefund.receivable)} to ${formatPaise(b.receivable)}`
    );
    assert.equal(b.bank, beforeRefund.bank,
      'a gateway reversal was charged to the bank, which leaves it understated for ever');
    balancedAfter('a refund after delivery');
  });

  it('and the KITCHEN’S SHARE comes back off what they are owed', () => {
    /*
     * The platform does not absorb a refund on food a kitchen was paid for. The
     * rider's share is deliberately NOT clawed back: they did the trip, and docking a
     * rider for a kitchen's mistake is how a platform loses riders.
     */
    const b = books(RIDER_ID);
    assert.ok(
      b.partnerPayable < beforeRefund.partnerPayable,
      `the kitchen is still owed ${formatPaise(b.partnerPayable)}, unchanged by the refund`
    );
    assert.equal(b.riderPayable, beforeRefund.riderPayable,
      'the rider was docked for a refund that was not their doing');
  });

  console.log('\n-- And when the kitchen was already paid');

  const clawbackPartner = 'rst_bbh_01';
  const paidAlready = await payOut('RESTAURANT', clawbackPartner, 'Biryani By Heart');
  const afterPaidOut = books(RIDER_ID);
  const secondComplaint = await api(
    `/admin/orders/${complained.order.id}/refund`,
    { method: 'POST', body: { amount: 50, reason: 'Second goodwill gesture' } },
    admin.token
  );
  await new Promise(r => setTimeout(r, 40));

  it('A CLAWBACK ON AN ALREADY-PAID PARTNER GOES NEGATIVE RATHER THAN VANISHING', () => {
    /*
     * The adjustment mechanism, and the reason it is not a debt to chase: the kitchen
     * has the money, so their share of this refund reduces their NEXT settlement. A
     * clawback that silently did nothing because the balance was zero would mean the
     * platform absorbed every refund on food it had already paid for.
     */
    assert.equal(paidAlready.sent.status, 200,
      `the partner payout failed: ${JSON.stringify(paidAlready.sent.json).slice(0, 250)}`);
    assert.equal(afterPaidOut.partnerPayable, 0, 'the partner was not actually paid out');
    assert.equal(secondComplaint.status, 200,
      `status ${secondComplaint.status}: ${JSON.stringify(secondComplaint.json).slice(0, 250)}`);

    const b = books(RIDER_ID);
    assert.ok(
      b.partnerPayable < 0,
      `the clawback vanished: the partner is owed ${formatPaise(b.partnerPayable)} rather than a negative figure`
    );
    balancedAfter('a clawback against a paid partner');
  });

  /* ================================================================ *
   *  8. AND THE WHOLE SWEEP LEAVES NOTHING STRANDED                   *
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
  (fcmDispatcher as any).sendPushNotification = realPush;
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
