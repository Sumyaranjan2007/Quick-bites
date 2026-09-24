/**
 * Pay and Settlements are one system, and used to be two.
 *
 * -------------------------------------------------------------------------
 * A SECOND PAYOUT SYSTEM WITH NO LEDGER
 * -------------------------------------------------------------------------
 * The Settlements screen let an administrator draft a restaurant settlement and mark
 * it PAID. That wrote the settlement record and an audit line and posted NOTHING to
 * the ledger. `PARTNER_PAYABLE` was untouched, so `duesFor` still showed the money
 * owed, and the next Pay run paid the same partner AGAIN.
 *
 * It was masked by a second defect. Until the payable calculation was fixed, a
 * partner was owed "nothing" after their first payout regardless — so the second
 * payment never happened and the missing ledger entry never showed. Fixing the
 * payable made this live. The two defects had been covering for each other, which is
 * an argument for fixing money defects in the same pass rather than shipping the
 * safest-looking one first.
 *
 * -------------------------------------------------------------------------
 * AND A FOURTH OPINION ABOUT THE AMOUNT
 * -------------------------------------------------------------------------
 * `restaurantShareOf` computed TDS as 1% of COMMISSION where `earnings.ts` uses the
 * bill's own figure; it ignored packaging entirely; and it could not see anything
 * else posted to the payable — refund clawbacks, corrections, the negative adjustment
 * that nets off an overpayment.
 *
 * So the "pending" figure on Settlements and the "owed" figure on Pay were different
 * numbers for the same kitchen on the same morning, and whichever screen somebody
 * happened to open was the one they believed. This file is the check that they agree,
 * built on a partner with packaging, a refund clawback and real TDS — the three things
 * the old formula got wrong.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryStore } from '../db/client.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise, toRupees, formatPaise } from '../modules/payments/money.ts';
import { duesFor, draftPayout, executePayout, resetPayoutsForTesting } from '../modules/payments/payouts.ts';
import { resetPayeeAccountsForTesting } from '../modules/payments/payeeAccounts.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { recordOrderEarnings } from '../modules/payments/earnings.ts';
import { sendRefund } from '../modules/payments/refunds.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import {
  backfillLegacySettlements,
  legacySettlementPosted,
  overpaidPartners
} from '../modules/payments/legacySettlements.ts';
import { ownOrder } from './helpers/ownFixture.ts';

console.log('====================================================');
console.log('  PAY AND SETTLEMENTS ARE ONE SYSTEM                ');
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
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 500)}`);
  }
}

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_A = 'usr_admin_s1';
const ADMIN_B = 'usr_admin_s2';
const PARTNER = 'rst_agree_1';
const RIDER = 'rdr_agree_1';

const realRefund = razorpayAdapter.refund;
(razorpayAdapter as any).refund = async (paymentId: string) => ({
  id: `rfnd_${paymentId}`,
  status: 'processed'
});

/** A bill whose parts add up, including the packaging the old formula ignored. */
function billFor(total: number) {
  return {
    totalAmount: total,
    itemsTotal: total * 0.8,
    packagingFee: total * 0.05,
    deliveryFee: total * 0.1,
    gstAmount: total * 0.05,
    commissionAmount: total * 0.12,
    tdsAmount: total * 0.01
  };
}

function deliveredOrder(label: string, total: number) {
  return ownOrder(label, {
    restaurantId: PARTNER,
    status: 'DELIVERED',
    paymentMethod: 'RAZORPAY_SANDBOX',
    totalAmount: total,
    riderId: RIDER,
    extra: {
      paymentStatus: 'PAID',
      razorpayPaymentId: `pay_${label}`,
      riderPayout: 30,
      pickedUpAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      deliveredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      bill: billFor(total)
    }
  });
}

function giveAccount() {
  memoryStore.payeeAccounts.set('acc_agree', {
    id: 'acc_agree',
    ownerType: 'RESTAURANT',
    ownerId: PARTNER,
    ownerUserId: 'usr_owner_agree',
    method: 'BANK',
    holderName: 'Agreeing Kitchen',
    accountLast4: '2222',
    ifsc: 'HDFC0001234',
    validationStatus: 'VERIFIED',
    appliedAt: new Date().toISOString(),
    isDefault: true,
    createdAt: new Date().toISOString(),
    createdByUserId: ADMIN_A
  } as any);
}

try {
  resetLedgerForTesting();
  resetConfigsForTesting();
  resetPayeeAccountsForTesting();
  resetPayoutsForTesting();
  memoryStore.restaurantSettlements.clear();
  memoryStore.restaurants.set(PARTNER, {
    id: PARTNER,
    name: 'Agreeing Kitchen',
    ownerId: 'usr_owner_agree'
  } as any);
  giveAccount();
  createVersion(
    { partnerHoldDays: 0, minPayoutAmount: 1, makerCheckerThreshold: 1000000 },
    { userId: ADMIN_A },
    'Release for the agreement checks'
  );

  /* ================================================================ *
   *  1. THE OWED FIGURE IS THE LEDGER'S                               *
   * ================================================================ */
  console.log('-- With packaging, real TDS and a refund clawback');

  const order = deliveredOrder('agree_a', 1000);
  memoryStore.orders.set(order.id, order);
  recordOrderEarnings(order);

  const beforeRefund = ledger.balanceOf(accountFor('PARTNER_PAYABLE', PARTNER));

  await sendRefund({
    order,
    amountPaise: toPaise(200),
    reason: 'Cold food',
    actorUserId: ADMIN_A,
    caseId: 'case_agree_1'
  });

  const owed = ledger.balanceOf(accountFor('PARTNER_PAYABLE', PARTNER));

  it('A refund claws back the kitchen’s share, so the payable is not the raw split', () => {
    /*
     * The clawback is what the old Settlements formula could not see at all. It scanned
     * orders and applied its own arithmetic; a refund posted against the payable was
     * invisible to it, so Settlements would have offered to pay the full pre-refund
     * amount.
     */
    assert.ok(beforeRefund > 0, 'the kitchen was owed nothing after a delivery');
    assert.ok(owed < beforeRefund, 'the refund did not reduce what the kitchen is owed');
  });

  const dues = duesFor('RESTAURANT', PARTNER, 'Agreeing Kitchen');

  it('and duesFor reports exactly that, to the paisa', () => {
    assert.equal(
      dues.payablePaise,
      owed,
      `duesFor says ${formatPaise(dues.payablePaise)} against a ledger balance of ${formatPaise(owed)}`
    );
  });

  it('and it includes the PACKAGING the old formula dropped', () => {
    /*
     * `restaurantShareOf` computed net as itemsTotal − commission − tds. The kitchen's
     * packaging fee never appeared, so every settlement underpaid by it — Rs 50 on this
     * Rs 1,000 order. Asserted by reconstructing the split the ledger actually used.
     */
    const items = toPaise(1000 * 0.8);
    const packaging = toPaise(1000 * 0.05);
    const commission = toPaise(1000 * 0.12);
    const tds = toPaise(1000 * 0.01);
    const expectedBeforeRefund = items + packaging - commission - tds;
    assert.equal(
      beforeRefund,
      expectedBeforeRefund,
      `the ledger credited ${formatPaise(beforeRefund)}, not ${formatPaise(expectedBeforeRefund)}`
    );

    const withoutPackaging = items - commission - tds;
    assert.notEqual(
      beforeRefund,
      withoutPackaging,
      'packaging makes no difference on this fixture, so it cannot show the defect'
    );
  });

  it('and the TDS base is the bill’s own figure, not 1% of commission', () => {
    /*
     * The old formula used commission * 0.01. On this order that is Rs 1.20 against the
     * bill's Rs 10.00 — so it withheld a tenth of the right amount and paid the
     * difference out, leaving the platform short against its own TDS obligation.
     */
    const wrongTds = toPaise(Math.round(1000 * 0.12 * 0.01 * 100) / 100);
    const rightTds = toPaise(1000 * 0.01);
    assert.notEqual(wrongTds, rightTds, 'the two TDS bases agree on this fixture, so it proves nothing');
    const items = toPaise(1000 * 0.8);
    const packaging = toPaise(1000 * 0.05);
    const commission = toPaise(1000 * 0.12);
    assert.equal(beforeRefund, items + packaging - commission - rightTds);
  });

  /* ================================================================ *
   *  2. MARKING A SETTLEMENT PAID CLEARS THE PAYABLE                  *
   * ================================================================ */
  console.log('\n-- Paying through a settlement, then running Pay');

  const paidPayout = draftPayout({
    ownerType: 'RESTAURANT',
    ownerId: PARTNER,
    ownerName: 'Agreeing Kitchen',
    actorUserId: ADMIN_A,
    rail: 'MANUAL_BANK',
    settlementId: 'setl_agree_1'
  });
  await executePayout({ id: paidPayout.id, actorUserId: ADMIN_B, manualReference: 'UTR-AGREE-1' });

  it('PAYING A SETTLEMENT CLEARS WHAT THE KITCHEN WAS OWED', () => {
    assert.equal(
      ledger.balanceOf(accountFor('PARTNER_PAYABLE', PARTNER)),
      0,
      'the payable survived a settlement being paid'
    );
    assert.equal(ledger.audit().balanced, true);
  });

  it('and the NEXT Pay run offers that partner nothing extra', () => {
    /*
     * THE DOUBLE PAYMENT. Marking a settlement paid used to post nothing, so this
     * figure stayed at the full amount and the next Pay run paid it all over again.
     */
    const after = duesFor('RESTAURANT', PARTNER, 'Agreeing Kitchen');
    assert.equal(
      after.payablePaise,
      0,
      `the kitchen is still owed ${formatPaise(after.payablePaise)} after being paid`
    );
    assert.equal(after.blockedCode, 'NOTHING_OWED', `blocked as ${after.blockedCode}`);
  });

  it('and the payout carries the settlement it paid', () => {
    // So the legacy backfill can tell a properly-paid settlement from one that was
    // marked paid before any of this existed, and not post it twice.
    assert.equal((paidPayout as any).settlementId, 'setl_agree_1');
  });

  /* ================================================================ *
   *  3. ONE BLOCKER, ON EVERY SURFACE                                 *
   * ================================================================ */
  console.log('\n-- A partner inside the hold period');

  createVersion({ partnerHoldDays: 7 }, { userId: ADMIN_A }, 'A week-long hold');
  const fresh = deliveredOrder('agree_held', 500);
  (fresh as any).deliveredAt = new Date().toISOString();
  memoryStore.orders.set(fresh.id, fresh);
  recordOrderEarnings(fresh);

  const held = duesFor('RESTAURANT', PARTNER, 'Agreeing Kitchen');

  it('IS BLOCKED BY THE HOLD, AND THE BLOCKER NAMES IT', () => {
    /*
     * Settlements and the People profile used to ask `accountBlockReason`, which knows
     * about accounts and nothing about hold periods, cash in hand or the minimum. So
     * this partner read as payable on two screens out of three, and only Pay refused.
     */
    assert.ok(held.heldPaise > 0, 'the fresh delivery was not held');
    assert.equal(held.payablePaise, 0, 'money inside the hold period is payable');
    assert.equal(held.blockedCode, 'NOTHING_OWED', `blocked as ${held.blockedCode}`);
    assert.match(held.blockedReason || '', /hold period/i, `reason: "${held.blockedReason}"`);
  });

  it('and every surface reads that same blocker from the same function', () => {
    /*
     * A source check, because the defect was three screens each computing their own
     * answer. `accountBlockReason` appearing as a BLOCKER source in a route is what
     * went wrong; it is still fine as the wording duesFor carries.
     */
    const finance = stripComments(readSource('routes/admin/financeRoutes.ts'));
    assert.match(
      finance,
      /payoutBlockedReason: dues\.blockedReason/,
      'the settlements rows compute their own blocker again'
    );
    assert.equal(
      /payoutBlockedReason: accountBlockReason\(/.test(finance),
      false,
      'the settlements rows are back to the account-only blocker'
    );
  });

  /* ================================================================ *
   *  4. THE SETTLEMENTS ALREADY MARKED PAID                           *
   * ================================================================ */
  console.log('\n-- The ones paid before the ledger knew');

  createVersion({ partnerHoldDays: 0 }, { userId: ADMIN_A }, 'Release again');
  const legacyOwed = duesFor('RESTAURANT', PARTNER, 'Agreeing Kitchen').payablePaise;

  memoryStore.restaurantSettlements.set('setl_legacy_1', {
    id: 'setl_legacy_1',
    restaurantId: PARTNER,
    restaurantName: 'Agreeing Kitchen',
    status: 'PAID',
    netAmount: toRupees(legacyOwed),
    reference: 'UTR-OLD-1',
    createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString()
  } as any);

  const backfilled = backfillLegacySettlements();

  it('A SETTLEMENT PAID BEFORE THE LEDGER KNEW IS WRITTEN DOWN', () => {
    /*
     * Not rewriting history. The transfer happened — an administrator pressed the
     * button and the reference is on the record. What was missing was the bookkeeping,
     * and the difference is between books that are behind and books that are wrong.
     */
    assert.equal(backfilled.posted, 1, `posted ${backfilled.posted}`);
    assert.equal(legacySettlementPosted('setl_legacy_1'), true);
    assert.equal(
      duesFor('RESTAURANT', PARTNER, 'Agreeing Kitchen').payablePaise,
      0,
      'the money paid by that settlement is still shown as owed'
    );
    assert.equal(ledger.audit().balanced, true);
  });

  it('and a settlement paid PROPERLY is not posted a second time', () => {
    /*
     * The properly-paid one carries a payoutId, and its payout already posted. Without
     * that distinction the backfill would double-count at every boot — the same defect
     * it exists to clear up.
     */
    memoryStore.restaurantSettlements.set('setl_proper_1', {
      id: 'setl_proper_1',
      restaurantId: PARTNER,
      restaurantName: 'Agreeing Kitchen',
      status: 'PAID',
      netAmount: 500,
      payoutId: paidPayout.id,
      createdAt: new Date().toISOString()
    } as any);
    const again = backfillLegacySettlements();
    assert.equal(again.posted, 0, `posted ${again.posted} on a second run`);
    assert.equal(legacySettlementPosted('setl_proper_1'), false);
  });

  it('and an OVERPAYMENT is surfaced as a named figure, not left looking broken', () => {
    /*
     * A settlement computed by the old formula could pay more than the ledger says a
     * partner earned. Posting it drives the payable negative, which is the honest
     * answer — it nets off their next run like a refund clawback — but a negative
     * figure with no explanation reads as a bug, so the Pay screen names it.
     */
    memoryStore.restaurantSettlements.set('setl_over_1', {
      id: 'setl_over_1',
      restaurantId: PARTNER,
      restaurantName: 'Agreeing Kitchen',
      status: 'PAID',
      netAmount: 250,
      reference: 'UTR-OLD-2',
      createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString()
    } as any);
    backfillLegacySettlements();

    const over = overpaidPartners().find(p => p.restaurantId === PARTNER);
    assert.ok(over, `no overpayment was reported: ${JSON.stringify(overpaidPartners())}`);
    assert.equal(over!.overpaidPaise, toPaise(250), `reported ${formatPaise(over!.overpaidPaise)}`);
    assert.equal(ledger.audit().balanced, true);
  });
} finally {
  (razorpayAdapter as any).refund = realRefund;
}

/* ---------------------------------------------------------------- *
 *  Reading source, for the checks a balance cannot make             *
 * ---------------------------------------------------------------- */

function readSource(relative: string): string {
  return fs.readFileSync(path.join(SRC, relative), 'utf8');
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
