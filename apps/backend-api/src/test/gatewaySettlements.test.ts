/**
 * Money in: what the gateway holds, what it keeps, and when it is really ours.
 *
 * -------------------------------------------------------------------------
 * THE THREE DEFECTS THESE CHECKS PIN DOWN
 * -------------------------------------------------------------------------
 * 1. An online payment booked straight to PLATFORM_BANK. Razorpay holds the money
 *    for a day or more, so from the moment a customer paid, the books claimed
 *    funds that were somebody else's to release — and nothing checks the bank
 *    holds the money before a payout run, so a payday funded by today's card
 *    payments is marked sent and bounces.
 *
 * 2. Razorpay's fee was recorded NOWHERE. Not in src/, not in packages/. The
 *    ledger believed the platform received every rupee the customer paid, and the
 *    gap against the real bank statement grew with every online order.
 *
 * 3. Online money entered the ledger only at DELIVERY. An order that was paid and
 *    then cancelled had its REFUND recorded with no payment ever recorded against
 *    it — so once the receivable came into use, one cancelled prepaid order drove
 *    the receivable below what Razorpay was really holding and the day's
 *    settlement could NEVER be recorded. Not "recorded wrongly": refused, with no
 *    figure anybody could type that was both true and accepted.
 *
 * -------------------------------------------------------------------------
 * WHY EVERY CHECK ASSERTS FOUR ACCOUNTS AND NOT ONE
 * -------------------------------------------------------------------------
 * A check on the bank alone passes while the fee vanishes. The bank rising by
 * exactly what arrived is true of both the right books and books where the fee
 * was silently absorbed into revenue — and the second is the defect. So the
 * settlement checks assert the bank, the fee, the receivable AND that revenue did
 * not move, because the interesting failure is the one that gets a number right.
 *
 * Each check resets the ledger and makes its own order. Nothing here reads a
 * balance another check created, so no check can pass because of where it sits in
 * the file.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise, toRupees, formatPaise } from '../modules/payments/money.ts';
import { resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { recordOrderEarnings, earningsPosted } from '../modules/payments/earnings.ts';
import { bookCapture, captureBooked, customerPrepaidPaise } from '../modules/payments/capture.ts';
import {
  recordGatewaySettlement,
  gatewayReceivablePaise,
  gatewayFeesPaise
} from '../modules/payments/gatewaySettlements.ts';
import { sendRefund } from '../modules/payments/refunds.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { ownOrder } from './helpers/ownFixture.ts';

console.log('====================================================');
console.log('  MONEY IN — THE GATEWAY, THE FEE, AND THE PROMISE  ');
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

const ADMIN = 'usr_admin_gw';
const RESTAURANT = 'rst_gw_1';

/** A fresh ledger for every check, so no balance below is inherited. */
function freshBooks(): void {
  resetLedgerForTesting();
  resetConfigsForTesting();
}

/**
 * A bill whose parts add up, because a total on its own pays nobody.
 *
 * `splitForOrder` reads the items, packaging, commission and TDS lines — not the
 * total — to work out what the kitchen is owed. A fixture carrying only
 * `totalAmount` gives a partner share of zero, and a check asserting "the kitchen
 * was paid" against it fails for a reason that has nothing to do with the code.
 */
function billFor(totalAmount: number) {
  return {
    totalAmount,
    itemsTotal: totalAmount * 0.8,
    packagingFee: totalAmount * 0.02,
    platformFee: totalAmount * 0.03,
    gstAmount: totalAmount * 0.04,
    deliveryFee: totalAmount * 0.11,
    commissionAmount: totalAmount * 0.12,
    tdsAmount: totalAmount * 0.008
  };
}

/**
 * An order paid online, delivered, with its payment already captured — the
 * ordinary case, built the way the platform really builds it: capture first, then
 * delivery.
 */
function paidAndDelivered(label: string, totalAmount: number, riderId: string) {
  const order = ownOrder(label, {
    restaurantId: RESTAURANT,
    status: 'DELIVERED',
    paymentMethod: 'RAZORPAY_SANDBOX',
    totalAmount,
    riderId,
    extra: {
      paymentStatus: 'PAID',
      razorpayPaymentId: `pay_${label}`,
      pickedUpAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      deliveredAt: new Date().toISOString(),
      riderPayout: totalAmount * 0.06,
      bill: billFor(totalAmount)
    }
  });
  bookCapture(order, toPaise(totalAmount));
  recordOrderEarnings(order);
  return order;
}

/** Every account a settlement must not quietly disturb. */
function untouchables() {
  return {
    commission: ledger.balanceOf('REVENUE_COMMISSION'),
    fees: ledger.balanceOf('REVENUE_FEES'),
    partner: ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)),
    gst: ledger.balanceOf('TAX_GST_PAYABLE'),
    tcs: ledger.balanceOf('TAX_TCS_PAYABLE'),
    tds: ledger.balanceOf('TDS_WITHHELD'),
    refunds: ledger.balanceOf('REFUNDS_PAID'),
    prepaid: customerPrepaidPaise()
  };
}

function assertUnchanged(before: Record<string, number>, after: Record<string, number>): void {
  for (const key of Object.keys(before)) {
    assert.equal(
      after[key],
      before[key],
      `a settlement moved ${key}: ${formatPaise(before[key])} became ${formatPaise(after[key])}`
    );
  }
}

async function run(): Promise<void> {
  /* ================================================================ *
   *  (a) THE SETTLEMENT ITSELF — ALL FOUR ACCOUNTS                    *
   * ================================================================ */

  await check('A Rs 1,000 online order leaves the BANK untouched until the gateway settles', () => {
    freshBooks();
    paidAndDelivered('gw_bank_untouched', 1000, 'rdr_gw_1');

    assert.equal(
      ledger.balanceOf('PLATFORM_BANK'),
      0,
      'the bank moved on a payment the gateway is still holding'
    );
    assert.equal(
      gatewayReceivablePaise(),
      toPaise(1000),
      'the gateway is not shown as holding the money it took'
    );
  });

  await check('and settling Rs 976.40 raises the bank by exactly that and books Rs 23.60 as fee', () => {
    freshBooks();
    paidAndDelivered('gw_four_accounts', 1000, 'rdr_gw_2');
    const before = untouchables();

    // Razorpay on Rs 1,000: 2% = Rs 20.00, GST on that = Rs 3.60, settled Rs 976.40.
    const result = recordGatewaySettlement({
      netPaise: toPaise(976.4),
      feesPaise: toPaise(20),
      taxPaise: toPaise(3.6),
      reference: 'setl_gw_four_accounts',
      actorUserId: ADMIN
    });

    assert.equal(result.feeTotalPaise, toPaise(23.6), 'the fee was not Rs 23.60');
    assert.equal(result.dischargedPaise, toPaise(1000), 'the gateway did not discharge the full Rs 1,000');

    // FOUR ACCOUNTS. A check on the bank alone passes while the fee vanishes.
    assert.equal(ledger.balanceOf('PLATFORM_BANK'), toPaise(976.4), 'the bank did not rise by what arrived');
    assert.equal(gatewayFeesPaise(), toPaise(23.6), 'the gateway fee was not recorded as an expense');
    assert.equal(gatewayReceivablePaise(), 0, 'the gateway is still shown as holding settled money');
    assertUnchanged(before, untouchables());

    assert.equal(ledger.audit().balanced, true, 'the books do not balance after a settlement');
  });

  await check('The fee cannot be omitted: the four accounts sum to nothing', () => {
    freshBooks();
    paidAndDelivered('gw_sums', 1000, 'rdr_gw_3');
    recordGatewaySettlement({
      netPaise: toPaise(976.4),
      feesPaise: toPaise(20),
      taxPaise: toPaise(3.6),
      reference: 'setl_gw_sums',
      actorUserId: ADMIN
    });

    /*
     * What the customer paid ends up in exactly three places and nowhere else:
     * the bank, the gateway's fee, and whatever the gateway still holds. If the
     * fee were dropped this would be short by Rs 23.60, which is the whole point
     * of deriving it from a transaction that has to balance.
     */
    const accountedFor =
      ledger.balanceOf('PLATFORM_BANK') + gatewayFeesPaise() + gatewayReceivablePaise();
    assert.equal(accountedFor, toPaise(1000), 'the customer’s Rs 1,000 is not all accounted for');
  });

  /* ================================================================ *
   *  (b) PAID, CANCELLED, REFUNDED — THE DEFECT THAT BLOCKED A DAY    *
   * ================================================================ */

  await check('A payment is booked when the gateway takes it, not when the food arrives', () => {
    freshBooks();
    const order = ownOrder('gw_capture', {
      restaurantId: RESTAURANT,
      status: 'ORDER_PLACED',
      paymentMethod: 'RAZORPAY_SANDBOX',
      totalAmount: 300,
      extra: { paymentStatus: 'PAID', razorpayPaymentId: 'pay_gw_capture' }
    });

    bookCapture(order, toPaise(300));

    assert.equal(captureBooked(order.id), true, 'the capture was not recorded');
    assert.equal(gatewayReceivablePaise(), toPaise(300), 'the gateway is not holding the money it took');
    assert.equal(customerPrepaidPaise(), toPaise(300), 'the platform does not owe the customer their food');
    assert.equal(earningsPosted(order.id), false, 'an undelivered order earned somebody money');
    assert.equal(ledger.balanceOf('REVENUE_FEES'), 0, 'a payment was booked as revenue before delivery');
    assert.equal(ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)), 0,
      'a kitchen is owed money for food nobody has cooked');
  });

  await check('Pay, cancel, refund to source: the receivable and the prepaid debt both come back to zero', async () => {
    freshBooks();
    const order = ownOrder('gw_cancelled', {
      restaurantId: RESTAURANT,
      status: 'CANCELLED',
      paymentMethod: 'RAZORPAY_SANDBOX',
      totalAmount: 300,
      extra: { paymentStatus: 'PAID', razorpayPaymentId: 'pay_gw_cancelled' }
    });
    bookCapture(order, toPaise(300));

    const refundsBefore = ledger.balanceOf('REFUNDS_PAID');
    const bankBefore = ledger.balanceOf('PLATFORM_BANK');

    await withGatewayRefund(async () => {
      const outcome = await sendRefund({
        order,
        amountPaise: toPaise(300),
        reason: 'The restaurant could not make it',
        actorUserId: ADMIN,
        caseId: 'case_gw_cancelled'
      });
      assert.equal(outcome.settled, true, 'the refund did not settle');
      assert.equal(outcome.route, 'SOURCE', 'an online order refunded by some other route');
    });

    assert.equal(gatewayReceivablePaise(), 0, 'the gateway is still shown as holding refunded money');
    assert.equal(customerPrepaidPaise(), 0, 'the platform still owes food for a refunded order');

    /*
     * NOT a refund in any accounting sense, and this is the assertion that says
     * so. Money came in, no food was made, the money went back. Nothing was
     * earned and nothing was lost. Recording it against REFUNDS_PAID would report
     * a cancelled order as a day's shrinkage.
     */
    assert.equal(ledger.balanceOf('REFUNDS_PAID'), refundsBefore,
      'a cancelled order was booked as a loss');
    assert.equal(ledger.balanceOf('PLATFORM_BANK'), bankBefore,
      'a gateway reversal moved money out of the bank');
    assert.equal(ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)), 0,
      'a kitchen was docked for an order it was never asked to cook');
    assert.equal(ledger.audit().balanced, true);
  });

  /* ================================================================ *
   *  (c) A REFUND AFTER DELIVERY COMES OUT OF THE RIGHT POCKET        *
   * ================================================================ */

  await check('A refund on a DELIVERED order is a loss, and comes off the gateway — not the bank', async () => {
    freshBooks();
    const order = paidAndDelivered('gw_delivered_refund', 1000, 'rdr_gw_4');
    const bankBefore = ledger.balanceOf('PLATFORM_BANK');
    const receivableBefore = gatewayReceivablePaise();

    await withGatewayRefund(async () => {
      const outcome = await sendRefund({
        order,
        amountPaise: toPaise(200),
        reason: 'Cold food',
        actorUserId: ADMIN,
        caseId: 'case_gw_delivered'
      });
      assert.equal(outcome.settled, true);
    });

    assert.equal(ledger.balanceOf('REFUNDS_PAID') > 0, true,
      'a refund after delivery was not recorded as a loss');
    assert.equal(gatewayReceivablePaise(), receivableBefore - toPaise(200),
      'Razorpay takes a reversal out of the balance it holds; the receivable did not drop');
    assert.equal(ledger.balanceOf('PLATFORM_BANK'), bankBefore,
      'a gateway reversal was charged to the bank, which leaves the bank understated for ever');
    assert.equal(ledger.audit().balanced, true);
  });

  await check('but a refund BY LINK does come off the bank, because RazorpayX pays it from there', async () => {
    freshBooks();
    const order = ownOrder('gw_link_refund', {
      restaurantId: RESTAURANT,
      status: 'DELIVERED',
      paymentMethod: 'CASH_ON_DELIVERY',
      totalAmount: 400,
      riderId: 'rdr_gw_5',
      extra: {
        paymentStatus: 'PAID',
        pickedUpAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        deliveredAt: new Date().toISOString()
      }
    });
    recordOrderEarnings(order);

    const bankBefore = ledger.balanceOf('PLATFORM_BANK');
    const receivableBefore = gatewayReceivablePaise();

    // Recorded by hand, which is the path a deployment without RazorpayX takes.
    // Either way the money left the current account, not the gateway balance.
    const outcome = await sendRefund({
      order,
      amountPaise: toPaise(100),
      reason: 'Goodwill',
      actorUserId: ADMIN,
      caseId: 'case_gw_link',
      manualReference: 'NEFT-556677'
    });
    assert.equal(outcome.settled, true, 'a hand-recorded refund did not settle');

    assert.equal(ledger.balanceOf('PLATFORM_BANK'), bankBefore - toPaise(100),
      'a refund paid out of the bank did not reduce the bank');
    assert.equal(gatewayReceivablePaise(), receivableBefore,
      'a bank transfer was charged to the payment gateway');
    assert.equal(ledger.audit().balanced, true);
  });

  /* ================================================================ *
   *  (d) THE SAME PAYMENT REPORTED TWICE                              *
   * ================================================================ */

  await check('A payment confirmed twice — device and webhook — is booked once', () => {
    freshBooks();
    const order = ownOrder('gw_double', {
      restaurantId: RESTAURANT,
      status: 'ORDER_PLACED',
      paymentMethod: 'RAZORPAY_SANDBOX',
      totalAmount: 500,
      extra: { paymentStatus: 'PAID', razorpayPaymentId: 'pay_gw_double' }
    });

    // The customer's phone comes back from checkout, and Razorpay's webhook
    // reports the same payment. Both happen, routinely, in either order.
    bookCapture(order, toPaise(500));
    bookCapture(order, toPaise(500));

    assert.equal(gatewayReceivablePaise(), toPaise(500), 'one payment was booked twice');
    assert.equal(customerPrepaidPaise(), toPaise(500), 'the customer is owed food twice over');
    assert.equal(ledger.query({ orderId: order.id }).length, 2,
      'a second capture wrote more ledger rows');
  });

  await check('and a replay claiming a DIFFERENT amount does not change what was booked', () => {
    freshBooks();
    const order = ownOrder('gw_double_amount', {
      restaurantId: RESTAURANT,
      status: 'ORDER_PLACED',
      paymentMethod: 'RAZORPAY_SANDBOX',
      totalAmount: 500,
      extra: { paymentStatus: 'PAID', razorpayPaymentId: 'pay_gw_double_amount' }
    });

    bookCapture(order, toPaise(500));
    bookCapture(order, toPaise(5000));

    assert.equal(gatewayReceivablePaise(), toPaise(500),
      'a replayed webhook with a different amount rewrote the receivable');
  });

  await check('Delivery discharges the debt rather than booking the money a second time', () => {
    freshBooks();
    const order = paidAndDelivered('gw_discharge', 1000, 'rdr_gw_6');

    assert.equal(gatewayReceivablePaise(), toPaise(1000),
      'delivery debited the gateway again, counting one payment twice');
    assert.equal(customerPrepaidPaise(), 0, 'the customer is still owed food after delivery');
    assert.equal(ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)) > 0, true,
      'delivery did not pay the kitchen');
    assert.equal(ledger.audit().balanced, true);
  });

  await check('An order paid BEFORE captures were recorded still delivers, off the receivable', () => {
    freshBooks();
    // No bookCapture: this is every order that was already paid when the change
    // landed. They have to keep working, and their money is at the gateway.
    const order = ownOrder('gw_legacy', {
      restaurantId: RESTAURANT,
      status: 'DELIVERED',
      paymentMethod: 'RAZORPAY_SANDBOX',
      totalAmount: 600,
      riderId: 'rdr_gw_7',
      extra: {
        paymentStatus: 'PAID',
        razorpayPaymentId: 'pay_gw_legacy',
        pickedUpAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        deliveredAt: new Date().toISOString()
      }
    });
    recordOrderEarnings(order);

    assert.equal(captureBooked(order.id), false, 'this fixture is meant to have no capture');
    assert.equal(gatewayReceivablePaise(), toPaise(600),
      'an order with no capture did not book its money at delivery');
    assert.equal(customerPrepaidPaise(), 0,
      'an order with no capture invented a prepaid debt');
    assert.equal(ledger.audit().balanced, true);
  });

  /* ================================================================ *
   *  (e) THE WORKED DAY THAT COULD NOT BE RECORDED AT ALL             *
   * ================================================================ */

  await check('A day with one delivered and one refunded prepaid order CAN be settled', async () => {
    freshBooks();

    // A: Rs 500, delivered.
    paidAndDelivered('gw_day_a', 500, 'rdr_gw_day');

    // B: Rs 300, paid, then cancelled and refunded to source.
    const b = ownOrder('gw_day_b', {
      restaurantId: RESTAURANT,
      status: 'CANCELLED',
      paymentMethod: 'RAZORPAY_SANDBOX',
      totalAmount: 300,
      extra: { paymentStatus: 'PAID', razorpayPaymentId: 'pay_gw_day_b' }
    });
    bookCapture(b, toPaise(300));
    await withGatewayRefund(() =>
      sendRefund({
        order: b,
        amountPaise: toPaise(300),
        reason: 'Kitchen closed',
        actorUserId: ADMIN,
        caseId: 'case_gw_day_b'
      })
    );

    /*
     * Razorpay held Rs 800, sent Rs 300 back out of that balance, charged 2% plus
     * GST on the Rs 800 it captured (Rs 16.00 + Rs 2.88) and settled the rest.
     * Rs 500 of receivable is discharged — which is exactly what the ledger now
     * says is outstanding, because the refund reduced it when it was sent.
     *
     * Before captures were booked, the ledger's receivable was Rs 500 minus the
     * Rs 300 refund = Rs 200, and this settlement was REFUSED for exceeding it.
     * There was no figure an administrator could type that was both true and
     * accepted, so the day could not be closed at all.
     */
    assert.equal(gatewayReceivablePaise(), toPaise(500),
      'the receivable is not what Razorpay is really holding');

    const result = recordGatewaySettlement({
      netPaise: toPaise(481.12),
      feesPaise: toPaise(16),
      taxPaise: toPaise(2.88),
      reference: 'setl_gw_worked_day',
      actorUserId: ADMIN
    });

    assert.equal(result.dischargedPaise, toPaise(500), 'the day did not discharge Rs 500');
    assert.equal(ledger.balanceOf('PLATFORM_BANK'), toPaise(481.12), 'the bank is not what landed');
    assert.equal(gatewayFeesPaise(), toPaise(18.88), 'the day’s fees were not recorded');
    assert.equal(gatewayReceivablePaise(), 0, 'the gateway is still holding a settled day');
    assert.equal(ledger.audit().balanced, true);
  });

  await check('A settlement larger than the gateway is holding is refused, naming both figures', () => {
    freshBooks();
    paidAndDelivered('gw_too_much', 500, 'rdr_gw_8');

    assert.throws(
      () =>
        recordGatewaySettlement({
          netPaise: toPaise(900),
          feesPaise: toPaise(18),
          taxPaise: toPaise(3.24),
          reference: 'setl_gw_too_much',
          actorUserId: ADMIN
        }),
      (err: any) => {
        assert.equal(err.code, 'SETTLEMENT_ABOVE_OUTSTANDING');
        assert.match(err.message, /500/, 'the refusal does not say what the gateway IS holding');
        assert.match(err.message, /921/, 'the refusal does not say what was asked for');
        return true;
      }
    );
    assert.equal(ledger.balanceOf('PLATFORM_BANK'), 0, 'a refused settlement moved the bank');
  });

  /* ================================================================ *
   *  (f) THE SAME SETTLEMENT SUBMITTED TWICE                          *
   * ================================================================ */

  await check('The same settlement reference cannot be recorded twice', () => {
    freshBooks();
    paidAndDelivered('gw_replay', 1000, 'rdr_gw_9');

    recordGatewaySettlement({
      netPaise: toPaise(976.4),
      feesPaise: toPaise(20),
      taxPaise: toPaise(3.6),
      reference: 'setl_gw_replay',
      actorUserId: ADMIN
    });

    const bankAfterFirst = ledger.balanceOf('PLATFORM_BANK');

    assert.throws(
      () =>
        recordGatewaySettlement({
          netPaise: toPaise(976.4),
          feesPaise: toPaise(20),
          taxPaise: toPaise(3.6),
          reference: 'setl_gw_replay',
          actorUserId: ADMIN
        }),
      (err: any) => {
        assert.equal(err.code, 'SETTLEMENT_ALREADY_RECORDED');
        assert.equal(err.status, 409);
        assert.match(err.message, /976\.40/, 'the refusal does not name what was recorded the first time');
        return true;
      }
    );
    assert.equal(ledger.balanceOf('PLATFORM_BANK'), bankAfterFirst, 'a replay moved the bank again');
  });

  await check('and a replay is told it is a replay, not that the gateway is short', () => {
    freshBooks();
    paidAndDelivered('gw_replay_drained', 1000, 'rdr_gw_10');

    recordGatewaySettlement({
      netPaise: toPaise(976.4),
      feesPaise: toPaise(20),
      taxPaise: toPaise(3.6),
      reference: 'setl_gw_drained',
      actorUserId: ADMIN
    });

    /*
     * The receivable is now zero, so the outstanding check would ALSO refuse this
     * — with "the gateway is only holding Rs 0.00", which sends somebody looking
     * for a missing payment instead of telling them the settlement is already in
     * the books. The order of the two checks is the whole point.
     */
    assert.equal(gatewayReceivablePaise(), 0);
    assert.throws(
      () =>
        recordGatewaySettlement({
          netPaise: toPaise(976.4),
          feesPaise: toPaise(20),
          taxPaise: toPaise(3.6),
          reference: 'setl_gw_drained',
          actorUserId: ADMIN
        }),
      (err: any) => {
        assert.equal(err.code, 'SETTLEMENT_ALREADY_RECORDED',
          `a replay was refused as ${err.code}, which is the wrong reason`);
        return true;
      }
    );
  });

  /* ================================================================ *
   *  WHAT THE ADMINISTRATOR IS ASKED TO TYPE                          *
   * ================================================================ */

  await check('The three figures are the three the statement prints, and none is derived by hand', () => {
    freshBooks();
    paidAndDelivered('gw_inputs', 1000, 'rdr_gw_11');

    /*
     * This asked for "gross" and derived the fee by subtraction. It read as the
     * careful choice and it was wrong: "gross" is not on Razorpay's settlement
     * row, and what its dashboard calls "collected" is payments BEFORE refunds.
     * An administrator copying that figure for a day with one refund would have
     * typed Rs 800 against a Rs 484 settlement and booked a Rs 316 fee on a
     * Rs 16 charge.
     */
    const result = recordGatewaySettlement({
      netPaise: toPaise(976.4),
      feesPaise: toPaise(20),
      taxPaise: toPaise(3.6),
      reference: 'setl_gw_inputs',
      actorUserId: ADMIN
    });

    // Every input is transcribed and comes back unchanged; only the total is ours.
    assert.equal(result.netPaise, toPaise(976.4));
    assert.equal(result.feesPaise, toPaise(20));
    assert.equal(result.taxPaise, toPaise(3.6));
    assert.equal(result.dischargedPaise, result.netPaise + result.feesPaise + result.taxPaise);
  });

  await check('A settlement with no reference is refused, because the reference is what stops a repeat', () => {
    freshBooks();
    assert.throws(
      () =>
        recordGatewaySettlement({
          netPaise: toPaise(100),
          feesPaise: 0,
          taxPaise: 0,
          reference: '   ',
          actorUserId: ADMIN
        }),
      (err: any) => err.code === 'SETTLEMENT_REFERENCE_REQUIRED'
    );
  });

  await check('A settlement of nothing, or with negative fees, is refused', () => {
    freshBooks();
    paidAndDelivered('gw_bad_inputs', 500, 'rdr_gw_12');

    assert.throws(
      () =>
        recordGatewaySettlement({
          netPaise: 0,
          feesPaise: toPaise(10),
          taxPaise: 0,
          reference: 'setl_gw_zero',
          actorUserId: ADMIN
        }),
      (err: any) => err.code === 'SETTLEMENT_NET_REQUIRED'
    );

    assert.throws(
      () =>
        recordGatewaySettlement({
          netPaise: toPaise(100),
          feesPaise: toPaise(-5),
          taxPaise: 0,
          reference: 'setl_gw_negative',
          actorUserId: ADMIN
        }),
      (err: any) => err.code === 'SETTLEMENT_FEE_NEGATIVE'
    );
  });

  await check('A gateway fee is an EXPENSE, so it grows with a debit', () => {
    // Omitting it from the debit-positive set would report every rupee Razorpay
    // kept as a NEGATIVE expense, which reads on a screen as the platform having
    // been paid its own fees back.
    assert.equal(ledger.increasesWithDebit('EXPENSE_GATEWAY_FEE'), true);
    // And a prepaid balance is a LIABILITY: we owe the customer food. Counting it
    // as an asset would add every unfulfilled order to what the platform holds.
    assert.equal(ledger.increasesWithDebit('CUSTOMER_PREPAID'), false);
  });

  /* ================================================================ *
   *  CANCELLING IS A REFUND, AND USED NOT TO BE ONE                   *
   * ================================================================ */

  await check('Cancelling a paid order clears the gateway and the prepaid debt, not just the gateway call', async () => {
    freshBooks();
    const order = ownOrder('gw_cancel_path', {
      restaurantId: RESTAURANT,
      status: 'ORDER_PLACED',
      paymentMethod: 'RAZORPAY_SANDBOX',
      totalAmount: 300,
      extra: {
        paymentStatus: 'PAID',
        razorpayPaymentId: 'pay_gw_cancel_path',
        customerPhone: '9800000123',
        bill: billFor(300)
      }
    });
    bookCapture(order, toPaise(300));
    assert.equal(gatewayReceivablePaise(), toPaise(300));

    /*
     * DRIVEN THROUGH THE CANCELLATION, NOT THROUGH sendRefund.
     *
     * That distinction is the whole check. Cancelling used to call the gateway
     * itself and write NOTHING to the ledger — a second refund implementation
     * sitting next to the real one. A check that calls `sendRefund` directly
     * passes against both the fixed code and the broken code, because the code it
     * is meant to be testing is never reached.
     */
    await withGatewayRefund(() =>
      orderService.cancelOrder(
        order.id,
        { userId: 'usr_cust_gw', name: 'Priya', role: 'customer' as any },
        'CHANGED_MY_MIND'
      )
    );

    assert.equal(gatewayReceivablePaise(), 0,
      'a cancelled order left its money sitting at the gateway for ever');
    assert.equal(customerPrepaidPaise(), 0,
      'a cancelled order still shows the platform owing the customer food');
    assert.equal(ledger.balanceOf('REFUNDS_PAID'), 0,
      'a cancelled order was booked as a loss rather than as money that came and went');
    assert.equal(ledger.balanceOf('PLATFORM_BANK'), 0,
      'a gateway reversal on a cancellation was charged to the bank');
    assert.equal(ledger.audit().balanced, true);
  });

  await check('and a refund on money the ledger never took in does NOT go through the prepaid account', async () => {
    freshBooks();
    /*
     * An order paid before captures were recorded, cancelled afterwards. There is
     * no prepaid balance to discharge, so debiting one would drive the liability
     * negative — the books would report customers as having prepaid us a negative
     * amount, which is as unreadable as a negative gateway fee.
     */
    const order = ownOrder('gw_uncaptured', {
      restaurantId: RESTAURANT,
      status: 'CANCELLED',
      paymentMethod: 'RAZORPAY_SANDBOX',
      totalAmount: 250,
      extra: {
        paymentStatus: 'PAID',
        razorpayPaymentId: 'pay_gw_uncaptured',
        bill: billFor(250)
      }
    });
    assert.equal(captureBooked(order.id), false, 'this fixture is meant to have no capture');

    await withGatewayRefund(() =>
      sendRefund({
        order,
        amountPaise: toPaise(250),
        reason: 'Paid before the switch, cancelled after',
        actorUserId: ADMIN,
        caseId: 'case_gw_uncaptured'
      })
    );

    assert.equal(customerPrepaidPaise(), 0,
      'a refund drove the prepaid liability negative on money that was never captured');
    assert.equal(ledger.balanceOf('REFUNDS_PAID'), toPaise(250),
      'a refund on uncaptured money was not recorded as the loss it looks like');
    assert.equal(ledger.audit().balanced, true);
  });

  /* ================================================================ *
   *  EVERY PATH THAT TAKES GATEWAY MONEY BOOKS IT                     *
   * ================================================================ */

  await check('Every path that marks a gateway-paid order PAID books the capture', () => {
    /*
     * A SOURCE CHECK, because this is the failure the balance assertions above
     * cannot see. If a fifth payment path is added and forgets to book, every
     * check in this file still passes — the defect only shows up as a day that
     * cannot be settled, weeks later, in production.
     *
     * Comments are stripped FIRST. The prose in these files names the accounts
     * and the functions it discusses, and a grep that reads comments finds its
     * own explanation and reports success.
     */
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = path.resolve(here, '..');

    const stripComments = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

    // The stripper itself, checked. A stripper that silently does nothing turns
    // this whole check into a grep over the comments it was meant to remove.
    const sample = stripComments('/* PAID */ const a = 1; // PAID\nconst b = 2;');
    assert.equal(/PAID/.test(sample), false, 'the comment stripper does not strip comments');
    assert.equal(/const b/.test(sample), true, 'the comment stripper ate the code');

    const paths = [
      'modules/orders/orderService.ts',
      'routes/paymentRouter.ts',
      'routes/cashRouter.ts'
    ];

    let bookings = 0;
    for (const rel of paths) {
      const code = stripComments(fs.readFileSync(path.join(src, rel), 'utf8'));
      const marksPaid = (code.match(/paymentStatus = 'PAID'/g) || []).length;
      const books = (code.match(/bookCapture\(/g) || []).length;
      assert.equal(
        books >= marksPaid,
        true,
        `${rel} marks an order PAID ${marksPaid} time(s) but books a capture ${books} time(s)`
      );
      bookings += books;
    }

    // Four: confirmPayment, markPaidByGateway, the QR webhook, the rider's poll.
    assert.equal(bookings, 4, `expected four capture bookings across the payment paths, found ${bookings}`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

/**
 * Runs something with the gateway's reversal standing in for the network call.
 *
 * `razorpayAdapter.refund` returns null unless live keys are configured, so
 * `sendRefund` never settles in a test and the whole posting block — the thing
 * these checks are about — was unreachable. Restored afterwards, so a later check
 * cannot pass because this one left a stub behind.
 */
async function withGatewayRefund(fn: () => Promise<unknown>): Promise<void> {
  const real = razorpayAdapter.refund;
  (razorpayAdapter as any).refund = async (paymentId: string, amountInPaise?: number) => ({
    id: `rfnd_${paymentId}_${amountInPaise}`,
    status: 'processed'
  });
  try {
    await fn();
  } finally {
    (razorpayAdapter as any).refund = real;
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
