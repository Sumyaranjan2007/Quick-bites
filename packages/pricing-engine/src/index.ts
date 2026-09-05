/**
 * Quick Bite - Core Pricing & Tax Calculation Engine
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
}

export interface CalculatedBill {
  itemsTotal: number;
  gstAmount: number;
  packagingFee: number;
  deliveryFee: number;
  platformFee: number;
  couponDiscount: number;
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

  // 7. Total Payable
  const preDiscount = itemsTotal + gstAmount + packagingFee + deliveryFee + platformFee;
  const totalAmount = Math.max(0, Math.round((preDiscount - couponDiscount) * 100) / 100);

  // 8. Restaurant Net Payout: Food Total - 15% Commission - 1% TDS + Packaging
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
    totalAmount,
    restaurantNetPayout
  };
}
