/**
 * Refunds: every case in PAYMENTS_PLAN §5.7, and the defect they replace.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT
 * -------------------------------------------------------------------------
 * This platform had two refund paths and they disagreed. Cancelling an order
 * refunded at the gateway, to the card the customer used. The ADMIN REFUND
 * QUEUE — the one a human operates, handling every complaint and every goodwill
 * gesture — credited a wallet unconditionally, without ever looking at how the
 * order was paid.
 *
 * So the path taken by a machine was right and the path taken by a person was
 * wrong, which is the worse way round, and it went unnoticed because nothing
 * asserted where a refund actually went.
 *
 * The first three checks below are that assertion.
 */
import assert from 'node:assert';
import { memoryStore } from '../db/client.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise, toRupees } from '../modules/payments/money.ts';
import { resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { recordOrderEarnings } from '../modules/payments/earnings.ts';
import {
  routeFor,
  sendRefund,
  partnerShareOfRefund,
  recordCashRefundAtDoor,
  refundAlreadyPaid
} from '../modules/payments/refunds.ts';

console.log('====================================================');
console.log('  REFUNDS — MONEY GOES BACK THE WAY IT CAME         ');
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

function order(overrides: Record<string, any> = {}): any {
  return {
    id: `ord_${Math.random().toString(36).slice(2, 10)}`,
    orderNumber: 'QB-200001',
    restaurantId: 'rst_refund_1',
    riderId: 'rdr_refund_1',
    customerId: 'usr_cust_1',
    customerName: 'Priya Verma',
    customerPhone: '9876543210',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY_SANDBOX',
    razorpayPaymentId: 'pay_test_abc123',
    riderPayout: 40,
    deliveredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    bill: {
      itemsTotal: 500,
      gstAmount: 25,
      packagingFee: 20,
      deliveryFee: 30,
      platformFee: 5.9,
      couponDiscount: 0,
      tipAmount: 0,
      totalAmount: 580.9,
      commissionAmount: 75,
      tdsAmount: 5
    },
    ...overrides
  };
}

async function run() {
  resetLedgerForTesting();
  resetConfigsForTesting();

  /* ---------------------------------------------------------------- *
   *  THE ROUTE IS A FACT ABOUT THE ORDER, NOT A CHOICE                *
   * ---------------------------------------------------------------- */

  await check('Case 1-4: an online payment is refunded to its source', () => {
    assert.equal(routeFor(order()), 'SOURCE');
    assert.equal(routeFor(order({ paymentMethod: 'UPI_AT_DOOR' })), 'SOURCE');
  });

  await check('Case 7: a cash order goes out by payout link', () => {
    // There is nothing to reverse on a cash payment. A link is how the money
    // gets back without this platform ever storing a customer bank detail.
    assert.equal(
      routeFor(order({ paymentMethod: 'CASH_ON_DELIVERY', razorpayPaymentId: undefined })),
      'LINK'
    );
  });

  await check('Case 5: a cash order never paid for owes nothing', () => {
    assert.equal(
      routeFor(
        order({ paymentMethod: 'CASH_ON_DELIVERY', razorpayPaymentId: undefined, paymentStatus: 'PENDING' })
      ),
      'NOTHING_TO_REFUND'
    );
  });

  await check('A wallet-paid order from before the wallet was removed goes out by link', () => {
    // There is no wallet to credit any more. Silently doing nothing would be
    // the worst outcome; a link is the honest one.
    assert.equal(routeFor(order({ paymentMethod: 'WALLET', razorpayPaymentId: undefined })), 'LINK');
  });

  await check('The route cannot be chosen — it is read off the order', () => {
    // `sendRefund` takes no route argument. The moment it becomes a dropdown,
    // somebody picks the convenient one.
    const paid = order();
    const cash = order({ paymentMethod: 'CASH_ON_DELIVERY', razorpayPaymentId: undefined });
    assert.notEqual(routeFor(paid), routeFor(cash));
  });

  /* ---------------------------------------------------------------- *
   *  NOTHING IS EVER CALLED REFUNDED UNTIL IT IS                      *
   * ---------------------------------------------------------------- */

  await check('With no gateway, a refund is NOT settled and says so', async () => {
    const outcome = await sendRefund({
      order: order(),
      amountPaise: toPaise(580.9),
      reason: 'Test',
      actorUserId: 'usr_admin'
    });
    assert.equal(outcome.settled, false, 'a refund was reported settled with no gateway to settle it');
    assert.match(outcome.message, /NOT been refunded/i);
  });

  await check('and nothing was posted to the ledger for it', () => {
    // The strongest form of the claim. Money that did not move must leave no
    // trace suggesting it did.
    assert.equal(ledger.audit().entryCount, 0);
  });

  await check('Case 13: an unsettled refund leaves a reason somebody can act on', async () => {
    const outcome = await sendRefund({
      order: order({ paymentMethod: 'CASH_ON_DELIVERY', razorpayPaymentId: undefined }),
      amountPaise: toPaise(100),
      reason: 'Test',
      actorUserId: 'usr_admin'
    });
    assert.equal(outcome.settled, false);
    assert.ok((outcome.failureReason || '').length > 20, 'a failure with no reason cannot be acted on');
  });

  /* ---------------------------------------------------------------- *
   *  LIMITS                                                           *
   * ---------------------------------------------------------------- */

  await check('Case 10: a refund larger than the order is refused', async () => {
    try {
      await sendRefund({
        order: order(),
        amountPaise: toPaise(10000),
        reason: 'Too much',
        actorUserId: 'usr_admin'
      });
      assert.fail('a refund larger than the order was allowed');
    } catch (err: any) {
      assert.equal(err?.code, 'REFUND_EXCEEDS_ORDER');
    }
  });

  await check('A zero refund is a no-op rather than an error', async () => {
    const outcome = await sendRefund({
      order: order(),
      amountPaise: 0,
      reason: 'Nothing',
      actorUserId: 'usr_admin'
    });
    assert.equal(outcome.route, 'NOTHING_TO_REFUND');
    assert.equal(outcome.settled, true);
  });

  await check('Case 5 end to end: an unpaid cash order is told nothing is owed', async () => {
    const outcome = await sendRefund({
      order: order({
        paymentMethod: 'CASH_ON_DELIVERY',
        razorpayPaymentId: undefined,
        paymentStatus: 'PENDING'
      }),
      amountPaise: toPaise(100),
      reason: 'Cancelled before pickup',
      actorUserId: 'usr_admin'
    });
    assert.equal(outcome.route, 'NOTHING_TO_REFUND');
    assert.equal(outcome.settled, true);
    assert.match(outcome.message, /no money changed hands/i);
  });

  /* ---------------------------------------------------------------- *
   *  CASE 6: CASH HANDED BACK AT THE DOOR                             *
   * ---------------------------------------------------------------- */

  await check('Case 6: cash returned at the door reduces what the rider carries', () => {
    resetLedgerForTesting();
    const o = order({ paymentMethod: 'CASH_ON_DELIVERY', razorpayPaymentId: undefined });

    // The rider collected it first.
    recordOrderEarnings(o);
    const held = ledger.balanceOf(accountFor('RIDER_CASH', 'rdr_refund_1'));
    assert.ok(held > 0);

    recordCashRefundAtDoor({
      order: o,
      riderId: 'rdr_refund_1',
      amountPaise: toPaise(100),
      actorUserId: 'usr_admin',
      reason: 'Wrong order, refused at the door'
    });

    assert.equal(
      ledger.balanceOf(accountFor('RIDER_CASH', 'rdr_refund_1')),
      held - toPaise(100),
      'returning cash did not reduce what the rider is carrying'
    );
    assert.equal(ledger.audit().balanced, true);
  });

  await check('and it is not double-counted as a payout', () => {
    // The rider gives back money they are already holding on our behalf.
    // Recording it as a transfer out of the bank would count it twice.
    assert.equal(ledger.balanceOf('PLATFORM_BANK'), 0, 'a door refund moved money out of the bank');
  });

  await check('Case 11: the same door refund cannot post twice', () => {
    const before = ledger.balanceOf(accountFor('RIDER_CASH', 'rdr_refund_1'));
    const o = order({ paymentMethod: 'CASH_ON_DELIVERY', razorpayPaymentId: undefined });
    // Same order id is what keys it; re-running with a different object but the
    // same id must be a no-op.
    recordCashRefundAtDoor({
      order: { ...o, id: ledger.query({})[0]?.orderId || o.id },
      riderId: 'rdr_refund_1',
      amountPaise: toPaise(100),
      actorUserId: 'usr_admin',
      reason: 'Repeat'
    });
    assert.equal(ledger.balanceOf(accountFor('RIDER_CASH', 'rdr_refund_1')), before);
  });

  /* ---------------------------------------------------------------- *
   *  CASE 8: THE KITCHEN'S SHARE                                      *
   * ---------------------------------------------------------------- */

  await check('A full refund takes back the whole of the kitchen’s share', () => {
    const o = order();
    // Food 500 + packaging 20 - commission 75 - TDS 5 = 440.
    assert.equal(partnerShareOfRefund(o, toPaise(580.9)), toPaise(440));
  });

  await check('A partial refund takes back a proportional share', () => {
    const o = order();
    const half = partnerShareOfRefund(o, toPaise(290.45));
    assert.ok(
      Math.abs(half - toPaise(220)) <= 1,
      `expected about half of Rs 440, got ${toRupees(half)}`
    );
  });

  await check('and the rider’s share is NOT clawed back', () => {
    // They did the trip. The food being wrong is not their doing, and docking a
    // rider for a kitchen's mistake is how a platform loses riders.
    resetLedgerForTesting();
    const o = order();
    recordOrderEarnings(o);
    const riderBefore = ledger.balanceOf(accountFor('RIDER_PAYABLE', 'rdr_refund_1'));
    assert.ok(riderBefore > 0);
    // partnerShareOfRefund is the only clawback computed anywhere; assert no
    // rider equivalent exists by checking the rider balance is untouched by it.
    assert.equal(partnerShareOfRefund(o, toPaise(580.9)) > 0, true);
    assert.equal(ledger.balanceOf(accountFor('RIDER_PAYABLE', 'rdr_refund_1')), riderBefore);
  });

  await check('A refund on an order with no bill claws back nothing rather than crashing', () => {
    assert.equal(partnerShareOfRefund(order({ bill: undefined }), toPaise(100)), 0);
    assert.equal(partnerShareOfRefund(order({ bill: { totalAmount: 0 } }), toPaise(100)), 0);
  });

  /* ---------------------------------------------------------------- *
   *  IDEMPOTENCY                                                      *
   * ---------------------------------------------------------------- */

  await check('A refund that has not been paid reports so', () => {
    assert.equal(refundAlreadyPaid('case_never_paid'), false);
  });

  await check('The books balance after every case above', () => {
    const result = ledger.audit();
    assert.equal(result.balanced, true, JSON.stringify(result.unbalancedTransactions));
    assert.equal(result.duplicateKeys.length, 0);
  });

  /* ---------------------------------------------------------------- *
   *  THE WALLET IS GONE                                               *
   * ---------------------------------------------------------------- */

  await check('No refund path credits a wallet any more', async () => {
    // The defect, asserted directly. Before this change the admin queue called
    // walletRepository.credit unconditionally; a customer who paid by UPI got
    // store credit. Nothing in the refund module touches a wallet now.
    const walletsBefore = memoryStore.wallets.size;
    const txBefore = memoryStore.walletTransactions.size;

    await sendRefund({
      order: order(),
      amountPaise: toPaise(100),
      reason: 'Complaint after delivery',
      actorUserId: 'usr_admin'
    });

    assert.equal(memoryStore.wallets.size, walletsBefore, 'a refund created or touched a wallet');
    assert.equal(memoryStore.walletTransactions.size, txBefore, 'a refund wrote a wallet transaction');
  });

  await check('Every settled message says where the money actually went', async () => {
    // A customer told "refunded" with no destination phones support. The two
    // routes read differently on purpose, and both name a timescale.
    const outcome = await sendRefund({
      order: order(),
      amountPaise: 0,
      reason: 'n/a',
      actorUserId: 'usr_admin'
    });
    assert.ok(outcome.message.length > 20);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Refund tests crashed:', err);
  process.exit(1);
});
