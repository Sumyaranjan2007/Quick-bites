/**
 * The order clock (owner, 20 Oct 2026): the customer may cancel in the app for 2 minutes
 * after the kitchen accepts, then only through support; riders are offered the trip at
 * 10 minutes of cooking left (at once for a shorter cook, or when the food is Ready).
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { offerableNow } from '../modules/orders/riderTrip.ts';
import { buildRestaurantDashboard } from '../modules/restaurants/restaurantInsights.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { ownOrder } from './helpers/ownFixture.ts';

const PORT = 5281;
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
async function api(path: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const KITCHEN = 'rst_bbh_01';

console.log('-- Partner dashboard: delivered then refunded is not a cancellation (R2-20)');
const dash = buildRestaurantDashboard(
  [
    { id: 'a', status: 'DELIVERED', deliveredAt: minutesAgo(5), createdAt: minutesAgo(60), items: [] },
    { id: 'b', status: 'REFUNDED', deliveredAt: minutesAgo(5), createdAt: minutesAgo(60), items: [] },
    { id: 'c', status: 'CANCELLED', createdAt: minutesAgo(60), items: [] }
  ] as any,
  null
);
check('one cancellation, two of three reached the customer', () => {
  assert.equal(dash.orders.cancelled, 1);
  assert.equal(dash.orders.completionRate, 67);
});

console.log('-- Riders are called at 10 minutes of cooking left');
const cooking = (prep: number, startedMinutesAgo: number, status: any = 'PREPARING') =>
  ({ restaurantId: KITCHEN, status, acceptedAt: minutesAgo(startedMinutesAgo), preparationMinutes: prep, items: [] }) as any;
check('25 min cook, just accepted: not yet', () => assert.equal(offerableNow(cooking(25, 0)), false));
check('25 min cook, 14 min in (11 left): not yet', () => assert.equal(offerableNow(cooking(25, 14)), false));
check('25 min cook, 16 min in (9 left): offered', () => assert.equal(offerableNow(cooking(25, 16)), true));
check('8 min cook: offered at once', () => assert.equal(offerableNow(cooking(8, 0, 'ACCEPTED')), true));
check('Ready early: offered', () => assert.equal(offerableNow(cooking(25, 1, 'READY_FOR_PICKUP')), true));
check('Not accepted yet: never', () => assert.equal(offerableNow({ restaurantId: KITCHEN, status: 'ORDER_PLACED' } as any), false));

await seedDatabase();
(razorpayAdapter as any).refund = async (paymentId: string) => ({ id: `rfnd_${paymentId}`, status: 'processed' });
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 300));
resetAuthRateLimit();

try {
  console.log('\n-- The customer may cancel for 2 minutes after the kitchen accepts');
  const token = (await api('/auth/login', { method: 'POST', body: { email: 'customer@quickbite.app', password: 'pass123' } })).json?.data?.token;
  const reason = (await api('/orders/cancellation-reasons', {}, token)).json?.data?.reasons?.[0]?.code;
  const order = (status: any, acceptedMinutesAgo?: number) =>
    ownOrder('clock', {
      restaurantId: KITCHEN,
      status,
      paymentMethod: 'CASH_ON_DELIVERY',
      extra: acceptedMinutesAgo === undefined ? {} : { acceptedAt: minutesAgo(acceptedMinutesAgo), preparationMinutes: 20 }
    });
  const cancel = (id: string) =>
    api(`/orders/${id}/status`, { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: reason } }, token);

  const fresh = order('ACCEPTED', 1);
  const quote = (await api(`/orders/${fresh.id}/cancellation-quote`, {}, token)).json?.data;
  check('1 min after accept: the quote says cancel is open and until when', () => {
    assert.equal(quote?.canCancel, true);
    assert.ok(Date.parse(quote?.cancelUntil) > Date.now(), String(quote?.cancelUntil));
  });
  const okCancel = await cancel(fresh.id);
  check('...and the cancel goes through', () => assert.equal(okCancel.status, 200, JSON.stringify(okCancel.json).slice(0, 200)));

  const late = order('PREPARING', 3);
  const lateQuote = (await api(`/orders/${late.id}/cancellation-quote`, {}, token)).json?.data;
  check('3 min after accept: the quote says no, and sends them to support (R3-8)', () => {
    assert.equal(lateQuote?.canCancel, false);
    assert.match(String(lateQuote?.message), /Ask support/);
  });
  const refused = await cancel(late.id);
  check('...and the server refuses, sending them to support', () => {
    assert.equal(refused.status, 409);
    assert.equal(refused.json?.error?.code, 'CUSTOMER_CANCEL_WINDOW_OVER');
  });

  const waiting = order('ORDER_PLACED');
  const beforeAccept = await cancel(waiting.id);
  check('Before the kitchen accepts: always allowed', () => assert.equal(beforeAccept.status, 200, JSON.stringify(beforeAccept.json).slice(0, 200)));

  console.log('-- Cart suggestions: the most ordered dishes first (item 5)');
  const sold = (dishId: string, quantity: number) =>
    ownOrder('popular', { restaurantId: 'rst_pop_01', status: 'DELIVERED', extra: { items: [{ dishId, quantity, name: dishId, unitPrice: 100, totalPrice: 100 * quantity }] } });
  sold('dish_b', 1);
  sold('dish_a', 3);
  sold('dish_b', 1);
  ownOrder('popular', { restaurantId: 'rst_pop_01', status: 'CANCELLED', extra: { items: [{ dishId: 'dish_c', quantity: 9 }] } });
  const popular = (await api('/restaurants/rst_pop_01/popular')).json?.data?.dishIds;
  check('most ordered first, cancelled orders not counted', () => assert.deepEqual(popular, ['dish_a', 'dish_b']));
} finally {
  await new Promise(r => server.close(() => r(null)));
}

console.log(failed ? `\n${failed} FAILED` : '\nALL ORDER CLOCK CHECKS PASSED');
setTimeout(() => process.exit(failed ? 1 : 0), 100);
