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
import { resetConfigsForTesting, getActiveRates } from '../modules/payments/pricingConfig.ts';
import {
  effectiveCharges,
  setCharges,
  platformMarginPaiseFor,
  resetRestaurantChargesForTesting
} from '../modules/payments/restaurantCharges.ts';
import { splitForOrder, recordOrderEarnings } from '../modules/payments/earnings.ts';
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
  memoryStore.restaurants.clear();
  memoryStore.orders.clear();
  memoryStore.riders.clear();

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
    assert.equal(charges.packagingMargin, 0);
  });

  await check('A restaurant that has never declared one falls back to the platform default', () => {
    // NOT to zero. Charging a customer nothing for packaging because a partner
    // has not filled in a form is a silent discount funded by us.
    memoryStore.restaurants.set('rst_silent', { id: 'rst_silent', name: 'Silent Kitchen' });
    const charges = effectiveCharges('rst_silent');
    assert.equal(charges.partnerPackagingFee, getActiveRates().packagingFeeDefault);
  });

  await check('An administrator can charge more than the partner asked for', () => {
    const charges = setCharges(RESTAURANT, { customerPackagingFee: 30 }, ADMIN, 'Standard markup');
    assert.equal(charges.partnerPackagingFee, 15);
    assert.equal(charges.customerPackagingFee, 30);
    assert.equal(charges.packagingMargin, 15);
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
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY_SANDBOX',
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
