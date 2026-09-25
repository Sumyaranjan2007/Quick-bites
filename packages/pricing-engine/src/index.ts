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
  /**
   * What the CUSTOMER is charged for packaging.
   *
   * Not necessarily what the restaurant gets — see `partnerPackagingFee`.
   */
  packagingFee?: number;
  /**
   * What the RESTAURANT declared and had approved for packaging.
   *
   * Defaults to `packagingFee` when absent, which is the no-markup case. When
   * an administrator has raised the customer's charge, this stays at the
   * restaurant's own figure and the difference is platform revenue.
   *
   * This is the single most important field in this interface. Paying a
   * restaurant the marked-up figure would hand them money the platform charged
   * on its own behalf, and it would be invisible — the bill would still add up.
   */
  partnerPackagingFee?: number;
  /**
   * The food total at the RESTAURANT's own prices, before any markup.
   *
   * `items` carry what the customer pays. This is what the kitchen set, and it
   * is the base for their payout, our commission and the tax withheld from
   * them. Absent means no markup, so the two are the same — which is what was
   * true before food could be marked up.
   *
   * Commission is taken on THIS, never on the marked-up total. Charging a
   * restaurant commission on our own markup would bill them for money they
   * never received, and they would be right to dispute every settlement.
   */
  partnerItemsTotal?: number;
  /** This restaurant's own GST rate, where it has one. */
  gstFoodPercent?: number;
  /** This restaurant's own platform fee, before GST on the fee. */
  platformFeeBase?: number;
  /** This restaurant's own delivery floor. */
  deliveryBaseFee?: number;
  /** Anything else the platform adds. Charged to the customer, kept by us. */
  extraCharge?: number;
  extraChargeLabel?: string;
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
   * The most a membership may take off this one order. Zero or absent means
   * uncapped, which is what it was before caps existed.
   *
   * A percentage with no ceiling is not a discount, it is an open liability:
   * one large order can cost the platform more than the membership sold for.
   */
  membershipMaxDiscount?: number;

  /** The food total a member needs for free delivery, if their plan sets one. */
  memberFreeDeliveryMinOrder?: number;
  /**
   * The percentage this member's plan takes off the delivery fee.
   *
   * Absent means no membership benefit on delivery, which is also what a
   * non-member gets. It replaced free-delivery-above-a-floor; the floor is
   * still honoured and now gates the DISCOUNT rather than deciding whether
   * delivery is free.
   */
  memberDeliveryDiscountPercent?: number;

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
  /** The food total at the restaurant's own prices. What they earn on. */
  partnerItemsTotal: number;
  /** What the customer paid for packaging. */
  packagingFee: number;
  /**
   * What the restaurant earns of it. Frozen onto the bill so a settlement
   * drafted weeks later can prove what the markup was at the time, rather than
   * re-deriving it from a figure that may since have changed.
   */
  partnerPackagingFee: number;
  /** Anything else the platform charged, and what it was called on the bill. */
  extraCharge: number;
  extraChargeLabel: string;
  deliveryFee: number;
  /**
   * The delivery fee BEFORE the platform's markup, frozen onto the bill.
   *
   * Kept for the same reason as partnerPackagingFee: a settlement or a revenue
   * figure worked out weeks later must be able to say what the markup was at
   * the time, rather than re-deriving it from a rate that has since changed.
   * The difference between this and deliveryFee is what the platform kept on
   * delivery for this order, and it is the only place that is recorded.
   */
  partnerDeliveryFee: number;
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
  /**
   * What the membership took off the DELIVERY fee, as its own figure.
   *
   * Separate from membershipDiscount, which is the food discount. Reported
   * rather than left implicit in a smaller deliveryFee, because a member who
   * cannot see what their plan saved them on an order cannot tell whether it
   * was worth buying -- and because it is the only place the delivery benefit
   * is recorded once the fee has already been reduced.
   */
  membershipDeliverySaving: number;
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
  /** The part of the GST on commission charged to the restaurant. 0 unless the owner set a share. */
  commissionGstToPartner?: number;
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

  // 2. GST on food. This restaurant's own rate where it has one, otherwise
  //    the platform default.
  const gstFoodPercent =
    typeof input.gstFoodPercent === 'number' && Number.isFinite(input.gstFoodPercent)
      ? Math.min(28, Math.max(0, input.gstFoodPercent))
      : rates.gstFoodPercent;
  const gstAmount = Math.round(itemsTotal * (gstFoodPercent / 100) * 100) / 100;

  /*
   * 3. Packaging, which has TWO figures and not one.
   *
   *    `packagingFee` is what the customer pays. `partnerPackagingFee` is what
   *    the restaurant declared and is the only one that reaches their payout.
   *    When no markup is configured the two are equal, which is the ordinary
   *    case and why this used to be a single number.
   */
  const packagingFee = input.packagingFee !== undefined ? input.packagingFee : rates.packagingFeeDefault;
  const partnerPackagingFee =
    input.partnerPackagingFee !== undefined ? input.partnerPackagingFee : packagingFee;

  // 4. Delivery Fee: base up to the base distance, then per whole km beyond.
  //    Free for a member whose food total clears the threshold.
  let deliveryFee =
    typeof input.deliveryBaseFee === 'number' && Number.isFinite(input.deliveryBaseFee)
      ? Math.max(0, input.deliveryBaseFee)
      : rates.deliveryBaseFee;
  if (input.distanceKm && input.distanceKm > rates.deliveryBaseKm) {
    const extraKm = Math.ceil(input.distanceKm - rates.deliveryBaseKm);
    deliveryFee += extraKm * rates.deliveryPerKmBeyond;
  }
  /*
   * The platform's markup on delivery, paid by the CUSTOMER.
   *
   * Applied after distance and BEFORE any membership discount, deliberately.
   * A member's percentage should come off the real price they would otherwise
   * have paid -- discounting first and marking up afterwards would quietly
   * claw back part of the benefit they bought, and the order of two
   * percentages is invisible on a bill that still adds up.
   *
   * It does not appear in the rider's payout because the rider's payout is not
   * computed here. calculateTripPayout works from the trip and the rider rates;
   * this number is not one of them, and a test asserts the payout is
   * byte-identical across a change to it.
   */
  const deliveryMarkupPercent = Math.max(0, Number(rates.riderDeliveryMarkupPercent) || 0);
  const partnerDeliveryFee = deliveryFee;
  if (deliveryMarkupPercent > 0) {
    deliveryFee = Math.round(deliveryFee * (1 + deliveryMarkupPercent / 100) * 100) / 100;
  }

  const freeDeliveryFloor =
    typeof input.memberFreeDeliveryMinOrder === 'number' && Number.isFinite(input.memberFreeDeliveryMinOrder)
      ? input.memberFreeDeliveryMinOrder
      : rates.memberFreeDeliveryMinOrder;
  /*
   * The member's benefit, as a PERCENTAGE off the delivery fee.
   *
   * This was `deliveryFee = 0.00`, all-or-nothing above a floor. The owner
   * replaced it with a percentage per plan, and it is a better shape as well as
   * what they asked for: free-above-a-threshold is a cliff, where a member one
   * rupee short pays the whole fee and one rupee over pays none of it.
   *
   * The floor is kept and repurposed. It no longer decides whether delivery is
   * free -- it decides whether the discount applies at all, and zero means
   * always.
   *
   * Applied AFTER the platform markup above, so the member's percentage comes
   * off the price they would otherwise have paid rather than off a pre-markup
   * number they were never going to be charged.
   */
  const memberDeliveryDiscountPercent =
    typeof input.memberDeliveryDiscountPercent === 'number' &&
    Number.isFinite(input.memberDeliveryDiscountPercent)
      ? Math.min(100, Math.max(0, input.memberDeliveryDiscountPercent))
      : 0;

  let membershipDeliverySaving = 0;
  if (input.isGold && itemsTotal >= freeDeliveryFloor && memberDeliveryDiscountPercent > 0) {
    const discounted = Math.round(deliveryFee * (1 - memberDeliveryDiscountPercent / 100) * 100) / 100;
    membershipDeliverySaving = Math.round((deliveryFee - discounted) * 100) / 100;
    deliveryFee = discounted;
  }

  // 5. Platform Fee: the flat fee plus GST on it. Rs 5.00 + 18% = Rs 5.90.
  const platformFeeBase =
    typeof input.platformFeeBase === 'number' && Number.isFinite(input.platformFeeBase)
      ? Math.max(0, input.platformFeeBase)
      : rates.platformFeeBase;
  const platformFee =
    Math.round(platformFeeBase * (1 + rates.platformFeeGstPercent / 100) * 100) / 100;

  // 5b. Anything else the platform adds for this restaurant. Charged in full,
  //     kept in full, and named on the bill.
  const extraCharge = Math.max(0, Math.round((input.extraCharge || 0) * 100) / 100);

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
  const uncappedMembership = Math.round(itemsTotal * membershipPercent) / 100;
  // Capped where the plan sets one. This is the difference between a discount
  // and an unbounded liability on a large basket.
  const membershipCap =
    typeof input.membershipMaxDiscount === 'number' && input.membershipMaxDiscount > 0
      ? input.membershipMaxDiscount
      : Infinity;
  const membershipDiscount = Math.round(Math.min(uncappedMembership, membershipCap) * 100) / 100;

  // 7. Tip — rounded and floored at zero, so a negative figure cannot be used
  //    to reduce the bill. It is added after the discount rather than before,
  //    because a percentage coupon must not be computed on the rider's tip.
  const tipAmount = Math.max(0, Math.round((input.tipAmount || 0) * 100) / 100);

  // 8. Total Payable
  const preDiscount = itemsTotal + gstAmount + packagingFee + deliveryFee + platformFee + extraCharge;
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
  /*
   * Both taken on the RESTAURANT's own food total, not the marked-up one.
   *
   * Commission on our own markup would charge a kitchen for money that never
   * reached them. TDS on it would withhold tax against supplies they did not
   * make, and it is remitted under their PAN, so it would be wrong in a way
   * that shows up on their tax return rather than on a screen.
   */
  const partnerItemsTotal =
    typeof input.partnerItemsTotal === 'number' && Number.isFinite(input.partnerItemsTotal)
      ? input.partnerItemsTotal
      : itemsTotal;
  const commission = Math.round(partnerItemsTotal * (commissionPercent / 100) * 100) / 100;
  const tds = Math.round(partnerItemsTotal * (rates.tdsPercent / 100) * 100) / 100;
  /*
   * The restaurant gets its OWN packaging figure, never the marked-up one.
   *
   * This line used to add the CUSTOMER packaging figure, which was correct only while the two
   * were the same number. With a markup it would have paid the restaurant the
   * platform's own revenue, and nothing would have looked wrong: the bill still
   * balances, the ledger still balances, and the money simply leaves.
   */
  /*
   * The GST on our commission that the RESTAURANT pays (0 by default: the
   * platform has absorbed all of it, about 2.7% of food value on every order).
   * Zomato and Swiggy invoice it to the restaurant; the owner and their CA set
   * the share. Frozen onto the bill so a later change never reaches an order
   * already placed.
   */
  const commissionGstSharePercent = Math.min(
    100,
    Math.max(0, Number((rates as any).commissionGstChargedToPartnerPercent) || 0)
  );
  const commissionGstToPartner =
    Math.round(commission * ((Number(rates.commissionGstPercent) || 0) / 100) * (commissionGstSharePercent / 100) * 100) / 100;

  const restaurantNetPayout =
    Math.round((partnerItemsTotal - commission - tds - commissionGstToPartner + partnerPackagingFee) * 100) / 100;

  return {
    itemsTotal,
    partnerItemsTotal,
    gstAmount,
    packagingFee,
    partnerPackagingFee,
    extraCharge,
    extraChargeLabel: input.extraChargeLabel || '',
    deliveryFee,
    partnerDeliveryFee,
    platformFee,
    couponDiscount,
    membershipDiscount,
    membershipDeliverySaving,
    tipAmount,
    totalAmount,
    restaurantNetPayout,
    commissionPercent,
    commissionAmount: commission,
    tdsAmount: tds,
    commissionGstToPartner
  };
}
