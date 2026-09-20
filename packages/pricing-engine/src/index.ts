/**
 * Quick Bites - Core Pricing & Tax Calculation Engine
 * Version 1.0.0
 * Strictly enforces Indian GST, packaging, delivery, and commission rules.
 */

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
}

export function calculateOrderPricing(input: PricingInput): CalculatedBill {
  // 1. Calculate Items Total
  let itemsTotal = 0;
  for (const item of input.items) {
    const itemPrice = item.unitPrice + (item.addonsTotal || 0);
    itemsTotal += itemPrice * item.quantity;
  }
  itemsTotal = Math.round(itemsTotal * 100) / 100;

  // 2. GST on Food (5% for standard restaurant services without ITC)
  const gstAmount = Math.round(itemsTotal * 0.05 * 100) / 100;

  // 3. Packaging Fee
  const packagingFee = input.packagingFee !== undefined ? input.packagingFee : 20.00;

  // 4. Delivery Fee: Base Rs 30 for <=3km, +Rs 10/km beyond. Free if Gold & itemsTotal >= 199
  let deliveryFee = 30.00;
  if (input.distanceKm && input.distanceKm > 3) {
    const extraKm = Math.ceil(input.distanceKm - 3);
    deliveryFee += extraKm * 10.00;
  }
  if (input.isGold && itemsTotal >= 199.00) {
    deliveryFee = 0.00;
  }

  // 5. Platform Fee: Fixed Rs 5.00 (+ 18% GST = Rs 5.90)
  const platformFee = 5.90;

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

  // 9. Restaurant Net Payout: Food Total - 15% Commission - 1% TDS + Packaging
  //    The tip is deliberately absent: it belongs to the rider, not the kitchen.
  const commission = Math.round(itemsTotal * 0.15 * 100) / 100;
  const tds = Math.round(itemsTotal * 0.01 * 100) / 100;
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
    restaurantNetPayout
  };
}
