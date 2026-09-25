import { calculateOrderPricing } from './index.ts';

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
if (bill1.deliveryFee !== 50.00) throw new Error('Delivery fee mismatch: ' + bill1.deliveryFee); // 30 + 20 = 50
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

console.log('All pricing tests passed successfully!');
