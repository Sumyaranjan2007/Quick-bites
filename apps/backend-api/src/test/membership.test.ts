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
import { memoryStore } from '../db/client.ts';
import {
  isGoldActive,
  goldDiscountPercent,
  listPlans,
  findPlan,
  savePlans,
  goldDeliveryDiscountPercent,
  goldMembersWithoutPlan
} from '../modules/membership/membershipService.ts';

console.log('====================================================');
console.log('  MEMBERSHIP / QUICK BITES GOLD                     ');
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

/*
 * This check used to assert a member's delivery fee was EXACTLY ZERO, and it
 * was right until the benefit stopped being free delivery. The owner replaced
 * it with a percentage per plan, so the assertion moved with the behaviour
 * rather than being relaxed to accommodate it.
 *
 * The numbers are worked out by hand rather than read off the code: this basket
 * travels 6km, the base fee of Rs 30 covers 3km, and the 3 whole kilometres
 * beyond cost Rs 10 each -- Rs 60. Ten percent off is Rs 54 and forty percent
 * off is Rs 36. Asserting the exact figure is the point; "it went down" would
 * pass for any discount, including one that gave the whole fee away.
 */
check('A member pays a discounted delivery fee, not a free one', () => {
  const live = calculateOrderPricing({
    ...basket,
    isGold: true,
    memberDeliveryDiscountPercent: 10,
    memberFreeDeliveryMinOrder: 0
  });
  const lapsed = calculateOrderPricing({ ...basket, isGold: false });

  assert.equal(lapsed.deliveryFee, 60, 'Rs 30 base plus 3 whole km beyond at Rs 10');
  assert.equal(live.deliveryFee, 54, '10% off Rs 60');
  assert.equal(live.membershipDeliverySaving, 6, 'and the saving is stated, not just implied');

  // The old rule is gone, and this is the line that says so. A member paying
  // nothing would mean the zeroing branch had survived.
  assert.notEqual(live.deliveryFee, 0, 'free delivery is no longer the benefit');
  assert.ok(lapsed.deliveryFee > live.deliveryFee, 'a lapsed member pays the full fee');
});

check('A dearer plan is visibly better on the same basket', () => {
  const common = { ...basket, isGold: true, memberFreeDeliveryMinOrder: 0 };
  const gold = calculateOrderPricing({ ...common, memberDeliveryDiscountPercent: 10 });
  const goldMax = calculateOrderPricing({ ...common, memberDeliveryDiscountPercent: 40 });

  assert.equal(gold.deliveryFee, 54);
  assert.equal(goldMax.deliveryFee, 36, '40% off Rs 60');
  assert.equal(goldMax.membershipDeliverySaving, 24);
});

/*
 * The plan-less member, and the edge that undid the branch protecting them.
 *
 * A Gold account with no plan id is not hypothetical: the seeded customer is
 * one, and so is anybody an administrator grants Gold by hand. Under the old
 * free-delivery rule the engine checked `isGold` alone, so they had a benefit.
 * Reading it off a plan they do not have would take it away silently -- no
 * error, no screen, just a delivery fee that used to be lower.
 */
check('A member with no plan keeps a delivery benefit', () => {
  const pct = goldDeliveryDiscountPercent({ isGold: true, goldExpiresAt: future(5) });
  const cheapest = listPlans().slice().sort((a, b) => a.price - b.price)[0];
  assert.equal(pct, cheapest.deliveryDiscountPercent, 'they fall back to the cheapest ACTIVE plan');
  assert.ok(pct! > 0, 'a fallback worth nothing is the same as no fallback');
});

check('and keeps it even when every plan is deactivated', () => {
  const before = listPlans(true);
  try {
    savePlans(before.map(p => ({ ...p, isActive: false })));

    /*
     * listPlans() is active-only, so this returned undefined before it was
     * floored -- the benefit vanishing through the very branch that exists to
     * stop it vanishing. And it is the likely path rather than a contrived one:
     * hiding the old plans while setting up new ones is how a ladder gets
     * restructured, which the owner has just done.
     */
    const pct = goldDeliveryDiscountPercent({ isGold: true, goldExpiresAt: future(5) });
    assert.notEqual(pct, undefined, 'deactivating every plan silently removed the benefit');
    assert.equal(pct, before.slice().sort((a, b) => a.price - b.price)[0].deliveryDiscountPercent);
  } finally {
    savePlans(before);
  }
});

check('A member who BOUGHT a retired plan keeps that plan, not the fallback', () => {
  const before = listPlans(true);
  const dearest = before.slice().sort((a, b) => b.price - a.price)[0];
  try {
    savePlans(before.map(p => (p.id === dearest.id ? { ...p, isActive: false } : p)));

    // They paid for it. findPlan reads listPlans(true) deliberately, so
    // retiring a plan changes what the NEXT person can buy and nothing else.
    const pct = goldDeliveryDiscountPercent({
      isGold: true,
      goldExpiresAt: future(5),
      goldPlanId: dearest.id
    });
    assert.equal(pct, dearest.deliveryDiscountPercent, 'a bought benefit was withdrawn when the plan was hidden');
  } finally {
    savePlans(before);
  }
});

check('The plan-less members are counted, so the anomaly can be closed', () => {
  /*
   * The count is asserted to MOVE rather than to be some fixture's value. This
   * suite seeds nothing, so a bare `count >= 1` failed honestly -- and had it
   * been written against a seeded number it would have passed while measuring
   * somebody else's data rather than this function.
   *
   * Two users are added: one Gold with no plan, who must be counted, and one
   * Gold on a real plan, who must not. A counter that simply counts Gold
   * accounts passes the first half and fails the second.
   */
  const before = goldMembersWithoutPlan();
  const realPlan = listPlans()[0];

  memoryStore.users.set('usr_test_planless', {
    id: 'usr_test_planless',
    isGold: true,
    goldExpiresAt: future(30)
  } as any);
  memoryStore.users.set('usr_test_onplan', {
    id: 'usr_test_onplan',
    isGold: true,
    goldExpiresAt: future(30),
    goldPlanId: realPlan.id
  } as any);

  try {
    const after = goldMembersWithoutPlan();
    assert.equal(after.count, before.count + 1, 'only the member with no plan should be counted');
    assert.equal(
      after.gettingPercent,
      listPlans().slice().sort((a, b) => a.price - b.price)[0].deliveryDiscountPercent,
      'the number reported must be the benefit they are actually getting'
    );
  } finally {
    memoryStore.users.delete('usr_test_planless');
    memoryStore.users.delete('usr_test_onplan');
  }
});

check('The ladder is the one the owner set', () => {
  const plans = listPlans();
  const byPrice = plans.slice().sort((a, b) => a.price - b.price);

  assert.deepEqual(
    byPrice.map(p => [p.price, p.durationDays, p.deliveryDiscountPercent, p.extraDiscountPercent, p.maxDiscountPerOrder]),
    [
      [99, 30, 10, 5, 75],
      [249, 30, 25, 5, 100],
      [799, 60, 40, 7, 150]
    ],
    'the three plans no longer match the ladder that was agreed'
  );
});

/*
 * The benefit lines are DERIVED, and this is the check that keeps them honest.
 *
 * The shipped text once promised "Free delivery on every order" while the code
 * required a Rs 199 basket, on the screen where somebody hands over money. The
 * same sentence would have become false again the moment the benefit turned
 * into a percentage -- and nothing type-checks prose.
 */
check('What a plan promises is what a plan does', () => {
  for (const plan of listPlans()) {
    const delivery = plan.benefits.find(b => /delivery/i.test(b)) || '';

    if (plan.deliveryDiscountPercent >= 100) {
      assert.match(delivery, /free delivery/i, `${plan.name} gives 100% off and should say free`);
    } else {
      assert.doesNotMatch(
        delivery,
        /free delivery/i,
        `${plan.name} promises free delivery but only takes ${plan.deliveryDiscountPercent}% off`
      );
      assert.ok(
        delivery.includes(`${plan.deliveryDiscountPercent}%`),
        `${plan.name} does not state its own delivery percentage: "${delivery}"`
      );
    }

    assert.ok(
      plan.benefits.some(b => b.includes(String(plan.price)) && b.includes(String(plan.durationDays))),
      `${plan.name} does not state its own price and duration`
    );
  }
});

check('An administrator can change the delivery benefit, and it takes', () => {
  const before = listPlans(true);
  const target = before[0];

  /*
   * Saved through savePlans and read back from a FRESH listing, not from the
   * object that was handed in. A field missing from the route's schema is
   * stripped by zod without complaint -- the call succeeds, the screen
   * confirms, and the plan quietly loses its benefit. That is the same shape as
   * the rate that vanished from RATE_BOUNDS, and it is why this reads the value
   * back rather than trusting the setter.
   */
  savePlans(before.map(p => (p.id === target.id ? { ...p, deliveryDiscountPercent: 33 } : p)));

  const after = listPlans(true).find(p => p.id === target.id)!;
  assert.equal(after.deliveryDiscountPercent, 33, 'the change did not survive being saved');
  assert.ok(
    after.benefits.some(b => b.includes('33%')),
    `the benefit line did not follow the change: ${JSON.stringify(after.benefits)}`
  );

  savePlans(before);
  assert.equal(
    listPlans(true).find(p => p.id === target.id)!.deliveryDiscountPercent,
    target.deliveryDiscountPercent,
    'the ladder was not restored'
  );
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
