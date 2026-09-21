/**
 * Tax: invoices and the figures a return is filed from.
 *
 * The thing being defended here is different from everywhere else in this
 * codebase. Elsewhere a mistake costs money. Here a mistake is a false legal
 * document: an invoice with a placeholder GSTIN is not a rough draft, it is
 * something a customer may hand to their own accountant and claim credit
 * against. So the first and loudest tests are about REFUSING to produce one.
 *
 * The second theme is that every figure on an invoice is the figure that was
 * actually charged, taken from the frozen bill — not re-derived from today's
 * rates. An invoice that changes when a rate changes is an invoice that
 * contradicts a return already filed.
 */
import assert from 'node:assert';
import { memoryStore } from '../db/client.ts';
import { resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise } from '../modules/payments/money.ts';
import { resetConfigsForTesting, createVersion } from '../modules/payments/pricingConfig.ts';
import {
  getTaxIdentity,
  setTaxIdentity,
  taxIdentityGaps,
  invoiceFor,
  monthlyTaxSummary,
  tdsCsv,
  financialYearOf,
  resetTaxForTesting
} from '../modules/payments/tax.ts';

console.log('====================================================');
console.log('  TAX, INVOICES AND FILING                          ');
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

const ADMIN = 'usr_admin_tax';
const RESTAURANT_A = 'rst_tax_a';
const RESTAURANT_B = 'rst_tax_b';

const VALID_IDENTITY = {
  gstin: '29AABCU9603R1ZM',
  legalName: 'Quick Bites Foods Private Limited',
  tradeName: 'Quick Bites',
  addressLine: '4th Floor, 12 Residency Road',
  city: 'Bengaluru',
  stateCode: '',
  stateName: 'Karnataka',
  pincode: '560025',
  pan: 'AABCU9603R',
  invoicePrefix: 'QB'
};

function order(overrides: Record<string, any> = {}): any {
  const id = `ord_tax_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    orderNumber: `QB-${Math.floor(100000 + Math.random() * 800000)}`,
    restaurantId: RESTAURANT_A,
    restaurantName: 'Ganesh Bhavan',
    riderId: 'rdr_tax_1',
    customerId: 'usr_cust_tax',
    customerName: 'Priya Nair',
    deliveryAddressText: '221B, 5th Cross, Indiranagar, Bengaluru 560038',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY_SANDBOX',
    riderPayout: 40,
    deliveredAt: '2026-09-10T12:00:00.000Z',
    updatedAt: '2026-09-10T12:00:00.000Z',
    createdAt: '2026-09-10T11:30:00.000Z',
    bill: {
      itemsTotal: 500,
      gstAmount: 27.5,
      packagingFee: 20,
      deliveryFee: 30,
      platformFee: 5.9,
      couponDiscount: 0,
      tipAmount: 0,
      totalAmount: 583.4,
      commissionPercent: 15,
      commissionAmount: 75,
      tdsAmount: 5
    },
    ...overrides
  };
}

function place(overrides: Record<string, any> = {}): any {
  const o = order(overrides);
  memoryStore.orders.set(o.id, o);
  return o;
}

async function run() {
  resetLedgerForTesting();
  resetConfigsForTesting();
  resetTaxForTesting();
  memoryStore.orders.clear();
  memoryStore.restaurants.clear();

  memoryStore.restaurants.set(RESTAURANT_A, { id: RESTAURANT_A, name: 'Ganesh Bhavan' });
  memoryStore.restaurants.set(RESTAURANT_B, { id: RESTAURANT_B, name: 'Coastal Curry House' });

  /* ---------------------------------------------------------------- *
   *  REFUSING TO INVENT A REGISTRATION                                *
   * ---------------------------------------------------------------- */

  await check('With nothing configured, the gaps say so rather than returning a blank form', () => {
    const gaps = taxIdentityGaps();
    assert.ok(gaps.length > 0);
    assert.equal(getTaxIdentity(), null, 'a placeholder registration was invented');
  });

  await rejects('No invoice can be issued before a GSTIN exists', 'TAX_IDENTITY_INCOMPLETE', () =>
    invoiceFor(place())
  );

  await rejects('A malformed GSTIN is refused', 'INVALID_GSTIN', () =>
    setTaxIdentity({ ...VALID_IDENTITY, gstin: '29AABCU9603R' } as any, ADMIN)
  );

  await rejects('A plausible-looking but wrong GSTIN is still refused', 'INVALID_GSTIN', () =>
    // Right length, wrong shape: the mandatory 'Z' in position 14 is missing.
    setTaxIdentity({ ...VALID_IDENTITY, gstin: '29AABCU9603R1XM' } as any, ADMIN)
  );

  await check('A valid registration is accepted', () => {
    const identity = setTaxIdentity(VALID_IDENTITY as any, ADMIN);
    assert.equal(identity.gstin, '29AABCU9603R1ZM');
    assert.deepEqual(taxIdentityGaps(), []);
  });

  await check('The state code comes from the GSTIN, never from what was typed', () => {
    /*
     * A typed state code that disagrees with the registration splits CGST and
     * SGST against a state the business is not registered in. It is invisible
     * on screen and surfaces months later as a rejected return.
     */
    const identity = setTaxIdentity({ ...VALID_IDENTITY, stateCode: '07' } as any, ADMIN);
    assert.equal(identity.stateCode, '29', 'a typed state code overrode the registration');
  });

  /* ---------------------------------------------------------------- *
   *  THE INVOICE                                                      *
   * ---------------------------------------------------------------- */

  const invoiced = place();

  await check('An invoice separates the taxable value from the tax on it', () => {
    const invoice = invoiceFor(invoiced);
    const food = invoice.lines.find(l => l.sac === '996331')!;
    // 500 food + 20 packaging + 30 delivery, one composite supply.
    assert.equal(food.taxableValuePaise, toPaise(550));
    assert.equal(food.cgstPaise + food.sgstPaise + food.igstPaise, toPaise(27.5));
  });

  await check('The platform fee is unwound from its GST-inclusive figure', () => {
    /*
     * The bill stores `platformFee: 5.90`, being Rs 5 plus 18%. An invoice that
     * showed 5.90 as the taxable value would overstate the supply and imply a
     * rate we did not charge.
     */
    const invoice = invoiceFor(invoiced);
    const fee = invoice.lines.find(l => l.sac === '998599')!;
    assert.equal(fee.taxableValuePaise, toPaise(5), 'the GST-inclusive figure was shown as the taxable value');
    assert.equal(fee.cgstPaise + fee.sgstPaise + fee.igstPaise, toPaise(0.9));
    assert.equal(fee.totalPaise, toPaise(5.9));
  });

  await check('CGST and SGST always sum back to the whole tax, with nothing lost', () => {
    // An odd number of paise halved twice is where a rupee quietly disappears.
    const odd = place({
      bill: { ...order().bill, itemsTotal: 333.33, gstAmount: 19.17, totalAmount: 407.4 }
    });
    const invoice = invoiceFor(odd);
    for (const line of invoice.lines) {
      const tax = line.cgstPaise + line.sgstPaise + line.igstPaise;
      assert.equal(line.taxableValuePaise + tax, line.totalPaise, `${line.description} does not add up`);
      assert.ok(Number.isInteger(line.cgstPaise) && Number.isInteger(line.sgstPaise));
    }
  });

  await check('An intra-state order is CGST and SGST, never IGST', () => {
    const invoice = invoiceFor(invoiced);
    assert.equal(invoice.intraState, true);
    assert.equal(invoice.totals.igstPaise, 0);
    assert.ok(invoice.totals.cgstPaise > 0 && invoice.totals.sgstPaise > 0);
  });

  await check('A tip is on the invoice but carries no tax', () => {
    // The customer's money passing through to a rider. It is not consideration
    // for anything we supplied, and taxing it would be charging tax on a gift.
    const tipped = place({
      bill: { ...order().bill, tipAmount: 40, totalAmount: 623.4 }
    });
    const invoice = invoiceFor(tipped);

    assert.equal(invoice.totals.nonTaxablePaise, toPaise(40));
    const taxedTotal = invoice.lines.reduce((t, l) => t + l.taxableValuePaise, 0);
    assert.equal(taxedTotal, toPaise(555), 'the tip leaked into the taxable value');
    assert.ok(
      invoice.notes.some(n => /tip/i.test(n)),
      'the invoice does not say why the tip is untaxed'
    );
  });

  await check('The tax shown is what was CHARGED, not what today’s rate would be', () => {
    // The whole reason the bill is frozen. A rate raised in October must not
    // restate a September invoice, which would contradict a filed return.
    createVersion({ gstFoodPercent: 12 }, { userId: ADMIN }, 'A rate change');
    const invoice = invoiceFor(invoiced);
    const food = invoice.lines.find(l => l.sac === '996331')!;
    assert.equal(
      food.cgstPaise + food.sgstPaise,
      toPaise(27.5),
      'a rate change rewrote an invoice that had already been issued'
    );
    createVersion({ gstFoodPercent: 5 }, { userId: ADMIN }, 'Back');
  });

  await check('An invoice number is allocated once and never changes', () => {
    /*
     * GST requires a consecutive series. Re-deriving a number per request would
     * be stable but not consecutive; allocating per request would give one
     * order two numbers, which is worse and is the failure that shows up in an
     * audit.
     */
    const first = invoiceFor(invoiced).invoiceNumber;
    const second = invoiceFor(invoiced).invoiceNumber;
    const third = invoiceFor(invoiced).invoiceNumber;
    assert.equal(first, second);
    assert.equal(second, third);
    assert.match(first, /^QB\/2026-27\/\d{5}$/, `unexpected invoice number: ${first}`);
  });

  await check('Two orders get two different numbers', () => {
    const a = invoiceFor(place()).invoiceNumber;
    const b = invoiceFor(place()).invoiceNumber;
    assert.notEqual(a, b, 'two orders share one invoice number');
  });

  await check('Looking at an invoice in the admin console does not burn a number', () => {
    /*
     * A gap in a GST invoice series is a question somebody has to answer at an
     * audit, so a peek must consume nothing.
     *
     * Asserting only that a peek RETURNS "not yet issued" is not enough, and a
     * mutation run proved it: a version that returned that string and then
     * quietly allocated anyway passed. The series itself has to be watched.
     */
    const serial = (n: string) => Number(n.split('/').pop());

    const before = serial(invoiceFor(place()).invoiceNumber);

    const unseen = place();
    const peeked = invoiceFor(unseen, { allocate: false });
    assert.equal(peeked.invoiceNumber, 'NOT YET ISSUED');
    // Twice, because a leak per call is the likelier bug than a leak per order.
    invoiceFor(unseen, { allocate: false });

    const after = serial(invoiceFor(place()).invoiceNumber);
    assert.equal(after, before + 1, `peeking consumed ${after - before - 1} number(s) from the series`);

    // And issuing it for real still works, and is then stable.
    const issued = invoiceFor(unseen).invoiceNumber;
    assert.notEqual(issued, 'NOT YET ISSUED');
    assert.equal(invoiceFor(unseen, { allocate: false }).invoiceNumber, issued);
  });

  await check('The financial year is April to March, not January to December', () => {
    assert.equal(financialYearOf('2026-09-10T00:00:00.000Z'), '2026-27');
    assert.equal(financialYearOf('2026-03-31T23:59:59.000Z'), '2025-26', 'March fell into the wrong year');
    assert.equal(financialYearOf('2026-04-01T00:00:00.000Z'), '2026-27', 'April fell into the wrong year');
  });

  await check('The invoice states who is liable for the tax on restaurant service', () => {
    // Section 9(5): the operator pays it, not the kitchen. Without this line the
    // document does not explain why it carries our GSTIN for somebody else's food.
    const invoice = invoiceFor(invoiced);
    assert.ok(
      invoice.notes.some(n => /9\(5\)/.test(n)),
      'the invoice does not say under what provision it was issued'
    );
    assert.equal(invoice.supplier.gstin, '29AABCU9603R1ZM');
  });

  /* ---------------------------------------------------------------- *
   *  WHAT A RETURN IS FILED FROM                                      *
   * ---------------------------------------------------------------- */

  await check('A month counts only the orders delivered inside it', () => {
    memoryStore.orders.clear();
    place({ deliveredAt: '2026-09-01T00:00:01.000Z' });
    place({ deliveredAt: '2026-09-30T23:59:58.000Z' });
    place({ deliveredAt: '2026-08-31T23:00:00.000Z' });
    place({ deliveredAt: '2026-10-01T01:00:00.000Z' });

    const summary = monthlyTaxSummary('2026-09');
    assert.equal(summary.ordersCounted, 2, 'the month boundary leaked');
  });

  await check('An undelivered order is not a supply and is not counted', () => {
    place({ deliveredAt: '2026-09-15T12:00:00.000Z', status: 'CANCELLED' });
    place({ deliveredAt: '2026-09-15T12:00:00.000Z', status: 'OUT_FOR_DELIVERY' });
    assert.equal(monthlyTaxSummary('2026-09').ordersCounted, 2, 'a cancelled order was filed as a supply');
  });

  await check('Outward supplies are split by what they are, not lumped together', () => {
    const summary = monthlyTaxSummary('2026-09');
    // Two orders, each 550 taxable food and 5 platform fee.
    assert.equal(summary.outward.restaurantServiceTaxablePaise, toPaise(1100));
    assert.equal(summary.outward.restaurantServiceTaxPaise, toPaise(55));
    assert.equal(summary.outward.platformFeeTaxablePaise, toPaise(10));
    assert.equal(summary.outward.commissionTaxablePaise, toPaise(150));
    assert.equal(summary.outward.commissionTaxPaise, toPaise(27), '18% of 150');
    assert.equal(
      summary.outward.totalTaxPaise,
      summary.outward.restaurantServiceTaxPaise +
        summary.outward.platformFeeTaxPaise +
        summary.outward.commissionTaxPaise
    );
  });

  await check('TCS is on the supplier’s net supplies, not on what the customer paid us', () => {
    // Section 52 is on the value of supplies made THROUGH the platform. Basing
    // it on the customer's total would collect tax on our own fee as well.
    const summary = monthlyTaxSummary('2026-09');
    assert.equal(summary.tcs.netSuppliesPaise, toPaise(1040), '2 x (500 food + 20 packaging)');
    assert.equal(summary.tcs.collectedPaise, toPaise(10.4));
  });

  await check('TDS is reported per partner, because that is how it is filed', () => {
    memoryStore.orders.clear();
    place({ restaurantId: RESTAURANT_A, restaurantName: 'Ganesh Bhavan', deliveredAt: '2026-09-05T12:00:00.000Z' });
    place({ restaurantId: RESTAURANT_A, restaurantName: 'Ganesh Bhavan', deliveredAt: '2026-09-06T12:00:00.000Z' });
    place({ restaurantId: RESTAURANT_B, restaurantName: 'Coastal Curry House', deliveredAt: '2026-09-07T12:00:00.000Z' });

    const summary = monthlyTaxSummary('2026-09');
    assert.equal(summary.tds.length, 2);

    const a = summary.tds.find(r => r.restaurantId === RESTAURANT_A)!;
    assert.equal(a.ordersCounted, 2);
    assert.equal(a.deductedPaise, toPaise(10), '1% of 500, twice');
    assert.equal(summary.tdsTotalPaise, toPaise(15));

    // Largest supplier first: a filing clerk reads the top of the list.
    assert.equal(summary.tds[0].restaurantId, RESTAURANT_A);
  });

  await check('An order with no frozen commission rate raises a warning rather than passing quietly', () => {
    /*
     * The failure mode this exists for: a summary that looks clean because it
     * silently re-derived a historical commission from today's rate. Filing
     * confidently from a wrong number is worse than filing late.
     */
    const legacy = order({ deliveredAt: '2026-09-08T12:00:00.000Z' });
    delete legacy.bill.commissionPercent;
    delete legacy.bill.commissionAmount;
    memoryStore.orders.set(legacy.id, legacy);

    const summary = monthlyTaxSummary('2026-09');
    assert.ok(
      summary.warnings.some(w => /commission/i.test(w)),
      'an order with no frozen rate was filed without a word'
    );
  });

  await check('The TDS export is a csv a bookkeeper can actually open', () => {
    const csv = tdsCsv(monthlyTaxSummary('2026-09'));
    const lines = csv.split('\n');
    assert.match(lines[0], /Restaurant/);
    assert.equal(lines.length, monthlyTaxSummary('2026-09').tds.length + 1);
    assert.ok(lines[1].includes('Ganesh Bhavan'));
  });

  await check('A restaurant name containing a comma does not break the csv', () => {
    memoryStore.orders.clear();
    place({
      restaurantId: 'rst_comma',
      restaurantName: 'Biryani, Kebab & Co',
      deliveredAt: '2026-09-09T12:00:00.000Z'
    });
    const csv = tdsCsv(monthlyTaxSummary('2026-09'));
    const row = csv.split('\n')[1];
    assert.equal(row.split(',').length > 5, true);
    assert.ok(row.includes('"Biryani, Kebab & Co"'), `the name was not quoted: ${row}`);
  });

  await check('A month with no trading returns zeroes, not an error', () => {
    const summary = monthlyTaxSummary('2020-01');
    assert.equal(summary.ordersCounted, 0);
    assert.equal(summary.outward.totalTaxPaise, 0);
    assert.equal(summary.tds.length, 0);
  });

  await rejects('A malformed month is refused rather than guessed at', 'BAD_MONTH', () =>
    monthlyTaxSummary('september')
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Tax tests crashed:', err);
  process.exit(1);
});
