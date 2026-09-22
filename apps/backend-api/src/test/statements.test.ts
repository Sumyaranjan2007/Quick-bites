/**
 * Statements, and asking to be paid.
 *
 * Two things are being defended here, and they are not the same thing.
 *
 * The first is arithmetic: a statement whose lines do not add up to the ledger
 * is worse than no statement at all, because it invites a partner to argue
 * with a number that was right. Every test that touches a figure checks it
 * against the ledger and not against another derivation of the same inputs.
 *
 * The second is the property that makes payout requests safe at all: **a
 * request never names an amount.** If that ever stops being true, a payee
 * gains a way to put a number of their choosing in front of somebody whose job
 * is to approve numbers. Several tests below exist purely to make that
 * regression loud.
 */
import assert from 'node:assert';
import { memoryStore } from '../db/client.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise } from '../modules/payments/money.ts';
import { resetConfigsForTesting, createVersion } from '../modules/payments/pricingConfig.ts';
import { resetPayeeAccountsForTesting, addAccount } from '../modules/payments/payeeAccounts.ts';
import {
  resetPayoutsForTesting,
  draftPayout,
  duesFor
} from '../modules/payments/payouts.ts';
import { recordOrderEarnings } from '../modules/payments/earnings.ts';
import { statementFor, statementView } from '../modules/payments/statements.ts';
import { resolvePayee } from '../modules/payments/payeeIdentity.ts';
import {
  raiseRequest,
  withdrawRequest,
  declineRequest,
  markSeen,
  settleRequestsFor,
  openRequestFor,
  listRequests,
  resetPayoutRequestsForTesting
} from '../modules/payments/payoutRequests.ts';

console.log('====================================================');
console.log('  STATEMENTS AND PAYOUT REQUESTS                    ');
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

const RESTAURANT = 'rst_stmt_1';
const RIDER = 'rdr_stmt_1';
const PARTNER_USER = 'usr_partner_1';
const RIDER_USER = 'usr_rider_1';
const ADMIN = 'usr_admin_stmt';

/** Days ago, as an ISO timestamp. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function deliveredOrder(overrides: Record<string, any> = {}): any {
  const id = `ord_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    orderNumber: `QB-${Math.floor(100000 + Math.random() * 800000)}`,
    restaurantId: RESTAURANT,
    riderId: RIDER,
    customerId: 'usr_cust_stmt',
    status: 'DELIVERED',
    pickedUpAt: new Date(Date.now() - 86_400_000).toISOString(),
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY_SANDBOX',
    razorpayPaymentId: 'pay_test_fixture',
    riderPayout: 40,
    deliveredAt: daysAgo(5),
    updatedAt: daysAgo(5),
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

/** Puts an order in the store and posts its earnings, as delivery does. */
function deliver(overrides: Record<string, any> = {}): any {
  const order = deliveredOrder(overrides);
  memoryStore.orders.set(order.id, order);
  recordOrderEarnings(order);
  return order;
}

async function run() {
  resetLedgerForTesting();
  resetConfigsForTesting();
  resetPayeeAccountsForTesting();
  resetPayoutsForTesting();
  resetPayoutRequestsForTesting();
  memoryStore.orders.clear();
  memoryStore.riders.clear();
  memoryStore.restaurants.clear();

  memoryStore.riders.set(RIDER, { id: RIDER, fullName: 'Rahul Sharma', codCashInHand: 0 });
  memoryStore.restaurants.set(RESTAURANT, { id: RESTAURANT, name: 'Ganesh Bhavan', ownerId: PARTNER_USER });

  const first = deliver();
  const second = deliver({ orderNumber: 'QB-200002' });

  /* ---------------------------------------------------------------- *
   *  THE ARITHMETIC                                                   *
   * ---------------------------------------------------------------- */

  await check('A partner statement lists every order it was asked about', () => {
    const statement = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    assert.equal(statement.orders.length, 2);
    const numbers = statement.orders.map(o => o.orderId).sort();
    assert.deepEqual(numbers, [first.id, second.id].sort());
  });

  await check('Every order’s lines add up to what the ledger says it earned', () => {
    const statement = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    for (const order of statement.orders) {
      const sum = order.lines.reduce((total, line) => total + line.amountPaise, 0);
      assert.equal(
        sum,
        order.netPaise,
        `order ${order.orderNumber}: lines sum to ${sum}, ledger says ${order.netPaise}`
      );
      assert.equal(order.unexplainedPaise, 0, 'the statement could not explain its own total');
    }
  });

  await check('The partner’s net is food plus packaging, less commission and TDS', () => {
    const statement = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    const order = statement.orders.find(o => o.orderId === first.id)!;
    // 500 + 20 - 75 - 5.
    assert.equal(order.netPaise, toPaise(440));

    const byLabel = (label: string) => order.lines.find(l => l.label === label)?.amountPaise;
    assert.equal(byLabel('Food total'), toPaise(500));
    assert.equal(byLabel('Packaging'), toPaise(20));
    assert.equal(byLabel('Our commission'), -toPaise(75));
    assert.equal(byLabel('TDS withheld'), -toPaise(5));
  });

  await check('Every deduction is named, never netted into one figure', () => {
    // A partner shown "Deductions: -80" has been told nothing. The whole
    // purpose of a statement is that each subtraction can be argued with
    // separately.
    const statement = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    const order = statement.orders[0];
    const negatives = order.lines.filter(l => l.amountPaise < 0);
    assert.ok(negatives.length >= 2, 'the deductions were collapsed into one line');
    for (const line of negatives) {
      assert.ok(line.label.trim().length > 2, 'a deduction with no name');
      assert.ok((line.detail || '').length > 10, `${line.label} does not say where it comes from`);
    }
  });

  await check('The commission shown is the rate FROZEN on the order, not today’s', () => {
    // The single most important property of a statement. A rate renegotiated
    // in October must not restate what a kitchen earned in September — and if
    // it did, the partner would be right to distrust every figure we ever
    // showed them.
    createVersion({ defaultCommissionPercent: 30 }, { userId: ADMIN }, 'Doubling it');

    const statement = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    const order = statement.orders.find(o => o.orderId === first.id)!;
    const commission = order.lines.find(l => l.label === 'Our commission')!;

    assert.equal(commission.amountPaise, -toPaise(75), 'a rate change rewrote a settled order');
    assert.ok(
      (commission.detail || '').includes('15%'),
      `the statement showed the wrong percentage: ${commission.detail}`
    );

    createVersion({ defaultCommissionPercent: 15 }, { userId: ADMIN }, 'Back');
  });

  await check('A rider statement shows the trip and the whole tip', () => {
    const tipped = deliver({
      riderPayout: 55,
      bill: { ...deliveredOrder().bill, tipAmount: 30, totalAmount: 610.9 }
    });

    const statement = statementFor('RIDER', RIDER, 'Rahul Sharma');
    const order = statement.orders.find(o => o.orderId === tipped.id)!;

    const byLabel = (label: string) => order.lines.find(l => l.label === label)?.amountPaise;
    assert.equal(byLabel('Trip earning'), toPaise(55));
    assert.equal(byLabel('Tip'), toPaise(30));
    assert.equal(order.netPaise, toPaise(85), 'the rider was not paid the whole tip');
  });

  await check('A refund that came off an order appears on that order, not on its own', () => {
    // A partner whose settlement is short by 120 needs to see WHICH order, not
    // a loose adjustment at the bottom of a page.
    ledger.post({
      event: 'SETTLEMENT_ADJUSTMENT',
      postings: [
        { account: accountFor('PARTNER_PAYABLE', RESTAURANT), direction: 'DEBIT', amountPaise: toPaise(120) },
        { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: 0 },
        { account: 'REVENUE_FEES', direction: 'CREDIT', amountPaise: toPaise(120) }
      ].filter(p => p.amountPaise > 0) as any,
      idempotencyKey: `test_refund_adj:${first.id}`,
      actorUserId: ADMIN,
      narration: 'Customer refunded for a missing item',
      orderId: first.id
    });

    const statement = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    const order = statement.orders.find(o => o.orderId === first.id)!;

    assert.equal(order.netPaise, toPaise(320), '440 less a 120 refund');
    const adjustment = order.lines.find(l => l.label === 'Refund adjustment' || l.label === 'Adjustment');
    assert.ok(adjustment, 'the refund is not on the order it came off');
    assert.equal(adjustment!.amountPaise, -toPaise(120));

    assert.equal(
      statement.adjustments.length,
      0,
      'an order-linked adjustment was filed as an unattributable one'
    );
    assert.equal(order.unexplainedPaise, 0, 'the refund broke the statement’s arithmetic');
  });

  await check('The payable total on a statement equals what the payout queue would pay', () => {
    // Two derivations of one number, and they must agree. If they ever drift,
    // a partner is told one figure in their app and paid another, and there is
    // no way for either of us to tell which was right.
    const statement = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    const due = duesFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    assert.equal(statement.summary.payablePaise, due.payablePaise);
    assert.equal(statement.summary.heldPaise, due.heldPaise);
  });

  await check('The balance is the whole history, even when the window is narrow', () => {
    // A statement for "today" that says "you are owed Rs 0" when the balance is
    // Rs 4,000 is a statement that starts an argument.
    const narrow = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan', {
      from: daysAgo(400),
      to: daysAgo(399)
    });
    const full = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');

    assert.equal(narrow.orders.length, 0, 'the window was not applied');
    assert.equal(
      narrow.summary.payablePaise,
      full.summary.payablePaise,
      'narrowing the window changed what the partner is owed'
    );
  });

  await check('An order delivered today is held, not payable', () => {
    const fresh = deliver({ deliveredAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const statement = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    const order = statement.orders.find(o => o.orderId === fresh.id)!;
    assert.equal(order.released, false, 'an order delivered seconds ago was already released');
    assert.ok(statement.summary.heldPaise > 0);
    assert.ok(statement.holdDays >= 1);
  });

  await check('The rupee view never disagrees with the paise it came from', () => {
    const statement = statementFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    const view: any = statementView(statement);
    assert.equal(Math.round(view.summary.payable * 100), statement.summary.payablePaise);
    for (const order of view.orders) {
      assert.equal(Math.round(order.net * 100), order.netPaise);
    }
  });

  /* ---------------------------------------------------------------- *
   *  RAISING A REQUEST                                                *
   * ---------------------------------------------------------------- */

  await rejects(
    'A payee with no verified account cannot raise a request',
    'NO_VERIFIED_ACCOUNT',
    () =>
      raiseRequest({
        ownerType: 'RESTAURANT',
        ownerId: RESTAURANT,
        ownerName: 'Ganesh Bhavan',
        raisedByUserId: PARTNER_USER
      })
  );

  await check('With an account verified, a request can be raised', async () => {
    const account = await addAccount({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerUserId: PARTNER_USER,
      createdByUserId: PARTNER_USER,
      method: 'BANK',
      holderName: 'Ganesh Bhavan',
      accountNumber: '000123456789',
      ifsc: 'HDFC0001234',
      kycName: 'Ganesh Bhavan'
    });
    // Force the verified state the penny drop would have produced; the drop
    // itself is asserted in payees.test.ts and is not what is under test here.
    (account as any).validationStatus = 'VERIFIED';
    (account as any).appliedAt = new Date().toISOString();
    (account as any).appliedByAdminId = 'usr_admin_fixture';
    (account as any).razorpayFundAccountId = 'fa_test_stmt';
    memoryStore.payeeAccounts.set(account.id, account);

    const request = raiseRequest({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Ganesh Bhavan',
      raisedByUserId: PARTNER_USER,
      note: 'Rent is due on the first'
    });

    assert.equal(request.status, 'OPEN');
    assert.equal(request.ownerId, RESTAURANT);
    assert.equal(request.note, 'Rent is due on the first');
  });

  await check('A request carries NO amount a payee chose', () => {
    /*
     * The property this whole design rests on.
     *
     * A request has exactly one number on it and it is a snapshot the SERVER
     * took from the ledger. Nothing the payee sent influenced it, and nothing
     * downstream sizes a payment from it. If a field ever appears here that a
     * payee can set and a payout can read, this assertion is what should stop
     * it reaching a bank.
     */
    const request = openRequestFor('RESTAURANT', RESTAURANT)!;
    const due = duesFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');

    assert.equal(
      request.payableAtRequestPaise,
      due.payablePaise,
      'the snapshot did not come from the ledger'
    );

    const fields = Object.keys(request);
    const amountish = fields.filter(f => /amount|paise|total|sum/i.test(f));
    assert.deepEqual(
      amountish,
      ['payableAtRequestPaise'],
      `a payout request gained a second money field: ${amountish.join(', ')}`
    );
  });

  await rejects('The same payee cannot raise a second request', 'REQUEST_ALREADY_OPEN', () =>
    raiseRequest({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Ganesh Bhavan',
      raisedByUserId: PARTNER_USER
    })
  );

  await check('Raising a request does not change what is owed by one paise', () => {
    const before = duesFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    withdrawRequest(openRequestFor('RESTAURANT', RESTAURANT)!.id, RESTAURANT);
    raiseRequest({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Ganesh Bhavan',
      raisedByUserId: PARTNER_USER
    });
    const after = duesFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan');
    assert.equal(after.payablePaise, before.payablePaise);
    assert.equal(after.outstandingPaise, before.outstandingPaise);
  });

  await check('A request can be withdrawn only by the payee who raised it', () => {
    const request = openRequestFor('RESTAURANT', RESTAURANT)!;
    let refused = false;
    try {
      withdrawRequest(request.id, 'rst_somebody_else');
    } catch (err: any) {
      refused = err?.code === 'REQUEST_NOT_FOUND';
    }
    assert.ok(refused, 'one partner withdrew another partner’s request');
    assert.equal(openRequestFor('RESTAURANT', RESTAURANT)?.id, request.id, 'it was withdrawn anyway');
  });

  await check('Declining says why, and the money stays owed', () => {
    const request = openRequestFor('RESTAURANT', RESTAURANT)!;
    const owedBefore = duesFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan').payablePaise;

    markSeen(request.id, ADMIN);
    const declined = declineRequest(request.id, ADMIN, 'Paid in the Friday run. Nothing to do.');

    assert.equal(declined.status, 'DECLINED');
    assert.equal(declined.declineReason, 'Paid in the Friday run. Nothing to do.');
    assert.equal(
      duesFor('RESTAURANT', RESTAURANT, 'Ganesh Bhavan').payablePaise,
      owedBefore,
      'declining a request wrote off what was owed'
    );
    assert.equal(openRequestFor('RESTAURANT', RESTAURANT), null);
  });

  await rejects('A decline with no reason is refused', 'REASON_REQUIRED', () => {
    const request = raiseRequest({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Ganesh Bhavan',
      raisedByUserId: PARTNER_USER
    });
    return declineRequest(request.id, ADMIN, '   ');
  });

  await check('A payout closes whatever the payee was waiting on', () => {
    const request = openRequestFor('RESTAURANT', RESTAURANT)!;
    const payout = draftPayout({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerName: 'Ganesh Bhavan',
      actorUserId: ADMIN,
      rail: 'MANUAL_BANK'
    });

    const closed = settleRequestsFor('RESTAURANT', RESTAURANT, payout.id);
    assert.equal(closed, 1);
    assert.equal(openRequestFor('RESTAURANT', RESTAURANT), null);

    const settled = listRequests({ ownerId: RESTAURANT }).find(r => r.id === request.id)!;
    assert.equal(settled.status, 'SETTLED');
    assert.equal(settled.settledByPayoutId, payout.id);
  });

  await check('Settling one payee’s request leaves another payee’s alone', async () => {
    const riderAccount = await addAccount({
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerUserId: RIDER_USER,
      createdByUserId: RIDER_USER,
      method: 'VPA',
      holderName: 'Rahul Sharma',
      vpa: 'rahul@okhdfcbank',
      kycName: 'Rahul Sharma'
    });
    (riderAccount as any).validationStatus = 'VERIFIED';
    (riderAccount as any).appliedAt = new Date().toISOString();
    (riderAccount as any).appliedByAdminId = 'usr_admin_fixture';
    (riderAccount as any).razorpayFundAccountId = 'fa_test_rider';
    memoryStore.payeeAccounts.set(riderAccount.id, riderAccount);

    const riderRequest = raiseRequest({
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerName: 'Rahul Sharma',
      raisedByUserId: RIDER_USER
    });

    settleRequestsFor('RESTAURANT', RESTAURANT, 'pyt_unrelated');
    assert.equal(openRequestFor('RIDER', RIDER)?.id, riderRequest.id, 'a rider’s request was closed by a partner’s payout');
  });

  await rejects('A rider holding our cash is told so, not left to guess', 'CASH_IN_HAND', () => {
    withdrawRequest(openRequestFor('RIDER', RIDER)!.id, RIDER);
    memoryStore.riders.set(RIDER, { id: RIDER, fullName: 'Rahul Sharma', codCashInHand: 1500 });
    return raiseRequest({
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerName: 'Rahul Sharma',
      raisedByUserId: RIDER_USER
    });
  });

  await check('And that refusal names the figure they are carrying', () => {
    memoryStore.riders.set(RIDER, { id: RIDER, fullName: 'Rahul Sharma', codCashInHand: 1500 });
    try {
      raiseRequest({
        ownerType: 'RIDER',
        ownerId: RIDER,
        ownerName: 'Rahul Sharma',
        raisedByUserId: RIDER_USER
      });
      assert.fail('it was allowed');
    } catch (err: any) {
      assert.ok(
        /1,?500/.test(err.message),
        `a rider was blocked without being told how much: ${err.message}`
      );
    }
    memoryStore.riders.set(RIDER, { id: RIDER, fullName: 'Rahul Sharma', codCashInHand: 0 });
  });

  await rejects('A payee owed nothing cannot raise a request', 'NOTHING_OWED', () =>
    raiseRequest({
      ownerType: 'RESTAURANT',
      ownerId: 'rst_never_traded',
      ownerName: 'Nobody',
      raisedByUserId: 'usr_nobody'
    })
  );

  /* ---------------------------------------------------------------- *
   *  WHO THE PAYEE IS                                                 *
   * ---------------------------------------------------------------- */

  await check('A rider whose PRIMARY role is customer is still a rider', async () => {
    /*
     * The regression this section exists for.
     *
     * Roles became non-exclusive, so somebody who ordered food in March and
     * signed up to deliver in April has `role: 'customer'` and `rider` in
     * `roles`. Every route here used to ask `role === 'rider'`, which meant
     * that person was told they were not a payee — they could not see their
     * earnings, could not add the bank account they are paid into, and could
     * not ask to be paid. Money earned, and invisible to the person who
     * earned it.
     *
     * Identity is resolved from the RIDER RECORD now. The role is not
     * consulted unless somebody is genuinely both.
     */
    memoryStore.riders.set(RIDER, { id: RIDER, userId: RIDER_USER, fullName: 'Rahul Sharma', codCashInHand: 0 });

    const payee = await resolvePayee(RIDER_USER, 'customer');
    assert.equal(payee.ownerType, 'RIDER');
    assert.equal(payee.ownerId, RIDER);
  });

  await check('A partner whose primary role is customer is still a partner', async () => {
    const payee = await resolvePayee(PARTNER_USER, 'customer');
    assert.equal(payee.ownerType, 'RESTAURANT');
    assert.equal(payee.ownerId, RESTAURANT);
  });

  await rejects('Somebody who is neither is refused', 'NOT_A_PAYEE', () =>
    resolvePayee('usr_just_a_customer', 'customer')
  );

  await check('Being BOTH is refused rather than guessed at', async () => {
    // Two separate balances. Guessing pays the wrong one to the right person,
    // which reconciles perfectly and is still wrong.
    memoryStore.riders.set('rdr_both', { id: 'rdr_both', userId: 'usr_both', fullName: 'Both', codCashInHand: 0 });
    memoryStore.restaurants.set('rst_both', { id: 'rst_both', name: 'Both Kitchen', ownerId: 'usr_both' });

    let refused = '';
    try {
      await resolvePayee('usr_both', 'customer');
    } catch (err: any) {
      refused = err?.code;
    }
    assert.equal(refused, 'PAYEE_AMBIGUOUS', 'a person with two balances was silently given one of them');

    const asRider = await resolvePayee('usr_both', 'customer', 'RIDER');
    assert.equal(asRider.ownerId, 'rdr_both');
    assert.equal(asRider.alsoOtherPayee, true);

    const asPartner = await resolvePayee('usr_both', 'customer', 'RESTAURANT');
    assert.equal(asPartner.ownerId, 'rst_both');
  });

  await check('A primary role that names one of the two breaks the tie', async () => {
    const asRider = await resolvePayee('usr_both', 'rider');
    assert.equal(asRider.ownerType, 'RIDER');
    const asPartner = await resolvePayee('usr_both', 'restaurant_owner');
    assert.equal(asPartner.ownerType, 'RESTAURANT');
  });

  await rejects(
    'Asking to be treated as something you are not is refused, not answered with the other',
    'RESTAURANT_NOT_FOUND',
    () => resolvePayee(RIDER_USER, 'rider', 'RESTAURANT')
  );

  await check('A partner’s kyc name is the business, not the person who owns it', async () => {
    /*
     * The owner is deliberately given a DIFFERENT personal name here.
     *
     * Without that, both orderings of the fallback produce the same string and
     * the test passes while checking nothing — which is exactly what happened
     * on the first attempt, and a mutation run caught it.
     *
     * The rule matters because a penny drop compares the bank's `registered_name`
     * against whatever we send. Send the proprietor's personal name and every
     * properly-held business account fails verification, which is most of them.
     */
    memoryStore.users.set(PARTNER_USER, {
      id: PARTNER_USER,
      fullName: 'Suresh Kumar',
      role: 'restaurant_owner'
    } as any);

    const payee = await resolvePayee(PARTNER_USER, 'restaurant_owner');
    assert.equal(payee.kycName, 'Ganesh Bhavan', 'the bank would be asked about the proprietor, not the kitchen');
    assert.equal(payee.ownerName, 'Ganesh Bhavan');
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
  console.error('[FAIL] Statement tests crashed:', err);
  process.exit(1);
});
