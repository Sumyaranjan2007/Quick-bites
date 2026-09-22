/**
 * What each restaurant costs, and who gets which part of it.
 *
 * One rule matters more than everything else here, and it is the owner's own:
 * a partner declares ₹15 packaging, an administrator charges the customer ₹30,
 * **the partner earns ₹15 and the ₹15 difference is ours.**
 *
 * The dangerous property of getting that wrong is that nothing looks broken.
 * The bill adds up either way. The ledger balances either way. The money simply
 * leaves. So most of this file is about asserting where each rupee lands rather
 * than that the arithmetic terminates.
 */
import assert from 'node:assert';
import { memoryStore } from '../db/client.ts';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import { resetLedgerForTesting, ledger, accountFor } from '../modules/payments/ledger.ts';
import { toPaise } from '../modules/payments/money.ts';
import { resetConfigsForTesting, getActiveRates, createVersion } from '../modules/payments/pricingConfig.ts';
import { calculateTripPayout } from '../routes/riderRouter.ts';
import {
  effectiveCharges,
  setCharges,
  platformMarginPaiseFor,
  resetRestaurantChargesForTesting,
  customerDishPrice,
  inflateMenuForCustomer
} from '../modules/payments/restaurantCharges.ts';
import {
  splitForOrder,
  recordOrderEarnings,
  deliveryEvidence,
  settlementEvidence,
  heldEarnings,
  backfillEarnings
} from '../modules/payments/earnings.ts';
import {
  addAccount,
  reviewAccount,
  reviewQueue,
  payableAccountFor,
  allAccounts,
  awaitingApply,
  accountBlockReason,
  resetPayeeAccountsForTesting
} from '../modules/payments/payeeAccounts.ts';
import {
  incentiveSettings,
  setIncentiveSettings,
  settingFor,
  resetIncentiveConfigForTesting
} from '../modules/payments/incentiveConfig.ts';

console.log('====================================================');
console.log('  PER-RESTAURANT CHARGES AND WHO KEEPS WHAT         ');
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

async function rejects(name: string, code: string, fn: () => unknown): Promise<void> {
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

const RESTAURANT = 'rst_charge_1';
const ADMIN = 'usr_admin_charge';

async function run() {
  resetLedgerForTesting();
  resetConfigsForTesting();
  resetRestaurantChargesForTesting();
  resetIncentiveConfigForTesting();
  resetPayeeAccountsForTesting();
  memoryStore.restaurants.clear();
  memoryStore.orders.clear();
  memoryStore.riders.clear();
  memoryStore.menus.clear();

  memoryStore.restaurants.set(RESTAURANT, {
    id: RESTAURANT,
    name: 'Ganesh Bhavan',
    // What the partner declared. The other session's app writes this.
    partnerPackagingFee: 15
  });

  /* ---------------------------------------------------------------- *
   *  THE MARKUP RULE                                                  *
   * ---------------------------------------------------------------- */

  await check('With no markup set, the customer pays exactly what the partner asked for', () => {
    const charges = effectiveCharges(RESTAURANT);
    assert.equal(charges.partnerPackagingFee, 15);
    assert.equal(charges.customerPackagingFee, 15, 'a restaurant nobody has looked at was marked up');
    assert.equal(charges.packagingMarkup, 0);
    assert.equal(charges.partnerFeeAdjusted, false);
  });

  await check('A restaurant that has never declared one falls back to the platform default', () => {
    // NOT to zero. Charging a customer nothing for packaging because a partner
    // has not filled in a form is a silent discount funded by us.
    memoryStore.restaurants.set('rst_silent', { id: 'rst_silent', name: 'Silent Kitchen' });
    const charges = effectiveCharges('rst_silent');
    assert.equal(charges.partnerPackagingFee, getActiveRates().packagingFeeDefault);
  });

  await check('An administrator can charge more than the partner asked for', () => {
    const charges = setCharges(RESTAURANT, { packagingMarkup: 15 }, ADMIN, 'Standard markup');
    assert.equal(charges.partnerPackagingFee, 15, 'the markup changed what the partner earns');
    assert.equal(charges.packagingMarkup, 15);
    assert.equal(charges.customerPackagingFee, 30, 'approved + markup');
  });

  await check('THE RULE: the customer pays 30, the partner earns 15, and 15 is ours', () => {
    /*
     * The owner's sentence, asserted end to end through the real pricing engine
     * rather than through the charges module alone — the charges module could be
     * perfectly right and the engine still pay the wrong figure.
     */
    const charges = effectiveCharges(RESTAURANT);
    const bill = calculateOrderPricing({
      items: [{ unitPrice: 500, quantity: 1 }],
      packagingFee: charges.customerPackagingFee,
      partnerPackagingFee: charges.partnerPackagingFee,
      gstFoodPercent: charges.gstFoodPercent,
      platformFeeBase: charges.platformFee,
      deliveryBaseFee: charges.deliveryBaseFee,
      commissionPercent: charges.commissionPercent,
      rates: getActiveRates()
    });

    assert.equal(bill.packagingFee, 30, 'the customer was not charged the marked-up figure');
    assert.equal(bill.partnerPackagingFee, 15, 'the partner figure did not survive onto the bill');

    // Food 500 − 15% commission (75) − 1% TDS (5) + packaging 15 = 435.
    assert.equal(bill.restaurantNetPayout, 435, 'the restaurant was paid the markup');

    // And the customer really did pay the extra fifteen.
    const withoutMarkup = calculateOrderPricing({
      items: [{ unitPrice: 500, quantity: 1 }],
      packagingFee: 15,
      partnerPackagingFee: 15,
      rates: getActiveRates()
    });
    assert.equal(
      Math.round((bill.totalAmount - withoutMarkup.totalAmount) * 100) / 100,
      15,
      'the markup never reached the customer'
    );
  });

  await check('THE SECOND LEVER: an administrator can change what the partner EARNS', () => {
    /*
     * The owner asked for two levers, not one: *"there will be both features —
     * that we can increase theirs and ours."*
     *
     * Before this, a partner's declared figure was final and the only editable
     * number was the customer-facing total. That is not an oversight, it is a
     * hole: a partner could set their own earnings by declaring whatever they
     * liked, and the platform's only recourse was to raise the customer price
     * to compensate — which punishes the customer for the partner's number.
     */
    const charges = setCharges(RESTAURANT, { partnerApprovedFee: 25 }, ADMIN, 'Rs 40 was too high');

    assert.equal(charges.partnerDeclaredFee, 15, 'their own declaration was overwritten');
    assert.equal(charges.partnerPackagingFee, 25, 'the approved figure did not take effect');
    assert.equal(charges.partnerFeeAdjusted, true);

    // And it moved the customer's total, because the markup is unchanged.
    assert.equal(charges.customerPackagingFee, 40, '25 approved + 15 markup');

    // Put it back for the tests below.
    setCharges(RESTAURANT, { partnerApprovedFee: null }, ADMIN, 'Back to their own figure');
    assert.equal(effectiveCharges(RESTAURANT).partnerPackagingFee, 15);
    assert.equal(effectiveCharges(RESTAURANT).partnerFeeAdjusted, false);
  });

  await check('The two levers move independently', () => {
    /*
     * The property the stored-total model could not give you. With a customer
     * total stored, raising what a partner earns silently ate the margin; here
     * each number changes exactly one thing.
     */
    setCharges(RESTAURANT, { partnerApprovedFee: 20, packagingMarkup: 15 }, ADMIN);
    const before = effectiveCharges(RESTAURANT);
    assert.equal(before.partnerPackagingFee, 20);
    assert.equal(before.packagingMarkup, 15);
    assert.equal(before.customerPackagingFee, 35);

    // Raise only the partner's share.
    setCharges(RESTAURANT, { partnerApprovedFee: 30 }, ADMIN);
    const raised = effectiveCharges(RESTAURANT);
    assert.equal(raised.packagingMarkup, 15, 'raising their pay changed our margin');
    assert.equal(raised.customerPackagingFee, 45);

    // Raise only ours.
    setCharges(RESTAURANT, { packagingMarkup: 25 }, ADMIN);
    const marked = effectiveCharges(RESTAURANT);
    assert.equal(marked.partnerPackagingFee, 30, 'raising our margin changed their pay');
    assert.equal(marked.customerPackagingFee, 55);

    setCharges(RESTAURANT, { partnerApprovedFee: null, packagingMarkup: 15 }, ADMIN);
  });

  await check('And the LEDGER pays the partner the same 435, not 450', () => {
    // The place the money actually leaves from. A pricing engine that is right
    // and an earnings split that is wrong would still hand over the markup.
    const order: any = {
      id: 'ord_markup_1',
      orderNumber: 'QB-900001',
      restaurantId: RESTAURANT,
      riderId: 'rdr_charge_1',
      customerId: 'usr_cust_charge',
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
        packagingFee: 30,
        partnerPackagingFee: 15,
        deliveryFee: 30,
        platformFee: 5.9,
        couponDiscount: 0,
        tipAmount: 0,
        totalAmount: 590.9,
        commissionPercent: 15,
        commissionAmount: 75,
        tdsAmount: 5
      }
    };

    const split = splitForOrder(order);
    assert.equal(split.partnerPaise, toPaise(435), 'the split paid out the platform markup');

    memoryStore.orders.set(order.id, order);
    recordOrderEarnings(order);

    const balance = ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT));
    assert.equal(balance, toPaise(435), 'the ledger owes the restaurant our own revenue');
    assert.equal(ledger.audit().balanced, true);
  });

  await check('An order with no partner figure at all is read as no markup', () => {
    // Every order placed before this feature existed. Falling back to zero
    // would retroactively cut every one of those settlements.
    const legacy: any = {
      bill: { itemsTotal: 500, packagingFee: 20, commissionAmount: 75, tdsAmount: 5 },
      riderPayout: 40
    };
    assert.equal(splitForOrder(legacy).partnerPaise, toPaise(440), '500 + 20 − 75 − 5');
  });

  await check('What we made on the order is reported line by line', () => {
    const order = memoryStore.orders.get('ord_markup_1');
    const margin = platformMarginPaiseFor(order);
    assert.equal(margin.commissionPaise, toPaise(75));
    assert.equal(margin.packagingMarginPaise, toPaise(15), 'the packaging markup is not counted as ours');
    assert.equal(margin.platformFeePaise, toPaise(5.9));
    // Delivery charged 30, rider paid 40: a real loss, reported as one.
    assert.equal(margin.deliveryMarginPaise, toPaise(-10), 'a loss-making delivery was hidden');
    assert.equal(margin.totalPaise, toPaise(85.9));
  });

  /* ---------------------------------------------------------------- *
   *  THE REST OF THE CHARGES                                          *
   * ---------------------------------------------------------------- */

  await check('A field left alone keeps following the platform default when it moves', () => {
    /*
     * The distinction that makes this screen work. Copying the default into
     * every restaurant would look identical today and mean that changing the
     * platform fee later moved nothing — the most confusing failure a pricing
     * screen can have.
     */
    assert.equal(effectiveCharges(RESTAURANT).commissionPercent, getActiveRates().defaultCommissionPercent);
    assert.equal(effectiveCharges(RESTAURANT).overridden.includes('commissionPercent'), false);

    setCharges(RESTAURANT, { commissionPercent: 22 }, ADMIN);
    assert.equal(effectiveCharges(RESTAURANT).commissionPercent, 22);
    assert.ok(effectiveCharges(RESTAURANT).overridden.includes('commissionPercent'));
  });

  await check('Per-restaurant charges really reach the customer bill', () => {
    setCharges(RESTAURANT, { platformFee: 12, gstFoodPercent: 12, extraCharge: 9, extraChargeLabel: 'Surge' }, ADMIN);
    const charges = effectiveCharges(RESTAURANT);

    const bill = calculateOrderPricing({
      items: [{ unitPrice: 100, quantity: 1 }],
      packagingFee: charges.customerPackagingFee,
      partnerPackagingFee: charges.partnerPackagingFee,
      gstFoodPercent: charges.gstFoodPercent,
      platformFeeBase: charges.platformFee,
      deliveryBaseFee: charges.deliveryBaseFee,
      extraCharge: charges.extraCharge,
      extraChargeLabel: charges.extraChargeLabel,
      commissionPercent: charges.commissionPercent,
      rates: getActiveRates()
    });

    assert.equal(bill.gstAmount, 12, 'the restaurant GST rate was ignored');
    assert.equal(bill.platformFee, 14.16, '12 plus 18% GST on the fee');
    assert.equal(bill.extraCharge, 9);
    assert.equal(bill.extraChargeLabel, 'Surge');
    assert.ok(
      bill.totalAmount > 100 + 12 + 9,
      'the extra charge never reached the total'
    );
  });

  await rejects('An unnamed extra charge is refused', 'EXTRA_CHARGE_NEEDS_LABEL', () =>
    setCharges(RESTAURANT, { extraCharge: 20, extraChargeLabel: '' }, ADMIN)
  );

  await rejects('A commission outside the allowed band is refused', 'CHARGE_OUT_OF_RANGE', () =>
    setCharges(RESTAURANT, { commissionPercent: 90 }, ADMIN)
  );

  await rejects('Charges cannot be set for a restaurant that does not exist', 'RESTAURANT_NOT_FOUND', () =>
    setCharges('rst_nope', { platformFee: 5 }, ADMIN)
  );

  /* ---------------------------------------------------------------- *
   *  THE BONUSES THE OWNER NEVER APPROVED                             *
   * ---------------------------------------------------------------- */

  await check('Every rider bonus ships switched OFF', () => {
    /*
     * The owner's complaint, made into a test: *"I sometimes give bonus of 700
     * to the rider. I don't want to do that."* The safe default for
     * automatically giving money away is not to.
     */
    for (const incentive of incentiveSettings()) {
      assert.equal(incentive.enabled, false, `${incentive.code} still pays out by default`);
      assert.equal(settingFor(incentive.code), null, `${incentive.code} is still live`);
    }
  });

  await check('The Rs 700 one specifically is off, and is still there to switch on', () => {
    const week40 = incentiveSettings().find(i => i.code === 'WEEK_40')!;
    assert.equal(week40.enabled, false);
    assert.equal(week40.reward, 700, 'the amount was zeroed rather than disabled');
  });

  await check('Switching one on makes it live, at the amount set', () => {
    setIncentiveSettings([{ code: 'DAILY_8', enabled: true, reward: 150, target: 10 }], ADMIN);
    const live = settingFor('DAILY_8');
    assert.ok(live, 'switching it on did not make it live');
    assert.equal(live!.reward, 150);
    assert.equal(live!.target, 10);

    // And the others are untouched.
    assert.equal(settingFor('WEEK_40'), null);
  });

  await check('Switching it back off makes it inert again', () => {
    setIncentiveSettings([{ code: 'DAILY_8', enabled: false }], ADMIN);
    assert.equal(settingFor('DAILY_8'), null);
    // The amount they chose is remembered for next time.
    assert.equal(incentiveSettings().find(i => i.code === 'DAILY_8')!.reward, 150);
  });

  await rejects('A bonus beyond the allowed ceiling is refused', 'REWARD_OUT_OF_RANGE', () =>
    setIncentiveSettings([{ code: 'WEEK_40', reward: 50000 }], ADMIN)
  );

  /* ---------------------------------------------------------------- *
   *  AND SOMEBODY CAN ACTUALLY BE PAID                                *
   * ---------------------------------------------------------------- */

  await check('An account nothing could check reaches a human, and can be approved', async () => {
    /*
     * The worst defect in this release, and it was silent.
     *
     * Without bank verification switched on — which is every deployment today —
     * a new account lands on UNVERIFIED. `reviewQueue` only listed
     * NAME_MISMATCH, and `reviewAccount` only accepted NAME_MISMATCH. So the
     * account could never be approved, never appeared in the queue, and
     * `payableAccountFor` returns only VERIFIED accounts.
     *
     * Nobody on the platform could be paid at all, while the partner was told
     * "our team will verify this account by hand before your first payout."
     * There was no by-hand path.
     */
    const account = await addAccount({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerUserId: 'usr_partner_charge',
      createdByUserId: 'usr_partner_charge',
      kycName: 'Ganesh Bhavan',
      method: 'VPA',
      holderName: 'Ganesh Bhavan',
      vpa: 'ganesh@okicici'
    });

    assert.equal(account.validationStatus, 'UNVERIFIED', 'no gateway, so nothing checked it');
    assert.equal(payableAccountFor('RESTAURANT', RESTAURANT), null, 'an unchecked account was payable');

    assert.ok(
      reviewQueue().some(a => a.id === account.id),
      'an account nobody can check is invisible to the person who has to decide'
    );

    reviewAccount(account.id, 'APPROVE', { userId: ADMIN }, 'Checked the passbook photo');

    const payable = payableAccountFor('RESTAURANT', RESTAURANT);
    assert.ok(payable, 'approving it still left nowhere to send money');
    assert.equal(payable!.id, account.id);
  });

  await check('And the approval is stamped as done by hand, not by a bank', () => {
    // A real decision with a real risk: the first payout is the test. It must
    // not look identical to an account a bank confirmed.
    const account = payableAccountFor('RESTAURANT', RESTAURANT)! as any;
    assert.equal(account.manuallyApproved, true);
    assert.equal(account.manuallyApprovedByUserId, ADMIN);
  });

  /* ---------------------------------------------------------------- *
   *  APPLYING AN ACCOUNT                                              *
   * ---------------------------------------------------------------- *
   *
   * Verification and application answer different questions. The bank says
   * the account exists and whose name is on it; a person at the platform
   * decides to pay it. The owner asked that their decision be the one that
   * matters, and the defect they reported was that an account which PASSED
   * the automatic check appeared on no screen at all — so it could never be
   * looked at, and the partner behind it went unpaid with nothing explaining
   * why.
   */

  await check('An account the bank verified is still not payable until applied', () => {
    const fresh = memoryStore.payeeAccounts;
    const account: any = Array.from(fresh.values()).find(
      (a: any) => a.ownerId === RESTAURANT && !a.archivedAt
    );
    assert.ok(account, 'no account to work with');

    // Exactly what an automatic penny drop leaves behind: passed, untouched
    // by a person.
    account.validationStatus = 'VERIFIED';
    account.appliedAt = undefined;
    account.appliedByAdminId = undefined;
    fresh.set(account.id, account);

    assert.equal(
      payableAccountFor('RESTAURANT', RESTAURANT),
      null,
      'a verified account nobody applied was payable'
    );
  });

  await check('It appears in the full list even though the review queue omits it', () => {
    // The reported defect, stated as an assertion. reviewQueue is right to
    // show only failures; the bug was that nothing else showed anything.
    const inQueue = reviewQueue().some(a => a.ownerId === RESTAURANT);
    const inList = allAccounts().some(a => a.ownerId === RESTAURANT);
    assert.equal(inQueue, false, 'a passed account is in the failure queue');
    assert.equal(inList, true, 'a passed account is invisible to the owner');
    assert.equal(awaitingApply().some(a => a.ownerId === RESTAURANT), true);
  });

  await check('The refusal says to apply it, not that the account is missing', () => {
    /*
     * Asserted because the wrong sentence here has a real cost: an
     * administrator told "they have no account" goes and asks the partner to
     * re-submit details that are already correct, and the partner cannot tell
     * what is being asked of them.
     */
    const reason = accountBlockReason('RESTAURANT', RESTAURANT) || '';
    assert.match(reason, /appl(y|ied)/i, `unhelpful refusal: ${reason}`);
    assert.doesNotMatch(reason, /have not given us/i);
  });

  await check('Applying it makes it payable, and records who decided', () => {
    const account: any = awaitingApply().find(a => a.ownerId === RESTAURANT);
    reviewAccount(account.id, 'APPROVE', { userId: ADMIN }, 'Checked against their KYC.');

    const payable: any = payableAccountFor('RESTAURANT', RESTAURANT);
    assert.ok(payable, 'applying it did not make it payable');
    assert.equal(payable.id, account.id);
    assert.ok(payable.appliedAt, 'nothing recorded when it was applied');
    assert.equal(payable.appliedByAdminId, ADMIN, 'nobody is on record as having decided');
    assert.equal(accountBlockReason('RESTAURANT', RESTAURANT), null);

    /*
     * The nav badge counts this. Asserting it MOVES, not merely that it is a
     * number: a badge wired to a predicate that matches nothing renders zero,
     * and zero reads as "nothing to do" — the exact thing the badge exists to
     * prevent, wearing a reassuring face.
     */
    assert.equal(
      awaitingApply().some(a => a.ownerId === RESTAURANT),
      false,
      'the badge would still show this account as needing a decision'
    );
  });

  await check('Changing bank details does not inherit the old approval', async () => {
    /*
     * The property that matters most on this screen, and it is a security one.
     *
     * Adding an account archives the previous one, and the replacement arrives
     * with isDefault already true. If payability followed isDefault, anyone who
     * could change a payee's bank details could redirect their money using an
     * approval somebody granted for a different account. It follows appliedAt
     * instead, so the swap lands unpaid until a person looks at it again.
     */
    const second = await addAccount({
      ownerType: 'RESTAURANT',
      ownerId: RESTAURANT,
      ownerUserId: 'usr_partner_charge',
      method: 'UPI',
      holderName: 'Ganesh Bhavan',
      vpa: 'ganesh@okaxis',
      createdByUserId: 'usr_partner_charge'
    });

    assert.equal(second.isDefault, true, 'the replacement is not the default');
    assert.equal(
      payableAccountFor('RESTAURANT', RESTAURANT),
      null,
      'new bank details inherited the approval given to the old ones'
    );
    assert.match(accountBlockReason('RESTAURANT', RESTAURANT) || '', /appl(y|ied)/i);

    reviewAccount(second.id, 'APPROVE', { userId: ADMIN }, 'Partner asked us to switch to UPI.');

    const live = allAccounts().filter(a => a.ownerId === RESTAURANT);
    assert.equal(live.length, 1, 'the archived account is still in the list');
    assert.equal(payableAccountFor('RESTAURANT', RESTAURANT)!.id, second.id);
  });

  await rejects('An account the BANK refused cannot be approved by hand', 'PAYEE_ACCOUNT_NOT_IN_REVIEW', async () => {
    /*
     * The other half of opening the queue up, and the half that keeps the
     * penny drop meaningful.
     *
     * UNVERIFIED means nobody checked — a judgement call. INVALID means the
     * bank was asked and said the account does not exist. Letting a person
     * override the second turns bank verification into advice, and the whole
     * reason it exists is that one wrong digit sends a settlement to a
     * stranger who will not give it back.
     *
     * A mutation run caught this: widening the check to "anything not already
     * verified" passed every test in this file.
     */
    const refused = await addAccount({
      ownerType: 'RIDER',
      ownerId: 'rdr_refused',
      ownerUserId: 'usr_rider_refused',
      createdByUserId: 'usr_rider_refused',
      kycName: 'Someone Else',
      method: 'VPA',
      holderName: 'Someone Else',
      vpa: 'someone@okaxis'
    });
    refused.validationStatus = 'INVALID';
    memoryStore.payeeAccounts.set(refused.id, refused);

    return reviewAccount(refused.id, 'APPROVE', { userId: ADMIN }, 'Looks fine to me');
  });

  await check('A membership discount cannot exceed the plan cap', () => {
    /*
     * A percentage with no ceiling is not a discount, it is an open liability:
     * one large basket can cost more than the membership sold for. Also caught
     * by mutation — nothing asserted the cap at all.
     */
    const big = calculateOrderPricing({
      items: [{ unitPrice: 5000, quantity: 1 }],
      membershipDiscountPercent: 5,
      membershipMaxDiscount: 75,
      rates: getActiveRates()
    });
    assert.equal(big.membershipDiscount, 75, '5% of 5000 was allowed through uncapped');

    // And a small order is unaffected by the ceiling.
    const small = calculateOrderPricing({
      items: [{ unitPrice: 200, quantity: 1 }],
      membershipDiscountPercent: 5,
      membershipMaxDiscount: 75,
      rates: getActiveRates()
    });
    assert.equal(small.membershipDiscount, 10, 'the cap ate into an order below it');

    // No cap set behaves as it did before caps existed.
    const uncapped = calculateOrderPricing({
      items: [{ unitPrice: 5000, quantity: 1 }],
      membershipDiscountPercent: 5,
      rates: getActiveRates()
    });
    assert.equal(uncapped.membershipDiscount, 250);
  });

  await check('A member only gets free delivery above their own plan floor', () => {
    const below = calculateOrderPricing({
      items: [{ unitPrice: 150, quantity: 1 }],
      isGold: true,
      memberFreeDeliveryMinOrder: 199,
      rates: getActiveRates()
    });
    assert.ok(below.deliveryFee > 0, 'delivery was free below the plan floor');

    const above = calculateOrderPricing({
      items: [{ unitPrice: 250, quantity: 1 }],
      isGold: true,
      memberFreeDeliveryMinOrder: 199,
      rates: getActiveRates()
    });
    assert.equal(above.deliveryFee, 0);
  });

  /* ---------------------------------------------------------------- *
   *  FOOD PRICE MARKUP                                                *
   * ---------------------------------------------------------------- */

  await check('A dish is marked up per dish, and rounded to whole rupees', () => {
    /*
     * Rounded per dish rather than per basket. Rounding the whole basket makes
     * the sum of the prices on screen differ from the checkout total by a rupee
     * or two, and a customer who notices that once never trusts the bill again.
     */
    assert.equal(customerDishPrice(200, 20), 240);
    assert.equal(customerDishPrice(125, 10), 138, '137.5 rounds to a price, not a fraction');
    assert.equal(customerDishPrice(200, 0), 200, 'no markup changed the price');
    assert.equal(customerDishPrice(0, 20), 0);
  });

  await check('THE RULE: the customer pays the inflated price, the kitchen earns its own', () => {
    // Every rate this check depends on is set here rather than inherited from
    // an earlier one. A test that reads whatever the previous test left behind
    // fails for reasons that have nothing to do with what it is testing —
    // which is exactly what happened on the first run of this check.
    setCharges(
      RESTAURANT,
      { foodMarkupPercent: 20, packagingMarkup: 0, partnerApprovedFee: null, commissionPercent: 15 },
      ADMIN
    );
    const charges = effectiveCharges(RESTAURANT);
    assert.equal(charges.foodMarkupPercent, 20);

    // One dish the kitchen priced at Rs 500. The customer sees Rs 600.
    const customerPrice = customerDishPrice(500, charges.foodMarkupPercent);
    assert.equal(customerPrice, 600);

    const bill = calculateOrderPricing({
      items: [{ unitPrice: customerPrice, quantity: 1 }],
      partnerItemsTotal: 500,
      packagingFee: charges.customerPackagingFee,
      partnerPackagingFee: charges.partnerPackagingFee,
      commissionPercent: charges.commissionPercent,
      rates: getActiveRates()
    });

    assert.equal(bill.itemsTotal, 600, 'the customer was not charged the marked-up price');
    assert.equal(bill.partnerItemsTotal, 500, 'the kitchen figure did not survive onto the bill');

    /*
     * Commission on 500, NOT on 600.
     *
     * Taking it on the inflated figure would charge the kitchen for money that
     * never reached them — and they would be right to dispute every settlement.
     */
    assert.equal(bill.commissionAmount, 75, '15% of 500; commission was taken on our own markup');
    assert.equal(bill.tdsAmount, 5, '1% of 500; tax was withheld against supplies they did not make');

    // 500 − 75 − 5 + 15 packaging = 435. The markup is not in it.
    assert.equal(bill.restaurantNetPayout, 435, 'the kitchen was paid our markup');
  });

  await check('And the LEDGER pays the kitchen 435, not 535', () => {
    const order: any = {
      id: 'ord_foodmarkup_1',
      orderNumber: 'QB-900002',
      restaurantId: RESTAURANT,
      riderId: 'rdr_charge_1',
      customerId: 'usr_cust_charge',
      status: 'DELIVERED',
      pickedUpAt: new Date(Date.now() - 86_400_000).toISOString(),
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY_SANDBOX',
      razorpayPaymentId: 'pay_test_fixture',
      riderPayout: 37,
      deliveredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      updatedAt: new Date().toISOString(),
      bill: {
        itemsTotal: 600,
        partnerItemsTotal: 500,
        gstAmount: 30,
        packagingFee: 15,
        partnerPackagingFee: 15,
        deliveryFee: 40,
        platformFee: 5.9,
        couponDiscount: 0,
        tipAmount: 0,
        totalAmount: 690.9,
        commissionPercent: 15,
        commissionAmount: 75,
        tdsAmount: 5
      }
    };

    const split = splitForOrder(order);
    assert.equal(split.partnerPaise, toPaise(435), 'the split handed over the food markup');
    assert.equal(split.foodMarkupPaise, toPaise(100), 'the markup was not counted as ours');

    memoryStore.orders.set(order.id, order);
    recordOrderEarnings(order);
    assert.equal(ledger.audit().balanced, true);
  });

  await check('The food markup is reported as platform revenue', () => {
    const margin = platformMarginPaiseFor(memoryStore.orders.get('ord_foodmarkup_1'));
    assert.equal(margin.foodMarkupPaise, toPaise(100));
    assert.equal(margin.commissionPaise, toPaise(75));
    // 100 markup + 75 commission + 5.90 fee + (40 delivery − 37 rider) = 183.90
    assert.equal(margin.totalPaise, toPaise(183.9));
  });

  await check('An order placed before markups existed is read as no markup', () => {
    // Every order already in the database. Falling back to zero would
    // retroactively cut every one of those settlements by the whole food total.
    const legacy: any = {
      bill: { itemsTotal: 500, packagingFee: 20, commissionAmount: 75, tdsAmount: 5 },
      riderPayout: 37
    };
    assert.equal(splitForOrder(legacy).partnerPaise, toPaise(440), '500 + 20 − 75 − 5');
    assert.equal(splitForOrder(legacy).foodMarkupPaise, 0);
  });

  await check('A whole menu is inflated consistently, add-ons included', () => {
    /*
     * Add-ons are marked up with the dish. Leaving them raw would let a
     * customer dodge the markup by ordering a cheap base with expensive extras,
     * which is the kind of hole somebody finds within a week.
     */
    memoryStore.menus.set(RESTAURANT, {
      id: 'menu_1',
      restaurantId: RESTAURANT,
      categories: [
        {
          id: 'cat_1',
          name: 'Mains',
          items: [
            {
              id: 'dish_1',
              name: 'Biryani',
              price: 300,
              optionGroups: [{ id: 'g1', options: [{ id: 'o1', priceDelta: 50 }] }]
            }
          ]
        }
      ]
    });

    // Held before the call so we can prove the stored object was not touched at
    // all, not merely that its numbers came out the same. A version that
    // reassigned the stored categories left every value identical and passed.
    const storedCategories = memoryStore.menus.get(RESTAURANT).categories;
    const storedItems = storedCategories[0].items;

    const shown: any = inflateMenuForCustomer(memoryStore.menus.get(RESTAURANT), RESTAURANT);
    const dish = shown.categories[0].items[0];

    assert.equal(dish.price, 360, '300 plus 20%');
    assert.equal(dish.partnerPrice, 300, 'the kitchen figure was lost');
    assert.equal(dish.optionGroups[0].options[0].priceDelta, 60, 'an add-on escaped the markup');

    /*
     * The stored menu is untouched. Inflation is a VIEW, not a write.
     *
     * Compared as a whole rather than one price, because a version that copied
     * the categories and mutated something deeper passed the single-field
     * check. If this ever writes back, the kitchen's own menu silently becomes
     * the marked-up one and the markup compounds on every read.
     */
    const stored = memoryStore.menus.get(RESTAURANT);
    assert.notEqual(shown, stored, 'the same object was handed back');
    assert.equal(stored.categories, storedCategories, 'the stored categories were replaced');
    assert.equal(stored.categories[0].items, storedItems, 'the stored items were replaced');
    assert.deepEqual(
      JSON.parse(JSON.stringify(stored)),
      {
        id: 'menu_1',
        restaurantId: RESTAURANT,
        categories: [
          {
            id: 'cat_1',
            name: 'Mains',
            items: [
              {
                id: 'dish_1',
                name: 'Biryani',
                price: 300,
                optionGroups: [{ id: 'g1', options: [{ id: 'o1', priceDelta: 50 }] }]
              }
            ]
          }
        ]
      },
      'inflating the menu wrote back to the stored one'
    );
  });

  await check('With no markup set, the menu is returned untouched and unwrapped', () => {
    setCharges(RESTAURANT, { foodMarkupPercent: 0 }, ADMIN);
    const stored = memoryStore.menus.get(RESTAURANT);
    const shown: any = inflateMenuForCustomer(stored, RESTAURANT);

    assert.equal(shown.categories[0].items[0].price, 300);
    /*
     * The SAME object, not a rebuilt copy.
     *
     * Asserting identity rather than equality pins the early return. A version
     * that rebuilt the whole menu with a zero markup produced identical prices
     * and passed — while quietly adding fields and allocating a new object on
     * every menu read, for every restaurant, forever.
     */
    assert.equal(shown, stored, 'a menu with no markup was rebuilt rather than returned');

    setCharges(RESTAURANT, { foodMarkupPercent: 20 }, ADMIN);
  });

  /* ---------------------------------------------------------------- *
   *  DELIVERY MUST NOT LOSE MONEY ON EVERY ORDER                      *
   * ---------------------------------------------------------------- */

  await check('A rider is paid from the configured rates, not a hardcoded figure', () => {
    /*
     * The single most expensive defect in the platform, and it was silent.
     *
     * The old formula was `40 + the whole delivery fee + tip`. The customer is
     * charged Rs 30 for delivery, so the platform collected 30 and paid 70 — a
     * Rs 40 loss on every delivery before anything else was counted. It also
     * paid for distance twice, since the delivery fee already scales with it.
     *
     * Worse, the four rider rates on the Rates screen were read by nothing.
     * They were editable, displayed, and moved no money at all.
     */
    const rates = getActiveRates();

    // 3.2 km: base 25, and 1.2 km beyond the 2 km floor rounds UP to 2 whole
    // km at Rs 6 = 12. Whole kilometres, matching how the customer is charged.
    assert.equal(calculateTripPayout({ distanceKm: 3.2 }), 37);

    // A very short trip is floored at the guaranteed minimum.
    assert.equal(calculateTripPayout({ distanceKm: 0.5 }), rates.riderMinEarningPerTrip);

    // And the delivery fee no longer enters the rider's pay at all.
    assert.equal(
      calculateTripPayout({ distanceKm: 3.2, bill: { deliveryFee: 500 } }),
      37,
      'the delivery fee is being paid to the rider on top of their own rate'
    );
  });

  await check('Changing a rider rate actually changes what a rider is paid', () => {
    // The property that was missing entirely: these numbers moved nothing.
    createVersion({ riderBaseFeePerTrip: 40, riderPerKmFee: 10 }, { userId: ADMIN }, 'Higher rider pay');
    assert.equal(calculateTripPayout({ distanceKm: 3.2 }), 60, '40 base + 2 whole km at 10');
    createVersion({ riderBaseFeePerTrip: 25, riderPerKmFee: 6 }, { userId: ADMIN }, 'Back');
  });

  await check('The tip reaches the rider on top, in full', () => {
    assert.equal(calculateTripPayout({ distanceKm: 3.2, bill: { tipAmount: 50 } }), 87);
  });

  await check('A small order is PROFITABLE, which it was not before', () => {
    /*
     * The owner's actual question: *"pricing is fixed so we can actually earn
     * rather than just earning on small platform fee."*
     *
     * Modelled on the real engine rather than by hand. A Rs 200 order over
     * 3.2 km used to lose the platform Rs 5; the commission was entirely eaten
     * by the delivery subsidy.
     */
    // Restored explicitly rather than relying on the previous check having
    // cleaned up: a failed assertion skips the restore, and the next test then
    // fails for a reason that has nothing to do with what it is testing.
    createVersion({ riderBaseFeePerTrip: 25, riderPerKmFee: 6 }, { userId: ADMIN }, 'Defaults');

    const rates = getActiveRates();
    const bill = calculateOrderPricing({
      items: [{ unitPrice: 200, quantity: 1 }],
      distanceKm: 3.2,
      rates
    });

    const commission = 200 * (rates.defaultCommissionPercent / 100);
    const riderPay = calculateTripPayout({ distanceKm: 3.2 });
    // The platform fee net of the GST charged on it, which is remitted onward.
    const margin = commission + rates.platformFeeBase + (bill.deliveryFee - riderPay);

    assert.ok(margin > 0, `a small order still loses money: ${margin}`);
    assert.ok(
      bill.deliveryFee >= riderPay,
      `delivery is charged at ${bill.deliveryFee} and paid at ${riderPay} — still a subsidy`
    );
  });

  /* ---------------------------------------------------------------- *
   *  WHAT MAY BECOME MONEY OWED                                       *
   * ---------------------------------------------------------------- *
   *
   * Everything above proves the split is right. This proves it is only
   * ever APPLIED to an order that earned it.
   *
   * Two independent things have to be true — the food moved, and the money
   * arrived — and the dangerous case is the one where only the first is.
   * Both are asserted by REASON rather than by "it threw", because an order
   * id that does not exist and an order that was never collected would both
   * throw, and a test that accepts any refusal cannot tell the difference.
   */

  const deliveredOrder = (over: Record<string, unknown> = {}) => ({
    id: `ord_gate_${Math.random().toString(36).slice(2, 8)}`,
    orderNumber: 'QB-940001',
    restaurantId: RESTAURANT,
    riderId: 'rdr_charge_1',
    customerId: 'usr_cust_charge',
    status: 'DELIVERED',
    pickedUpAt: new Date(Date.now() - 86_400_000).toISOString(),
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY_SANDBOX',
    razorpayPaymentId: 'pay_test_fixture',
    riderPayout: 40,
    deliveredAt: new Date().toISOString(),
    bill: { itemsTotal: 500, packagingFee: 20, totalAmount: 590, commissionAmount: 75, tdsAmount: 5 },
    ...over
  }) as any;

  await check('An order nobody collected earns nobody anything', () => {
    const order = deliveredOrder({ pickedUpAt: undefined });
    const before = ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT));

    assert.throws(
      () => recordOrderEarnings(order),
      (e: Error) => e.name === 'EarningsNotDue' && /confirmed collecting/i.test(e.message),
      'refused for the wrong reason, or for no reason in particular'
    );
    assert.equal(
      ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)),
      before,
      'it refused and posted anyway'
    );
  });

  await check('Food that moved without the money is the case that matters', () => {
    // The kitchen cooked, the rider collected, the customer ate. Marking the
    // order delivered set paymentStatus to PAID on its own, so every flag on
    // this order says it was paid for.
    const order = deliveredOrder({ razorpayPaymentId: undefined });

    assert.equal(deliveryEvidence(order).ok, true, 'the delivery half should pass — the food did move');
    assert.equal(order.paymentStatus, 'PAID', 'the flag says paid, which is exactly the trap');

    assert.throws(
      () => recordOrderEarnings(order),
      (e: Error) => e.name === 'EarningsNotDue' && /no payment reference/i.test(e.message),
      'a never-paid order became money somebody is owed'
    );
  });

  await check('A legacy wallet order can still be settled', () => {
    /*
     * The customer wallet was removed. `orderId` was always optional on a
     * wallet debit, and orderRouter accepts only RAZORPAY_SANDBOX and
     * CASH_ON_DELIVERY — so no wallet order can be created now, and none of the
     * old ones can produce a transaction record on demand.
     *
     * Requiring one refused every wallet order in the store permanently, with
     * no route to a remedy. Local fixtures could not show that, because a
     * fixture can always be given the record a real order does not have.
     */
    const order = deliveredOrder({ paymentMethod: 'WALLET', razorpayPaymentId: undefined });
    assert.equal(settlementEvidence(order).ok, true, 'a legacy wallet order is stranded forever');

    memoryStore.orders.set(order.id, order);
    const before = ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT));
    recordOrderEarnings(order);
    assert.ok(
      ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)) > before,
      'it passed the check and still paid nobody'
    );
  });

  await check('An order the delivery path flagged as unpaid is refused even so', () => {
    /*
     * The delivery path stamps `paymentUnresolvedAt` when it hands food over on
     * a prepaid order nothing had confirmed payment for.
     *
     * Given a payment reference ON PURPOSE. Without it this order would be
     * refused anyway by the missing-reference rule, and the test would pass
     * whether or not the stamp was ever read.
     */
    const order = deliveredOrder({
      razorpayPaymentId: 'pay_looks_fine',
      paymentUnresolvedAt: new Date().toISOString()
    });

    assert.throws(
      () => recordOrderEarnings(order),
      (e: Error) => e.name === 'EarningsNotDue' && /never accounted for/i.test(e.message),
      'the delivery path said the money is missing and the ledger paid out regardless'
    );
  });

  await check('Cash at the door is payment, and is not refused for lacking a reference', () => {
    // The half of the rule that stops it being "refuse everything". A cash
    // order has no gateway reference and never will.
    const order = deliveredOrder({
      paymentMethod: 'CASH_ON_DELIVERY',
      razorpayPaymentId: undefined
    });
    assert.equal(settlementEvidence(order).ok, true, 'cash deliveries can no longer be settled at all');

    memoryStore.orders.set(order.id, order);
    recordOrderEarnings(order);
    assert.ok(
      ledger.balanceOf(accountFor('RIDER_CASH', 'rdr_charge_1')) > 0,
      'the cash never reached the rider cash account'
    );
  });

  await check('Every refusal is put in front of a person, with its reason', () => {
    const stranded = deliveredOrder({ pickedUpAt: undefined });
    memoryStore.orders.set(stranded.id, stranded);

    const held = heldEarnings();
    const mine = held.find(h => h.orderId === stranded.id);
    assert.ok(mine, 'money stopped moving and nothing told anybody');
    assert.match(mine!.reason, /confirmed collecting/i);

    // And the sweeper counts it rather than shouting about it every boot.
    assert.ok(backfillEarnings().held >= 1, 'the sweeper did not report it as held');
  });

  await check('A person who has checked can release one, and is recorded', () => {
    const stranded = deliveredOrder({ pickedUpAt: undefined });
    memoryStore.orders.set(stranded.id, stranded);
    const before = ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT));

    recordOrderEarnings(stranded, { byUserId: ADMIN, note: 'Confirmed with the restaurant by phone.' });

    assert.ok(
      ledger.balanceOf(accountFor('PARTNER_PAYABLE', RESTAURANT)) > before,
      'an override that overrides nothing'
    );
    assert.equal(
      heldEarnings().some(h => h.orderId === stranded.id),
      false,
      'still listed as held after being released'
    );
  });

  await check('The books balance after everything above', () => {
    const result = ledger.audit();
    assert.equal(result.balanced, true, JSON.stringify(result.unbalancedTransactions));
    assert.equal(result.duplicateKeys.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Charge tests crashed:', err);
  process.exit(1);
});
