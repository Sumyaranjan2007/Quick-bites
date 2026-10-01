import { calculateOrderPricing, riderPayFor } from './index.ts';
import { DEFAULT_PRICING_RATES } from '@quick-bites/shared-types';

console.log('Running Pricing Engine Unit Tests...');

// Test 1: Standard Order (Non-Gold, 4.5km, no coupon)
const bill1 = calculateOrderPricing({
  items: [
    { unitPrice: 200, quantity: 2 }, // Rs 400
    { unitPrice: 50, quantity: 1 }   // Rs 50 -> Subtotal: Rs 450
  ],
  packagingFee: 25.00,
  distanceKm: 4.5
});

if (bill1.itemsTotal !== 450.00) throw new Error('Items total mismatch: ' + bill1.itemsTotal);
if (bill1.gstAmount !== 22.50) throw new Error('GST mismatch: ' + bill1.gstAmount);
// Owner, 1 Oct 2026: delivery = rider pay (4.5 road km x Rs 10 = 45) + markup (0% by default).
if (bill1.riderPay !== 45) throw new Error('Rider pay mismatch: ' + bill1.riderPay);
if (bill1.deliveryFee !== 45.00) throw new Error('Delivery fee mismatch: ' + bill1.deliveryFee);
console.log('[PASS] Test 1: Standard Order Pricing');

// Test 2: Gold takes a PERCENTAGE off delivery (3cbe959), not free delivery.
const goldNone = calculateOrderPricing({ items: [{ unitPrice: 250, quantity: 1 }], isGold: true, distanceKm: 5.0, memberFreeDeliveryMinOrder: 0 });
const goldHalf = calculateOrderPricing({ items: [{ unitPrice: 250, quantity: 1 }], isGold: true, distanceKm: 5.0, memberFreeDeliveryMinOrder: 0, memberDeliveryDiscountPercent: 50 });
const goldAll = calculateOrderPricing({ items: [{ unitPrice: 250, quantity: 1 }], isGold: true, distanceKm: 5.0, memberFreeDeliveryMinOrder: 0, memberDeliveryDiscountPercent: 100 });
const notGold = calculateOrderPricing({ items: [{ unitPrice: 250, quantity: 1 }], isGold: false, distanceKm: 5.0, memberFreeDeliveryMinOrder: 0, memberDeliveryDiscountPercent: 100 });
if (goldNone.deliveryFee !== notGold.deliveryFee) throw new Error('Gold with no percentage set should pay full delivery: ' + goldNone.deliveryFee);
if (goldHalf.deliveryFee !== Math.round(notGold.deliveryFee * 50) / 100) throw new Error('Gold at 50% should pay half delivery: ' + goldHalf.deliveryFee);
if (goldAll.deliveryFee !== 0) throw new Error('Gold at 100% should pay no delivery: ' + goldAll.deliveryFee);
console.log('[PASS] Test 2: Gold takes its percentage off delivery');

// Test 3: Coupon Discount with Cap
const bill3 = calculateOrderPricing({
  items: [{ unitPrice: 500, quantity: 1 }],
  coupon: {
    discountType: 'PERCENTAGE',
    discountValue: 50,
    maxDiscountCap: 100,
    minOrderValue: 200
  }
});
if (bill3.couponDiscount !== 100.00) throw new Error('Coupon discount should be capped at 100: ' + bill3.couponDiscount);
console.log('[PASS] Test 3: Percentage Coupon with Cap');

// Test 4: rider pay = km x rate, rounded, never below the minimum (owner, 1 Oct 2026).
const r = { ...DEFAULT_PRICING_RATES, riderPerKmFee: 10, riderMinEarningPerTrip: 30 };
if (riderPayFor(1.2, r) !== 30) throw new Error('A short trip must pay the minimum: ' + riderPayFor(1.2, r));
if (riderPayFor(3.47, r) !== 35) throw new Error('3.47 km at Rs 10 should round to Rs 35: ' + riderPayFor(3.47, r));
if (riderPayFor(8, { ...r, riderPerKmFee: 12 }) !== 96) throw new Error('The per-km rate must move pay');
if (riderPayFor(2, { ...r, riderMinEarningPerTrip: 0 }) !== 20) throw new Error('With no minimum, 2 km pays Rs 20');
console.log('[PASS] Test 4: Rider pay per km with a minimum');

// Test 5: the customer's delivery fee is rider pay plus the markup, so the margin is exactly the markup.
const marked = calculateOrderPricing({ items: [{ unitPrice: 300, quantity: 1 }], distanceKm: 6, rates: { ...r, riderDeliveryMarkupPercent: 20 } });
if (marked.riderPay !== 60) throw new Error('6 km should pay the rider Rs 60: ' + marked.riderPay);
if (marked.deliveryFee !== 72) throw new Error('Rs 60 + 20% should be Rs 72: ' + marked.deliveryFee);
if (marked.partnerDeliveryFee !== 60) throw new Error('The unmarked figure is the rider pay');
console.log('[PASS] Test 5: Delivery fee = rider pay + markup');

// Test 6: no GST on the platform fee unless the caller (who knows about the GSTIN) asks for it.
const noGst = calculateOrderPricing({ items: [{ unitPrice: 300, quantity: 1 }], platformFeeBase: 10 });
if (noGst.platformFee !== 10) throw new Error('Rs 10 set must be Rs 10 billed without a GSTIN: ' + noGst.platformFee);
const withGst = calculateOrderPricing({ items: [{ unitPrice: 300, quantity: 1 }], platformFeeBase: 10, platformFeeGstPercent: 18 });
if (withGst.platformFee !== 11.8) throw new Error('With a GSTIN at 18%, Rs 10 is Rs 11.80: ' + withGst.platformFee);
console.log('[PASS] Test 6: Platform fee GST only with a GSTIN');

console.log('All pricing tests passed successfully!');
