/**
 * What each restaurant costs a customer, and what the restaurant actually gets.
 *
 * -------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS FOR
 * -------------------------------------------------------------------------
 * The owner put it exactly: *"suppose partners they applied for 15 rupees for
 * packaging but we updated only for us to 30 rupees — in their payment section
 * they won't get the extra 15. That money belongs to us."*
 *
 * So every chargeable line has **two figures, not one**:
 *
 *   `partner…`   what the restaurant declared and had approved. This is the
 *                only figure that ever reaches their earnings.
 *   `customer…`  what the platform charges for it. Defaults to the partner's
 *                figure, and an administrator may raise it.
 *
 * The difference is platform revenue. It is computed, never typed, so the two
 * can never be recorded inconsistently — and because the partner's figure is
 * stored separately from the customer's, raising a price cannot accidentally
 * raise a payout.
 *
 * -------------------------------------------------------------------------
 * PER RESTAURANT, FALLING BACK TO THE PLATFORM DEFAULT
 * -------------------------------------------------------------------------
 * A field left `null` means "whatever the platform default is", and it keeps
 * following that default when it changes. A field set to a number means "this
 * restaurant, specifically", and it stops following.
 *
 * That distinction matters more than it looks. Copying the default into every
 * restaurant at creation time would look identical on day one and mean that
 * changing the platform fee later moved nothing at all — the single most
 * confusing failure a pricing screen can have.
 *
 * -------------------------------------------------------------------------
 * AND NOTHING HERE TOUCHES AN ORDER THAT HAS ALREADY BEEN PLACED
 * -------------------------------------------------------------------------
 * These are the rates used to PRICE a new order. Every order freezes what it
 * was charged onto its own bill, so a change here never restates a bill, a
 * statement or a settlement.
 */
import type { PricingRates } from '@quick-bites/shared-types';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';
import { getActiveRates } from './pricingConfig.ts';
import { toPaise, toRupees } from './money.ts';
import { platformGstin } from '../platform/businessIdentity.ts';

/**
 * What an administrator may set for one restaurant.
 *
 * Every money field is in rupees, and every one of them may be `null`, meaning
 * "follow the platform default".
 */
export interface RestaurantCharges {
  restaurantId: string;

  /**
   * What the partner is APPROVED to earn for packaging.
   *
   * `null` means accept whatever they declared — no review needed for the
   * ordinary case. A number means an administrator has decided a different
   * figure, which is the lever the owner asked for: a partner declaring Rs 40
   * when Rs 25 is right must be correctable, and before this existed their
   * declared figure was simply final.
   */
  partnerApprovedFee: number | null;

  /**
   * What the platform adds on top, and keeps.
   *
   * Stored explicitly rather than derived from a customer-facing total. That
   * direction matters: with the markup its own number, raising what a partner
   * earns cannot silently change what we keep, and raising our margin cannot
   * silently cut their pay. The old shape stored the customer total, which made
   * a partner's raise look like a margin cut and hid which of the two had
   * actually moved.
   */
  packagingMarkup: number;

  /**
   * A percentage added to every dish price for this restaurant, kept by us.
   *
   * The restaurant sets its menu prices and is paid on those. This inflates
   * what the CUSTOMER sees and pays; the difference never reaches the kitchen
   * and never enters their commission base, because taking commission on our
   * own markup would charge a restaurant for money it never received.
   *
   * Zero means the customer pays exactly what the restaurant set, which is the
   * default and the honest one for a restaurant nobody has reviewed.
   */
  foodMarkupPercent: number;

  /** Charged to the customer in full. No part of it reaches the restaurant. */
  platformFee: number | null;

  /**
   * GST on the food line — the RESTAURANT's own tax on their own supply.
   *
   * A pass-through. It is charged on the customer's bill against the kitchen's
   * food, and it is remitted; no part of it is platform revenue.
   */
  gstFoodPercent: number | null;

  /**
   * GST on what the PLATFORM charges — our fee, our markup, our delivery.
   *
   * Null or zero means no such line appears, which is the default and stays
   * the default until a GSTIN is stored. That gate is not a nicety. A bill that
   * prints "GST" on money which is not remitted to the government is a false
   * invoice, and the exposure for issuing one is criminal rather than a
   * penalty — so the number cannot be set at all until there is a registration
   * to put beside it, and the bill line carries that GSTIN when it appears.
   */
  platformGstPercent: number | null;

  /** What the platform keeps of the food total. */
  commissionPercent: number | null;

  /** The delivery fee floor for orders from this restaurant. */
  deliveryBaseFee: number | null;

  /**
   * Anything else, named.
   *
   * A nameless charge on a bill is the fastest way to lose a customer's trust,
   * so a label is required whenever the amount is non-zero.
   */
  extraCharge: number;
  extraChargeLabel: string;

  /**
   * The CUSTOMER'S price for individual dishes, keyed by menu item id, in
   * rupees.
   *
   * Absent for a dish means follow `foodMarkupPercent`, which is the behaviour
   * every restaurant has today and must stay the default -- otherwise this
   * feature would force the owner to price every dish of every restaurant by
   * hand before earning anything.
   *
   * Keyed on the dish id, which is safe: ids are `dish_` + randomUUID and
   * `updateItem` preserves them, so a typed price cannot land on a different
   * dish after a menu edit. A DELETED dish does leave its key behind -- harmless
   * for pricing, but any count of "how many items are marked up" must be
   * filtered against the live menu rather than taken from this map.
   */
  itemPrices?: Record<string, number>;

  updatedAt: string;
  updatedByUserId: string;
  /** Why, so somebody reading this in six months knows. */
  note?: string;
}

/** Every figure that actually applies to one restaurant's next order. */
export interface EffectiveCharges {
  restaurantId: string;
  /** What the partner asked for. Their number, untouched. */
  partnerDeclaredFee: number;
  /** What the partner actually earns. Theirs, after any admin adjustment. */
  partnerPackagingFee: number;
  /** What the platform adds and keeps. */
  packagingMarkup: number;
  /**
   * What the customer pays: approved + markup.
   *
   * Computed, never stored. A third stored number is a third thing to keep in
   * step with two others, and the moment it is not, a screen confidently
   * reports a total the customer was never charged.
   */
  customerPackagingFee: number;
  /** Same as `packagingMarkup`. Kept for screens that read the old name. */
  packagingMargin: number;
  /** True when an administrator has set the partner's figure themselves. */
  partnerFeeAdjusted: boolean;
  /** Added to every dish price and kept by us. */
  foodMarkupPercent: number;
  platformFee: number;
  gstFoodPercent: number;
  /**
   * GST on the platform's OWN charges, or null when none is charged.
   *
   * Null rather than zero on purpose: "we do not charge this" and "we charge
   * nought per cent" read the same on a screen and differently in a ledger.
   */
  platformGstPercent: number | null;
  /**
   * The registration the platform GST line is charged under, when there is
   * one. Empty means no GST line may appear at all.
   */
  platformGstin: string;
  commissionPercent: number;
  deliveryBaseFee: number;
  extraCharge: number;
  extraChargeLabel: string;
  /** Which fields are this restaurant's own rather than the platform default. */
  overridden: string[];
}

function row(restaurantId: string): RestaurantCharges | null {
  const stored = memoryStore.restaurantCharges.get(restaurantId);
  return stored && typeof stored.restaurantId === 'string' ? (stored as RestaurantCharges) : null;
}

/**
 * The partner's own declared packaging charge.
 *
 * Written by the partner app (the other session owns that half) and read here.
 * Absent means they have not declared one, and the platform default stands in —
 * charging a customer nothing for packaging because a partner has not filled a
 * form would be a silent discount.
 */
export function partnerPackagingFee(restaurantId: string, rates: PricingRates): number {
  const restaurant: any = memoryStore.restaurants.get(restaurantId);

  // Newly declared through the partner app, if they have.
  const declared = Number(restaurant?.partnerPackagingFee);
  if (Number.isFinite(declared) && declared >= 0) return declared;

  /*
   * Otherwise the figure the restaurant already had.
   *
   * `packagingFee` predates this feature and every seeded and existing
   * restaurant carries one. Skipping straight to the platform default would
   * silently re-price every restaurant that has not yet used the new field —
   * which is all of them on the day this ships, and it is exactly the kind of
   * change nobody notices until a bill is five rupees different.
   */
  const existing = Number(restaurant?.packagingFee);
  if (Number.isFinite(existing) && existing >= 0) return existing;

  return rates.packagingFeeDefault;
}

/** Everything that applies to this restaurant right now. */
export function effectiveCharges(
  restaurantId: string,
  rates: PricingRates = getActiveRates()
): EffectiveCharges {
  const own = row(restaurantId);
  const declared = partnerPackagingFee(restaurantId, rates);

  /*
   * What the partner earns.
   *
   * An administrator's figure where they have set one, otherwise whatever the
   * partner declared. Defaulting to their own number means a restaurant nobody
   * has reviewed is paid exactly what it asked for — the only honest default,
   * since the alternative silently pays them something they never agreed to.
   */
  const partnerFeeAdjusted =
    own?.partnerApprovedFee !== null && own?.partnerApprovedFee !== undefined;
  const partnerPackaging = partnerFeeAdjusted ? own!.partnerApprovedFee! : declared;

  /*
   * What we add on top, and what the customer therefore pays.
   *
   * No markup configured means no markup. Not the platform default — marking
   * up every restaurant nobody has looked at would be charging customers for a
   * decision nobody took.
   */
  const markup = Math.max(0, own?.packagingMarkup ?? 0);
  const customerPackaging = Math.round((partnerPackaging + markup) * 100) / 100;

  const overridden: string[] = [];
  const pick = (key: keyof RestaurantCharges, fallback: number): number => {
    const value = own?.[key];
    if (typeof value === 'number') {
      overridden.push(key);
      return value;
    }
    return fallback;
  };

  const charges: EffectiveCharges = {
    restaurantId,
    partnerDeclaredFee: declared,
    partnerPackagingFee: partnerPackaging,
    packagingMarkup: markup,
    customerPackagingFee: customerPackaging,
    packagingMargin: markup,
    partnerFeeAdjusted,
    foodMarkupPercent: Math.max(0, own?.foodMarkupPercent ?? 0),
    platformFee: pick('platformFee', rates.platformFeeBase),
    gstFoodPercent: pick('gstFoodPercent', rates.gstFoodPercent),
    platformGstPercent: own?.platformGstPercent ?? null,
    platformGstin: platformGstin(),
    commissionPercent: pick('commissionPercent', rates.defaultCommissionPercent),
    deliveryBaseFee: pick('deliveryBaseFee', rates.deliveryBaseFee),
    extraCharge: own?.extraCharge ?? 0,
    extraChargeLabel: own?.extraChargeLabel ?? '',
    overridden
  };

  if (partnerFeeAdjusted) overridden.push('partnerApprovedFee');
  if (markup > 0) overridden.push('packagingMarkup');

  return charges;
}

const BOUNDS: Record<string, { min: number; max: number; unit: string; label: string }> = {
  partnerApprovedFee: { min: 0, max: 200, unit: 'Rs', label: 'Packaging the restaurant earns' },
  packagingMarkup: { min: 0, max: 200, unit: 'Rs', label: 'Packaging markup we keep' },
  foodMarkupPercent: { min: 0, max: 100, unit: '%', label: 'Food price markup we keep' },
  platformFee: { min: 0, max: 100, unit: 'Rs', label: 'Platform fee' },
  gstFoodPercent: { min: 0, max: 28, unit: '%', label: 'GST the restaurant charges on its food' },
  platformGstPercent: { min: 0, max: 28, unit: '%', label: 'GST on our charges (needs a GSTIN)' },
  commissionPercent: { min: 0, max: 40, unit: '%', label: 'Our commission' },
  deliveryBaseFee: { min: 0, max: 200, unit: 'Rs', label: 'Delivery base fee' },
  extraCharge: { min: 0, max: 200, unit: 'Rs', label: 'Extra charge' }
};

export const CHARGE_BOUNDS = BOUNDS;

/**
 * Sets one restaurant's charges.
 *
 * Only the keys present are changed; a key set to `null` goes back to following
 * the platform default, which is a different thing from being set to the same
 * number as the default and has to stay expressible.
 */
export function setCharges(
  restaurantId: string,
  changes: Partial<Omit<RestaurantCharges, 'restaurantId' | 'updatedAt' | 'updatedByUserId'>>,
  actorUserId: string,
  note?: string
): EffectiveCharges {
  if (!memoryStore.restaurants.has(restaurantId)) {
    throw new AppError('No such restaurant.', 404, 'RESTAURANT_NOT_FOUND');
  }

  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) continue;
    if (key === 'extraChargeLabel' || key === 'note') continue;
    // Not a single amount with bounds; validated by setItemPrice below.
    if (key === 'itemPrices') continue;

    const bound = BOUNDS[key];
    if (!bound) throw new AppError(`There is no charge called ${key}.`, 400, 'UNKNOWN_CHARGE');

    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < bound.min || amount > bound.max) {
      throw new AppError(
        `${bound.label} must be between ${bound.min} and ${bound.max} ${bound.unit}.`,
        400,
        'CHARGE_OUT_OF_RANGE'
      );
    }
  }

  const existing = row(restaurantId);
  const next: RestaurantCharges = {
    restaurantId,
    partnerApprovedFee: existing?.partnerApprovedFee ?? null,
    packagingMarkup: existing?.packagingMarkup ?? 0,
    foodMarkupPercent: existing?.foodMarkupPercent ?? 0,
    platformFee: existing?.platformFee ?? null,
    gstFoodPercent: existing?.gstFoodPercent ?? null,
    platformGstPercent: existing?.platformGstPercent ?? null,
    commissionPercent: existing?.commissionPercent ?? null,
    deliveryBaseFee: existing?.deliveryBaseFee ?? null,
    extraCharge: existing?.extraCharge ?? 0,
    extraChargeLabel: existing?.extraChargeLabel ?? '',
    itemPrices: existing?.itemPrices ?? {},
    ...changes,
    updatedAt: new Date().toISOString(),
    updatedByUserId: actorUserId,
    ...(note ? { note } : {})
  };

  /*
   * THE GSTIN GATE.
   *
   * Charging GST means collecting tax on the government's behalf, and a bill
   * showing a GST line against a business with no registration is a false
   * invoice however the money is later accounted for. Refused at the point the
   * number is set rather than hidden on the screen that sets it, because the
   * screen is a convenience and this is the control.
   */
  if ((next.platformGstPercent ?? 0) > 0 && !platformGstin()) {
    throw new AppError(
      'Add the platform GSTIN in Settings before charging GST on our own fees. ' +
        'A bill showing GST without a registration behind it is a false invoice.',
      400,
      'PLATFORM_GSTIN_REQUIRED'
    );
  }

  // A charge with no name is a charge a customer cannot query, and the first
  // thing they do about one is stop ordering.
  if (next.extraCharge > 0 && next.extraChargeLabel.trim().length < 3) {
    throw new AppError(
      'Give the extra charge a name. It appears on the customer’s bill and an unnamed one is the fastest way to lose them.',
      400,
      'EXTRA_CHARGE_NEEDS_LABEL'
    );
  }

  memoryStore.restaurantCharges.set(restaurantId, next);
  triggerAutoSave();

  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: next.updatedAt,
      event: 'RESTAURANT_CHARGES_SET',
      restaurantId,
      actorUserId,
      changes
    })
  );

  return effectiveCharges(restaurantId);
}

/**
 * What the platform makes on one order, line by line.
 *
 * Derived from the FROZEN bill, not from today's charges, so it is still right
 * for an order priced before the last rate change.
 */
export function platformMarginPaiseFor(order: any): {
  commissionPaise: number;
  foodMarkupPaise: number;
  packagingMarginPaise: number;
  platformFeePaise: number;
  extraChargePaise: number;
  deliveryMarginPaise: number;
  totalPaise: number;
} {
  const bill: any = order?.bill || {};

  const commissionPaise = toPaise(Number(bill.commissionAmount) || 0);

  // What we added to the food price. Frozen on the bill as two totals, so this
  // stays right for an order priced before the last rate change.
  const customerItems = Number(bill.itemsTotal) || 0;
  const partnerItems = Number.isFinite(Number(bill.partnerItemsTotal))
    ? Number(bill.partnerItemsTotal)
    : customerItems;
  const foodMarkupPaise = Math.max(0, toPaise(customerItems - partnerItems));
  const platformFeePaise = toPaise(Number(bill.platformFee) || 0);
  const extraChargePaise = toPaise(Number(bill.extraCharge) || 0);

  // The packaging markup. Both figures are frozen onto the bill at checkout
  // precisely so this can be computed later without guessing what the partner's
  // declared figure was at the time.
  const customerPackaging = Number(bill.packagingFee) || 0;
  const partnerPackaging = Number.isFinite(Number(bill.partnerPackagingFee))
    ? Number(bill.partnerPackagingFee)
    : customerPackaging;
  // Floored at zero: an administrator charging less than the partner earns is
  // funding a discount out of platform revenue, which is a real thing they may
  // do, but it is not a negative margin on the packaging line.
  const packagingMarginPaise = Math.max(0, toPaise(customerPackaging - partnerPackaging));

  // What was charged for delivery, less what the rider was paid for it.
  const deliveryPaise = toPaise(Number(bill.deliveryFee) || 0);
  const riderPaise = toPaise(Number(order?.riderPayout) || 0);
  const deliveryMarginPaise = deliveryPaise - riderPaise;

  return {
    commissionPaise,
    foodMarkupPaise,
    packagingMarginPaise,
    platformFeePaise,
    extraChargePaise,
    deliveryMarginPaise,
    totalPaise:
      commissionPaise +
      foodMarkupPaise +
      packagingMarginPaise +
      platformFeePaise +
      extraChargePaise +
      deliveryMarginPaise
  };
}

/** Rupee view for a screen. */
export function chargesView(charges: EffectiveCharges) {
  return {
    ...charges,
    /** Said in words, because the point of the screen is that this is ours. */
    marginNote:
      charges.packagingMarkup > 0
        ? `Customer pays Rs ${charges.customerPackagingFee}. Restaurant earns Rs ${charges.partnerPackagingFee}. You keep Rs ${charges.packagingMarkup}.`
        : 'Customer pays Rs ' + charges.customerPackagingFee + '. All of it goes to the restaurant — you have added no markup.',
    /** Named separately because it is a different decision from the markup. */
    approvalNote: charges.partnerFeeAdjusted
      ? `They asked for Rs ${charges.partnerDeclaredFee}; you set Rs ${charges.partnerPackagingFee}.`
      : `Paying what they asked for: Rs ${charges.partnerDeclaredFee}.`
  };
}

/* ------------------------------------------------------------------ *
 *  FOOD PRICE MARKUP                                                  *
 * ------------------------------------------------------------------ */

/**
 * What a customer sees for a dish the restaurant priced at `price`.
 *
 * -------------------------------------------------------------------------
 * ROUNDED PER DISH, NOT PER BASKET
 * -------------------------------------------------------------------------
 * Rounding the whole basket would make the sum of the prices on screen differ
 * from the total at checkout by a rupee or two, and a customer who notices that
 * once never trusts the bill again. Each dish is inflated and rounded on its
 * own, so the line the customer read is the line they are charged.
 *
 * Rounded to whole rupees, because a menu showing Rs 137.50 for a dish the
 * kitchen priced at Rs 125 looks like a mistake rather than a price.
 */
export function customerDishPrice(
  restaurantId: string,
  itemId: string,
  restaurantPrice: number
): number {
  const raw = Number(restaurantPrice) || 0;
  const typed = typedPriceFor(restaurantId, itemId);

  // 1. A price an administrator typed for this dish wins outright.
  if (typed !== null) return typed;

  // 2. Otherwise the restaurant-wide percentage, which is what every
  //    restaurant has today and what an unmarked dish keeps.
  const markup = Math.max(0, Number(effectiveCharges(restaurantId).foodMarkupPercent) || 0);
  if (markup === 0) return Math.round(raw * 100) / 100;
  return Math.round(raw * (1 + markup / 100));
}

/**
 * The typed customer price for one dish, or null when there is none.
 *
 * Null rather than zero: zero is a price somebody could legitimately type for a
 * free item, and collapsing "no typed price" into "typed as free" would give a
 * dish away.
 */
/**
 * Every typed customer price for a restaurant, keyed by dish id.
 *
 * Exposed as its own function rather than added to EffectiveCharges, which is
 * read on every pricing path -- widening that type to carry a map would put it
 * in front of a lot of code that has no business with it, and make it easy to
 * hand to a partner-facing response by accident.
 */
export function typedPricesFor(restaurantId: string): Record<string, number> {
  return { ...(row(restaurantId)?.itemPrices ?? {}) };
}

export function typedPriceFor(restaurantId: string, itemId: string): number | null {
  const stored = row(restaurantId)?.itemPrices?.[itemId];
  if (stored === undefined || stored === null) return null;
  const value = Number(stored);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

/**
 * What the customer pays for a dish's ADD-ONS.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS NOT customerDishPrice
 * -------------------------------------------------------------------------
 * Add-ons are marked up today, and a percentage scales naturally: a Rs 50 extra
 * becomes Rs 60 at 20% and the restaurant is paid its own Rs 50.
 *
 * An absolute typed price does not scale, and there is no add-on id to look a
 * price up by. Passing the add-ons total through customerDishPrice with the
 * DISH'S id would find the dish's typed price and return it -- so a Rs 50 slice
 * of cheese on a dish typed at Rs 240 would be charged Rs 240, and the dish and
 * each of its extras would each cost the customer the dish's full price.
 *
 * Nothing on the bill would look wrong. It adds up. It would be found by a
 * customer paying it.
 *
 * So a typed price is converted to the RATIO it implies -- Rs 200 typed at
 * Rs 240 is 1.2 -- and the ratio is applied to the extras, giving Rs 60. That is
 * what the percentage model produces for the same dish, so the feature changes
 * what an administrator can EXPRESS rather than what the arithmetic means.
 *
 * -------------------------------------------------------------------------
 * WHERE THE RATIO AND THE PERCENTAGE DISAGREE, AND WHY THAT IS CORRECT
 * -------------------------------------------------------------------------
 * They are NOT identical for every number, and the first version of this comment
 * claimed they were. A typed price is a whole-rupee figure, so the ratio it
 * implies is the markup that was actually typed rather than the one intended:
 * a Rs 149 dish at 15% types as Rs 171, which is a ratio of 1.1477, not 1.15 --
 * so a Rs 37 extra is Rs 42 by the ratio and Rs 43 by the percentage. On a cheap
 * dish the gap is larger: Rs 10 typed to Rs 11 is a 10% markup whatever
 * percentage produced it.
 *
 * That divergence is the RIGHT behaviour, not a rounding bug to paper over. The
 * typed price is the more specific instruction, and an administrator who typed
 * Rs 11 against a Rs 10 dish has marked it up a tenth; applying a tenth to its
 * extras follows what they did. Following the restaurant percentage instead
 * would mean the extras obeying a number the administrator had just overridden.
 *
 * What WAS a defect is having two rounding conventions for one concept. The
 * percentage path returns whole rupees and the ratio path returned paise, so the
 * same dish produced Rs 14 one way and Rs 14.18 the other. Both now round to
 * whole rupees. A typed price itself is never rounded -- a human typed it, and
 * rounding Rs 239.50 up to Rs 240 would overrule them. The rule is: typed values
 * are obeyed, derived values are rounded.
 */
export function customerAddonsPrice(
  restaurantId: string,
  itemId: string,
  restaurantPrice: number,
  addonsTotal: number
): number {
  const extras = Number(addonsTotal) || 0;
  if (extras <= 0) return 0;

  const base = Number(restaurantPrice) || 0;
  const typed = typedPriceFor(restaurantId, itemId);

  /*
   * The division is guarded. A zero-priced dish -- a free item, a promotional
   * line -- would give Infinity or NaN, and NaN travels through a bill in
   * silence until it surfaces as a blank on a screen three steps later. Such a
   * dish falls back to the restaurant percentage, which is defined for it.
   */
  if (typed !== null && base > 0) {
    const ratio = typed / base;
    // Whole rupees, the same convention as the percentage path below. Two
    // conventions for one concept is how the same dish came back as Rs 14 from
    // one path and Rs 14.18 from the other.
    return Math.round(extras * ratio);
  }

  const markup = Math.max(0, Number(effectiveCharges(restaurantId).foodMarkupPercent) || 0);
  if (markup === 0) return Math.round(extras * 100) / 100;
  return Math.round(extras * (1 + markup / 100));
}

/**
 * Sets, or clears, the customer's price for one dish.
 *
 * Refuses a price BELOW the restaurant's own, naming both numbers. Typing Rs 150
 * against a Rs 200 dish means paying the restaurant Rs 200 while charging Rs 150
 * -- the platform losing Rs 50 a dish, with nothing on any screen to say so.
 * Refused here rather than on the screen, because the screen is a convenience
 * and this is the control.
 *
 * Passing null clears it, and resolution falls back to the restaurant
 * percentage.
 */
/**
 * What the customer's price should become when the kitchen's price changes.
 *
 * Returns the number to type, or null when there is nothing to preserve.
 *
 * Two readings are offered because they answer different questions and an
 * administrator should pick rather than be given one silently:
 *
 *   RUPEE   Rs 200 -> Rs 260 with Rs 40 kept becomes Rs 300. The platform keeps
 *           the same cash per order.
 *   PERCENT Rs 200 -> Rs 260 with 20% kept becomes Rs 312. The platform keeps
 *           the same share, so its margin grows with the dish.
 *
 * The rupee reading is the default. It is the smaller number, so defaulting to
 * it cannot quietly raise a customer's bill by more than the kitchen did -- and
 * a default that errs toward charging less is the one to get wrong.
 */
export function marginPreservingPrice(input: {
  restaurantId: string;
  itemId: string;
  oldRestaurantPrice: number;
  newRestaurantPrice: number;
}): {
  rupee: number;
  percent: number;
  keptRupees: number;
  keptPercent: number;
  /** What holding the rupee margin leaves, as a percentage of the new price. */
  rupeeKeepsPercent: number;
} | null {
  const typed = typedPriceFor(input.restaurantId, input.itemId);
  const oldBase = Number(input.oldRestaurantPrice) || 0;
  const newBase = Number(input.newRestaurantPrice) || 0;

  // Nothing typed means nothing to preserve: the restaurant percentage applies
  // to the new price on its own, which is already correct.
  if (typed === null || oldBase <= 0) return null;

  const keptRupees = Math.round((typed - oldBase) * 100) / 100;
  const keptPercent = (typed / oldBase - 1) * 100;

  const rupee = Math.round(newBase + keptRupees);

  return {
    rupee,
    percent: Math.round(newBase * (1 + keptPercent / 100)),
    keptRupees,
    keptPercent: Math.round(keptPercent * 100) / 100,
    /*
     * What holding the rupee margin leaves as a PERCENTAGE, so the erosion is
     * visible at the moment of decision.
     *
     * A margin held at Rs 40 across Rs 200 -> Rs 260 -> Rs 340 goes 20% to 15.4%
     * to 11.8%. Nothing reports that, and it erodes fastest exactly when costs
     * rise fastest -- which is when the owner can least afford it. Holding rupees
     * is still the right default; drifting toward nothing without being told is
     * not.
     */
    rupeeKeepsPercent: newBase > 0 ? Math.round((keptRupees / newBase) * 10000) / 100 : 0
  };
}

export function setItemPrice(input: {
  restaurantId: string;
  itemId: string;
  restaurantPrice: number;
  customerPrice: number | null;
  actorUserId: string;
  note?: string;
}): { customerPrice: number | null; marginPaise: number } {
  const base = Number(input.restaurantPrice) || 0;
  const existing = { ...(row(input.restaurantId)?.itemPrices ?? {}) };

  if (input.customerPrice === null) {
    delete existing[input.itemId];
  } else {
    const typed = Number(input.customerPrice);
    if (!Number.isFinite(typed) || typed < 0) {
      throw new AppError('Enter the price the customer should pay.', 400, 'INVALID_ITEM_PRICE');
    }
    if (typed < base) {
      throw new AppError(
        `The restaurant charges ${base.toFixed(2)} for this dish. Charging the customer ` +
          `${typed.toFixed(2)} would pay out more than it collects, losing ` +
          `${(base - typed).toFixed(2)} every time somebody orders it.`,
        400,
        'ITEM_PRICE_BELOW_COST'
      );
    }
    existing[input.itemId] = Math.round(typed * 100) / 100;
  }

  setCharges(input.restaurantId, { itemPrices: existing }, input.actorUserId, input.note);

  const resolved = typedPriceFor(input.restaurantId, input.itemId);
  return {
    customerPrice: resolved,
    marginPaise: resolved === null ? 0 : Math.round((resolved - base) * 100)
  };
}

/**
 * A whole menu, priced as the customer should see it.
 *
 * Exposed so every surface that shows a price to a CUSTOMER — the menu, search,
 * the cart — applies the same function rather than each doing its own
 * arithmetic. Four surfaces inflating independently is four chances for the
 * dish price and the checkout total to disagree.
 *
 * **Never call this for a partner or an admin menu.** They must see the
 * restaurant's own prices; showing a partner the inflated figure while paying
 * them the original is how they conclude the platform is stealing.
 */
export function inflateMenuForCustomer<T extends { categories?: any[] }>(
  menu: T | null,
  restaurantId: string
): T | null {
  if (!menu) return menu;

  /*
   * The short circuit now asks about BOTH kinds of markup.
   *
   * It used to return the menu untouched whenever foodMarkupPercent was 0,
   * which was correct while a percentage was the only markup there was. With
   * typed per-item prices it is not: a restaurant on 0% WITH typed prices would
   * have shown the kitchen's raw prices on the menu and charged the typed ones
   * at the till -- one total on the cart screen and another at the end, which is
   * the complaint this feature is most likely to produce.
   *
   * Deleting the early return outright would have fixed that and introduced a
   * second cost: a new menu object allocated on every read, for every
   * restaurant, forever, including the great majority that mark nothing up.
   * There is a test asserting object IDENTITY here precisely to pin that, and it
   * failed honestly when the return was removed.
   *
   * So the condition is widened rather than dropped. Nothing marked up in
   * either way means the same object comes back; anything marked up means the
   * menu is priced.
   */
  const typedPrices = row(restaurantId)?.itemPrices ?? {};
  const hasTypedPrices = Object.keys(typedPrices).length > 0;
  if (effectiveCharges(restaurantId).foodMarkupPercent === 0 && !hasTypedPrices) return menu;

  return {
    ...menu,
    categories: (menu.categories || []).map((category: any) => ({
      ...category,
      items: (category.items || []).map((item: any) => ({
        ...item,
        price: customerDishPrice(restaurantId, item.id, item.price),
        /** What the kitchen set. Present so a bill can be explained later. */
        partnerPrice: Number(item.price) || 0,
        optionGroups: (item.optionGroups || []).map((group: any) => ({
          ...group,
          options: (group.options || []).map((option: any) => ({
            ...option,
            // An add-on is part of the dish price, so it is marked up with it.
            // Leaving add-ons raw would let a customer dodge the markup by
            // ordering a cheap base with expensive extras.
            // Scaled by the ratio the dish's own price implies, so an extra on
            // a dish typed at Rs 240 is not itself charged Rs 240.
            priceDelta: customerAddonsPrice(restaurantId, item.id, item.price, option.priceDelta),
            partnerPriceDelta: Number(option.priceDelta) || 0
          }))
        }))
      }))
    }))
  };
}

export function resetRestaurantChargesForTesting(): void {
  memoryStore.restaurantCharges.clear();
}

/** Exported for the rupee/paise round trip in reports. */
export const marginRupees = (paise: number) => toRupees(paise);

/**
 * Clears a typed customer price when the kitchen's own price CHANGES.
 *
 * A backstop, not the main flow. Prices normally change through the approval
 * queue, where the new price and the customer price are decided together. Two
 * routes still write a price straight through, so this lives inside
 * `menuRepository.updateItem` where both are covered by one rule.
 *
 * It compares STORED against INCOMING rather than reacting to the field being
 * present, because MenuItemSchema is `.partial()` -- a rename or a photo swap
 * carries no price, and a description fix must not cost the platform its markup
 * on that dish.
 *
 * Clearing rather than keeping is the safe direction. A typed price is absolute:
 * a kitchen going from Rs 200 to Rs 260 against a typed Rs 240 would have the
 * platform paying out more than it collects on every order. Losing the markup is
 * recoverable by typing it again; paying more than you charge is not.
 *
 * If this starts firing regularly, something is writing prices around the
 * approval queue, and that is the bug to find rather than this line.
 */
export function clearTypedPriceIfPriceChanged(
  restaurantId: string,
  itemId: string,
  storedPrice: number | undefined,
  incomingPrice: number | undefined
): boolean {
  if (incomingPrice === undefined || incomingPrice === null) return false;

  const before = Number(storedPrice);
  const after = Number(incomingPrice);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return false;
  if (Math.round(before * 100) === Math.round(after * 100)) return false;

  if (typedPriceFor(restaurantId, itemId) === null) return false;

  const existing = { ...(row(restaurantId)?.itemPrices ?? {}) };
  delete existing[itemId];
  setCharges(
    restaurantId,
    { itemPrices: existing },
    'system',
    `Kitchen price changed from ${before} to ${after}, so the typed customer price was cleared.`
  );
  return true;
}
