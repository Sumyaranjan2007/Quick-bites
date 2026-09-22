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

/**
 * What an administrator may set for one restaurant.
 *
 * Every money field is in rupees, and every one of them may be `null`, meaning
 * "follow the platform default".
 */
export interface RestaurantCharges {
  restaurantId: string;

  /**
   * What the customer is charged for packaging.
   *
   * `null` means charge exactly what the partner declared — no markup. A number
   * means charge that, and the difference above the partner's figure is ours.
   */
  customerPackagingFee: number | null;

  /** Charged to the customer in full. No part of it reaches the restaurant. */
  platformFee: number | null;

  /** GST on the food line, as a percentage. */
  gstFoodPercent: number | null;

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

  updatedAt: string;
  updatedByUserId: string;
  /** Why, so somebody reading this in six months knows. */
  note?: string;
}

/** Every figure that actually applies to one restaurant's next order. */
export interface EffectiveCharges {
  restaurantId: string;
  /** Reaches the partner. */
  partnerPackagingFee: number;
  /** Charged to the customer. */
  customerPackagingFee: number;
  /** `customerPackagingFee - partnerPackagingFee`. Computed, never stored. */
  packagingMargin: number;
  platformFee: number;
  gstFoodPercent: number;
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
  const partnerPackaging = partnerPackagingFee(restaurantId, rates);

  // No markup configured means charge what the partner asked for. Not the
  // platform default — the partner's own figure is the honest floor, and
  // defaulting to anything else would mark up every restaurant that has never
  // been looked at.
  const customerPackaging =
    own?.customerPackagingFee !== null && own?.customerPackagingFee !== undefined
      ? own.customerPackagingFee
      : partnerPackaging;

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
    partnerPackagingFee: partnerPackaging,
    customerPackagingFee: customerPackaging,
    // Never negative. An administrator who sets the customer charge BELOW the
    // partner's figure is subsidising that restaurant out of platform revenue,
    // which is allowed — but it is not a negative margin on the packaging line,
    // it is a discount, and it is reported as one.
    packagingMargin: Math.round((customerPackaging - partnerPackaging) * 100) / 100,
    platformFee: pick('platformFee', rates.platformFeeBase),
    gstFoodPercent: pick('gstFoodPercent', rates.gstFoodPercent),
    commissionPercent: pick('commissionPercent', rates.defaultCommissionPercent),
    deliveryBaseFee: pick('deliveryBaseFee', rates.deliveryBaseFee),
    extraCharge: own?.extraCharge ?? 0,
    extraChargeLabel: own?.extraChargeLabel ?? '',
    overridden
  };

  if (own?.customerPackagingFee !== null && own?.customerPackagingFee !== undefined) {
    overridden.push('customerPackagingFee');
  }

  return charges;
}

const BOUNDS: Record<string, { min: number; max: number; unit: string; label: string }> = {
  customerPackagingFee: { min: 0, max: 200, unit: 'Rs', label: 'Packaging charged to the customer' },
  platformFee: { min: 0, max: 100, unit: 'Rs', label: 'Platform fee' },
  gstFoodPercent: { min: 0, max: 28, unit: '%', label: 'GST on food' },
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
    customerPackagingFee: existing?.customerPackagingFee ?? null,
    platformFee: existing?.platformFee ?? null,
    gstFoodPercent: existing?.gstFoodPercent ?? null,
    commissionPercent: existing?.commissionPercent ?? null,
    deliveryBaseFee: existing?.deliveryBaseFee ?? null,
    extraCharge: existing?.extraCharge ?? 0,
    extraChargeLabel: existing?.extraChargeLabel ?? '',
    ...changes,
    updatedAt: new Date().toISOString(),
    updatedByUserId: actorUserId,
    ...(note ? { note } : {})
  };

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
  packagingMarginPaise: number;
  platformFeePaise: number;
  extraChargePaise: number;
  deliveryMarginPaise: number;
  totalPaise: number;
} {
  const bill: any = order?.bill || {};

  const commissionPaise = toPaise(Number(bill.commissionAmount) || 0);
  const platformFeePaise = toPaise(Number(bill.platformFee) || 0);
  const extraChargePaise = toPaise(Number(bill.extraCharge) || 0);

  // The packaging markup. Both figures are frozen onto the bill at checkout
  // precisely so this can be computed later without guessing what the partner's
  // declared figure was at the time.
  const customerPackaging = Number(bill.packagingFee) || 0;
  const partnerPackaging = Number.isFinite(Number(bill.partnerPackagingFee))
    ? Number(bill.partnerPackagingFee)
    : customerPackaging;
  const packagingMarginPaise = Math.max(0, toPaise(customerPackaging - partnerPackaging));

  // What was charged for delivery, less what the rider was paid for it.
  const deliveryPaise = toPaise(Number(bill.deliveryFee) || 0);
  const riderPaise = toPaise(Number(order?.riderPayout) || 0);
  const deliveryMarginPaise = deliveryPaise - riderPaise;

  return {
    commissionPaise,
    packagingMarginPaise,
    platformFeePaise,
    extraChargePaise,
    deliveryMarginPaise,
    totalPaise:
      commissionPaise + packagingMarginPaise + platformFeePaise + extraChargePaise + deliveryMarginPaise
  };
}

/** Rupee view for a screen. */
export function chargesView(charges: EffectiveCharges) {
  return {
    ...charges,
    /** Said in words, because the point of the screen is that this is ours. */
    marginNote:
      charges.packagingMargin > 0
        ? `The customer pays Rs ${charges.customerPackagingFee} for packaging, the restaurant earns Rs ${charges.partnerPackagingFee}, and Rs ${charges.packagingMargin} is ours.`
        : charges.packagingMargin < 0
        ? `You are charging Rs ${Math.abs(charges.packagingMargin)} less than this restaurant asked for. The difference comes out of platform revenue.`
        : 'The customer pays exactly what the restaurant asked for. Nothing is added.'
  };
}

export function listCharges(): RestaurantCharges[] {
  return Array.from(memoryStore.restaurantCharges.values()).filter(
    (c: any) => c && typeof c.restaurantId === 'string'
  ) as RestaurantCharges[];
}

export function resetRestaurantChargesForTesting(): void {
  memoryStore.restaurantCharges.clear();
}

/** Exported for the rupee/paise round trip in reports. */
export const marginRupees = (paise: number) => toRupees(paise);
