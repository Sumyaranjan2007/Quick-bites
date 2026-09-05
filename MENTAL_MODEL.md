# Quick Bite Platform -- Mental Model & System Mechanics (MENTAL_MODEL)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Architecture Team  

---

## 1. System Philosophy & Plain English Overview

Quick Bite is designed so that any engineer, product manager, or AI assistant can understand exactly how data, money, and state changes move through the codebase without reading thousands of lines of code.

The core architecture follows a simple principle: **The Frontend is an Untrusted Display Engine; The Backend is the Authoritative Arbiter of State and Truth.**

No client (mobile app or web terminal) ever calculates prices, assigns delivery states, or grants permissions on its own. Every action is verified, signed, and recorded centrally in our backend.

---

## 2. "When User Does X, System Does Y Because Z"

### 2.1 Placing an Order
- **When:** A customer taps "Place Order" on the checkout screen.
- **System Does:** 
  1. Verifies that the client sent an `idempotencyKey` (a UUID generated on the device).
  2. Queries PostgreSQL to ensure the restaurant is currently OPEN and accepting orders.
  3. Re-fetches current dish prices and stock availability from MongoDB.
  4. Recalculates the bill from scratch (Subtotal + 5% GST + Packaging Fee + Platform Fee + Delivery Fee - Verified Coupon).
  5. Inserts an order row into PostgreSQL with status `PAYMENT_PENDING`.
  6. Dispatches an incoming order event to the restaurant's live web terminal via Socket.io.
- **Because:** Customers cannot be trusted to submit item prices (they could manipulate request bodies), and network double-clicks must never result in duplicate orders or double billing.

### 2.2 Restaurant Accepting an Order
- **When:** A kitchen manager taps "Accept Order (25 Mins)" on their web terminal.
- **System Does:**
  1. Validates that the logged-in restaurant owner owns the restaurant tied to the order (`restaurant.owner_id === user.id`).
  2. Updates order status in PostgreSQL to `PREPARING` and sets `estimated_delivery_time = NOW() + 25m + transit_time`.
  3. Emits WebSocket event to room `order:<orderId>`.
  4. Sends a push notification to the customer's phone via Firebase Cloud Messaging.
- **Because:** Kitchen preparation time directly dictates customer expectations and delivery dispatch scheduling; immediate feedback prevents customer cancellation anxiety.

### 2.3 Applying a Promo Code
- **When:** A customer types `WELCOME50` in the cart screen.
- **System Does:**
  1. Checks Redis cache for active coupon rules.
  2. Verifies coupon validity: Start Date <= Now <= Expiry Date, Minimum Order Value >= cart subtotal.
  3. Checks PostgreSQL order history to verify user has not exceeded maximum usage count (e.g. 1 time per user for welcome codes).
  4. Calculates discount (e.g., 50% capped at Rs 100).
  5. Returns signed discount object to client.
- **Because:** Promo fraud (re-using single-use coupons via multiple devices or sessions) destroys unit economics; server-side validation against customer history prevents coupon exploitation.

### 2.4 Customer Cancelling an Order
- **When:** A customer taps "Cancel Order" within 60 seconds of placing it.
- **System Does:**
  1. Checks current order status in database.
  2. If status is `PLACED` and time elapsed < 60s, marks status as `CANCELLED`.
  3. Triggers automated refund via Razorpay Refund API if prepaid, or marks COD balance void.
  4. Emits cancellation alert to restaurant terminal to halt kitchen preparation.
  5. If status is already `PREPARING`, cancellation is rejected with an explanation that food is already in the kitchen.
- **Because:** Once cooking begins, food ingredients are consumed and the restaurant has incurred irrecoverable cost.

---

## 3. How Data Moves Through the System

```
1. User Action
   [Mobile / Web Touch Event]
        |
        v
2. Client Request Formation
   - Attaches Bearer JWT in Authorization Header
   - Injects X-Correlation-ID for distributed tracing
   - Formats JSON payload
        |
        v
3. API Gateway / Global Middleware
   - Helmet sets HTTP security headers (CSP, HSTS, XSS)
   - CORS checks origin against whitelist
   - Token Bucket Rate Limiter checks IP & User budget
   - Supabase Auth middleware validates JWT signature & extracts { userId, role }
   - Zod Schema Validator verifies exact shape, types, and constraints of body
        |
        v
4. Domain Service Layer
   - Executes business rules & access checks (RBAC)
   - Reads / writes to PostgreSQL via Prisma parameterized queries
   - Reads / writes nested menus to MongoDB
   - Updates cache keys in Upstash Redis
        |
        v
5. Asynchronous Event Dispatch
   - Socket.io broadcasts state changes to interested rooms
   - FCM sends background push notification
   - Resend dispatches email confirmation
        |
        v
6. Standard Envelope Response
   - Returns JSON: { success: true, data: {...}, meta: { timestamp, correlationId } }
```

---

## 4. How Authentication & Multi-User Isolation Works

### 4.1 Token Structure
- Authentication uses JSON Web Tokens (JWT) signed by Supabase GoTrue using RS256 private keys.
- JWT Payload contains:
  ```json
  {
    "sub": "usr_948fbc2e-...",
    "email": "rahul.sharma@example.com",
    "role": "customer",
    "app_metadata": { "provider": "email" },
    "user_metadata": { "name": "Rahul Sharma", "preferred_lang": "kn" },
    "exp": 1725580800
  }
  ```

### 4.2 Multi-User Isolation Rules
1. **Customer Isolation:** In all database queries regarding orders, addresses, or profile data, the query *always* contains an explicit `WHERE user_id = req.user.id` clause. It is physically impossible for User A to fetch User B's order by guessing an Order ID.
2. **Restaurant Partner Isolation:** A restaurant manager can only view or mutate orders, menus, and payouts where `restaurant.owner_id === req.user.id`.
3. **Admin Verification:** Admin endpoints verify that `req.user.role === 'super_admin'` before allowing access to cross-tenant or platform-level queries.

---

## 5. Where the "Smart" Business Logic Lives

### 5.1 Pricing & Tax Engine
All pricing calculations are centralized in `packages/pricing-engine` (shared between backend services):
- **Base Food Total:** Sum of (Item Price + Addon Prices) * Quantity.
- **GST on Food:** 5% on Food Total (for non-AC / standard cloud kitchens) per Indian GST law.
- **Packaging Fee:** Fixed fee configured per restaurant (e.g. Rs 15 - Rs 35).
- **Delivery Fee:**
  - Base fee: Rs 30 for first 3km.
  - Incremental fee: Rs 10 per additional km beyond 3km.
  - Free delivery if customer is an active **Quick Bite Gold** subscriber AND Food Total >= Rs 199.
- **Platform Fee:** Fixed Rs 5.00 charged to customer (taxed at 18% GST = Rs 0.90).
- **Restaurant Commission:** Platform retains 15% of Food Total. Net payout to restaurant = Food Total - 15% Commission - Applicable TDS (1%).

### 5.2 Search Scoring & Ranking
Implemented in Meilisearch:
- Ranking criteria: `exactness > typo > words > proximity > attribute > sort(rating:desc, delivery_time:asc)`.
- Veg filter applies a hard boolean facet: `is_veg = true`.

---

## 6. Demo Mode vs Production Mode

To guarantee that Quick Bite can be demonstrated, audited, and tested at any time without external dependencies or payment charges, the system provides a first-class **Demo Mode**:

| Feature / System | Demo Mode Behavior | Production Mode Behavior |
|------------------|-------------------|--------------------------|
| **Payment Gateway** | Razorpay Sandbox with test UPI VPAs (e.g., `success@razorpay`) and simulated cards. Instant automated authorization. | Live Razorpay merchant account with real INR settlement. |
| **Email Delivery** | Logs OTPs to backend console and displays demo toast in development. | Sends real transactional email to user inbox via Resend. |
| **Push Notifications** | In-app notification bell toasts and simulated status banner. | Dispatches native APNs (iOS) and FCM (Android) push alerts. |
| **Restaurant Data** | Admin portal provides a "Generate Test Restaurant" button to create 1-click full menus and profiles. | Real restaurant partners onboarded via FSSAI/GST document verification. |
| **Maps & Location** | Pre-configured Bengaluru mock GPS coordinates (Indiranagar / Koramangala) if GPS is unavailable. | Live GPS device coordinates reverse geocoded via OpenStreetMap. |
