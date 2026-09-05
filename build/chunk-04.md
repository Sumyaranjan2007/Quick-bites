# Chunk 04: Order State Machine, Pricing Engine & Razorpay Adapter

**Goal:** Implement the order lifecycle state machine, pricing and tax calculation engine (5% GST, fees, Gold discount), coupon validator, and Razorpay Sandbox payment adapter.  
**Estimated Time:** 90 minutes  
**Dependencies:** Chunk 03  
**Unlocks:** Chunk 07 (Client Ordering Flow)  

---

## 1. Pricing Engine Specification (`packages/pricing-engine`)
- **Food Subtotal:** Sum of `(item.price + addons) * quantity`
- **GST on Food:** `Math.round(foodSubtotal * 0.05 * 100) / 100`
- **Packaging Fee:** Restaurant fixed fee (e.g. Rs 25.00)
- **Delivery Fee:** Rs 30 for <=3km, +Rs 10/km beyond. Rs 0 if `isGold && foodSubtotal >= 199`.
- **Platform Fee:** Rs 5.00 + 18% GST (Rs 0.90) = Rs 5.90
- **Restaurant Commission:** `foodSubtotal * 0.15`

## 2. Order State Machine Transitions
```
PAYMENT_PENDING
      |
      v
ORDER_PLACED  <-----+ (If COD or Razorpay Verified)
      |
      v
  ACCEPTED
      |
      v
  PREPARING
      |
      v
READY_FOR_PICKUP
      |
      v
OUT_FOR_DELIVERY
      |
      v
  DELIVERED  (Verified via 4-digit customer OTP)
```

---

## 3. Verification Commands

```bash
# Run pricing engine unit tests
npm --prefix packages/pricing-engine test
```

---

## 4. Rollback Instructions
Revert changes in `packages/pricing-engine` and `apps/backend-api/src/modules/orders`.
