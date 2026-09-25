/**
 * Telling people their money arrived, and telling a customer what is happening.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT
 * -------------------------------------------------------------------------
 * For a platform whose whole job is paying everybody, the person being paid was
 * the one who never found out. `PAYOUT_SENT` existed as a ledger entry and an
 * audit line and nothing else — so a partner and a rider learned they had been
 * paid by checking their bank, or by ringing to ask about money that had already
 * arrived. One support call per payee per payday.
 *
 * The customer had the mirror of it. The admin is notified when a refund is
 * RAISED; the customer heard nothing when it was PAID. Of those two people,
 * exactly one is waiting for money.
 *
 * And two moments in a customer's own order passed silently: the kitchen taking
 * it on, and a rider being assigned. The first matters more than it looks,
 * because the live map appears at that moment — the thing the customer most
 * wants to look at opened and nobody said so.
 *
 * -------------------------------------------------------------------------
 * THE TWO WAYS THIS GOES WRONG THAT ARE WORSE THAN SILENCE
 * -------------------------------------------------------------------------
 * A message that LIES. A refund left PROCESSING announced as sent stops the
 * customer chasing it, and a refund nobody is chasing is one that quietly never
 * happens. A payout announced on approval rather than on sending says the money
 * is there when a gateway call still has to succeed.
 *
 * A message on the WRONG CHANNEL. The partner and rider apps each create exactly
 * one notification channel: a MAX-importance alarm that loops `new_order.wav`.
 * Channel sound and importance are fixed when the channel is created, so a "you
 * were paid" sent to it is indistinguishable from a new order — and a kitchen
 * that runs to the pass twice for a bank transfer starts ignoring the alarm that
 * matters. That is how a notification makes a platform worse.
 *
 * Both are checked below, and both were mutated to fail.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryStore } from '../db/client.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise } from '../modules/payments/money.ts';
import { resetConfigsForTesting, createVersion } from '../modules/payments/pricingConfig.ts';
import { recordOrderEarnings } from '../modules/payments/earnings.ts';
import {
  draftPayout,
  approvePayout,
  executePayout,
  findPayout,
  resetPayoutsForTesting
} from '../modules/payments/payouts.ts';
import { runPaymentsHealthCheck } from '../modules/payments/paymentsHealth.ts';
import { resetPayeeAccountsForTesting } from '../modules/payments/payeeAccounts.ts';
import { RAILS } from '../modules/payments/rails.ts';
import { sendRefund } from '../modules/payments/refunds.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

console.log('====================================================');
console.log('  MONEY REACHED YOU — AND SO DID THE NEWS           ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`[PASS] ${name}`);
    })
    .catch((err: any) => {
      failed++;
      console.log(`[FAIL] ${name}: ${err?.message || err}`);
    });
}

const ADMIN_A = 'usr_admin_a';
const ADMIN_B = 'usr_admin_b';
const RIDER = 'rdr_news_1';
const RIDER_USER = 'usr_rider_news_1';
const RESTAURANT = 'rst_news_1';
const RESTAURANT_OWNER = 'usr_owner_news_1';
const CUSTOMER = 'usr_customer_news_1';

/** The alarm channels. A payment must never arrive on either of these. */
const ALARM_CHANNELS = ['kitchen-orders', 'new-orders'];

/**
 * Pushes sent since the last clear, so a check reads only its own.
 *
 * The dispatcher keeps every notification it has ever built, so a check that
 * reads the whole history counts messages an earlier check caused and passes for
 * the wrong reason.
 */
function pushesSinceClear(type?: string) {
  const all = fcmDispatcher.getSentNotifications();
  return type ? all.filter(p => (p.data as any)?.type === type) : all;
}

function deliveredOrder(overrides: Record<string, any> = {}): any {
  return {
    id: `ord_news_${Math.random().toString(36).slice(2, 10)}`,
    orderNumber: 'QB-900001',
    restaurantId: RESTAURANT,
    riderId: RIDER,
    customerId: CUSTOMER,
    customerName: 'Priya Verma',
    status: 'DELIVERED',
    paymentMethod: 'RAZORPAY_SANDBOX',
    paymentStatus: 'PAID',
    razorpayPaymentId: 'pay_news_1',
    riderPayout: 40,
    pickedUpAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    deliveredAt: new Date().toISOString(),
    bill: {
      totalAmount: 580.9,
      itemsTotal: 500,
      packagingFee: 20,
      deliveryFee: 30,
      gstAmount: 25.9,
      platformFee: 5,
      commissionAmount: 75,
      tdsAmount: 5
    },
    ...overrides
  };
}

/** A verified, applied account, so a payout has somewhere to say it went. */
function giveVerifiedAccount(ownerType: 'RIDER' | 'RESTAURANT', ownerId: string, last4: string) {
  const id = `pay_acc_${ownerId}`;
  memoryStore.payeeAccounts.set(id, {
    id,
    ownerType,
    ownerId,
    ownerUserId: ownerType === 'RIDER' ? RIDER_USER : RESTAURANT_OWNER,
    method: 'BANK',
    holderName: 'Test Payee',
    accountLast4: last4,
    ifsc: 'HDFC0001234',
    validationStatus: 'VERIFIED',
    appliedAt: new Date().toISOString(),
    isDefault: true,
    createdAt: new Date().toISOString(),
    createdByUserId: ADMIN_A
  } as any);
}

/** Runs something with a gateway reversal standing in for the network call. */
async function withGatewayRefund(fn: () => Promise<unknown>): Promise<void> {
  const real = razorpayAdapter.refund;
  (razorpayAdapter as any).refund = async (paymentId: string) => ({
    id: `rfnd_${paymentId}`,
    status: 'processed'
  });
  try {
    await fn();
  } finally {
    (razorpayAdapter as any).refund = real;
  }
}

async function run(): Promise<void> {
  resetLedgerForTesting();
  resetConfigsForTesting();
  resetPayeeAccountsForTesting();
  resetPayoutsForTesting();
  memoryStore.riders.clear();
  memoryStore.orders.clear();
  memoryStore.restaurants.clear();

  memoryStore.riders.set(RIDER, {
    id: RIDER,
    userId: RIDER_USER,
    fullName: 'Rahul Sharma',
    codCashInHand: 0
  } as any);
  memoryStore.restaurants.set(RESTAURANT, {
    id: RESTAURANT,
    name: 'Nandini Kitchen',
    ownerId: RESTAURANT_OWNER
  } as any);

  giveVerifiedAccount('RIDER', RIDER, '4321');
  giveVerifiedAccount('RESTAURANT', RESTAURANT, '1234');

  // Everything owed comes from a delivered order, as it does in production.
  recordOrderEarnings(deliveredOrder());
  createVersion({ riderHoldDays: 0, partnerHoldDays: 0, minPayoutAmount: 1 }, { userId: ADMIN_A }, 'Release now');

  /* ================================================================ *
   *  A PAYOUT THAT LANDS                                              *
   * ================================================================ */

  await check('A payout reaching PAID tells the person whose money it is', async () => {
    fcmDispatcher.clearHistory();
    const payout = draftPayout({
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerName: 'Rahul Sharma',
      actorUserId: ADMIN_A,
      rail: 'MANUAL_BANK'
    });
    if (payout.state === 'AWAITING_APPROVAL') approvePayout(payout.id, ADMIN_B);

    const sent = await executePayout({
      id: payout.id,
      actorUserId: ADMIN_B,
      manualReference: 'UTR55667788'
    });
    assert.equal(sent.state, 'PAID', `the payout did not reach PAID, it is ${sent.state}`);

    // Not awaited by the payout path on purpose, so give the microtask a turn.
    await new Promise(r => setTimeout(r, 30));

    const paid = pushesSinceClear('PAYOUT_PAID');
    assert.equal(paid.length, 1, `expected one "you were paid", got ${paid.length}`);
    assert.equal(paid[0].userId, RIDER_USER,
      'the push went to the rider id rather than the user, which matches no device');
  });

  await check('and it says how much, and which account it went to', () => {
    const paid = pushesSinceClear('PAYOUT_PAID');
    assert.equal(paid.length, 1);
    assert.match(paid[0].body, /40/, `the amount is missing: ${paid[0].body}`);
    assert.match(paid[0].body, /4321/,
      `"you were paid" without the destination invites the question it exists to answer: ${paid[0].body}`);
  });

  await check('and it does NOT arrive on the alarm channel a new order uses', () => {
    const paid = pushesSinceClear('PAYOUT_PAID');
    assert.equal(paid.length, 1);
    /*
     * The rider app's only channel loops `new_order.wav` at MAX importance.
     * Channel sound is fixed at creation, so a payment on it is
     * indistinguishable from a trip — and a rider who is woken twice by a bank
     * transfer starts ignoring the alarm that pays them.
     */
    assert.equal(
      ALARM_CHANNELS.includes(paid[0].androidChannelId || ''),
      false,
      `a payment notification was sent to ${paid[0].androidChannelId}, which plays the order alarm`
    );
    // R2: the rider and partner apps create a quiet 'payments' channel
    // (normal importance, no sound) for exactly this.
    assert.equal(paid[0].androidChannelId, 'payments',
      'a payment must go by the quiet payments channel');
  });

  /* ================================================================ *
   *  A PAYOUT THAT DOES NOT LAND                                      *
   * ================================================================ */

  await check('A payout the gateway REFUSES tells the payee nothing', async () => {
    fcmDispatcher.clearHistory();
    recordOrderEarnings(deliveredOrder({ orderNumber: 'QB-900002' }));

    const payout = draftPayout({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Nandini Kitchen',
      actorUserId: ADMIN_A,
      rail: 'MANUAL_BANK'
    });
    if (payout.state === 'AWAITING_APPROVAL') approvePayout(payout.id, ADMIN_B);

    /*
     * The manual rail refuses to report SENT without a reference, and a refusal
     * it is sure about puts the payout back to APPROVED. Nothing reached a bank,
     * so nothing may be announced.
     *
     * This is also the check that a manual payout cannot be announced before
     * somebody records the reference: there is no path to PAID on this rail that
     * skips it.
     */
    await executePayout({ id: payout.id, actorUserId: ADMIN_B }).catch(() => null);
    await new Promise(r => setTimeout(r, 30));

    assert.equal(pushesSinceClear('PAYOUT_PAID').length, 0,
      'somebody was told they were paid money that never left the bank');
  });

  await check('and a payout that FAILS at the rail tells the payee nothing either', async () => {
    fcmDispatcher.clearHistory();
    recordOrderEarnings(deliveredOrder({ orderNumber: 'QB-900007' }));

    const payout = draftPayout({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Nandini Kitchen',
      actorUserId: ADMIN_A,
      rail: 'MANUAL_BANK'
    });
    if (payout.state === 'AWAITING_APPROVAL') approvePayout(payout.id, ADMIN_B);

    /*
     * A DIFFERENT OUTCOME FROM THE ONE ABOVE, AND THE CHECK ABOVE CANNOT REACH IT.
     *
     * A rail that THROWS is sure the money never moved, and the payout goes back
     * to APPROVED. A rail that RETURNS `FAILED` has actually spoken to a gateway
     * which declined — a closed account, a name mismatch — and that is the branch
     * where the admin is alerted and the payee must not be.
     *
     * The only way to reach it is for a rail to return FAILED, so the rail's own
     * `send` stands in for a gateway that declined. Restored afterwards, so no
     * later check inherits a broken rail.
     */
    const rail = RAILS.MANUAL_BANK;
    const realSend = rail.send;
    (rail as any).send = async () => ({
      status: 'FAILED' as const,
      reason: 'The beneficiary account is closed.'
    });
    try {
      const failed = await executePayout({
        id: payout.id,
        actorUserId: ADMIN_B,
        manualReference: 'UTR00000000'
      });
      assert.equal(failed.state, 'FAILED', `expected FAILED, got ${failed.state}`);
    } finally {
      (rail as any).send = realSend;
    }
    await new Promise(r => setTimeout(r, 30));

    assert.equal(pushesSinceClear('PAYOUT_PAID').length, 0,
      'a payee was told they were paid by a gateway that declined the transfer');
  });

  /* ================================================================ *
   *  A PAYOUT THAT WAS IN DOUBT AND TURNED OUT FINE                   *
   * ================================================================ */

  await check('A payout resolved from UNCERTAIN to PAID also tells the payee', async () => {
    fcmDispatcher.clearHistory();
    recordOrderEarnings(deliveredOrder({ orderNumber: 'QB-900008' }));

    const payout = draftPayout({
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerName: 'Rahul Sharma',
      actorUserId: ADMIN_A,
      rail: 'MANUAL_BANK'
    });
    if (payout.state === 'AWAITING_APPROVAL') approvePayout(payout.id, ADMIN_B);

    /*
     * A payout is UNCERTAIN when we asked and do not know — the request timed out,
     * or the process died between sending and recording. A rail that neither
     * throws nor answers produces exactly that, so the rail's `send` stands in for
     * one that never came back.
     */
    const rail = RAILS.MANUAL_BANK;
    const realSend = rail.send;
    (rail as any).send = async () => ({ status: 'UNKNOWN' as any, reason: 'No answer' });
    try {
      await executePayout({ id: payout.id, actorUserId: ADMIN_B, manualReference: 'UTR77778888' });
    } finally {
      (rail as any).send = realSend;
    }

    const inDoubt = findPayout(payout.id)!;
    assert.equal(inDoubt.state, 'UNCERTAIN', `expected UNCERTAIN, got ${inDoubt.state}`);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(pushesSinceClear('PAYOUT_PAID').length, 0,
      'somebody was told they were paid while the outcome was still unknown');

    /*
     * THE SECOND PLACE A PAYOUT BECOMES PAID, AND IT TOLD NOBODY.
     *
     * Reconciliation confirming an uncertain payout had grown its own copy of the
     * PAID path: its own ledger posting, its own state change, no notification. So
     * the payee whose money had been in doubt for a day — the one most likely to be
     * anxious about it — was the only payee never told it had landed.
     */
    fcmDispatcher.clearHistory();
    const report = await runPaymentsHealthCheck({
      lookup: async () => [{ id: 'pout_live_1', status: 'processed' }]
    });
    assert.equal(report.uncertainPayouts.resolvedPaid >= 1, true,
      `reconciliation resolved nothing: ${JSON.stringify(report.uncertainPayouts)}`);
    assert.equal(findPayout(payout.id)!.state, 'PAID');

    await new Promise(r => setTimeout(r, 30));
    const told = pushesSinceClear('PAYOUT_PAID');
    assert.equal(told.length, 1,
      `the payee whose money was in doubt was told ${told.length} times`);
    assert.equal(told[0].userId, RIDER_USER);
    assert.match(told[0].title, /have been paid/i,
      `a confirmed payout was announced as merely on its way: ${told[0].title}`);
  });

  await check('and it clears the payable through the same account name the normal path uses', () => {
    /*
     * The copy did not only forget the notification. It built the payable account
     * by concatenating 'RIDER_PAYABLE:' + ownerId instead of calling `accountFor`.
     * Those agree today because nobody has changed how an account name is
     * composed — and the day that changes, reconciliation clears a payable nothing
     * else reads, so the payable never goes down and the next run pays the same
     * person again.
     *
     * Asserted on the ENTRY rather than on the balance: the rider has earnings
     * from several orders in this suite, so a balance of zero is not what "the
     * payout cleared its own payable" means and a check written that way would be
     * measuring the other orders.
     *
     * `accountFor` is on the left of the comparison because it is the thing that
     * would move. A hardcoded 'RIDER_PAYABLE:rdr_news_1' here would agree with the
     * drifted copy and disagree with the rest of the platform.
     */
    const cleared = ledger
      .query({})
      .filter(e => e.event === 'PAYOUT_SENT' && e.direction === 'DEBIT');
    assert.ok(cleared.length > 0, 'no payout cleared a payable at all');
    for (const entry of cleared) {
      assert.equal(
        entry.account === accountFor('RIDER_PAYABLE', RIDER) ||
          entry.account === accountFor('PARTNER_PAYABLE', RESTAURANT),
        true,
        `a payout cleared "${entry.account}", which is not an account accountFor composes`
      );
    }
  });

  await check('A QUEUED payout is told it is on its way, not that it has arrived', async () => {
    fcmDispatcher.clearHistory();
    recordOrderEarnings(deliveredOrder({ orderNumber: 'QB-900009' }));

    const payout = draftPayout({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Nandini Kitchen',
      actorUserId: ADMIN_A,
      rail: 'MANUAL_BANK'
    });
    if (payout.state === 'AWAITING_APPROVAL') approvePayout(payout.id, ADMIN_B);

    /*
     * RazorpayX ACCEPTING a payout is not RazorpayX having paid it. The state is
     * PAID either way, because the money has left our control and the entries it
     * covers must never be drafted again — but "you have been paid" about a
     * transfer the bank has not made yet sends somebody to look at an account that
     * has not moved, and the second time that happens they stop believing us.
     */
    const rail = RAILS.MANUAL_BANK;
    const realSend = rail.send;
    (rail as any).send = async () => ({ status: 'QUEUED' as const, reference: 'pout_q_1' });
    try {
      const queued = await executePayout({
        id: payout.id,
        actorUserId: ADMIN_B,
        manualReference: 'UTR99990000'
      });
      assert.equal(queued.state, 'PAID', 'a queued payout must still clear what it covers');
    } finally {
      (rail as any).send = realSend;
    }
    await new Promise(r => setTimeout(r, 30));

    const told = pushesSinceClear('PAYOUT_PAID');
    assert.equal(told.length, 1);
    assert.match(told[0].title, /on its way/i,
      `a queued transfer was announced as arrived: ${told[0].title}`);
    assert.equal(/have been paid/i.test(told[0].title), false,
      `a queued transfer claimed the money had landed: ${told[0].title}`);
  });

  /* ================================================================ *
   *  A REFUND THE CUSTOMER IS TOLD ABOUT                              *
   * ================================================================ */

  await check('A settled refund tells the customer it has been sent', async () => {
    fcmDispatcher.clearHistory();
    const order = deliveredOrder({ orderNumber: 'QB-900003' });
    memoryStore.orders.set(order.id, order);
    recordOrderEarnings(order);

    await withGatewayRefund(() =>
      sendRefund({
        order,
        amountPaise: toPaise(200),
        reason: 'Cold food',
        actorUserId: ADMIN_A,
        caseId: 'case_news_settled'
      })
    );
    await new Promise(r => setTimeout(r, 30));

    const told = pushesSinceClear('REFUND_SENT');
    assert.equal(told.length, 1, `expected one refund notice, got ${told.length}`);
    assert.equal(told[0].userId, CUSTOMER);
    assert.match(told[0].body, /200/, `the amount is missing: ${told[0].body}`);
    assert.equal(ALARM_CHANNELS.includes(told[0].androidChannelId || ''), false);
  });

  await check('A refund that did NOT settle tells the customer nothing', async () => {
    fcmDispatcher.clearHistory();
    const order = deliveredOrder({ orderNumber: 'QB-900004' });
    memoryStore.orders.set(order.id, order);

    /*
     * The gateway could not be reached, so `sendRefund` leaves the case open
     * instead of discarding the decision to refund. A customer told their money
     * is on its way stops chasing it — and a refund nobody is chasing is one that
     * quietly never happens. The queue is where this gets noticed.
     *
     * No stub here: `razorpayAdapter.refund` returns null without live keys,
     * which IS the gateway-unreachable case.
     */
    const outcome = await sendRefund({
      order,
      amountPaise: toPaise(150),
      reason: 'Missing item',
      actorUserId: ADMIN_A,
      caseId: 'case_news_unsettled'
    });
    assert.equal(outcome.settled, false, 'this fixture is meant to leave the refund unsettled');
    await new Promise(r => setTimeout(r, 30));

    assert.equal(pushesSinceClear('REFUND_SENT').length, 0,
      'a customer was told money was sent that is still sitting in a queue');
  });

  /* ================================================================ *
   *  THE KITCHEN HAS IT — ONCE                                        *
   * ================================================================ */

  await check('ACCEPTED then PREPARING within seconds is ONE message, not two', async () => {
    fcmDispatcher.clearHistory();
    const { orderService } = await import('../modules/orders/orderService.ts');

    const order = deliveredOrder({ orderNumber: 'QB-900005', status: 'ACCEPTED' });
    delete order.pickedUpAt;
    delete order.deliveredAt;
    order.status = 'ORDER_PLACED';
    memoryStore.orders.set(order.id, order);

    await orderService.transitionStatus(order.id, 'ACCEPTED');
    await orderService.transitionStatus(order.id, 'PREPARING', 20);
    await new Promise(r => setTimeout(r, 30));

    const told = pushesSinceClear('KITCHEN_HAS_ORDER');
    assert.equal(told.length, 1,
      `a kitchen tapping accept and then start-cooking sent ${told.length} messages`);
    assert.equal(told[0].userId, CUSTOMER);
    assert.equal(ALARM_CHANNELS.includes(told[0].androidChannelId || ''), false);

    // And the old PREPARING message is not sent alongside it, which would be the
    // same pair of notifications by another name.
    assert.equal(pushesSinceClear('PREPARING').length, 0,
      'the replaced PREPARING message is still being sent as well');
  });

  await check('and the order remembers being told, so a later PREPARING adds nothing', async () => {
    const { orderService } = await import('../modules/orders/orderService.ts');
    const orders = Array.from(memoryStore.orders.values()) as any[];
    const order = orders.find(o => o.orderNumber === 'QB-900005');
    assert.ok(order?.customerToldKitchenHasItAt, 'nothing was recorded on the order');

    fcmDispatcher.clearHistory();
    await orderService.transitionStatus(order.id, 'PREPARING', 25).catch(() => null);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(pushesSinceClear('KITCHEN_HAS_ORDER').length, 0,
      'the order was announced a second time');
  });

  /* ================================================================ *
   *  A RIDER IS COMING                                                *
   * ================================================================ */

  await check('A customer is told a rider is coming, by first name only', () => {
    fcmDispatcher.clearHistory();
    void fcmDispatcher.notifyRiderAssigned(CUSTOMER, 'ord_x', 'QB-900006', 'Rahul');

    const told = pushesSinceClear('RIDER_ASSIGNED');
    assert.equal(told.length, 1);
    assert.match(told[0].body, /Rahul/);
    assert.equal(/Sharma/.test(told[0].body), false,
      'a rider’s surname was pushed to a customer');
    assert.equal(ALARM_CHANNELS.includes(told[0].androidChannelId || ''), false);
  });

  await check('and the rider route takes only the first word of their name', () => {
    /*
     * A SOURCE CHECK, because the trimming happens at the call site in
     * riderRouter and the dispatcher only receives what it is given. A check that
     * calls the dispatcher with 'Rahul' proves the dispatcher is honest and proves
     * nothing at all about whether the route splits the name.
     *
     * Comments are stripped first: the prose above and in the route names the
     * surname it is asserting never ships, and a grep that reads comments finds
     * its own explanation and reports success.
     */
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = path.resolve(here, '..');

    const stripComments = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

    const sample = stripComments('/* Sharma */ const a = 1; // Sharma\nconst b = 2;');
    assert.equal(/Sharma/.test(sample), false, 'the comment stripper does not strip comments');
    assert.equal(/const b/.test(sample), true, 'the comment stripper ate the code');

    const code = stripComments(fs.readFileSync(path.join(src, 'routes/riderRouter.ts'), 'utf8'));
    assert.match(code, /notifyRiderAssigned\(/, 'the rider route does not tell the customer at all');
    assert.match(
      code,
      /riderName[^\n]*split\(/,
      'the rider route passes a name it has not reduced to a first name'
    );
  });

  /* ================================================================ *
   *  NO MONEY NEWS MAY EVER USE AN ALARM CHANNEL                      *
   * ================================================================ */

  await check('No payment or progress notification names an alarm channel in the dispatcher', () => {
    /*
     * The balance checks above each cover one message. This covers the next one
     * somebody adds: copying a neighbouring method is how a "you were paid" ends
     * up on `new-orders`, and every check in this file would still pass because
     * none of them would be exercising it.
     */
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dispatcher = fs.readFileSync(
      path.join(path.resolve(here, '..'), 'notifications/fcmDispatcher.ts'),
      'utf8'
    );
    const stripComments = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = stripComments(dispatcher);

    for (const method of [
      'notifyPayeePaid',
      'notifyCustomerRefundSent',
      'notifyKitchenHasOrder',
      'notifyRiderAssigned'
    ]) {
      const start = code.indexOf(`async ${method}(`);
      assert.notEqual(start, -1, `${method} is gone from the dispatcher`);
      const body = code.slice(start, start + 900);
      assert.equal(
        /CHANNEL\.(KITCHEN|RIDER)/.test(body),
        false,
        `${method} sends to an order-alarm channel`
      );
      assert.match(
        body,
        /CHANNEL\.(DEFAULT|PAYMENTS|ORDER_UPDATES)/,
        `${method} does not name a non-alarm channel explicitly`
      );
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
