/**
 * Quick Bites - Core Pricing & Tax Calculation Engine
 * Version 2.0.0
 * Strictly enforces Indian GST, packaging, delivery, and commission rules.
 *
 * -------------------------------------------------------------------------
 * RATES COME FROM OUTSIDE NOW
 * -------------------------------------------------------------------------
 * Every rate this file applies used to be a literal in the arithmetic below:
 * 5% GST, Rs 20 packaging, Rs 30 delivery, Rs 5.90 platform fee, 15%
 * commission, 1% TDS. Changing any of them meant a deploy, and the commission
 * rate in particular was ALSO written out in modules/admin/analytics.ts, where
 * it could drift apart from this one with nothing to notice.
 *
 * They now arrive as `input.rates`, from the versioned configuration an
 * administrator controls. `DEFAULT_PRICING_RATES` is the fallback and holds
 * exactly the numbers that used to be here, so a caller that passes no rates
 * gets the identical bill it got before — which is what makes it safe to have
 * moved them at all.
 *
 * This file stays a pure function of its inputs. That is what lets a bill be
 * reproduced from a stored order months later: the order carries the rates it
 * was priced under, and feeding them back in gives the same answer.
 */
import { DEFAULT_PRICING_RATES } from '@quick-bites/shared-types';
import type { PricingRates } from '@quick-bites/shared-types';

export interface PricingInput {
  items: Array<{
    unitPrice: number;
    quantity: number;
    addonsTotal?: number;
  }>;
  packagingFee?: number;
  distanceKm?: number;
  isGold?: boolean;
  coupon?: {
    discountType: 'PERCENTAGE' | 'FLAT' | 'FREE_DELIVERY';
    discountValue: number;
    maxDiscountCap?: number;
    minOrderValue?: number;
  };
  /**
   * A voluntary tip for the rider, added by the customer at checkout.
   *
   * It is added to the total and to nothing else: no GST is charged on it, no
   * commission is taken from it, and it does not enter the restaurant's payout.
   * A tip is the customer's money passing through the platform to the rider, so
   * taxing it or taking a cut of it would be taking a cut of a gift.
   *
   * A coupon never reduces it either — the discount is computed from the food
   * total, so a promotion cannot be funded out of the rider's tip.
   */
  tipAmount?: number;

  /**
   * The extra percentage a paid membership takes off the food total.
   *
   * Passed in rather than looked up here, because which plan someone holds and
   * whether it has expired are questions about an account, and this file is a
   * pure function of its inputs — that is what makes the bill reproducible from
   * a stored order months later.
   *
   * Zero for everyone without a live membership. See
   * modules/membership/membershipService.ts, and in particular `isGoldActive`:
   * reading the raw `isGold` flag here would honour a lapsed membership
   * forever.
   */
  membershipDiscountPercent?: number;

  /**
   * The rates in force, from the versioned pricing configuration.
   *
   * Optional, and falling back to `DEFAULT_PRICING_RATES` — the numbers that
   * were hardcoded here before. That fallback is not laziness: it keeps every
   * existing caller, every existing test and every stored order behaving
   * exactly as before, so moving the rates out cannot be the cause of a
   * difference in anybody's bill.
   */
  rates?: PricingRates;

  /**
   * The commission this particular restaurant is on, overriding the platform
   * default. Set by an administrator at approval.
   *
   * Passed in rather than read from the restaurant, for the same reason
   * `membershipDiscountPercent` is: which rate a kitchen negotiated is a
   * question about an account, and this file answers only questions about its
   * arguments.
   */
  commissionPercent?: number;
}

export interface CalculatedBill {
  itemsTotal: number;
  gstAmount: number;
  packagingFee: number;
  deliveryFee: number;
  platformFee: number;
  couponDiscount: number;
  /**
   * What the membership took off, as its own line.
   *
   * Separate from `couponDiscount` on purpose: a customer looking at a bill
   * should be able to see what their membership is earning them, and rolling
   * it into the coupon line would make Gold invisible on every order it paid
   * for — which is how a subscription stops feeling worth renewing.
   */
  membershipDiscount: number;
  /** Paid on top of everything else, and passed to the rider in full. */
  tipAmount: number;
  totalAmount: number;
  restaurantNetPayout: number;
  /**
   * The commission rate actually applied, and what it came to.
   *
   * Returned so the order can freeze it. A settlement drafted weeks later must
   * be able to say why a kitchen was charged what it was charged, and a rate
   * that has since been renegotiated cannot answer that question. Optional
   * because orders placed before this existed do not carry it.
   */
  commissionPercent?: number;
  commissionAmount?: number;
  /** TDS withheld, as its own line, for the same reason. */
  tdsAmount?: number;
}

export function calculateOrderPricing(input: PricingInput): CalculatedBill {
  const rates = input.rates || DEFAULT_PRICING_RATES;

  // 1. Calculate Items Total
  let itemsTotal = 0;
  for (const item of input.items) {
    const itemPrice = item.unitPrice + (item.addonsTotal || 0);
    itemsTotal += itemPrice * item.quantity;
  }
  itemsTotal = Math.round(itemsTotal * 100) / 100;

  // 2. GST on food. 5% by default, for restaurant service without ITC.
  const gstAmount = Math.round(itemsTotal * (rates.gstFoodPercent / 100) * 100) / 100;

  // 3. Packaging Fee — the restaurant's own, or the platform default.
  const packagingFee = input.packagingFee !== undefined ? input.packagingFee : rates.packagingFeeDefault;

  // 4. Delivery Fee: base up to the base distance, then per whole km beyond.
  //    Free for a member whose food total clears the threshold.
  let deliveryFee = rates.deliveryBaseFee;
  if (input.distanceKm && input.distanceKm > rates.deliveryBaseKm) {
    const extraKm = Math.ceil(input.distanceKm - rates.deliveryBaseKm);
    deliveryFee += extraKm * rates.deliveryPerKmBeyond;
  }
  if (input.isGold && itemsTotal >= rates.memberFreeDeliveryMinOrder) {
    deliveryFee = 0.00;
  }

  // 5. Platform Fee: the flat fee plus GST on it. Rs 5.00 + 18% = Rs 5.90.
  const platformFee =
    Math.round(rates.platformFeeBase * (1 + rates.platformFeeGstPercent / 100) * 100) / 100;

  // 6. Coupon Discount Calculation
  let couponDiscount = 0.00;
  if (input.coupon) {
    const minOrder = input.coupon.minOrderValue || 0;
    if (itemsTotal >= minOrder) {
      if (input.coupon.discountType === 'PERCENTAGE') {
        const calculated = (itemsTotal * input.coupon.discountValue) / 100;
        couponDiscount = input.coupon.maxDiscountCap ? Math.min(calculated, input.coupon.maxDiscountCap) : calculated;
      } else if (input.coupon.discountType === 'FLAT') {
        couponDiscount = Math.min(input.coupon.discountValue, itemsTotal);
      } else if (input.coupon.discountType === 'FREE_DELIVERY') {
        couponDiscount = deliveryFee;
      }
    }
  }
  couponDiscount = Math.round(couponDiscount * 100) / 100;

  // 6b. Membership discount, on the food total only.
  //
  // Not on delivery, packaging, GST or the platform fee: those are either
  // already free for a member or are money owed to somebody else, and a
  // percentage that ate into them would be the platform discounting a third
  // party's income. Stacks with a coupon, which is deliberate — a member who
  // also has a voucher should get both, and the floor below keeps the total
  // from going negative.
  const membershipPercent = Math.min(50, Math.max(0, input.membershipDiscountPercent || 0));
  const membershipDiscount = Math.round(itemsTotal * membershipPercent) / 100;

  // 7. Tip — rounded and floored at zero, so a negative figure cannot be used
  //    to reduce the bill. It is added after the discount rather than before,
  //    because a percentage coupon must not be computed on the rider's tip.
  const tipAmount = Math.max(0, Math.round((input.tipAmount || 0) * 100) / 100);

  // 8. Total Payable
  const preDiscount = itemsTotal + gstAmount + packagingFee + deliveryFee + platformFee;
  const totalAmount = Math.max(
    0,
    Math.round((preDiscount - couponDiscount - membershipDiscount) * 100) / 100 + tipAmount
  );

  // 9. Restaurant Net Payout: Food Total - Commission - TDS + Packaging
  //    The tip is deliberately absent: it belongs to the rider, not the kitchen.
  //
  //    The commission is this restaurant's own negotiated rate where it has
  //    one, and the platform default otherwise. Bounded at 0-50% here as well
  //    as at the configuration screen, because a bad number reaching this line
  //    produces a payout rather than an error message.
  const commissionPercent =
    typeof input.commissionPercent === 'number' && Number.isFinite(input.commissionPercent)
      ? Math.min(50, Math.max(0, input.commissionPercent))
      : rates.defaultCommissionPercent;
  const commission = Math.round(itemsTotal * (commissionPercent / 100) * 100) / 100;
  const tds = Math.round(itemsTotal * (rates.tdsPercent / 100) * 100) / 100;
  const restaurantNetPayout = Math.round((itemsTotal - commission - tds + packagingFee) * 100) / 100;

  return {
    itemsTotal,
    gstAmount,
    packagingFee,
    deliveryFee,
    platformFee,
    couponDiscount,
    membershipDiscount,
    tipAmount,
    totalAmount,
    restaurantNetPayout,
    commissionPercent,
    commissionAmount: commission,
    tdsAmount: tds
  };
}
