/**
 * One order, one "ours" (Tester T-4, review J-C4, 19 Oct 2026).
 *
 * The dashboard (`economicsOf`), the Pay screen and the full invoice used three
 * definitions of what Quick Bites keeps. All now read `contributionPaise`. And no
 * GST is booked on our commission when the bill shows the business had no GSTIN
 * (CLAUDE.md §4: no GST on the platform's own fees without one).
 */
import assert from 'node:assert/strict';
import { seedDatabase } from '../db/seed.ts';
import { economicsOf } from '../modules/admin/analytics.ts';
import { contributionPaise } from '../modules/payments/orderMargin.ts';
import { splitForOrder } from '../modules/payments/earnings.ts';

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

await seedDatabase();

const bill = {
  itemsTotal: 350, partnerItemsTotal: 350, packagingFee: 20, partnerPackagingFee: 15, platformFee: 10,
  deliveryFee: 40, gstAmount: 17.5, tipAmount: 0, couponDiscount: 0, commissionAmount: 52.5, totalAmount: 437.5
};
const order = (platformFeeGstPercent?: number): any => ({
  id: 'ord_one_ours', restaurantId: 'rst_bbh_01', status: 'DELIVERED', riderPayout: 30, distanceKm: 2,
  bill: { ...bill, ...(platformFeeGstPercent === undefined ? {} : { platformFeeGstPercent }) }
});

const noGstin = order(0);
it('The dashboard figure is the books\' figure (one "ours")', () =>
  assert.equal(Math.round(economicsOf(noGstin).netRevenue * 100), contributionPaise(noGstin)));
it('No GSTIN at checkout: no GST booked on our commission', () => assert.equal(splitForOrder(noGstin).commissionGstPaise, 0));
it('With a GSTIN at checkout: GST on commission is booked', () => assert.ok(splitForOrder(order(18)).commissionGstPaise > 0));
it('An old bill without the field keeps the old rule', () => assert.ok(splitForOrder(order()).commissionGstPaise > 0));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
