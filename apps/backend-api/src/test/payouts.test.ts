/**
 * Paying people: what is owed, who may authorise it, and what stops it.
 *
 * The controls in here are the ones standing between an insider and the
 * platform's bank account. Each is asserted by making it REFUSE, because a
 * control that has only ever been observed allowing things is not a control
 * anybody has tested.
 *
 * The hardest case, and the one this file spends the most effort on: a payout
 * must move money exactly once. Not once per request, not once per button
 * press — once per amount owed, however many times anything is retried.
 */
import assert from 'node:assert';
import { memoryStore } from '../db/client.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise, toRupees } from '../modules/payments/money.ts';
import { createVersion, resetConfigsForTesting, getActiveRates } from '../modules/payments/pricingConfig.ts';
import { resetPayeeAccountsForTesting, addAccount } from '../modules/payments/payeeAccounts.ts';
import {
  duesFor,
  draftPayout,
  approvePayout,
  cancelPayout,
  executePayout,
  findPayout,
  listPayouts,
  paidInLast24hPaise,
  resetPayoutsForTesting
} from '../modules/payments/payouts.ts';
import { RAILS, defaultRail, railCatalogue } from '../modules/payments/rails.ts';
import { splitForOrder, recordOrderEarnings, earningsPosted } from '../modules/payments/earnings.ts';

console.log('====================================================');
console.log('  PAYOUTS, RAILS AND THE CONTROLS ON THEM           ');
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

async function rejects(name: string, code: string, fn: () => Promise<unknown> | unknown): Promise<void> {
  return check(name, async () => {
    try {
      await fn();
    } catch (err: any) {
      assert.equal(err?.code ?? err?.errorCode, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
      return;
    }
    assert.fail(`expected this to be refused with ${code}, and it was allowed`);
  });
}

const RESTAURANT = 'rst_payout_1';
const RIDER = 'rdr_payout_1';
const DRAFTER = 'usr_admin_drafter';
const APPROVER = 'usr_admin_approver';

/** A delivered order, shaped exactly as the real ones are. */
function deliveredOrder(overrides: Record<string, any> = {}): any {
  return {
    id: `ord_${Math.random().toString(36).slice(2, 10)}`,
    orderNumber: 'QB-100001',
    restaurantId: RESTAURANT,
    riderId: RIDER,
    customerId: 'usr_cust_1',
    status: 'DELIVERED',
    pickedUpAt: new Date(Date.now() - 86_400_000).toISOString(),
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY_SANDBOX',
    razorpayPaymentId: 'pay_test_fixture',
    riderPayout: 40,
    deliveredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    updatedAt: new Date().toISOString(),
    bill: {
      itemsTotal: 500,
      gstAmount: 25,
      packagingFee: 20,
      deliveryFee: 30,
      platformFee: 5.9,
      couponDiscount: 0,
      tipAmount: 0,
      totalAmount: 580.9,
      restaurantNetPayout: 445,
      commissionPercent: 15,
      commissionAmount: 75,
      tdsAmount: 5
    },
    ...overrides
  };
}

async function run() {
  resetLedgerForTesting();
  resetConfigsForTesting();
  resetPayeeAccountsForTesting();
  resetPayoutsForTesting();
  memoryStore.riders.clear();
  memoryStore.orders.clear();

  memoryStore.riders.set(RIDER, { id: RIDER, fullName: 'Rahul Sharma', codCashInHand: 0 });

  /* ---------------------------------------------------------------- *
   *  THE SPLIT                                                        *
   * ---------------------------------------------------------------- */

  await check('An order splits into what each party is owed', () => {
    const split = splitForOrder(deliveredOrder());
    assert.equal(split.grossPaise, 58090);
    // Food 500 + packaging 20 - commission 75 - TDS 5.
    assert.equal(split.partnerPaise, toPaise(440));
    assert.equal(split.riderPaise, toPaise(40));
    assert.equal(split.commissionPaise, toPaise(75));
  });

  await check('The frozen commission is used, not today’s rate', () => {
    // The whole reason the bill carries it. A rate renegotiated since must not
    // restate what a kitchen earned last month.
    createVersion({ defaultCommissionPercent: 30 }, { userId: DRAFTER }, 'Doubling it');
    const split = splitForOrder(deliveredOrder());
    assert.equal(split.commissionPaise, toPaise(75), 'the new rate rewrote an old order');
    createVersion({ defaultCommissionPercent: 15 }, { userId: DRAFTER }, 'Back');
  });

  await check('The tip goes to the rider and nobody takes a cut of it', () => {
    const withTip = splitForOrder(
      deliveredOrder({ bill: { ...deliveredOrder().bill, tipAmount: 30, totalAmount: 610.9 } })
    );
    assert.equal(withTip.riderPaise, toPaise(70), 'the tip did not reach the rider in full');
    assert.equal(withTip.partnerPaise, toPaise(440), 'the tip leaked into the kitchen’s share');
    assert.equal(withTip.commissionPaise, toPaise(75), 'commission was taken from a tip');
  });

  /* ---------------------------------------------------------------- *
   *  POSTING EARNINGS                                                 *
   * ---------------------------------------------------------------- */

  const order1 = deliveredOrder();

  await check('A delivered order posts what everybody is owed', () => {
    recordOrderEarnings(order1);
    assert.ok(earningsPosted(order1.id));
    assert.equal(ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)), toPaise(440));
    assert.equal(ledger.balanceOf(accountFor('RIDER_PAYABLE', RIDER)), toPaise(40));
  });

  await check('and the books balance after it', () => {
    assert.equal(ledger.audit().balanced, true);
  });

  await check('Posting the same order five more times changes nothing', () => {
    for (let i = 0; i < 5; i++) recordOrderEarnings(order1);
    assert.equal(ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)), toPaise(440));
    assert.equal(ledger.audit().transactionCount, 1);
  });

  await check('A cash order puts the money in the rider’s pocket, not the bank', () => {
    const cash = deliveredOrder({ paymentMethod: 'CASH_ON_DELIVERY', paymentStatus: 'PAID' });
    recordOrderEarnings(cash);
    assert.ok(
      ledger.balanceOf(accountFor('RIDER_CASH', RIDER)) > 0,
      'cash collected was recorded as though it were in the bank'
    );
    assert.equal(ledger.audit().balanced, true);
  });

  await check('An order that cost more than it collected is recorded as a loss, not clamped', () => {
    resetLedgerForTesting();
    // A heavily couponed order: the platform funded the discount.
    const lossMaking = deliveredOrder({
      riderPayout: 200,
      bill: {
        itemsTotal: 100,
        gstAmount: 5,
        packagingFee: 0,
        deliveryFee: 0,
        platformFee: 0,
        couponDiscount: 100,
        tipAmount: 0,
        totalAmount: 105,
        commissionAmount: 15,
        tdsAmount: 1
      }
    });
    recordOrderEarnings(lossMaking);
    assert.equal(ledger.audit().balanced, true, 'a loss-making order broke the books');
    assert.ok(
      ledger.balanceOf('REVENUE_FEES') < 0,
      'the platform’s loss was silently clamped to zero rather than recorded'
    );
  });

  /* ---------------------------------------------------------------- *
   *  THE HOLD PERIOD                                                  *
   * ---------------------------------------------------------------- */

  resetLedgerForTesting();
  resetPayoutsForTesting();
  recordOrderEarnings(order1);

  await check('Money older than the hold period is payable', () => {
    const due = duesFor('RESTAURANT', RESTAURANT, 'Nandini Kitchen');
    assert.equal(due.payablePaise, toPaise(440));
    assert.equal(due.heldPaise, 0);
  });

  await check('Money earned today is held back', () => {
    const fresh = deliveredOrder({ deliveredAt: new Date().toISOString() });
    recordOrderEarnings(fresh);
    const due = duesFor('RESTAURANT', RESTAURANT, 'Nandini Kitchen');
    assert.equal(due.payablePaise, toPaise(440), 'today’s order was paid out immediately');
    assert.equal(due.heldPaise, toPaise(440), 'today’s order was not held');
    assert.equal(due.outstandingPaise, toPaise(880));
  });

  /* ---------------------------------------------------------------- *
   *  WHAT BLOCKS A PAYOUT                                             *
   * ---------------------------------------------------------------- */

  await check('No verified account blocks it, and says so', () => {
    const due = duesFor('RESTAURANT', RESTAURANT, 'Nandini Kitchen');
    assert.match(due.blockedReason || '', /verified account/i);
  });

  await rejects('and drafting is refused', 'NOTHING_PAYABLE', () =>
    draftPayout({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Nandini Kitchen',
      actorUserId: DRAFTER
    })
  );

  await check('A verified account unblocks it', async () => {
    const account = await addAccount({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerUserId: 'usr_owner_1',
      createdByUserId: 'usr_owner_1',
      kycName: 'Nandini Kitchen',
      method: 'VPA',
      holderName: 'Nandini Kitchen',
      vpa: 'nandini@okicici'
    });
    // No gateway in a test, so verification is completed by hand — the same
    // path an administrator uses on a deployment without RazorpayX.
    account.validationStatus = 'VERIFIED';
    account.razorpayFundAccountId = 'fa_test_partner';
    memoryStore.payeeAccounts.set(account.id, account);

    const due = duesFor('RESTAURANT', RESTAURANT, 'Nandini Kitchen');
    assert.equal(due.blockedReason, null);
  });

  await check('A rider holding cash is blocked entirely, not netted off', () => {
    // The rule the owner asked for, and the right way round: a rider holding
    // Rs 2,000 of platform cash is not paid Rs 1,800 of earnings. That is a net
    // position, not a payment.
    recordOrderEarnings(deliveredOrder({ deliveredAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }));
    memoryStore.riders.set(RIDER, { id: RIDER, fullName: 'Rahul Sharma', codCashInHand: 2000 });
    const due = duesFor('RIDER', RIDER, 'Rahul Sharma');
    assert.ok(due.payablePaise > 0, 'the rider has earnings to be blocked');
    assert.match(due.blockedReason || '', /platform cash/i);
  });

  await check('and depositing the cash unblocks them', async () => {
    memoryStore.riders.set(RIDER, { id: RIDER, fullName: 'Rahul Sharma', codCashInHand: 0 });
    const account = await addAccount({
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerUserId: 'usr_rider_1',
      createdByUserId: 'usr_rider_1',
      kycName: 'Rahul Sharma',
      method: 'VPA',
      holderName: 'Rahul Sharma',
      vpa: 'rahul@okhdfcbank'
    });
    account.validationStatus = 'VERIFIED';
    account.razorpayFundAccountId = 'fa_test_rider';
    memoryStore.payeeAccounts.set(account.id, account);

    assert.equal(duesFor('RIDER', RIDER, 'Rahul Sharma').blockedReason, null);
  });

  await check('An amount below the minimum carries to the next run', () => {
    createVersion({ minPayoutAmount: 10000 }, { userId: DRAFTER }, 'High minimum for the test');
    assert.match(duesFor('RIDER', RIDER, 'Rahul Sharma').blockedReason || '', /minimum/i);
    createVersion({ minPayoutAmount: 100 }, { userId: DRAFTER }, 'Back');
  });

  /* ---------------------------------------------------------------- *
   *  MAKER-CHECKER                                                    *
   * ---------------------------------------------------------------- */

  await check('A small payout needs one person', () => {
    const payout = draftPayout({
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerName: 'Rahul Sharma',
      actorUserId: DRAFTER,
      rail: 'MANUAL_BANK'
    });
    assert.equal(payout.state, 'APPROVED', 'a small payout was sent for a second signature');
    cancelPayout(payout.id, DRAFTER, 'Test cleanup');
  });

  let big: ReturnType<typeof draftPayout>;

  await check('A payout over the threshold waits for a second administrator', () => {
    createVersion({ makerCheckerThreshold: 100 }, { userId: DRAFTER }, 'Low threshold for the test');
    big = draftPayout({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Nandini Kitchen',
      actorUserId: DRAFTER,
      rail: 'MANUAL_BANK'
    });
    assert.equal(big.state, 'AWAITING_APPROVAL');
  });

  await rejects('The drafter cannot approve their own payout', 'SECOND_APPROVER_REQUIRED', () =>
    approvePayout(big.id, DRAFTER)
  );

  await rejects('and cannot send it while it waits', 'PAYOUT_NOT_APPROVED', () =>
    executePayout({ id: big.id, actorUserId: DRAFTER, manualReference: 'UTR123456' })
  );

  await check('A different administrator can approve it', () => {
    const approved = approvePayout(big.id, APPROVER);
    assert.equal(approved.state, 'APPROVED');
    assert.equal(approved.approvedByUserId, APPROVER);
  });

  await rejects('and it cannot be approved twice', 'PAYOUT_NOT_AWAITING_APPROVAL', () =>
    approvePayout(big.id, DRAFTER)
  );

  /* ---------------------------------------------------------------- *
   *  SENDING IT                                                       *
   * ---------------------------------------------------------------- */

  await rejects('A manual rail refuses to pretend without a reference', 'MANUAL_REFERENCE_REQUIRED', () =>
    executePayout({ id: big.id, actorUserId: APPROVER })
  );

  await check('and the refusal left it sendable rather than stuck', () => {
    // A rail that refuses something it is sure about never reached a bank, so
    // the payout must go back to APPROVED and be correctable. Leaving it
    // UNCERTAIN would strand real money behind a typo.
    assert.equal(findPayout(big.id)!.state, 'APPROVED');
  });

  await check('With a reference it is sent, and the ledger clears the debt', async () => {
    const before = ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT));
    const sent = await executePayout({ id: big.id, actorUserId: APPROVER, manualReference: 'UTR9988776655' });

    assert.equal(sent.state, 'PAID');
    assert.equal(sent.reference, 'UTR9988776655');
    assert.equal(
      ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)),
      before - sent.amountPaise,
      'the debt was not cleared by the payment'
    );
    assert.equal(ledger.audit().balanced, true);
  });

  await check('Sending it six more times moves the money once', async () => {
    const after = ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT));
    for (let i = 0; i < 6; i++) {
      await executePayout({ id: big.id, actorUserId: APPROVER, manualReference: 'UTR9988776655' });
    }
    assert.equal(
      ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)),
      after,
      'a repeated send paid the same money again'
    );
  });

  await check('What was paid is not offered again', () => {
    const due = duesFor('RESTAURANT', RESTAURANT, 'Nandini Kitchen');
    assert.equal(due.payablePaise, 0, 'money already paid is still showing as owed');
  });

  await rejects('A sent payout cannot be cancelled', 'PAYOUT_ALREADY_SENT', () =>
    cancelPayout(big.id, APPROVER, 'Changed my mind')
  );

  /* ---------------------------------------------------------------- *
   *  THE DAILY CAP                                                    *
   * ---------------------------------------------------------------- */

  await check('The cap counts what has actually gone out', () => {
    assert.ok(paidInLast24hPaise() > 0);
  });

  await rejects('A payout that would breach the cap is refused', 'DAILY_PAYOUT_CAP_REACHED', async () => {
    createVersion({ dailyPayoutCap: 1, makerCheckerThreshold: 1000000 }, { userId: DRAFTER }, 'Tiny cap');
    const payout = draftPayout({
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerName: 'Rahul Sharma',
      actorUserId: DRAFTER,
      rail: 'MANUAL_BANK'
    });
    return executePayout({ id: payout.id, actorUserId: APPROVER, manualReference: 'UTR000111' });
  });

  await check('and the cap is checked when sending, not when drafting', () => {
    // Twenty drafts can each be under the cap while their sum is far over it.
    // Checking at draft time would let every one of them through.
    const waiting = listPayouts({ state: 'APPROVED' });
    assert.ok(waiting.length > 0, 'the refused payout was destroyed rather than left to be sent later');
  });

  await check('Raising the cap lets it through', async () => {
    createVersion({ dailyPayoutCap: 200000 }, { userId: DRAFTER }, 'Back to normal');
    const waiting = listPayouts({ state: 'APPROVED' })[0];
    const sent = await executePayout({
      id: waiting.id,
      actorUserId: APPROVER,
      manualReference: 'UTR000111'
    });
    assert.equal(sent.state, 'PAID');
  });

  /* ---------------------------------------------------------------- *
   *  RAILS                                                            *
   * ---------------------------------------------------------------- */

  await check('The manual rail is always available, whatever else is not', () => {
    assert.equal(RAILS.MANUAL_BANK.available(), true);
    assert.equal(RAILS.UPI_MANUAL.available(), true);
  });

  await check('Without RazorpayX the default is the recorded bank transfer', () => {
    // A deployment with no gateway still has a working, auditable way to pay
    // people — rather than a screen full of disabled buttons.
    assert.equal(defaultRail(), 'MANUAL_BANK');
  });

  await check('Every rail that is unavailable says why', () => {
    for (const rail of railCatalogue()) {
      if (!rail.available) {
        assert.ok(
          (rail.unavailableReason || '').length > 20,
          `${rail.id} is unavailable and does not say why`
        );
      }
    }
  });

  await check('The books balance after everything above', () => {
    const result = ledger.audit();
    assert.equal(result.balanced, true, JSON.stringify(result.unbalancedTransactions));
    assert.equal(result.duplicateKeys.length, 0);
    assert.equal(result.fractionalAmounts.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Payout tests crashed:', err);
  process.exit(1);
});
