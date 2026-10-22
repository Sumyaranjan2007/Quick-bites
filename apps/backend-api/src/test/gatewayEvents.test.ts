/**
 * What Razorpay says after the fact (launch readiness S6, S7, 22 Oct 2026): a
 * refund it accepted and later FAILED reaches Operations and is marked on its
 * case (the customer was told "refunded"); a processed one is marked done; a
 * chargeback is marked on its order with its deadline and Operations is told.
 * Nothing re-sends money by itself.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5299;
const API = `http://127.0.0.1:${PORT}/api`;
let failed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message}`);
  }
};
const webhook = (event: string, payload: any) => {
  const id = crypto.randomUUID();
  return fetch(`${API}/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'sig', 'x-razorpay-event-id': id },
    body: JSON.stringify({ id, event, payload })
  }).then(r => r.status);
};

await seedDatabase();
(razorpayAdapter as any).verifyWebhook = () => true;
const pushes: any[] = [];
(fcmDispatcher as any).sendPushNotification = async (p: any) => {
  pushes.push(p);
  return { ...p, sentAt: new Date().toISOString() };
};
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 300));

try {
  const caseFor = (id: string, refundId: string, orderNumber: string) =>
    memoryStore.refundRequests.set(id, { id, orderId: `ord_${id}`, orderNumber, status: 'REFUNDED', refundTransactionId: refundId, createdAt: new Date().toISOString() });
  caseFor('rr_ok', 'rfnd_ok', '1001');
  caseFor('rr_bad', 'rfnd_bad', '1002');

  console.log('-- Refunds after Razorpay accepted them');
  const okStatus = await webhook('refund.processed', { refund: { entity: { id: 'rfnd_ok', amount: 25000 } } });
  check('A processed refund is marked done on its case', () => {
    assert.equal(okStatus, 200);
    assert.equal((memoryStore.refundRequests.get('rr_ok') as any).gatewayRefundStatus, 'PROCESSED');
    assert.equal(pushes.filter(p => p.title === 'A refund could not be sent').length, 0);
  });
  await webhook('refund.failed', { refund: { entity: { id: 'rfnd_bad', amount: 40000 } } });
  check('A failed refund is marked on its case and Operations is told to settle it by hand', () => {
    assert.equal((memoryStore.refundRequests.get('rr_bad') as any).gatewayRefundStatus, 'FAILED');
    const told = pushes.filter(p => p.title === 'A refund could not be sent');
    assert.ok(told.length >= 1, 'no push to Operations');
    assert.match(told[0].body, /#1002/);
  });

  console.log('\n-- Chargebacks');
  memoryStore.orders.set('ord_disputed', { id: 'ord_disputed', orderNumber: '2001', razorpayPaymentId: 'pay_disputed', status: 'DELIVERED' });
  pushes.length = 0;
  const respondBy = Math.floor(Date.now() / 1000) + 5 * 86400;
  await webhook('payment.dispute.created', { dispute: { entity: { id: 'disp_1', payment_id: 'pay_disputed', amount: 52000, respond_by: respondBy, reason_code: 'fraud' } } });
  check('A chargeback is marked on its order with the deadline, and Operations is told', () => {
    const order = memoryStore.orders.get('ord_disputed') as any;
    assert.equal(order.dispute?.status, 'CREATED');
    assert.equal(order.dispute?.amountPaise, 52000);
    assert.ok(order.dispute?.respondBy);
    assert.ok(pushes.some(p => /chargeback/i.test(p.title) && /#2001/.test(p.body)), JSON.stringify(pushes.map(p => p.title)));
  });
  await webhook('payment.dispute.lost', { dispute: { entity: { id: 'disp_1', payment_id: 'pay_disputed', amount: 52000 } } });
  check('...and when it is lost, that is told too', () => {
    assert.equal((memoryStore.orders.get('ord_disputed') as any).dispute?.status, 'LOST');
    assert.ok(pushes.some(p => /lost/i.test(p.title)));
  });
} finally {
  await new Promise(r => server.close(() => r(null)));
}

console.log(failed ? `\n${failed} FAILED` : '\nALL GATEWAY EVENT CHECKS PASSED');
setTimeout(() => process.exit(failed ? 1 : 0), 100);
