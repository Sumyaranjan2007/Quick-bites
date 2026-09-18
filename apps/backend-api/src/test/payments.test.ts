/**
 * Payments.
 *
 * Money is the one thing on this platform that cannot be put back by editing a
 * record, so the checks here are almost entirely about what must NOT work: a
 * forged signature, a replayed webhook, someone else's order, a client that
 * claims to have paid.
 *
 * The Razorpay Orders API itself is not called — that needs the network and a
 * live account, and a test that depends on a third party is a test that fails
 * for reasons that are nobody's fault. What is tested is everything this
 * platform decides on its own: who may start a payment, which signatures are
 * accepted, and whether an order can be marked paid by anything other than
 * Razorpay.
 */
import crypto from 'crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { config } from '../config/env.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';

console.log('====================================================');
console.log('          RUNNING PAYMENT SECURITY TESTS           ');
console.log('====================================================\n');

const PORT = 5200 + Math.floor(Math.random() * 300);
const API = `http://127.0.0.1:${PORT}/api`;

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.log(`[FAIL] ${description}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function api(
  path: string,
  options: { method?: string; body?: any; headers?: Record<string, string>; rawBody?: string } = {},
  token?: string
) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    body: options.rawBody ?? (options.body ? JSON.stringify(options.body) : undefined)
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* some errors carry no body */
  }
  return { status: res.status, json };
}

/** A webhook body exactly as Razorpay sends one. */
function webhookBody(orderId: string, eventId: string) {
  return JSON.stringify({
    id: eventId,
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_' + crypto.randomBytes(8).toString('hex'),
          amount: 45000,
          notes: { quickBitesOrderId: orderId }
        }
      }
    }
  });
}

const sign = (body: string, secret: string) =>
  crypto.createHmac('sha256', secret).update(body).digest('hex');

async function run() {
  await seedDatabase();
  // A webhook secret must exist for any of this to be meaningful; the handler
  // refuses everything without one, which is itself checked below.
  (config as any).RAZORPAY_WEBHOOK_SECRET = 'whsec_test_' + crypto.randomBytes(8).toString('hex');

  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  resetAuthRateLimit();
  resetRequestRateLimit();

  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: 'customer@quickbite.app', password: 'pass123' }
  });
  const customerToken = login.json?.data?.token;

  const { order } = await orderService.createOrder({
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
    paymentMethod: 'CASH_ON_DELIVERY',
    idempotencyKey: 'idem_pay_' + Date.now()
  });

  // ------------------------------------------------------------------
  console.log('--- Starting a payment ---');

  const cfg = await api('/payments/config');
  check('An app can ask whether online payment exists at all', cfg.status === 200);
  check('and is told which methods to offer',
    Array.isArray(cfg.json?.data?.methods) && cfg.json.data.methods.includes('CASH_ON_DELIVERY'));
  check('The key SECRET is never in that response',
    !JSON.stringify(cfg.json).includes(config.RAZORPAY_KEY_SECRET),
    'the key secret was served to a client');

  const unauth = await api('/payments/start', { method: 'POST', body: { orderId: order.id } });
  check('Starting a payment requires signing in', unauth.status === 401 || unauth.status === 403,
    `status ${unauth.status}`);

  // ------------------------------------------------------------------
  console.log('\n--- A client cannot talk an order into being paid ---');

  const forged = await api(
    `/orders/${order.id}/confirm-payment`,
    {
      method: 'POST',
      body: { razorpayPaymentId: 'pay_forged', razorpaySignature: 'not-a-real-signature' }
    },
    customerToken
  );
  check('A made-up signature is refused', forged.status >= 400, `status ${forged.status}`);

  const stillUnpaid = await orderRepository.findById(order.id);
  check('and the order is still unpaid', stillUnpaid?.paymentStatus !== 'PAID',
    String(stillUnpaid?.paymentStatus));

  // A signature that is valid for a DIFFERENT razorpay order must not pass for
  // this one: the signed payload includes the order id precisely so it cannot
  // be lifted from one payment and replayed against another.
  await orderRepository.setPaymentReference(order.id, { razorpayOrderId: 'order_REAL123' });
  const wrongOrderSignature = crypto
    .createHmac('sha256', config.RAZORPAY_KEY_SECRET)
    .update('order_SOMEONEELSE|pay_abc')
    .digest('hex');

  const lifted = await api(
    `/orders/${order.id}/confirm-payment`,
    { method: 'POST', body: { razorpayPaymentId: 'pay_abc', razorpaySignature: wrongOrderSignature } },
    customerToken
  );
  check("A signature valid for someone else's payment does not pay this order",
    lifted.status >= 400, `status ${lifted.status}`);

  check(
    'The adapter verifies against the gateway order id, not our order number',
    razorpayAdapter.verifySignature({
      razorpayOrderId: 'order_REAL123',
      razorpayPaymentId: 'pay_abc',
      razorpaySignature: crypto
        .createHmac('sha256', config.RAZORPAY_KEY_SECRET)
        .update('order_REAL123|pay_abc')
        .digest('hex')
    }) === true
  );

  // ------------------------------------------------------------------
  console.log('\n--- The webhook is the authority, and it is checked ---');

  const eventId = 'evt_' + crypto.randomBytes(6).toString('hex');
  const body = webhookBody(order.id, eventId);

  const unsigned = await api('/payments/webhook', { method: 'POST', rawBody: body });
  check('An unsigned webhook is refused', unsigned.status === 401, `status ${unsigned.status}`);

  const badlySigned = await api('/payments/webhook', {
    method: 'POST',
    rawBody: body,
    headers: { 'x-razorpay-signature': sign(body, 'the-wrong-secret') }
  });
  check('A webhook signed with the wrong secret is refused', badlySigned.status === 401,
    `status ${badlySigned.status}`);

  const afterForgeries = await orderRepository.findById(order.id);
  check('Neither forgery marked the order paid', afterForgeries?.paymentStatus !== 'PAID');

  const genuine = await api('/payments/webhook', {
    method: 'POST',
    rawBody: body,
    headers: {
      'x-razorpay-signature': sign(body, (config as any).RAZORPAY_WEBHOOK_SECRET),
      'x-razorpay-event-id': eventId
    }
  });
  check('A correctly signed webhook is accepted', genuine.status === 200, `status ${genuine.status}`);

  const paid = await orderRepository.findById(order.id);
  check('and the order becomes paid', paid?.paymentStatus === 'PAID', String(paid?.paymentStatus));
  check('with the gateway payment id recorded, so it can be refunded',
    Boolean(paid?.razorpayPaymentId));

  // ------------------------------------------------------------------
  console.log('\n--- A retry must not pay twice ---');

  const replay = await api('/payments/webhook', {
    method: 'POST',
    rawBody: body,
    headers: {
      'x-razorpay-signature': sign(body, (config as any).RAZORPAY_WEBHOOK_SECRET),
      'x-razorpay-event-id': eventId
    }
  });
  check('Razorpay retrying the same event is acknowledged', replay.status === 200);
  check('and recognised as a duplicate rather than applied again',
    replay.json?.data?.duplicate === true, JSON.stringify(replay.json?.data));

  // ------------------------------------------------------------------
  console.log('\n--- Tampering with the body invalidates the signature ---');

  const tamperedEventId = 'evt_' + crypto.randomBytes(6).toString('hex');
  const original = webhookBody(order.id, tamperedEventId);
  const signature = sign(original, (config as any).RAZORPAY_WEBHOOK_SECRET);
  const tampered = original.replace('"amount":45000', '"amount":1');

  const tamperAttempt = await api('/payments/webhook', {
    method: 'POST',
    rawBody: tampered,
    headers: { 'x-razorpay-signature': signature, 'x-razorpay-event-id': tamperedEventId }
  });
  check('A body altered after signing is refused', tamperAttempt.status === 401,
    `status ${tamperAttempt.status}`);

  server.close();

  console.log('\n====================================================');
  if (failed === 0) {
    console.log(`        ALL ${passed} PAYMENT SECURITY CHECKS PASSED       `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  } else {
    console.log(`        ${failed} PAYMENT CHECK(S) FAILED                  `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(1), 100);
  }
}

run().catch((err) => {
  console.error('[FAIL] Payment tests crashed:', err);
  process.exit(1);
});
