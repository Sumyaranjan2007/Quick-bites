/**
 * v9 QA round 1 (26 Sep), server fixes: V9-16, V9-8, V9-2, V9-3.
 *
 *   V9-16  The rider's "Settlement & payment history" (GET /riders/settlements)
 *          and the admin rider profile read the ledger, so a rider paid from the
 *          Pay screen is shown as paid. The same rider is paid TWICE, because
 *          the second payment is where money defects on this platform hide.
 *   V9-8   A restaurant's payment row carries its sales, commission and TDS.
 *   V9-2   A dish is suggested for its own name, not its restaurant's cuisine.
 *   V9-3   An offer still on the rider's screen does not lower acceptance.
 *
 * Every check calls the route the installed app calls, with a real 7-day hold.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { recordOrderEarnings } from '../modules/payments/earnings.ts';
import { draftPayout, executePayout } from '../modules/payments/payouts.ts';
import { syncService } from '../modules/search/syncService.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5291;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';

console.log('====================================================');
console.log('  v9 QA ROUND 1: RIDER PAID, PAYMENT ROWS, SEARCH   ');
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

const token = (sub: string, role: string) =>
  jwt.sign({ sub, role }, config.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });

async function api(pathname: string, tok: string) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { Authorization: `Bearer ${tok}` },
    signal: AbortSignal.timeout(15000)
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await sleep(400);
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });

try {
  resetLedgerForTesting();
  resetConfigsForTesting();
  createVersion(
    { partnerHoldDays: 7, riderHoldDays: 7, minPayoutAmount: 1, codCashCeiling: 100000 },
    { userId: 'usr_admin_01' },
    'QA round 1: a real hold'
  );

  const rider: any = Array.from(memoryStore.riders.values())[0];
  const RIDER_ID = rider.id as string;
  const riderToken = token(rider.userId, 'rider');
  const partnerToken = token('usr_partner_01', 'restaurant_owner');
  const adminToken = token('usr_admin_01', 'super_admin');
  rider.codCashInHand = 0;

  for (const [ownerType, ownerId, name] of [
    ['RIDER', RIDER_ID, rider.fullName || 'Rider'],
    ['RESTAURANT', RESTAURANT_ID, 'Bangalore Biryani House']
  ] as const) {
    memoryStore.payeeAccounts.set(`acc_qa1_${ownerId}`, {
      id: `acc_qa1_${ownerId}`,
      ownerType,
      ownerId,
      ownerUserId: ownerType === 'RIDER' ? rider.userId : 'usr_partner_01',
      method: 'BANK',
      holderName: name,
      accountLast4: '4321',
      ifsc: 'SBIN0000001',
      validationStatus: 'VERIFIED',
      appliedAt: new Date().toISOString(),
      isDefault: true,
      createdAt: new Date().toISOString(),
      createdByUserId: 'usr_admin_01'
    } as any);
  }

  /** A delivered order, ten days ago (outside the hold), with its earnings posted. */
  let n = 0;
  function delivered(riderPayout: number, total: number) {
    n += 1;
    const at = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const order: any = {
      id: `ord_qa1_${n}_${crypto.randomUUID().slice(0, 6)}`,
      orderNumber: `QB-QA1-${n}`,
      idempotencyKey: crypto.randomUUID(),
      customerId: 'usr_customer_01',
      restaurantId: RESTAURANT_ID,
      riderId: RIDER_ID,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY_SANDBOX',
      razorpayPaymentId: `pay_qa1_${n}`,
      items: [],
      riderPayout,
      bill: {
        totalAmount: total,
        itemsTotal: total * 0.8,
        partnerItemsTotal: total * 0.8,
        packagingFee: 20,
        partnerPackagingFee: 20,
        commissionAmount: total * 0.12,
        tdsAmount: total * 0.01,
        deliveryFee: 30,
        platformFee: 5,
        gstAmount: 10,
        restaurantNetPayout: total * 0.67
      },
      createdAt: at,
      updatedAt: at,
      pickedUpAt: at,
      deliveredAt: at
    };
    memoryStore.orders.set(order.id, order);
    recordOrderEarnings(order, { byUserId: 'usr_admin_01', note: 'QA round 1 fixture' });
    return order;
  }

  async function payRider(reference: string) {
    const p = draftPayout({ ownerType: 'RIDER', ownerId: RIDER_ID, ownerName: 'Rider', actorUserId: 'usr_admin_01', rail: 'MANUAL_BANK' });
    await executePayout({ id: p.id, actorUserId: 'usr_admin_01', manualReference: reference });
    return p;
  }

  // -------------------------------------------------------------------
  console.log('-- V9-16: a rider paid from Pay is shown as paid, twice over');

  delivered(40, 300);
  const before = (await api('/riders/settlements', riderToken)).json?.data;
  it('Before any payment: Rs 40 pending, nothing paid', () => {
    assert.equal(before.summary.netPending, 40);
    assert.equal(before.summary.tripsAwaitingSettlement, 1);
    assert.equal(before.summary.paidToDate, 0);
  });

  await payRider('UTR-QA1-A');
  const afterFirst = (await api('/riders/settlements', riderToken)).json?.data;
  it('After the first payment: nothing pending, Rs 40 paid, with its reference', () => {
    assert.equal(afterFirst.summary.netPending, 0, JSON.stringify(afterFirst.summary));
    assert.equal(afterFirst.summary.tripsAwaitingSettlement, 0);
    assert.equal(afterFirst.summary.paidToDate, 40);
    const row = afterFirst.history.find((h: any) => h.reference === 'UTR-QA1-A');
    assert.ok(row, 'the payment is not in the history');
    assert.equal(row.status, 'PAID');
    assert.equal(row.netAmount, 40);
    assert.equal(row.tripsCompleted, 1);
  });

  delivered(55, 400);
  const midway = (await api('/riders/settlements', riderToken)).json?.data;
  it('New earnings after a payment are owed in full (the second payment is where it breaks)', () => {
    assert.equal(midway.summary.netPending, 55);
    assert.equal(midway.summary.paidToDate, 40);
  });

  await payRider('UTR-QA1-B');
  const afterSecond = (await api('/riders/settlements', riderToken)).json?.data;
  it('After the second payment: nothing pending, Rs 95 paid, two rows', () => {
    assert.equal(afterSecond.summary.netPending, 0);
    assert.equal(afterSecond.summary.paidToDate, 95);
    assert.equal(afterSecond.history.filter((h: any) => h.status === 'PAID').length, 2);
  });

  const profile = (await api(`/admin/drivers/${RIDER_ID}`, adminToken)).json?.data;
  it('The admin rider profile agrees: Rs 95 paid out, both payments listed', () => {
    assert.ok(profile, 'no rider profile');
    assert.equal(profile.stats.paidOut, 95);
    assert.equal((profile.payouts || []).filter((p: any) => p.status === 'PAID').length, 2);
  });

  // -------------------------------------------------------------------
  console.log('\n-- V9-8: a restaurant payment row carries its breakdown');

  const p = draftPayout({ ownerType: 'RESTAURANT', ownerId: RESTAURANT_ID, ownerName: 'BBH', actorUserId: 'usr_admin_01', rail: 'MANUAL_BANK' });
  await executePayout({ id: p.id, actorUserId: 'usr_admin_01', manualReference: 'UTR-QA1-R' });
  const partner = (await api(`/restaurants/${RESTAURANT_ID}/settlements`, partnerToken)).json?.data;
  const row = (partner?.history || []).find((h: any) => h.reference === 'UTR-QA1-R');
  it('The payment row shows sales, commission and TDS, not zeros', () => {
    assert.ok(row, 'payment row missing');
    assert.ok(row.grossSales > 0, JSON.stringify(row));
    assert.ok(row.commission > 0);
    assert.ok(row.tds > 0);
    assert.equal(row.ordersCount, 2);
    assert.equal(Math.round((row.grossSales - row.commission - row.tds) * 100) / 100, row.netAmount);
  });

  // -------------------------------------------------------------------
  console.log('\n-- V9-2: suggestions match the dish, not its restaurant');

  await syncService.startIndexing();
  const res = await fetch(`${API}/search/suggestions?q=biry`);
  const sugg = ((await res.json()) as any)?.data?.suggestions || [];
  it('"biry" suggests biryanis and not Paneer Butter Masala', () => {
    assert.ok(sugg.some((s: any) => /biryani/i.test(s.text)), JSON.stringify(sugg));
    assert.equal(sugg.some((s: any) => s.text === 'Paneer Butter Masala'), false, JSON.stringify(sugg));
  });
  const paneer = ((await (await fetch(`${API}/search/suggestions?q=butter`)).json()) as any)?.data?.suggestions || [];
  it('Control: the dish is still suggested for its own name', () => {
    assert.ok(paneer.some((s: any) => s.text === 'Paneer Butter Masala'), JSON.stringify(paneer));
  });
  const cuisine = ((await (await fetch(`${API}/search?q=Mughlai`)).json()) as any)?.data;
  it('Control: a restaurant is still found by its cuisine', () => {
    assert.ok(cuisine.restaurants.some((r: any) => r.id === RESTAURANT_ID));
  });
  syncService.stopIndexing();

  // -------------------------------------------------------------------
  console.log('\n-- V9-3: an unanswered offer does not lower acceptance');

  rider.offersReceived = 0;
  rider.offersAccepted = 0;
  const open: any = {
    ...memoryStore.orders.values().next().value,
    id: 'ord_qa1_open',
    orderNumber: 'QB-QA1-OPEN',
    status: 'READY_FOR_PICKUP',
    riderId: undefined,
    offeredToRiderIds: [RIDER_ID],
    declinedByRiderIds: []
  };
  memoryStore.orders.set(open.id, open);
  rider.offersReceived = 1;
  const dash = (await api('/riders/dashboard', riderToken)).json?.data;
  it('An offer still on screen is not counted against the rider', () => {
    assert.equal(dash.metrics.offersReceived, 0, JSON.stringify(dash.metrics));
    assert.equal(dash.metrics.acceptanceRate, 100);
  });
  open.declinedByRiderIds = [RIDER_ID];
  const dash2 = (await api('/riders/dashboard', riderToken)).json?.data;
  it('Control: once passed, it counts', () => {
    assert.equal(dash2.metrics.offersReceived, 1);
    assert.equal(dash2.metrics.acceptanceRate, 0);
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
