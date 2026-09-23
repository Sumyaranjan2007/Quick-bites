/**
 * The ledger, and the rates that feed it.
 *
 * Two questions are asked here, and they are the two that decide whether any of
 * the payments work above this layer can be trusted:
 *
 *   1. Do the books balance, over an arbitrary sequence of events rather than
 *      over three hand-picked ones? A ledger that balances for the cases its
 *      author thought of is not a ledger.
 *
 *   2. Did moving every rate out of source code change a single bill? The claim
 *      that it did not is the whole safety argument for the change, so it is
 *      checked against the exact numbers that used to be hardcoded rather than
 *      against the defaults — which would be checking the new code against
 *      itself.
 */
import assert from 'node:assert';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import { ledger, resetLedgerForTesting, accountFor } from '../modules/payments/ledger.ts';
import { toPaise, toRupees, percentOf, formatPaise } from '../modules/payments/money.ts';
import {
  getActiveConfig,
  getActiveRates,
  createVersion,
  listConfigs,
  findConfigByVersion,
  commissionPercentFor,
  validateRates,
  resetConfigsForTesting,
  DEFAULT_RATES
} from '../modules/payments/pricingConfig.ts';

console.log('====================================================');
console.log('  LEDGER, MONEY AND RATES                           ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    const result: any = fn();
    /*
     * An async body handed to this synchronous runner would return a promise
     * nothing awaits, print PASS immediately, and its assertions could never
     * fail. That happened once on this project -- a check verifying our markup
     * never reaches a partner passed, and went on passing when the leak was
     * deliberately introduced.
     *
     * Detected rather than documented: a note saying "do not write these async"
     * is advisory, and this is enforceable.
     */
    if (result && typeof result.then === 'function') {
      failed++;
      console.log(
        `[FAIL] ${name}: this check is async and this runner does not await, so its ` +
          'assertions could never fail. Await outside and assert synchronously.'
      );
      return;
    }
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message || err}`);
  }
}

function throws(name: string, code: string, fn: () => void): void {
  check(name, () => {
    try {
      fn();
    } catch (err: any) {
      assert.equal(err?.code ?? err?.errorCode, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
      return;
    }
    assert.fail(`expected this to be refused with ${code}, and it was allowed`);
  });
}

resetLedgerForTesting();
resetConfigsForTesting();

/* ------------------------------------------------------------------ *
 *  MONEY: integers, or nothing                                        *
 * ------------------------------------------------------------------ */

check('Rupees convert to paise', () => {
  assert.equal(toPaise(123.45), 12345);
  assert.equal(toPaise(0.01), 1);
  assert.equal(toPaise(1000), 100000);
});

check('The float cases that break naive conversion', () => {
  // 2.675 * 100 is 267.49999999999997 in binary floating point. Truncating or
  // rounding that naively loses a paisa, and a paisa lost on every order is a
  // business expense nobody authorised.
  assert.equal(toPaise(2.675), 268);
  assert.equal(toPaise(1.005), 101);
  assert.equal(toPaise(0.1 + 0.2), 30);
});

check('Paise convert back to rupees', () => {
  assert.equal(toRupees(12345), 123.45);
  assert.equal(toRupees(1), 0.01);
});

check('Rounding is symmetric about zero', () => {
  // `Math.round(-100.5)` is -100, not -101: it rounds toward positive infinity
  // at the boundary. Left alone, a correction and the entry it reverses would
  // differ by a paisa, and the books would fail to balance for a reason nobody
  // could find by reading either of them.
  assert.equal(toPaise(-1.005), -101);
  assert.equal(toPaise(-2.675), -268);
  assert.equal(toPaise(-123.45), -12345);
});

check('Every two-decimal amount up to Rs 10,000 survives a round trip', () => {
  // The property that matters: converting to paise and back must be the
  // identity. One counterexample anywhere in this range is a paisa that
  // appears or vanishes on some order nobody has placed yet.
  for (let paise = 1; paise <= 1_000_000; paise += 7) {
    const roundTripped = toPaise(toRupees(paise));
    if (roundTripped !== paise) {
      assert.fail(`Rs ${toRupees(paise)} converted to ${roundTripped} paise, not ${paise}`);
    }
  }
});

check('A percentage of an amount rounds to the paisa', () => {
  assert.equal(percentOf(10000, 15), 1500);
  assert.equal(percentOf(33333, 18), 6000);
  assert.equal(percentOf(10000, 0), 0);
});

check('Paise format for a human', () => {
  assert.equal(formatPaise(12345), 'Rs 123.45');
  assert.equal(formatPaise(5), 'Rs 0.05');
  assert.equal(formatPaise(100), 'Rs 1.00');
});

/* ------------------------------------------------------------------ *
 *  THE LEDGER REFUSES WHAT IT CANNOT RECORD HONESTLY                  *
 * ------------------------------------------------------------------ */

throws('Money cannot appear from nowhere', 'LEDGER_UNBALANCED', () => {
  ledger.post({
    event: 'ORDER_PAID_ONLINE',
    postings: [
      { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: 50000 },
      { account: 'REVENUE_FEES', direction: 'CREDIT', amountPaise: 49900 }
    ],
    idempotencyKey: 'test:unbalanced',
    actorUserId: 'system',
    narration: 'A hundred paise that came from nowhere'
  });
});

throws('A one-sided movement is not a movement', 'LEDGER_INCOMPLETE', () => {
  ledger.post({
    event: 'ORDER_PAID_ONLINE',
    postings: [{ account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: 50000 }],
    idempotencyKey: 'test:one-sided',
    actorUserId: 'system',
    narration: 'Where did it come from?'
  });
});

throws('A fractional paisa means a float leaked in upstream', 'FRACTIONAL_PAISE', () => {
  ledger.post({
    event: 'ORDER_PAID_ONLINE',
    postings: [
      { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: 100.5 },
      { account: 'REVENUE_FEES', direction: 'CREDIT', amountPaise: 100.5 }
    ],
    idempotencyKey: 'test:fractional',
    actorUserId: 'system',
    narration: 'Half a paisa'
  });
});

throws('A negative amount is refused — direction carries the sign', 'NON_POSITIVE_AMOUNT', () => {
  ledger.post({
    event: 'CORRECTION',
    postings: [
      { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: -500 },
      { account: 'REVENUE_FEES', direction: 'CREDIT', amountPaise: -500 }
    ],
    idempotencyKey: 'test:negative',
    actorUserId: 'system',
    narration: 'Backwards'
  });
});

throws('A transaction with no idempotency key is refused', 'LEDGER_KEY_REQUIRED', () => {
  ledger.post({
    event: 'ORDER_PAID_ONLINE',
    postings: [
      { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: 100 },
      { account: 'REVENUE_FEES', direction: 'CREDIT', amountPaise: 100 }
    ],
    idempotencyKey: '   ',
    actorUserId: 'system',
    narration: 'Unnamed'
  });
});

check('Nothing was written by any of those refusals', () => {
  assert.equal(ledger.audit().entryCount, 0, 'a refused transaction left rows behind');
});

/* ------------------------------------------------------------------ *
 *  NOTHING POSTS TWICE                                                *
 * ------------------------------------------------------------------ */

check('One order paid once', () => {
  const entries = ledger.post({
    event: 'ORDER_PAID_ONLINE',
    postings: [
      { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: 48000 },
      { account: accountFor('PARTNER_PAYABLE', 'rst_1'), direction: 'CREDIT', amountPaise: 36000 },
      { account: accountFor('RIDER_PAYABLE', 'rdr_1'), direction: 'CREDIT', amountPaise: 4000 },
      { account: 'REVENUE_COMMISSION', direction: 'CREDIT', amountPaise: 8000 }
    ],
    idempotencyKey: 'order_paid:ord_1',
    actorUserId: 'system',
    narration: 'Order QB-100001 paid online',
    orderId: 'ord_1'
  });
  assert.equal(entries.length, 4);
});

check('The same payment posted six times moves the money once', () => {
  // The shape of the existing concurrency check on Place Order. A redelivered
  // webhook, a retried request and a rider on a bad connection tapping twice
  // all arrive here, and all three are behaving correctly.
  for (let i = 0; i < 6; i++) {
    ledger.post({
      event: 'ORDER_PAID_ONLINE',
      postings: [
        { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: 48000 },
        { account: accountFor('PARTNER_PAYABLE', 'rst_1'), direction: 'CREDIT', amountPaise: 36000 },
        { account: accountFor('RIDER_PAYABLE', 'rdr_1'), direction: 'CREDIT', amountPaise: 4000 },
        { account: 'REVENUE_COMMISSION', direction: 'CREDIT', amountPaise: 8000 }
      ],
      idempotencyKey: 'order_paid:ord_1',
      actorUserId: 'system',
      narration: 'Order QB-100001 paid online',
      orderId: 'ord_1'
    });
  }
  assert.equal(ledger.audit().transactionCount, 1, 'the same event posted more than once');
  assert.equal(ledger.balanceOf('PLATFORM_BANK'), 48000, 'the bank was credited more than once');
});

check('A repeat returns the original entries rather than an error', () => {
  const again = ledger.post({
    event: 'ORDER_PAID_ONLINE',
    postings: [
      { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: 48000 },
      { account: accountFor('PARTNER_PAYABLE', 'rst_1'), direction: 'CREDIT', amountPaise: 36000 },
      { account: accountFor('RIDER_PAYABLE', 'rdr_1'), direction: 'CREDIT', amountPaise: 4000 },
      { account: 'REVENUE_COMMISSION', direction: 'CREDIT', amountPaise: 8000 }
    ],
    idempotencyKey: 'order_paid:ord_1',
    actorUserId: 'system',
    narration: 'Order QB-100001 paid online',
    orderId: 'ord_1'
  });
  assert.equal(again.length, 4);
  assert.equal(again[0].orderId, 'ord_1');
});

/* ------------------------------------------------------------------ *
 *  BALANCES MEAN WHAT A PERSON WOULD EXPECT                           *
 * ------------------------------------------------------------------ */

check('What the platform holds grows with a debit', () => {
  assert.equal(ledger.increasesWithDebit('PLATFORM_BANK'), true);
  assert.equal(ledger.increasesWithDebit(accountFor('RIDER_CASH', 'rdr_1')), true);
});

check('What the platform owes grows with a credit', () => {
  assert.equal(ledger.increasesWithDebit(accountFor('PARTNER_PAYABLE', 'rst_1')), false);
  assert.equal(ledger.increasesWithDebit('TAX_GST_PAYABLE'), false);
});

check('A partner we owe Rs 360 reads as owed Rs 360, not in debt to us', () => {
  // Getting this backwards reports a debt as a credit, which reads entirely
  // plausible on a screen and is the kind of mistake that survives a demo.
  assert.equal(ledger.balanceOf(accountFor('PARTNER_PAYABLE', 'rst_1')), 36000);
});

check('Paying a partner clears what they are owed', () => {
  ledger.post({
    event: 'PAYOUT_SENT',
    postings: [
      { account: accountFor('PARTNER_PAYABLE', 'rst_1'), direction: 'DEBIT', amountPaise: 36000 },
      { account: 'PLATFORM_BANK', direction: 'CREDIT', amountPaise: 36000 }
    ],
    idempotencyKey: 'payout_sent:pay_1',
    actorUserId: 'usr_admin',
    narration: 'Settlement paid to Nandini Kitchen',
    payoutId: 'pay_1'
  });
  assert.equal(ledger.balanceOf(accountFor('PARTNER_PAYABLE', 'rst_1')), 0);
  assert.equal(ledger.balanceOf('PLATFORM_BANK'), 12000);
});

check('Accounts of one kind can be listed with their balances', () => {
  const rows = ledger.balancesByKind('RIDER_PAYABLE');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partyId, 'rdr_1');
  assert.equal(rows[0].balancePaise, 4000);
});

check('An account that nets to zero is not listed as owed nothing', () => {
  const rows = ledger.balancesByKind('PARTNER_PAYABLE');
  assert.equal(rows.length, 0, 'a settled partner is still showing in the dues list');
});

/* ------------------------------------------------------------------ *
 *  CORRECTION, NOT EDITING                                            *
 * ------------------------------------------------------------------ */

check('A mistake is reversed, and both movements stay on the record', () => {
  const before = ledger.audit().entryCount;
  const original = ledger.query({ payoutId: 'pay_1' })[0];

  ledger.reverse(original.transactionId, { userId: 'usr_admin' }, 'Paid to the wrong account');

  const after = ledger.audit();
  assert.equal(after.entryCount, before + 2, 'the reversal replaced the original instead of joining it');
  assert.equal(ledger.balanceOf(accountFor('PARTNER_PAYABLE', 'rst_1')), 36000, 'the debt did not come back');
  assert.equal(ledger.balanceOf('PLATFORM_BANK'), 48000);
});

throws('A reversal of nothing is refused', 'LEDGER_TRANSACTION_NOT_FOUND', () => {
  ledger.reverse('ltx_does_not_exist', { userId: 'usr_admin' }, 'Nothing to undo');
});

/* ------------------------------------------------------------------ *
 *  THE BOOKS BALANCE OVER AN ARBITRARY SEQUENCE                       *
 * ------------------------------------------------------------------ */

check('A randomised day of trading leaves the books balanced', () => {
  resetLedgerForTesting();

  // A deterministic pseudo-random sequence: reproducible when it fails, which
  // a bare Math.random would not be. A property test that cannot be re-run
  // with the inputs that broke it is a test that reports a mystery.
  let seed = 20260921;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };

  for (let i = 0; i < 300; i++) {
    const rst = `rst_${next(8)}`;
    const rdr = `rdr_${next(12)}`;
    const total = (next(90000) + 10000); // Rs 100 to Rs 1000, in paise
    const commission = percentOf(total, 15);
    const riderCut = percentOf(total, 8);
    const partnerCut = total - commission - riderCut;
    const kind = next(4);

    if (kind === 0) {
      // Paid online.
      ledger.post({
        event: 'ORDER_PAID_ONLINE',
        postings: [
          { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: total },
          { account: accountFor('PARTNER_PAYABLE', rst), direction: 'CREDIT', amountPaise: partnerCut },
          { account: accountFor('RIDER_PAYABLE', rdr), direction: 'CREDIT', amountPaise: riderCut },
          { account: 'REVENUE_COMMISSION', direction: 'CREDIT', amountPaise: commission }
        ],
        idempotencyKey: `order_paid:seq_${i}`,
        actorUserId: 'system',
        narration: `Order ${i}`
      });
    } else if (kind === 1) {
      // Cash at the door: the rider is now holding our money.
      ledger.post({
        event: 'COD_COLLECTED',
        postings: [
          { account: accountFor('RIDER_CASH', rdr), direction: 'DEBIT', amountPaise: total },
          { account: accountFor('PARTNER_PAYABLE', rst), direction: 'CREDIT', amountPaise: partnerCut },
          { account: accountFor('RIDER_PAYABLE', rdr), direction: 'CREDIT', amountPaise: riderCut },
          { account: 'REVENUE_COMMISSION', direction: 'CREDIT', amountPaise: commission }
        ],
        idempotencyKey: `cod:seq_${i}`,
        actorUserId: 'system',
        narration: `Cash collected on order ${i}`
      });
    } else if (kind === 2) {
      // The rider deposits it at the office.
      const held = ledger.balanceOf(accountFor('RIDER_CASH', rdr));
      if (held > 0) {
        ledger.post({
          event: 'CASH_DEPOSIT_CONFIRMED',
          postings: [
            { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: held },
            { account: accountFor('RIDER_CASH', rdr), direction: 'CREDIT', amountPaise: held }
          ],
          idempotencyKey: `deposit:seq_${i}`,
          actorUserId: 'usr_admin',
          narration: `Cash deposit from ${rdr}`
        });
      }
    } else {
      // A refund back to source.
      ledger.post({
        event: 'REFUND_TO_SOURCE',
        postings: [
          { account: 'REFUNDS_PAID', direction: 'DEBIT', amountPaise: total },
          { account: 'PLATFORM_BANK', direction: 'CREDIT', amountPaise: total }
        ],
        idempotencyKey: `refund:seq_${i}`,
        actorUserId: 'usr_admin',
        narration: `Refund on order ${i}`
      });
    }
  }

  const result = ledger.audit();
  assert.equal(result.balanced, true, `books did not balance: ${JSON.stringify(result.unbalancedTransactions)}`);
  assert.equal(result.totalDebitPaise, result.totalCreditPaise);
  assert.equal(result.unbalancedTransactions.length, 0);
  assert.equal(result.duplicateKeys.length, 0);
  assert.equal(result.fractionalAmounts.length, 0);
  assert.ok(result.transactionCount > 200, 'the sequence did not actually post much');
});

check('Every rider holding cash holds a whole number of paise', () => {
  for (const row of ledger.balancesByKind('RIDER_CASH')) {
    assert.ok(Number.isInteger(row.balancePaise), `${row.account} holds ${row.balancePaise}`);
    assert.ok(row.balancePaise > 0, `${row.account} holds a negative amount of cash`);
  }
});

/* ------------------------------------------------------------------ *
 *  RATES: NOTHING CHANGED WHEN THEY MOVED OUT OF SOURCE               *
 * ------------------------------------------------------------------ */

check('The platform starts on version 1, from the defaults', () => {
  resetConfigsForTesting();
  const config = getActiveConfig();
  assert.equal(config.version, 1);
  assert.equal(config.createdByUserId, 'system');
  assert.deepEqual(config.rates, DEFAULT_RATES);
});

check('The defaults ARE the numbers that used to be hardcoded', () => {
  // Written out as literals rather than read from DEFAULT_RATES, which would
  // be checking the new code against itself. These are the values read out of
  // pricing-engine and analytics.ts before either was touched.
  const r = DEFAULT_RATES;
  assert.equal(r.gstFoodPercent, 5, 'GST on food');
  assert.equal(r.packagingFeeDefault, 20, 'packaging');
  assert.equal(r.deliveryBaseFee, 30, 'delivery base');
  assert.equal(r.deliveryBaseKm, 3, 'delivery base distance');
  assert.equal(r.deliveryPerKmBeyond, 10, 'delivery per km');
  assert.equal(r.memberFreeDeliveryMinOrder, 199, 'member free delivery threshold');
  assert.equal(r.platformFeeBase, 5, 'platform fee');
  assert.equal(r.platformFeeGstPercent, 18, 'GST on the platform fee');
  assert.equal(r.defaultCommissionPercent, 15, 'commission');
  assert.equal(r.tdsPercent, 1, 'TDS');
});

check('A bill priced with no rates matches one priced with the defaults', () => {
  const basket = {
    items: [{ unitPrice: 249, quantity: 2 }, { unitPrice: 99, quantity: 1, addonsTotal: 30 }],
    distanceKm: 7.4,
    packagingFee: 25,
    tipAmount: 20
  };
  const withoutRates = calculateOrderPricing(basket);
  const withDefaults = calculateOrderPricing({ ...basket, rates: DEFAULT_RATES });
  assert.deepEqual(withoutRates, withDefaults);
});

check('The platform fee still comes to exactly Rs 5.90', () => {
  // The number a customer sees on every bill. It is now computed from Rs 5.00
  // plus 18%, and it must still land on the same two decimal places.
  const bill = calculateOrderPricing({ items: [{ unitPrice: 100, quantity: 1 }] });
  assert.equal(bill.platformFee, 5.9);
});

check('Delivery is still Rs 30 up to 3km and Rs 10 a km beyond', () => {
  assert.equal(calculateOrderPricing({ items: [{ unitPrice: 100, quantity: 1 }], distanceKm: 2 }).deliveryFee, 30);
  assert.equal(calculateOrderPricing({ items: [{ unitPrice: 100, quantity: 1 }], distanceKm: 3 }).deliveryFee, 30);
  assert.equal(calculateOrderPricing({ items: [{ unitPrice: 100, quantity: 1 }], distanceKm: 5.5 }).deliveryFee, 60);
});

check('GST on food is still 5%', () => {
  assert.equal(calculateOrderPricing({ items: [{ unitPrice: 200, quantity: 1 }] }).gstAmount, 10);
});

check('The rates handed to the engine are the rates it applies', () => {
  // Found by mutation testing: an engine that accepted `rates` and quietly
  // used its own defaults passed every other check in this file. That failure
  // mode is the worst possible one — an administrator changes commission,
  // the screen confirms it, a new version is written, and not one bill moves.
  const basket = { items: [{ unitPrice: 1000, quantity: 1 }], distanceKm: 6, packagingFee: undefined };

  const asDefault = calculateOrderPricing(basket);
  const asChanged = calculateOrderPricing({
    ...basket,
    rates: {
      ...DEFAULT_RATES,
      gstFoodPercent: 12,
      packagingFeeDefault: 45,
      deliveryBaseFee: 50,
      deliveryBaseKm: 2,
      deliveryPerKmBeyond: 25,
      platformFeeBase: 9,
      platformFeeGstPercent: 18,
      defaultCommissionPercent: 22,
      tdsPercent: 2
    }
  });

  assert.equal(asDefault.gstAmount, 50, 'default GST');
  assert.equal(asChanged.gstAmount, 120, 'GST did not follow the rate it was given');

  assert.equal(asDefault.packagingFee, 20, 'default packaging');
  assert.equal(asChanged.packagingFee, 45, 'packaging did not follow the rate it was given');

  // 6km: base covers 2km, four whole km beyond at Rs 25.
  assert.equal(asDefault.deliveryFee, 60, 'default delivery over 6km');
  assert.equal(asChanged.deliveryFee, 150, 'delivery did not follow the rates it was given');

  assert.equal(asDefault.platformFee, 5.9, 'default platform fee');
  assert.equal(asChanged.platformFee, 10.62, 'the platform fee did not follow its rate');

  assert.equal(asDefault.commissionAmount, 150, 'default commission');
  assert.equal(asChanged.commissionAmount, 220, 'commission did not follow the rate it was given');

  assert.equal(asDefault.tdsAmount, 10, 'default TDS');
  assert.equal(asChanged.tdsAmount, 20, 'TDS did not follow the rate it was given');

  assert.notEqual(asDefault.totalAmount, asChanged.totalAmount, 'the customer was charged the same either way');
});

/*
 * The threshold still gates the member's benefit -- it just no longer decides
 * whether delivery is FREE. It decides whether the discount applies at all.
 *
 * This check previously asserted the fee dropped to zero once the threshold was
 * lowered. That was correct about the old model and is the wrong question now,
 * so the assertion follows the behaviour rather than being softened to tolerate
 * it. Rs 30 is the base fee, and a 1km trip stays inside the 3km base distance,
 * so the undiscounted fee is Rs 30 and 40% off is Rs 18.
 */
check('A member’s delivery discount is gated by the threshold', () => {
  const basket = {
    items: [{ unitPrice: 150, quantity: 1 }],
    isGold: true,
    distanceKm: 1,
    memberDeliveryDiscountPercent: 40
  };

  assert.equal(
    calculateOrderPricing(basket).deliveryFee,
    30,
    'Rs 150 is below the Rs 199 default threshold, so the discount does not apply yet'
  );

  const applied = calculateOrderPricing({
    ...basket,
    rates: { ...DEFAULT_RATES, memberFreeDeliveryMinOrder: 100 }
  });
  assert.equal(applied.deliveryFee, 18, '40% off Rs 30 once the basket clears the threshold');
  assert.equal(applied.membershipDeliverySaving, 12, 'and the saving is recorded');
  assert.notEqual(applied.deliveryFee, 0, 'clearing the threshold no longer makes delivery free');
});

/* ------------------------------------------------------------------ *
 *  RATES: CHANGING THEM                                               *
 * ------------------------------------------------------------------ */

check('Changing one rate carries the other twenty-three forward', () => {
  const before = getActiveRates();
  const { config, changed } = createVersion({ defaultCommissionPercent: 18 }, { userId: 'usr_admin' }, 'Q4 pricing');

  assert.equal(config.version, 2);
  assert.equal(config.rates.defaultCommissionPercent, 18);
  assert.equal(config.rates.gstFoodPercent, before.gstFoodPercent, 'GST was reverted by an unrelated change');
  assert.equal(config.rates.deliveryBaseFee, before.deliveryBaseFee, 'delivery was reverted');
  assert.equal(changed.length, 1);
  assert.deepEqual(changed[0], { key: 'defaultCommissionPercent', from: 15, to: 18 });
});

check('Version 1 still reads back as it was', () => {
  // The whole point. An order priced last month must still be explicable.
  const v1 = findConfigByVersion(1);
  assert.ok(v1);
  assert.equal(v1!.rates.defaultCommissionPercent, 15);
});

check('A change that changes nothing does not write a version', () => {
  const countBefore = listConfigs().length;
  const { changed } = createVersion({ defaultCommissionPercent: 18 }, { userId: 'usr_admin' }, 'No-op');
  assert.equal(changed.length, 0);
  assert.equal(listConfigs().length, countBefore, 'a version recording no decision was written');
});

throws('Commission cannot be set to 500%', 'INVALID_RATES', () => {
  createVersion({ defaultCommissionPercent: 500 }, { userId: 'usr_admin' }, 'Ambitious');
});

throws('A rate cannot be set negative', 'INVALID_RATES', () => {
  createVersion({ gstFoodPercent: -5 }, { userId: 'usr_admin' }, 'Refunding the government');
});

check('A door QR cannot be asked to live longer than Razorpay allows', () => {
  const problems = validateRates({ ...DEFAULT_RATES, doorQrExpiryMinutes: 400 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Door QR expiry/);
});

/* ------------------------------------------------------------------ *
 *  PER-RESTAURANT COMMISSION                                          *
 * ------------------------------------------------------------------ */

check('A restaurant with no negotiated rate pays the platform default', () => {
  assert.equal(commissionPercentFor({}), 18);
  assert.equal(commissionPercentFor(null), 18);
  assert.equal(commissionPercentFor(undefined), 18);
});

check('A restaurant with its own rate pays that', () => {
  assert.equal(commissionPercentFor({ commissionPercent: 12 }), 12);
  assert.equal(commissionPercentFor({ commissionPercent: 0 }), 0, 'a genuine zero-commission deal');
});

check('A nonsense rate on a restaurant falls back rather than commissioning at zero', () => {
  // These are the shapes JSON and a half-finished migration actually produce.
  assert.equal(commissionPercentFor({ commissionPercent: null }), 18);
  assert.equal(commissionPercentFor({ commissionPercent: NaN as any }), 18);
  assert.equal(commissionPercentFor({ commissionPercent: -5 }), 18);
  assert.equal(commissionPercentFor({ commissionPercent: 90 }), 18);
  assert.equal(commissionPercentFor({ commissionPercent: '12' as any }), 18);
});

check('The rate applied is frozen onto the bill', () => {
  const bill = calculateOrderPricing({
    items: [{ unitPrice: 500, quantity: 1 }],
    commissionPercent: 12
  });
  assert.equal(bill.commissionPercent, 12);
  assert.equal(bill.commissionAmount, 60);
  assert.equal(bill.tdsAmount, 5);
});

check('A negotiated rate actually changes what the kitchen is paid', () => {
  const standard = calculateOrderPricing({ items: [{ unitPrice: 1000, quantity: 1 }] });
  const negotiated = calculateOrderPricing({ items: [{ unitPrice: 1000, quantity: 1 }], commissionPercent: 10 });
  assert.equal(standard.commissionAmount, 150);
  assert.equal(negotiated.commissionAmount, 100);
  assert.equal(negotiated.restaurantNetPayout - standard.restaurantNetPayout, 50);
});

check('An out-of-range rate reaching the engine is clamped, not obeyed', () => {
  // The configuration screen refuses this and so does the route. This is the
  // third line of defence: a bad number arriving here produces a payout, not
  // an error message on somebody's screen.
  const bill = calculateOrderPricing({ items: [{ unitPrice: 1000, quantity: 1 }], commissionPercent: 900 });
  assert.equal(bill.commissionPercent, 50);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
