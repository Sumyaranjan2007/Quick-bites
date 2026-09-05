# Quick Bite Platform -- Comprehensive Testing Strategy (TESTING_STRATEGY)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Quality Assurance & Engineering Team  

---

## 1. Testing Pyramid Overview

Quick Bite adheres to the standard testing pyramid with high unit test coverage on critical business logic (tax calculations, pricing engine, commission ledgers) and focused integration/E2E tests for core user journeys:

```
          /\
         /  \
        / E2E \         ~10% (Critical ordering & payment flows)
       /-------\
      / Integr. \       ~30% (API endpoints, DB transactions, WebSockets)
     /-----------\
    /    Unit     \     ~60% (Pricing engine, Zod validators, token utils)
   /---------------
```

---

## 2. Test File Naming & Location Conventions

All test files are collocated directly next to the source code they test:
- Unit / Service tests: `[filename].test.ts`
- Integration tests: `[feature].integration.test.ts`
- E2E tests: `e2e/[journey].e2e.ts`

---

## 3. Unit Testing Scope

Unit tests execute in memory with zero external network or database dependencies:
1. **Pricing Engine (`packages/pricing-engine`):**
   - GST calculation: 5% on food items, 18% on platform fees.
   - Delivery fee rules: Base Rs 30 for <=3km, +Rs 10/km beyond.
   - Quick Bite Gold threshold: Free delivery on food total >= Rs 199.
   - Coupon discount formulas: Percentage caps, minimum spend enforcement.
   - Restaurant commission: 15% platform retention, 1% TDS deduction.
2. **Schema Validators:**
   - Zod schema validation rules for all 42 feature payloads.
   - Phone number format validation (+91 Indian standard).
   - 14-digit FSSAI license checksum validation.

---

## 4. Integration Testing Scope

Uses an isolated test database (PostgreSQL container or Supabase test project) and test Redis instance:
1. **Auth Flow:** Request OTP -> Verify OTP -> Generate JWT -> Access protected route.
2. **Order Placement Flow:** Create order with idempotency key -> Verify row in DB -> Attempt duplicate submission with same key -> Expect HTTP 409 Conflict.
3. **Restaurant Acceptance:** Partner accepts order -> Verify order status is PREPARING -> Check estimated delivery time calculation.
4. **WebSocket Rooms:** Connect client -> Join `order:<id>` -> Emit status update from backend -> Verify client receives event.

---

## 5. Mocking Strategy & Deterministic Seed Fixtures

- **Payment Gateway:** Mock Razorpay API responses using the standard Sandbox payload shape with valid HMAC signatures.
- **Mapping Service:** Mock OSRM distance matrix with pre-calculated distance pairs:
  - Indiranagar to Koramangala: 4.2 km (Rs 50 delivery fee)
  - Koramangala to HSR Layout: 3.1 km (Rs 40 delivery fee)
- **Push & Email:** Mock Resend and Firebase Admin SDK with spy functions that verify payload content without making network calls.
