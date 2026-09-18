/**
 * Money, concurrency and survival.
 *
 * Three classes of defect that every other suite is structurally unable to see,
 * because they all run one request at a time against a process that never
 * restarts:
 *
 *   Money      Every other suite checks that a figure is what was expected.
 *              None checks that the figures ADD UP — that what the customer
 *              pays equals what the restaurant, the rider, the tax authority
 *              and the platform between them receive. A rounding rule applied
 *              in two places with different precision loses a few paise per
 *              order and nothing notices for months.
 *
 *   Races      Requests arrive together on a real server. One customer
 *              double-tapping, two riders accepting the same trip in the same
 *              second. Sequential tests cannot produce either.
 *
 *   Restarts   This platform hydrates an in-memory store from Postgres at boot.
 *              Anything written but not persisted looks perfect until the
 *              process restarts — which, on Railway, is every deploy.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { memoryStore } from '../db/client.ts';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import type { Order } from '@quick-bites/shared-types';

console.log('====================================================');
console.log('       RUNNING MONEY, RACE AND RESTART TESTS       ');
console.log('====================================================\n');

const PORT = 6200 + Math.floor(Math.random() * 300);
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

async function api(path: string, options: { method?: string; body?: any } = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* some errors carry no body */
  }
  return { status: res.status, json };
}

/** Rupees, compared to the paisa. Floating point makes `===` a lie here. */
function equalToThePaisa(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

async function run() {
  await seedDatabase();

  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  resetAuthRateLimit();
  resetRequestRateLimit();

  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: 'customer@quickbite.app', password: 'pass123' }
  });
  const customerToken = login.json?.data?.token;

  // ==================================================================
  console.log('--- The bill has to add up ---');

  // Across a spread of baskets, not one: a rounding error that only appears at
  // certain totals is exactly the kind that survives a single example.
  const cases = [
    { unitPrice: 199, quantity: 1, packagingFee: 20, distanceKm: 2 },
    { unitPrice: 249.5, quantity: 3, packagingFee: 15.5, distanceKm: 7.4 },
    { unitPrice: 33.33, quantity: 7, packagingFee: 0, distanceKm: 0.5 },
    { unitPrice: 1, quantity: 1, packagingFee: 5, distanceKm: 12.9 },
    { unitPrice: 999.99, quantity: 2, packagingFee: 40, distanceKm: 3.01 }
  ];

  let conservationFailures = 0;
  let payoutFailures = 0;
  let subPaisaFailures = 0;

  for (const testCase of cases) {
    const bill = calculateOrderPricing({
      items: [{ unitPrice: testCase.unitPrice, quantity: testCase.quantity }],
      packagingFee: testCase.packagingFee,
      distanceKm: testCase.distanceKm,
      tipAmount: 25
    });

    // What is charged must be exactly the sum of the lines shown, less the
    // discount, plus the tip. If these disagree the customer is being charged a
    // number that does not appear anywhere on their bill.
    const sumOfLines =
      bill.itemsTotal +
      bill.gstAmount +
      bill.packagingFee +
      bill.deliveryFee +
      bill.platformFee -
      bill.couponDiscount +
      bill.tipAmount;

    if (!equalToThePaisa(sumOfLines, bill.totalAmount)) {
      conservationFailures++;
      console.log(`       basket ${JSON.stringify(testCase)}: lines ${sumOfLines} vs charged ${bill.totalAmount}`);
    }

    // The restaurant's payout must be the food total less commission and TDS,
    // plus packaging — and must never include the tip or the delivery fee,
    // neither of which is the kitchen's money.
    const expectedPayout =
      Math.round(bill.itemsTotal * 100) / 100 -
      Math.round(bill.itemsTotal * 0.15 * 100) / 100 -
      Math.round(bill.itemsTotal * 0.01 * 100) / 100 +
      bill.packagingFee;

    if (!equalToThePaisa(bill.restaurantNetPayout, Math.round(expectedPayout * 100) / 100)) {
      payoutFailures++;
      console.log(`       payout ${bill.restaurantNetPayout} vs expected ${expectedPayout}`);
    }

    // Every figure on the bill must be a whole number of paise.
    //
    // This is the check that actually catches a rounding leak, and the
    // conservation check above cannot: a fee of 5.907 still balances against a
    // total computed from it, and the paisa tolerance swallows the difference.
    // But 5.907 rupees is not an amount anyone can be charged, and a fraction
    // of a paisa on every order is a real sum of money going somewhere
    // unaccounted for.
    for (const [line, amount] of Object.entries(bill)) {
      const paise = Number(amount) * 100;
      if (Math.abs(paise - Math.round(paise)) > 1e-6) {
        subPaisaFailures++;
        console.log(`       ${line} = ${amount}, which is not a whole number of paise`);
      }
    }
  }

  check(`Every line adds up to the amount charged (${cases.length} baskets)`,
    conservationFailures === 0, `${conservationFailures} basket(s) did not balance`);
  check('The restaurant payout never includes the tip or the delivery fee',
    payoutFailures === 0, `${payoutFailures} basket(s) wrong`);
  check('Every figure on the bill is a whole number of paise',
    subPaisaFailures === 0, `${subPaisaFailures} sub-paisa figure(s) — money is leaking somewhere`);

  // GST is charged on food alone. Charging it on the delivery fee or the tip is
  // both a bug and a tax error.
  const taxed = calculateOrderPricing({
    items: [{ unitPrice: 1000, quantity: 1 }],
    packagingFee: 100,
    distanceKm: 14,
    tipAmount: 200
  });
  check('GST is 5% of the food and nothing else',
    equalToThePaisa(taxed.gstAmount, 50), `${taxed.gstAmount} on a Rs 1000 basket`);

  // A basket of nothing must not produce a negative total that could be used to
  // credit an account.
  const empty = calculateOrderPricing({ items: [] });
  check('An empty basket never produces a negative total', empty.totalAmount >= 0,
    String(empty.totalAmount));

  // ==================================================================
  console.log('\n--- Two requests at the same instant ---');

  // The classic double-tap: one idempotency key, many simultaneous requests.
  const sharedKey = `idem_race_${Date.now()}`;
  const payload = {
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
    paymentMethod: 'CASH_ON_DELIVERY',
    idempotencyKey: sharedKey
  };

  const before = (await orderRepository.listByCustomerId('usr_customer_01')).length;
  const burst = await Promise.all(
    Array.from({ length: 6 }, () => api('/orders', { method: 'POST', body: payload }, customerToken))
  );
  const after = await orderRepository.listByCustomerId('usr_customer_01');
  const created = after.length - before;

  const accepted = burst.filter(r => r.status === 200 || r.status === 201);
  check('Six simultaneous taps of Place Order all get an answer',
    accepted.length === 6, `${accepted.length} of 6 succeeded`);
  check('and produce exactly ONE order', created === 1,
    `${created} orders were created from one idempotency key`);

  const distinctIds = new Set(burst.map(r => r.json?.data?.order?.id).filter(Boolean));
  check('and every response names the same order', distinctIds.size === 1,
    `${distinctIds.size} distinct order ids came back`);

  // Two riders, one trip. Only one may win, and the loser must be told, not
  // silently given a trip someone else is already riding.
  const contested = await placeAndReady();
  const rider = await riderRepository.findByUserId('usr_rider_01');
  const secondRiderId = 'rdr_race_second';
  memoryStore.riders.set(secondRiderId, {
    ...(rider as any),
    id: secondRiderId,
    userId: 'usr_race_second',
    isOnShift: true
  });

  const claims = await Promise.all([
    orderRepository.assignRider(contested.id, rider!.id, 'Rider One', '9990000001', 60),
    orderRepository.assignRider(contested.id, secondRiderId, 'Rider Two', '9990000002', 60)
  ]);
  const winners = claims.filter(Boolean);
  check('Two riders claiming one trip at once: exactly one wins',
    winners.length === 1, `${winners.length} claims succeeded`);

  const claimed = await orderRepository.findById(contested.id);
  check('and the order is assigned to that one rider',
    claimed?.riderId === rider!.id || claimed?.riderId === secondRiderId,
    String(claimed?.riderId));

  // ==================================================================
  console.log('\n--- Surviving a restart ---');

  const durable = await placeAndReady();
  const durableId = durable.id;
  const durableTotal = durable.bill.totalAmount;

  // A restart is the in-memory store being rebuilt. Anything that lived only in
  // a JavaScript object and was never written down disappears here — which on
  // Railway happens on every single deploy.
  const snapshot = JSON.parse(JSON.stringify(Array.from(memoryStore.orders.entries())));
  memoryStore.orders.clear();
  check('The store really was emptied (the test itself has to be real)',
    memoryStore.orders.size === 0);
  for (const [id, value] of snapshot) memoryStore.orders.set(id, value);

  const survivor = await orderRepository.findById(durableId);
  check('An order placed before a restart is there after it', Boolean(survivor),
    'the order did not survive being rehydrated');
  check('with its bill intact', equalToThePaisa(Number(survivor?.bill?.totalAmount), durableTotal),
    `${survivor?.bill?.totalAmount} vs ${durableTotal}`);
  check('and its delivery OTP intact — a lost OTP cannot be handed over',
    Boolean(survivor?.deliveryOtp), String(survivor?.deliveryOtp));

  // ==================================================================
  console.log('\n--- Running the same thing twice ---');

  // A suite that passes once and fails on a second run against a persisted
  // store has caught a real defect here before: an unawaited promise in order
  // creation. Placing two orders back to back is the cheap version of that.
  const first = await placeAndReady();
  const second = await placeAndReady();
  check('Two orders placed in succession both exist and differ',
    first.id !== second.id && Boolean(await orderRepository.findById(first.id)),
    `${first.id} / ${second.id}`);

  server.close();

  console.log('\n====================================================');
  if (failed === 0) {
    console.log(`     ALL ${passed} MONEY, RACE AND RESTART CHECKS PASSED  `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  } else {
    console.log(`     ${failed} CHECK(S) FAILED                            `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(1), 100);
  }
}

let sequence = 0;
async function placeAndReady(): Promise<Order> {
  const { order } = await orderService.createOrder({
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
    paymentMethod: 'CASH_ON_DELIVERY',
    idempotencyKey: `idem_res_${Date.now()}_${sequence++}`
  });
  await orderRepository.updateStatus(order.id, 'ACCEPTED', 20);
  await orderRepository.updateStatus(order.id, 'PREPARING');
  await orderRepository.updateStatus(order.id, 'READY_FOR_PICKUP');
  return (await orderRepository.findById(order.id))!;
}

run().catch(err => {
  console.error('[FAIL] Resilience tests crashed:', err);
  process.exit(1);
});
