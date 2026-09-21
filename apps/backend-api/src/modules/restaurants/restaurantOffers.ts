import type { Coupon, Restaurant } from '@quick-bites/shared-types';

/**
 * The offer badge on a restaurant card, and the promotion on the home screen.
 *
 * Both used to be text typed into the app. Every card in the discovery feed read
 * "50% OFF", and the hero banner read "UP TO 50% OFF - Use WELCOME50", on every
 * phone, for every restaurant, whether or not any such coupon existed. It is the
 * same class of fault as the "25 MINS" that used to sit under it: a number
 * nobody computed, rendered with total confidence.
 *
 * It is a worse one, though. A delivery estimate that is wrong is an
 * inconvenience. A discount that is advertised and then not applied at checkout
 * is a false price claim - the customer chose that restaurant because of it, and
 * finds out at the payment screen. That is the sort of thing a consumer
 * regulator has opinions about, and it is certainly the sort of thing that loses
 * a customer permanently.
 *
 * So a badge now comes from a coupon that exists, is live, and would actually
 * apply to this restaurant. When there is no such coupon, there is no badge -
 * omitted rather than guessed, exactly as the delivery estimate is.
 */

export interface OfferBadge {
  /** What goes on the badge. Short: it sits on a photograph. */
  label: string;
  /** The code a customer types at checkout. The badge's whole promise. */
  code: string;
  /** Longer form for the detail page. */
  description: string;
  /** Present when the offer only applies above a spend, so the app can say so. */
  minOrderValue?: number;
  /** Present on a percentage offer with a ceiling, which is most of them. */
  maxDiscountCap?: number;
  expiresAt?: string;
}

/**
 * Whether a coupon is one a customer could actually use right now.
 *
 * Every condition here is a way the old badge could have been lying: an expired
 * coupon, a coupon not yet started, a coupon switched off, a coupon whose
 * redemptions are exhausted. A badge drawn from any of those is a promise the
 * checkout will refuse.
 *
 * `perUserLimit` is deliberately NOT checked. It needs a customer, the feed is
 * served to signed-out browsers too, and a per-customer check would make the
 * home screen uncacheable to save a rare case where somebody has already used
 * an offer. That case is handled honestly at checkout, where the customer is
 * known.
 */
export function isLiveCoupon(coupon: Coupon, at: Date = new Date()): boolean {
  if (!coupon.isActive) return false;

  const now = at.getTime();
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) return false;
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= now) return false;

  if (typeof coupon.usageLimit === 'number' && coupon.timesUsed >= coupon.usageLimit) return false;

  return true;
}

/** Whether this coupon is one of the ones this restaurant's customers can use. */
export function couponAppliesToRestaurant(coupon: Coupon, restaurant: Restaurant): boolean {
  const restricted = coupon.applicableRestaurantIds;
  // Absent or empty means platform-wide. That is the existing convention in the
  // type, and reading it the other way would silently un-advertise every
  // platform-wide offer there is.
  if (!restricted || restricted.length === 0) return true;
  return restricted.includes(restaurant.id);
}

/**
 * What a coupon is worth on a typical order at this restaurant, in rupees.
 *
 * Used only to rank offers against each other, never shown. A percentage and a
 * flat amount are not comparable without a basket to apply them to, and
 * "40% off" beating "Rs 150 off" on a Rs 200 order would put the worse offer on
 * the card.
 *
 * `costForTwo` is the basket it assumes, because it is the only figure the
 * platform holds about what an order at this kitchen tends to cost. A
 * restaurant with no `costForTwo` falls back to a flat assumption; ranking is
 * the only thing affected, and a slightly mis-ranked pair of live offers is a
 * far smaller fault than advertising a dead one.
 */
export function offerValueFor(coupon: Coupon, restaurant: Restaurant): number {
  const basket = Number(restaurant.costForTwo) > 0 ? Number(restaurant.costForTwo) : 400;

  if (coupon.minOrderValue && coupon.minOrderValue > basket) {
    // Reachable, but not on a typical order here. Ranked below anything that is.
    return 0;
  }

  if (coupon.discountType === 'PERCENTAGE') {
    const raw = (basket * coupon.discountValue) / 100;
    return coupon.maxDiscountCap ? Math.min(raw, coupon.maxDiscountCap) : raw;
  }
  return Math.min(coupon.discountValue, basket);
}

/** "50% OFF" or "Rs 100 OFF" - short enough to sit on a photograph. */
export function badgeLabel(coupon: Coupon): string {
  return coupon.discountType === 'PERCENTAGE'
    ? `${Math.round(coupon.discountValue)}% OFF`
    : `₹${Math.round(coupon.discountValue)} OFF`;
}

function describe(coupon: Coupon): string {
  if (coupon.description && coupon.description.trim()) return coupon.description.trim();
  if (coupon.title && coupon.title.trim()) return coupon.title.trim();

  const amount =
    coupon.discountType === 'PERCENTAGE'
      ? `${Math.round(coupon.discountValue)}% off`
      : `₹${Math.round(coupon.discountValue)} off`;
  const floor = coupon.minOrderValue ? ` on orders above ₹${Math.round(coupon.minOrderValue)}` : '';
  return `${amount}${floor} with ${coupon.code}`;
}

/**
 * The single best live offer for this restaurant, or null.
 *
 * Null is a normal, expected answer and the app must render nothing for it. A
 * platform with no coupons running shows no badges, which is the truth.
 */
export function bestOfferFor(
  restaurant: Restaurant,
  coupons: Coupon[],
  at: Date = new Date()
): OfferBadge | null {
  let best: Coupon | null = null;
  let bestValue = -1;

  for (const coupon of coupons) {
    if (!isLiveCoupon(coupon, at)) continue;
    if (!couponAppliesToRestaurant(coupon, restaurant)) continue;

    const value = offerValueFor(coupon, restaurant);
    // A restaurant-specific offer beats a platform-wide one of equal worth: it
    // is the more specific claim, and it is the one that kitchen is paying for.
    const specific = Boolean(coupon.applicableRestaurantIds?.length);
    const bestSpecific = Boolean(best?.applicableRestaurantIds?.length);

    if (value > bestValue || (value === bestValue && specific && !bestSpecific)) {
      best = coupon;
      bestValue = value;
    }
  }

  if (!best) return null;

  return {
    label: badgeLabel(best),
    code: best.code,
    description: describe(best),
    minOrderValue: best.minOrderValue,
    maxDiscountCap: best.maxDiscountCap,
    expiresAt: best.expiresAt
  };
}

export interface PromotionBanner {
  kicker: string;
  title: string;
  subtitle: string;
  code: string;
  expiresAt?: string;
}

/**
 * The home screen's hero banner, or null.
 *
 * Drawn from the best live PLATFORM-WIDE offer, because the banner sits above
 * the whole feed and a restaurant-specific coupon promised there would fail for
 * almost every kitchen underneath it.
 *
 * Returning null is the common case on a platform running no campaign, and the
 * app removes the banner rather than showing an empty one. A hero that is
 * sometimes absent is correct; a hero that always promises 50% is not.
 */
export function platformPromotion(coupons: Coupon[], at: Date = new Date()): PromotionBanner | null {
  const platformWide = coupons.filter(
    c => isLiveCoupon(c, at) && !(c.applicableRestaurantIds && c.applicableRestaurantIds.length > 0)
  );
  if (platformWide.length === 0) return null;

  // Ranked on the headline number rather than a basket: there is no restaurant
  // to assume a basket for, and the banner's job is to lead with the largest
  // honest claim the platform can make.
  const best = platformWide.reduce((a, b) => {
    const av = a.discountType === 'PERCENTAGE' ? a.discountValue * 10 : a.discountValue;
    const bv = b.discountType === 'PERCENTAGE' ? b.discountValue * 10 : b.discountValue;
    return bv > av ? b : a;
  });

  const headline =
    best.discountType === 'PERCENTAGE'
      ? `UP TO\n${Math.round(best.discountValue)}% OFF`
      : `₹${Math.round(best.discountValue)}\nOFF`;

  return {
    kicker: best.title?.trim() ? best.title.trim().toUpperCase() : 'OFFERS',
    title: headline,
    subtitle: best.minOrderValue
      ? `On orders above ₹${Math.round(best.minOrderValue)}`
      : describe(best),
    code: best.code,
    expiresAt: best.expiresAt
  };
}
