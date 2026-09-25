/**
 * Money the platform used to give back, and the controls that stop it.
 *
 * Plan: docs/plans/deep-audit-2026-09-25.md — N2 (late-cancel fee, cash
 * limit), N6 (refund stacking), N7 (commission GST share), N8 (coupons), N9
 * (distance, radius, minimum order), N12 (order privacy), N13 (idempotency),
 * plus the two rate-screen defects found on the way (a stored config missing
 * newer keys, and the admin app's `changes` body the route refused).
 *
 * Every check drives the route an app calls. Every refusal has a control.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise } from '../modules/payments/money.ts';
import { getActiveRates, resetConfigsForTesting, createVersion } from '../modules/payments/pricingConfig.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5262;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  NOTHING GIVEN AWAY THAT THE OWNER DID NOT CHOOSE  ');
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
async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}
const errCode = (r: { json: any }) => r.json?.error?.code ?? r.json?.code;

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });
(razorpayAdapter as any).refund = async (id: string) => ({ id: `rfnd_${id}`, status: 'processed' });
(razorpayAdapter as any).verifySignature = () => true;

try {
  const customer = await login('customer@quickbite.app');
  const other = await login('rahul.sharma@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const otherPartner = await login('sunita.partner@quickbite.app');
  const admin = await login('admin@quickbite.app');

  resetLedgerForTesting();
  resetConfigsForTesting();

  const setRates = (rates: Record<string, number>) =>
    api('/admin/pricing/config', { method: 'PUT', body: { changes: rates, note: 'profit guards check' } }, admin.token);

  // The second customer orders to an address of their own.
  const otherAddress = await api('/addresses', {
    method: 'POST',
    body: {
      label: 'Home', addressLine: '44 Second Customer Street', city: 'Bengaluru', pincode: '560002',
      coordinates: { latitude: 12.6889, longitude: 77.4803 }
    }
  }, other.token);
  const OTHER_ADDRESS = otherAddress.json?.data?.address?.id ?? otherAddress.json?.data?.id;

  async function place(paymentMethod: string, extra: any = {}, token = customer.token) {
    if (token === other.token && !extra.deliveryAddressId) extra = { ...extra, deliveryAddressId: OTHER_ADDRESS };
    return api(
      '/orders',
      {
        method: 'POST',
        body: {
          restaurantId: RESTAURANT_ID,
          deliveryAddressId: ADDRESS,
          items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
          paymentMethod,
          idempotencyKey: crypto.randomUUID(),
          ...extra
        }
      },
      token
    );
  }
  const orderOf = (r: any) => r.json?.data?.order ?? r.json?.data;
  async function paidOrder() {
    const placed = await place('RAZORPAY_SANDBOX');
    const order = orderOf(placed);
    (memoryStore.orders.get(order.id) as any).razorpayOrderId = `order_pg_${order.id}`;
    await api(`/orders/${order.id}/confirm-payment`, { method: 'POST', body: { razorpayPaymentId: `pay_${order.id}`, razorpaySignature: 's' } }, customer.token);
    return memoryStore.orders.get(order.id) as any;
  }

  // -------------------------------------------------------------------
  console.log('\n-- The rate screen can save');

  // A stored version from before the newest rates existed.
  const stored: any = Array.from(memoryStore.pricingConfigs.values())[0] || null;
  createVersion({ minPayoutAmount: 1 }, { userId: 'usr_admin_01' }, 'seed a version');
  const latest: any = Array.from(memoryStore.pricingConfigs.values()).sort((a: any, b: any) => b.version - a.version)[0];
  delete latest.rates.riderOfferWaveMinutes;
  delete latest.rates.maxDeliveryKm;
  it('A stored version missing newer rates still reads them, from the defaults', () => {
    assert.equal(typeof getActiveRates().riderOfferWaveMinutes, 'number');
    assert.equal(getActiveRates().maxDeliveryKm, 0);
  });
  const saved = await setRates({ packagingFeeDefault: 20 });
  it('and the admin app’s own request shape ({ changes }) saves a rate', () => {
    assert.equal(saved.status, 200, `status ${saved.status}: ${JSON.stringify(saved.json).slice(0, 300)}`);
  });
  void stored;

  // -------------------------------------------------------------------
  console.log('\n-- N12, N13: other people’s orders');

  const mine = orderOf(await place('CASH_ON_DELIVERY'));
  const byOtherKitchen = await api(`/orders/${mine.id}`, {}, otherPartner.token);
  const byOwnKitchen = await api(`/orders/${mine.id}`, {}, partner.token);
  it('Another restaurant cannot read this order', () => {
    assert.equal(byOtherKitchen.status, 403, `status ${byOtherKitchen.status}`);
  });
  it('Control: its own kitchen can', () => {
    assert.equal(byOwnKitchen.status, 200, `status ${byOwnKitchen.status}`);
  });

  const key = crypto.randomUUID();
  await place('CASH_ON_DELIVERY', { idempotencyKey: key });
  const stolenKey = await place('CASH_ON_DELIVERY', { idempotencyKey: key }, other.token);
  it('Another customer sending your checkout key does not get your order back', () => {
    assert.equal(stolenKey.status, 409, `status ${stolenKey.status}`);
    assert.equal(orderOf(stolenKey)?.deliveryOtp, undefined);
  });
  const myRetry = await place('CASH_ON_DELIVERY', { idempotencyKey: key });
  it('Control: your own retry returns your order', () => {
    assert.equal(myRetry.status, 200, `status ${myRetry.status}`);
  });

  // -------------------------------------------------------------------
  console.log('\n-- N9: distance, radius, minimum order');

  const pinless = await api('/addresses', {
    method: 'POST',
    body: { label: 'No pin', addressLine: '12 Somewhere Road', city: 'Bengaluru', pincode: '560001' }
  }, customer.token);
  const pinlessId = pinless.json?.data?.address?.id ?? pinless.json?.data?.id;
  const shortClaim = await place('CASH_ON_DELIVERY', { deliveryAddressId: pinlessId, distanceKm: 0.1 });
  it('An address with no pin cannot claim a 100-metre trip', () => {
    assert.ok(pinlessId, `address not created: ${JSON.stringify(pinless.json).slice(0, 200)}`);
    const o = orderOf(shortClaim);
    assert.ok(o?.id, `order failed: ${JSON.stringify(shortClaim.json).slice(0, 200)}`);
    assert.ok(o.distanceKm >= 3.5, `priced on ${o.distanceKm} km`);
  });
  const longClaim = orderOf(await place('CASH_ON_DELIVERY', { deliveryAddressId: pinlessId, distanceKm: 9 }));
  it('Control: the app may still say the trip is LONGER', () => {
    assert.equal(longClaim.distanceKm, 9);
  });

  await setRates({ minOrderValue: 1900 });
  const tooSmall = await place('CASH_ON_DELIVERY');
  it('Below the minimum order, checkout refuses', () => {
    assert.equal(tooSmall.status, 409);
    assert.equal(errCode(tooSmall), 'BELOW_MINIMUM_ORDER');
  });
  await setRates({ minOrderValue: 0, maxDeliveryKm: 0.1 });
  const tooFar = await place('CASH_ON_DELIVERY');
  it('Beyond the furthest delivery, checkout refuses', () => {
    assert.equal(errCode(tooFar), 'OUT_OF_DELIVERY_RANGE', `status ${tooFar.status}: ${JSON.stringify(tooFar.json).slice(0, 200)}`);
  });
  await setRates({ maxDeliveryKm: 0 });
  const fine = await place('CASH_ON_DELIVERY');
  it('Control: with both off, the same basket checks out', () => {
    assert.equal(fine.status, 201, `status ${fine.status}`);
  });

  // -------------------------------------------------------------------
  console.log('\n-- N6: one order, one refund');

  const refunded = await paidOrder();
  await api(`/orders/${refunded.id}/status`, { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'CHANGED_MY_MIND' } }, customer.token);
  const secondClaim = await api('/support/refund-requests', {
    method: 'POST',
    body: { orderId: refunded.id, reasonCode: 'OTHER', description: 'please refund me again' }
  }, customer.token);
  it('A refunded order cannot be claimed again', () => {
    assert.equal(secondClaim.status, 409, `status ${secondClaim.status}: ${JSON.stringify(secondClaim.json).slice(0, 200)}`);
  });

  // In-flight cases count too (B's review): a case stuck PROCESSING is money
  // already promised.
  const stuck = await paidOrder();
  (memoryStore.orders.get(stuck.id) as any).status = 'DELIVERED';
  const realRefund = (razorpayAdapter as any).refund;
  (razorpayAdapter as any).refund = async () => { throw new Error('gateway down'); };
  const firstTry = await api(`/admin/orders/${stuck.id}/refund`, { method: 'POST', body: { reason: 'gateway will fail' } }, admin.token);
  (razorpayAdapter as any).refund = realRefund;
  const secondTry = await api(`/admin/orders/${stuck.id}/refund`, { method: 'POST', body: { reason: 'try again' } }, admin.token);
  it('A refund stuck PROCESSING blocks a second full refund of the same order', () => {
    assert.equal(firstTry.status, 502, `the first refund should have been left processing: ${firstTry.status}`);
    assert.equal(errCode(secondTry), 'REFUND_EXCEEDS_REMAINING', `status ${secondTry.status}`);
  });

  const partial = await paidOrder();
  (memoryStore.orders.get(partial.id) as any).status = 'DELIVERED';
  const partTotal = Number(partial.bill.totalAmount);
  const sixty = Math.round(partTotal * 60) / 100;
  await api(`/admin/orders/${partial.id}/refund`, { method: 'POST', body: { amount: sixty, reason: 'part refund' } }, admin.token);
  const caseB = await api('/support/refund-requests', {
    method: 'POST',
    body: { orderId: partial.id, reasonCode: 'OTHER', description: 'the rest please', requestedAmount: Math.round((partTotal - sixty) * 100) / 100 }
  }, customer.token);
  const caseBId = caseB.json?.data?.request?.id;
  const overApprove = await api(`/admin/refund-requests/${caseBId}/decision`, { method: 'POST', body: { action: 'APPROVE', amount: partTotal } }, admin.token);
  it('Approving more than the order has left is refused', () => {
    assert.ok(caseBId, `case not raised: ${JSON.stringify(caseB.json).slice(0, 200)}`);
    assert.equal(errCode(overApprove), 'REFUND_EXCEEDS_REMAINING', `status ${overApprove.status}`);
  });
  const fairApprove = await api(`/admin/refund-requests/${caseBId}/decision`, { method: 'POST', body: { action: 'APPROVE' } }, admin.token);
  it('Control: approving exactly what is left is accepted', () => {
    assert.equal(fairApprove.status, 200, `status ${fairApprove.status}: ${JSON.stringify(fairApprove.json).slice(0, 200)}`);
  });

  // -------------------------------------------------------------------
  console.log('\n-- N8: coupons');

  const created = await api('/admin/coupons', {
    method: 'POST',
    body: { code: 'ONEONLY', discountType: 'FLAT', discountValue: 20, usageLimit: 1 }
  }, admin.token);
  it('Control: a limited coupon can be created', () => {
    assert.ok(created.status === 200 || created.status === 201, `status ${created.status}: ${JSON.stringify(created.json).slice(0, 200)}`);
  });
  const firstUse = orderOf(await place('CASH_ON_DELIVERY', { couponCode: 'ONEONLY' }));
  const blocked = orderOf(await place('CASH_ON_DELIVERY', { couponCode: 'ONEONLY' }, other.token));
  it('The single use is taken', () => {
    assert.equal(firstUse.couponCode, 'ONEONLY');
    assert.equal(blocked.couponCode, undefined, 'a second customer used a one-use coupon');
  });
  await api(`/orders/${firstUse.id}/status`, { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'CHANGED_MY_MIND' } }, customer.token);
  const afterRelease = orderOf(await place('CASH_ON_DELIVERY', { couponCode: 'ONEONLY' }, other.token));
  it('and cancelling the order gives the use back', () => {
    assert.equal((memoryStore.coupons.get('ONEONLY') as any).timesUsed, 1);
    assert.equal(afterRelease.couponCode, 'ONEONLY', 'the cancelled order kept the campaign’s only use');
  });

  await api('/admin/coupons', {
    method: 'POST',
    body: { code: 'HELLOFIRST', discountType: 'FLAT', discountValue: 20, newCustomersOnly: true }
  }, admin.token);
  (memoryStore.orders.get(mine.id) as any).status = 'DELIVERED';
  const returning = orderOf(await place('CASH_ON_DELIVERY', { couponCode: 'HELLOFIRST' }));
  it('A first-order coupon is refused to a customer who has had a delivery', () => {
    assert.equal(returning.couponCode, undefined);
  });

  // -------------------------------------------------------------------
  console.log('\n-- N2: cancelling after the kitchen started');

  // A9: refused until the customer app that shows the fee is on phones.
  const lockedFee = await setRates({ cancelFeePercentAfterAccept: 50 });
  it('A cancel fee is refused until the owner confirms the fee-showing app is on phones (A9)', () => {
    assert.ok(lockedFee.status >= 400, `status ${lockedFee.status}`);
    assert.match(JSON.stringify(lockedFee.json), /Customer app shows the cancel fee/);
  });
  await setRates({ cancelQuoteLiveOnPhones: 1, cancelFeePercentAfterAccept: 50 });
  const late = await paidOrder();
  await api(`/orders/${late.id}/status`, { method: 'PUT', body: { status: 'ACCEPTED', preparationMinutes: 20 } }, partner.token);
  const quote = await api(`/orders/${late.id}/cancellation-quote`, {}, customer.token);
  const total = Number(late.bill.totalAmount);
  it('The customer is told the fee before cancelling', () => {
    assert.equal(quote.status, 200);
    assert.equal(quote.json.data.fee, Math.round(total * 50) / 100);
  });
  const payableBefore = ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT_ID));
  const lateCancel = await api(`/orders/${late.id}/status`, { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'CHANGED_MY_MIND' } }, customer.token);
  it('and is refunded the bill less the fee', () => {
    assert.equal(lateCancel.status, 200, `status ${lateCancel.status}: ${JSON.stringify(lateCancel.json).slice(0, 200)}`);
    assert.equal(lateCancel.json.data.refund.amount, Math.round((total - quote.json.data.fee) * 100) / 100);
  });
  it('and the kitchen is paid from the fee for food it started', () => {
    assert.ok(ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT_ID)) > payableBefore);
  });
  it('and the books still balance', () => {
    assert.equal(ledger.audit().balanced, true);
  });

  const early = await paidOrder();
  const earlyCancel = await api(`/orders/${early.id}/status`, { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'CHANGED_MY_MIND' } }, customer.token);
  it('Control: cancelling before the kitchen accepts is still free', () => {
    assert.equal(earlyCancel.json.data.refund.amount, Number(early.bill.totalAmount));
  });

  const kitchenRejects = await paidOrder();
  await api(`/orders/${kitchenRejects.id}/status`, { method: 'PUT', body: { status: 'ACCEPTED', preparationMinutes: 20 } }, partner.token);
  const rejected = await api(`/orders/${kitchenRejects.id}/status`, { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'ITEM_UNAVAILABLE' } }, partner.token);
  it('Control: a KITCHEN cancellation never charges the customer', () => {
    assert.equal(rejected.json.data.refund.amount, Number(kitchenRejects.bill.totalAmount));
  });
  await setRates({ cancelFeePercentAfterAccept: 0 });

  await setRates({ codCancelLimit: 1 });
  const codLate = orderOf(await place('CASH_ON_DELIVERY', {}, other.token));
  await api(`/orders/${codLate.id}/status`, { method: 'PUT', body: { status: 'ACCEPTED', preparationMinutes: 20 } }, partner.token);
  await api(`/orders/${codLate.id}/status`, { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'CHANGED_MY_MIND' } }, other.token);
  const codAgain = await place('CASH_ON_DELIVERY', {}, other.token);
  const onlineAgain = await place('RAZORPAY_SANDBOX', {}, other.token);
  it('After the limit of late cash cancels, cash is switched off for that customer', () => {
    assert.equal(errCode(codAgain), 'COD_DISABLED_FOR_ACCOUNT', `status ${codAgain.status}`);
  });
  it('Control: they can still order and pay online', () => {
    assert.equal(onlineAgain.status, 201, `status ${onlineAgain.status}`);
  });
  await setRates({ codCancelLimit: 0 });

  // -------------------------------------------------------------------
  console.log('\n-- N7: the GST on commission');

  const before = orderOf(await place('CASH_ON_DELIVERY'));
  await setRates({ commissionGstChargedToPartnerPercent: 100 });
  const after = orderOf(await place('CASH_ON_DELIVERY'));
  it('At 100%, the restaurant pays the GST on its commission', () => {
    const expected = Math.round(Number(after.bill.commissionAmount) * 0.18 * 100) / 100;
    assert.equal(after.bill.commissionGstToPartner, expected);
    assert.equal(
      Math.round((Number(before.bill.restaurantNetPayout) - Number(after.bill.restaurantNetPayout)) * 100) / 100,
      expected
    );
  });
  it('Control: at the default of 0 nothing changed', () => {
    assert.equal(Number(before.bill.commissionGstToPartner || 0), 0);
  });
  void toPaise;
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
