import { memoryStore } from '../../db/client.ts';

export interface CouponValidationResult {
  valid: boolean;
  discountType?: 'PERCENTAGE' | 'FLAT' | 'FREE_DELIVERY';
  discountValue?: number;
  maxDiscountCap?: number;
  minOrderValue?: number;
  reason?: string;
}

export const couponService = {
  validateCoupon(code: string, itemsTotal: number): CouponValidationResult {
    const coupon = memoryStore.coupons.get(code.toUpperCase());
    if (!coupon) {
      return { valid: false, reason: 'Invalid or non-existent coupon code.' };
    }
    if (!coupon.isActive) {
      return { valid: false, reason: 'This coupon is no longer active.' };
    }
    if (coupon.minOrderValue && itemsTotal < coupon.minOrderValue) {
      return {
        valid: false,
        reason: `Minimum order value of Rs ${coupon.minOrderValue} required for this coupon.`
      };
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
