/**
 * Two ways money was promised and never moved, and the reason neither showed up.
 *
 * -------------------------------------------------------------------------
 * A THIRD CANCELLATION
 * -------------------------------------------------------------------------
 * There were three implementations of cancelling an order. Two agreed. The one an
 * ADMINISTRATOR used set the status by hand, credited `walletRepository` — the
 * customer wallet nobody can spend and no payout reads — marked the order REFUNDED,
 * and posted NOTHING to the ledger. No gateway refund, no refund case, no push.
 *
 * So the customer was told their money was back, the money stayed at Razorpay, and
 * no record anywhere said it was owed. That is precisely the lie `refunds.ts` was
 * written to make impossible, reached through the screen an operator uses most.
 *
 * -------------------------------------------------------------------------
 * AND EVERY RIDER BONUS EVER EARNED
 * -------------------------------------------------------------------------
 * Incentives were credited to the same dead wallet, with a `paidAt` written beside
 * them — which the rider's own Earnings screen reads and shows as PAID. Nothing in
 * `modules/payments` has ever read that wallet.
 *
 * Both defects share a shape worth naming: the money was recorded as SETTLED in a
 * place nothing spends from. A test asserting "the wallet went up" would have
 * passed on both. So every check here asserts the LEDGER, which is the only record
 * a payout run consults, and asserts the wallet did NOT move.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise } from '../modules/payments/money.ts';
import { bookCapture, customerPrepaidPaise } from '../modules/payments/capture.ts';
import { gatewayReceivablePaise } from '../modules/payments/gatewaySettlements.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { evaluateIncentives } from '../modules/riders/riderMetrics.ts';
import { backfillIncentiveAwards, incentivePosted } from '../modules/payments/incentives.ts';
import { duesFor } from '../modules/payments/payouts.ts';
import { setIncentiveSettings } from '../modules/payments/incentiveConfig.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { scanForUnsavedWrites, ALLOWED_WITHOUT_SAVE } from './helpers/persistenceScan.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 5241;
const API = `http://127.0.0.1:${PORT}/api`;

console.log('====================================================');
console.log('  MONEY THAT WAS PROMISED AND NEVER MOVED           ');
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
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}

type Sent = { userId: string; title: string; body: string; data?: any };
let sent: Sent[] = [];
const realSend = fcmDispatcher.sendPushNotification.bind(fcmDispatcher);
function captureSends() {
  sent = [];
  (fcmDispatcher as any).sendPushNotification = async (payload: any) => {
    sent.push({ userId: payload.userId, title: payload.title, body: payload.body, data: payload.data });
    return { ...payload, sentAt: new Date().toISOString() };
  };
}
const ofType = (type: string) => sent.filter(s => s.data?.type === type);

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

const RIDER = 'rdr_money_1';
const RIDER_USER = 'usr_rider_money_1';
const CUSTOMER = 'usr_cust_money_1';
const RESTAURANT = 'rst_money_1';

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

/** A gateway that accepts a reversal, and a record of whether it was asked. */
let refundAsked: Array<{ paymentId: string; amountPaise?: number }> = [];
const realRefund = razorpayAdapter.refund;
(razorpayAdapter as any).refund = async (paymentId: string, amountInPaise?: number) => {
  refundAsked.push({ paymentId, amountPaise: amountInPaise });
  return { id: `rfnd_${paymentId}`, status: 'processed' };
};

try {
  const admin = await login('admin@quickbite.app');

  /* ================================================================ *
   *  ONE CANCELLATION                                                 *
   * ================================================================ */
  console.log('-- An administrator cancelling a paid order');

  resetLedgerForTesting();
  resetConfigsForTesting();

  const paidOrder: any = {
    id: 'ord_money_cancel',
    orderNumber: 'QB-960001',
    customerId: CUSTOMER,
    customerName: 'Priya Verma',
    customerPhone: '9800000123',
    restaurantId: RESTAURANT,
    restaurantName: 'Nandini Kitchen',
    status: 'ORDER_PLACED',
    paymentMethod: 'RAZORPAY_SANDBOX',
    paymentStatus: 'PAID',
    razorpayPaymentId: 'pay_money_cancel',
    items: [{ dishId: 'd1', name: 'Biryani', unitPrice: 300, quantity: 1 }],
    bill: { totalAmount: 300, itemsTotal: 260, packagingFee: 10, deliveryFee: 30 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  memoryStore.orders.set(paidOrder.id, paidOrder);
  bookCapture(paidOrder, toPaise(300));

  const beforeReceivable = gatewayReceivablePaise();
  const beforePrepaid = customerPrepaidPaise();
  const walletBefore = (memoryStore.users.get(CUSTOMER) as any)?.walletBalance ?? 0;
  const refundCasesBefore = memoryStore.refundRequests.size;

  refundAsked = [];
  captureSends();
  const cancelled = await api(
    `/admin/orders/${paidOrder.id}/cancel`,
    { method: 'POST', body: { reason: 'Duplicate order, customer rang in' } },
    admin.token
  );
  await new Promise(r => setTimeout(r, 40));

  it('THE ADMIN CANCELLATION ACTUALLY ASKS THE GATEWAY FOR THE MONEY BACK', () => {
    /*
     * The old route never spoke to the gateway at all. It credited a wallet and
     * wrote REFUNDED, so the only thing that changed was what the screen said.
     */
    assert.equal(cancelled.status, 200, `status ${cancelled.status}: ${JSON.stringify(cancelled.json).slice(0, 250)}`);
    assert.equal(refundAsked.length, 1, `the gateway was asked ${refundAsked.length} times`);
    assert.equal(refundAsked[0].paymentId, 'pay_money_cancel');
    assert.equal(refundAsked[0].amountPaise, toPaise(300));
  });

  it('and the books come back to where they were', () => {
    /*
     * A capture put Rs 300 at the gateway and Rs 300 into what we owe the customer
     * in food. Cancelling reverses both, and neither is a loss: money came in, no
     * food was made, the money went back.
     */
    assert.equal(gatewayReceivablePaise(), beforeReceivable - toPaise(300),
      'the gateway is still shown as holding refunded money');
    assert.equal(customerPrepaidPaise(), beforePrepaid - toPaise(300),
      'the platform still owes food for a cancelled order');
    assert.equal(ledger.balanceOf('REFUNDS_PAID'), 0,
      'a cancelled order was booked as a loss');
    assert.equal(ledger.audit().balanced, true);
  });

  it('and a refund CASE exists, so it is somebody’s job if it fails', () => {
    assert.equal(
      memoryStore.refundRequests.size,
      refundCasesBefore + 1,
      'no refund case was opened, so a failure would have vanished with the HTTP call'
    );
  });

  it('and NOTHING went into the wallet nobody can spend', () => {
    /*
     * The assertion that would have failed before, and the one a check written
     * around the old behaviour would have got backwards. Crediting the wallet is
     * not a smaller version of refunding somebody — it is recording a settlement
     * in a place no money ever leaves.
     */
    const walletAfter = (memoryStore.users.get(CUSTOMER) as any)?.walletBalance ?? 0;
    assert.equal(walletAfter, walletBefore, 'a refund was credited to the dead wallet');
  });

  it('and the customer is told, by the path that knows the money moved', () => {
    assert.ok(ofType('REFUND_SENT').length >= 1, 'the customer was not told their refund was sent');
    assert.ok(ofType('CANCELLED').length >= 1, 'the customer was not told their order was cancelled');
  });

  it('and the order is not left claiming a refund that had not happened', () => {
    const after = memoryStore.orders.get(paidOrder.id) as any;
    assert.ok(
      after.status === 'REFUNDED' || after.status === 'CANCELLED',
      `the order is ${after.status}`
    );
    // REFUNDED is only reachable when the gateway settled it, which it did here.
    assert.equal(after.refundRequestId?.length > 0, true, 'the order does not point at its refund case');
  });

  /* ================================================================ *
   *  A BONUS IS MONEY OWED                                            *
   * ================================================================ */
  console.log('\n-- A rider hitting an incentive target');

  resetLedgerForTesting();
  memoryStore.riderIncentives.clear();
  memoryStore.riders.set(RIDER, {
    id: RIDER,
    userId: RIDER_USER,
    fullName: 'Rahul Sharma',
    codCashInHand: 0,
    ratingAverage: 4.9,
    ratingCount: 30
  } as any);
  memoryStore.users.set(RIDER_USER, {
    id: RIDER_USER,
    email: 'rahul.money@example.test',
    fullName: 'Rahul Sharma',
    role: 'rider',
    walletBalance: 0
  } as any);

  // Eight deliveries today: the DAILY_8 target, worth Rs 120.
  const nowIso = new Date().toISOString();
  for (let i = 0; i < 8; i++) {
    memoryStore.orders.set(`ord_inc_${i}`, {
      id: `ord_inc_${i}`,
      orderNumber: `QB-9610${i}`,
      riderId: RIDER,
      restaurantId: RESTAURANT,
      customerId: CUSTOMER,
      status: 'DELIVERED',
      deliveredAt: nowIso,
      updatedAt: nowIso,
      paymentMethod: 'RAZORPAY_SANDBOX',
      paymentStatus: 'PAID',
      bill: { totalAmount: 200, itemsTotal: 160 }
    } as any);
  }

  /*
   * Switched on the way an administrator switches it on.
   *
   * Every bonus ships DISABLED — the owner once paid a Rs 700 bonus nobody had
   * approved, and that safeguard is why. So the check enables it through
   * `setIncentiveSettings` rather than reaching past the guard, which would also
   * have meant testing a path production cannot reach.
   */
  setIncentiveSettings([{ code: 'DAILY_8', enabled: true, reward: 120, target: 8 }], 'usr_admin_01');

  const riderWalletBefore = (memoryStore.users.get(RIDER_USER) as any).walletBalance;
  const payableBefore = ledger.balanceOf(accountFor('RIDER_PAYABLE', RIDER));

  const result = await evaluateIncentives(memoryStore.riders.get(RIDER) as any, { award: true });
  const awarded = result.newlyAwarded.find(i => i.code === 'DAILY_8');

  it('HITTING A TARGET PUTS THE BONUS INTO WHAT THE RIDER IS OWED', () => {
    /*
     * The ledger, not the wallet. `RIDER_PAYABLE` is the only account a payout run
     * reads, so this is the difference between a bonus the rider receives and a
     * number on a screen.
     */
    assert.ok(awarded, `DAILY_8 was not awarded: ${JSON.stringify(result.incentives.map(i => [i.code, i.progress]))}`);
    assert.equal(
      ledger.balanceOf(accountFor('RIDER_PAYABLE', RIDER)),
      payableBefore + toPaise(120),
      'the bonus did not reach what the rider is owed'
    );
    assert.equal(ledger.balanceOf('EXPENSE_RIDER_INCENTIVE'), toPaise(120),
      'the bonus was not recorded as a cost to the platform');
    assert.equal(ledger.audit().balanced, true);
  });

  it('and NOT into the wallet, which no payout has ever read', () => {
    const after = (memoryStore.users.get(RIDER_USER) as any).walletBalance;
    assert.equal(after, riderWalletBefore, 'the bonus went to the wallet again');
  });

  it('A BONUS IS AN EXPENSE, so it grows with a debit', () => {
    // Omitted from the debit-positive set, every rupee of incentive the platform
    // has promised would report as a NEGATIVE expense.
    assert.equal(ledger.increasesWithDebit('EXPENSE_RIDER_INCENTIVE'), true);
  });

  it('and the next payout run carries it', () => {
    /*
     * The whole point of paying it as PAYABLE rather than sending it here. It goes
     * out through the same rails, the same maker-checker rule and the same verified
     * account as every other rupee the rider earns.
     */
    createVersion({ riderHoldDays: 0, minPayoutAmount: 1 }, { userId: 'usr_admin_01' }, 'Release now');
    const dues = duesFor('RIDER', RIDER, 'Rahul Sharma');
    assert.ok(
      dues.payablePaise >= toPaise(120),
      `the bonus is not payable: ${JSON.stringify({ payable: dues.payablePaise, blocked: dues.blockedReason })}`
    );
  });

  it('and awarding the same target twice adds nothing', () => {
    // The award row is keyed per rider per period, and the ledger entry is keyed on
    // the award. Two locks, because this one pays money out.
    const before = ledger.balanceOf(accountFor('RIDER_PAYABLE', RIDER));
    void evaluateIncentives(memoryStore.riders.get(RIDER) as any, { award: true });
    assert.equal(ledger.balanceOf(accountFor('RIDER_PAYABLE', RIDER)), before);
  });

  console.log('\n-- The bonuses riders were already told they had been paid');

  resetLedgerForTesting();
  memoryStore.riderIncentives.clear();
  memoryStore.riderIncentives.set('inc_old_1', {
    id: 'inc_old_1',
    riderId: RIDER,
    code: 'WEEK_20',
    reward: 400,
    paidAt: new Date(Date.now() - 20 * 86_400_000).toISOString()
  } as any);

  const backfilled = backfillIncentiveAwards();

  it('THE BACKFILL RECORDS A DEBT THAT WAS ALREADY OWED', () => {
    /*
     * Not rewriting history. These riders were TOLD a bonus had been settled and it
     * never was. Leaving them out would mean the only riders ever paid an incentive
     * are the ones who earn one after today — everybody before quietly written off
     * by the very fix that admits the money was owed.
     */
    assert.equal(backfilled.posted, 1, `posted ${backfilled.posted}`);
    assert.equal(incentivePosted('inc_old_1'), true);
    assert.equal(
      ledger.balanceOf(accountFor('RIDER_PAYABLE', RIDER)),
      toPaise(400),
      'a bonus the rider had been shown as paid is still not owed to them'
    );
  });

  it('and running it again posts nothing', () => {
    const again = backfillIncentiveAwards();
    assert.equal(again.posted, 0, `posted ${again.posted} on a second run`);
    assert.equal(ledger.balanceOf(accountFor('RIDER_PAYABLE', RIDER)), toPaise(400));
  });

  /* ================================================================ *
   *  A WRITE THAT SURVIVES A RESTART                                  *
   * ================================================================ */
  console.log('\n-- Every write to the store is actually saved');

  const unsaved = scanForUnsavedWrites('src');

  it('NO MODULE WRITES THE STORE WITHOUT SAVING IT', () => {
    /*
     * `memoryStore` is Maps: a write is correct in memory and gone on the next
     * restart unless something schedules a save. Nothing fails when that is
     * forgotten — every check passes and every screen looks right — and it
     * reappears weeks later as a setting that resets itself after a deploy, which
     * reads as a bug in the setting.
     *
     * It had already happened twice. The digest's sent-slot marker, whose entire
     * purpose is to survive a restart. And the notification switches, which
     * persisted only because the route setting them happened to write an audit row
     * afterwards — working for a reason with nothing to do with the code that
     * needed it, which is the more dangerous of the two.
     */
    assert.equal(
      unsaved.length,
      0,
      `these write the store and never save it: ${unsaved.map(u => u.file).join(', ')}`
    );
  });

  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-persist-'));
  fs.writeFileSync(
    path.join(probeDir, 'offender.ts'),
    'export function f() { memoryStore.settings.set("k", 1); }\n'
  );
  fs.writeFileSync(
    path.join(probeDir, 'innocent.ts'),
    'export function g() { memoryStore.settings.set("k", 1); triggerAutoSave(); }\n'
  );
  const probe = scanForUnsavedWrites(probeDir);

  it('and the scanner can still FIND one, so a clean result means something', () => {
    /*
     * The check above passes when the app is clean AND when the scanner has quietly
     * stopped matching — a renamed helper, a new way of writing the call. Those are
     * the same output and opposite meanings, so the scanner is pointed at a file
     * that is definitely wrong and one that is definitely fine.
     */
    assert.equal(probe.length, 1, `the scanner found ${probe.length} of one planted offender`);
    assert.equal(probe[0].file, 'offender.ts');
  });

  it('and every allowlisted file gives a reason', () => {
    // An allowlist without reasons becomes a place to put anything inconvenient.
    assert.ok(ALLOWED_WITHOUT_SAVE.length > 0);
    for (const entry of ALLOWED_WITHOUT_SAVE) {
      assert.ok(entry.why && entry.why.length > 20, `${entry.file} has no stated reason`);
    }
  });

  fs.rmSync(probeDir, { recursive: true, force: true });
} finally {
  (fcmDispatcher as any).sendPushNotification = realSend;
  (razorpayAdapter as any).refund = realRefund;
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
