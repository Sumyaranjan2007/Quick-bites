/**
 * Quick Bites Gold: does it start, does it stop, and does it stack correctly?
 *
 * The behaviour worth testing hardest is the one that costs money when it is
 * wrong: a membership that has lapsed must stop giving benefits. `goldExpiresAt`
 * existed in this codebase for a long time and was read by nothing at all, so
 * anything sold against it would have been honoured forever. These checks exist
 * to make that impossible to reintroduce quietly.
 */
import assert from 'node:assert';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import {
  isGoldActive,
  goldDiscountPercent,
  listPlans,
  findPlan,
  savePlans
} from '../modules/membership/membershipService.ts';

console.log('====================================================');
console.log('  MEMBERSHIP / QUICK BITES GOLD                     ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message || err}`);
  }
}

const DAY = 86_400_000;
const future = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const past = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/* ------------------------------------------------------------------ *
 *  Is it live?                                                        *
 * ------------------------------------------------------------------ */

check('A membership expiring in the future is active', () => {
  assert.equal(isGoldActive({ isGold: true, goldExpiresAt: future(10) }), true);
});

check('A membership that expired yesterday is NOT active', () => {
  assert.equal(
    isGoldActive({ isGold: true, goldExpiresAt: past(1) }),
    false,
    'an expired membership must stop giving benefits'
  );
});

check('A membership expiring one minute ago is NOT active', () => {
  // The boundary, because "expires today" is the case a >= vs > mistake hides in.
  const justGone = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isGoldActive({ isGold: true, goldExpiresAt: justGone }), false);
});

check('Gold with no expiry stays active', () => {
  // Every account seeded before memberships existed looks like this. Revoking
  // their benefit retrospectively would be a change nobody asked for.
  assert.equal(isGoldActive({ isGold: true }), true);
});

check('A non-member is never active, expiry or not', () => {
  assert.equal(isGoldActive({ isGold: false, goldExpiresAt: future(30) }), false);
});

check('A null or missing account is not active rather than throwing', () => {
  assert.equal(isGoldActive(null), false);
  assert.equal(isGoldActive(undefined), false);
});

check('An unparseable expiry keeps the benefit rather than withdrawing it', () => {
  // A storage fault on our side must not silently take away something paid for.
  assert.equal(isGoldActive({ isGold: true, goldExpiresAt: 'not-a-date' }), true);
});

/* ------------------------------------------------------------------ *
 *  What is it worth?                                                  *
 * ------------------------------------------------------------------ */

check('A live plan carries its own discount percentage', () => {
  const plan = listPlans()[0];
  const pct = goldDiscountPercent({ isGold: true, goldExpiresAt: future(5), goldPlanId: plan.id });
  assert.equal(pct, plan.extraDiscountPercent);
  assert.ok(pct > 0, 'the default plans must actually be worth something');
});

check('An EXPIRED plan is worth nothing', () => {
  const plan = listPlans()[0];
  assert.equal(
    goldDiscountPercent({ isGold: true, goldExpiresAt: past(1), goldPlanId: plan.id }),
    0
  );
});

check('A member with no recorded plan gets no extra discount', () => {
  // Rather than inheriting whichever plan happens to be first in the list.
  assert.equal(goldDiscountPercent({ isGold: true, goldExpiresAt: future(5) }), 0);
});

/* ------------------------------------------------------------------ *
 *  The bill                                                           *
 * ------------------------------------------------------------------ */

const basket = {
  items: [{ unitPrice: 500, quantity: 1, addonsTotal: 0 }],
  packagingFee: 20,
  distanceKm: 6
};

check('A member pays no delivery fee; a lapsed member pays it', () => {
  const live = calculateOrderPricing({ ...basket, isGold: true });
  const lapsed = calculateOrderPricing({ ...basket, isGold: false });
  assert.equal(live.deliveryFee, 0);
  assert.ok(lapsed.deliveryFee > 0, 'a lapsed member must be charged delivery again');
});

check('The membership discount comes off the food total', () => {
  const plain = calculateOrderPricing({ ...basket, isGold: true });
  const withPlan = calculateOrderPricing({ ...basket, isGold: true, membershipDiscountPercent: 5 });
  assert.equal(withPlan.membershipDiscount, 25, '5% of a 500 rupee basket');
  assert.equal(
    Math.round((plain.totalAmount - withPlan.totalAmount) * 100) / 100,
    25,
    'the discount must actually reduce what is charged'
  );
});

check('The membership discount is its own line, not folded into the coupon', () => {
  const bill = calculateOrderPricing({ ...basket, isGold: true, membershipDiscountPercent: 5 });
  assert.equal(bill.couponDiscount, 0, 'no coupon was applied');
  assert.equal(bill.membershipDiscount, 25, 'so Gold is visible on the bill it paid for');
});

check('Zero percent takes nothing off', () => {
  const bill = calculateOrderPricing({ ...basket, isGold: true, membershipDiscountPercent: 0 });
  assert.equal(bill.membershipDiscount, 0);
});

check('A membership discount stacks with a coupon without going negative', () => {
  const bill = calculateOrderPricing({
    items: [{ unitPrice: 200, quantity: 1, addonsTotal: 0 }],
    packagingFee: 0,
    distanceKm: 1,
    isGold: true,
    membershipDiscountPercent: 50,
    coupon: { discountType: 'FLAT', discountValue: 200, minOrderValue: 0 } as any
  });
  assert.ok(bill.totalAmount >= 0, 'a bill can never be negative');
});

check('An absurd discount percentage is clamped rather than trusted', () => {
  const bill = calculateOrderPricing({ ...basket, isGold: true, membershipDiscountPercent: 900 });
  assert.ok(
    bill.membershipDiscount <= 250,
    `clamped at 50% of 500, got ${bill.membershipDiscount}`
  );
  assert.ok(bill.totalAmount >= 0);
});

/* ------------------------------------------------------------------ *
 *  Plans                                                              *
 * ------------------------------------------------------------------ */

check('Plans are available and priced', () => {
  const plans = listPlans();
  assert.ok(plans.length >= 1);
  assert.ok(plans.every(p => p.price > 0 && p.durationDays > 0));
  assert.ok(plans.every(p => p.benefits.length > 0), 'a plan with no stated benefits sells nothing');
});

check('An administrator can change what Gold costs, and it takes effect', () => {
  const original = listPlans(true);
  savePlans([
    {
      id: 'plan_test_only',
      name: 'Test Plan',
      price: 1,
      durationDays: 7,
      extraDiscountPercent: 12,
      benefits: ['Testing'],
      isActive: true
    }
  ]);
  assert.equal(listPlans().length, 1);
  assert.equal(findPlan('plan_test_only')?.extraDiscountPercent, 12);
  assert.equal(findPlan('plan_gold_monthly'), null, 'a removed plan must really be gone');
  savePlans(original);
  assert.ok(listPlans().length > 1, 'restored');
});

check('An inactive plan is hidden from customers but still resolvable', () => {
  const original = listPlans(true);
  savePlans(original.map(p => ({ ...p, isActive: false })));
  assert.equal(listPlans().length, 0, 'customers see nothing they cannot buy');
  assert.ok(findPlan(original[0].id), 'but an existing member’s plan still resolves');
  savePlans(original);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
