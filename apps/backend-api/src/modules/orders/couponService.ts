import { memoryStore } from '../../db/client.ts';
import type { Coupon } from '@quick-bites/shared-types';

export interface CouponValidationResult {
  valid: boolean;
  discountType?: 'PERCENTAGE' | 'FLAT' | 'FREE_DELIVERY';
  discountValue?: number;
  maxDiscountCap?: number;
  minOrderValue?: number;
  reason?: string;
}

export interface CouponContext {
  /** Who is redeeming, so a per-customer limit can be counted. */
  customerId?: string;
  /** Which kitchen, so a campaign restricted to some partners can be honoured. */
  restaurantId?: string;
}

/**
 * Checks a promo code at checkout.
 *
 * Every condition an administrator can set on a campaign is enforced here: the
 * window it runs in, the minimum basket, how many times it may be used overall
 * and per customer, and which restaurants it applies to. A condition the console
 * offers but the checkout ignores is worse than not offering it — the campaign
 * looks limited and is not.
 */
export const couponService = {
  validateCoupon(code: string, itemsTotal: number, context: CouponContext = {}): CouponValidationResult {
    const coupon = memoryStore.coupons.get(String(code).trim().toUpperCase()) as Coupon | undefined;
    if (!coupon) {
      return { valid: false, reason: 'Invalid or non-existent coupon code.' };
    }
    if (!coupon.isActive) {
      return { valid: false, reason: 'This coupon is no longer active.' };
    }

    const now = Date.now();
    if (coupon.startsAt && now < new Date(coupon.startsAt).getTime()) {
      return { valid: false, reason: 'This offer has not started yet.' };
    }
    if (coupon.expiresAt && now > new Date(coupon.expiresAt).getTime()) {
      return { valid: false, reason: 'This offer has expired.' };
    }
    if (coupon.minOrderValue && itemsTotal < coupon.minOrderValue) {
      return {
        valid: false,
        reason: `Minimum order value of Rs ${coupon.minOrderValue} required for this coupon.`
      };
    }
    if (coupon.usageLimit && (coupon.timesUsed || 0) >= coupon.usageLimit) {
      return { valid: false, reason: 'This offer has been fully claimed.' };
    }
    if (coupon.budget && (coupon.spent || 0) >= coupon.budget) {
      return { valid: false, reason: 'This offer has been fully claimed.' };
    }
    // A welcome offer is for somebody who has not ordered yet. Checked on
    // DELIVERED orders, so a customer whose first order was cancelled still
    // qualifies.
    if (coupon.newCustomersOnly && context.customerId) {
      for (const order of memoryStore.orders.values()) {
        if (order.customerId === context.customerId && order.status === 'DELIVERED') {
          return { valid: false, reason: 'This offer is for your first order only.' };
        }
      }
    }
    if (
      coupon.applicableRestaurantIds?.length &&
      context.restaurantId &&
      !coupon.applicableRestaurantIds.includes(context.restaurantId)
    ) {
      return { valid: false, reason: 'This offer is not valid at this restaurant.' };
    }
    if (coupon.perUserLimit && context.customerId) {
      let used = 0;
      for (const order of memoryStore.orders.values()) {
        if (
          order.customerId === context.customerId &&
          String(order.couponCode || '').toUpperCase() === coupon.code &&
          order.status !== 'CANCELLED'
        ) {
          used++;
        }
      }
      if (used >= coupon.perUserLimit) {
        return { valid: false, reason: 'You have already used this offer.' };
      }
    }

    return {
      valid: true,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      maxDiscountCap: coupon.maxDiscountCap,
      minOrderValue: coupon.minOrderValue
    };
  }
};
