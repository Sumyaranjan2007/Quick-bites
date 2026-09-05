# Quick Bite Platform -- Product Requirements Document (PRD)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Product & Engineering Team  

---

## 1. Executive Summary

Quick Bite is an end-to-end food delivery and dining discovery platform built for the Indian market, engineered to deliver high performance, transparency, and consumer delight. Operating across three primary client portals—Customer Mobile App, Restaurant Partner Web Portal, and Platform Admin Dashboard—Quick Bite matches diners with top local restaurants and rapid delivery fulfillment. The platform is architected to operate entirely within free-tier cloud infrastructure during initial rollout, maintaining zero infrastructure costs while scaling up to 50,000 monthly active users.

---

## 2. Problem Statement

The Indian food delivery ecosystem faces three critical friction points:
1. **Aggregator Commission Inflation:** Incumbents charge restaurant partners between 22% and 33% per order, pushing small and mid-sized eateries into negative unit economics and forcing artificial menu inflation for consumers.
2. **Hidden Consumer Surcharges:** Opaque pricing structures involving high packaging fees, surging platform fees, and unpredictable delivery costs erode customer trust.
3. **Operational Opacity:** Independent cloud kitchens and family-owned restaurants lack accessible, real-time tooling for automated inventory management, menu synchronization, transparent payout settlements, and fraud protection without paying prohibitive platform fees.

Quick Bite solves this by delivering an ultra-responsive, lightweight platform with transparent item-level bill breakdowns, automated restaurant payout settlements, instant KYC onboarding, and localized multi-lingual access (English, Hindi, and Kannada).

---

## 3. Target Users and Personas

### Persona 1: Rahul Sharma (Urban Consumer)
- **Role:** Software Engineer / Tech Worker (Age 24, Bengaluru)
- **Goals:** Fast lunch and late-night dinner ordering with sub-30 second checkout, clear real-time tracking, reliable vegetarian options, and zero surprise charges at checkout.
- **Frustrations:** Aggressive surge fees, cold food due to delayed rider assignment, unresponsive customer support when items are missing.
- **Preferences:** Mobile-first (iOS/Android), uses UPI payments, prefers Kannada/English interface toggle, relies heavily on veg-only toggle.

### Persona 2: Sunita Deshmukh (Restaurant Partner)
- **Role:** Cloud Kitchen Co-Owner & Chef (Age 46, Pune)
- **Goals:** Simple web portal to manage daily menu availability, receive live order audio chimes, set prep times accurately, and monitor bi-weekly settlement payouts.
- **Frustrations:** Complex enterprise dashboards, delayed payment reconciliation, unfair customer cancellation charges deducted from restaurant earnings.
- **Preferences:** Desktop web browser, clean Hindi/English interface, simple one-click item toggle (In Stock / Out of Stock).

### Persona 3: Vikram Singh (Gig Delivery Partner - Phase 1b)
- **Role:** Full-Time Delivery Rider (Age 28, Hyderabad)
- **Goals:** Predictable earnings per delivery, fair distance pay calculation, instant OTP-based drop confirmation, battery-efficient turn-by-turn map navigation.
- **Frustrations:** Unfair penalty deductions for restaurant delays, battery drain caused by poorly optimized apps, navigation errors in dense residential complexes.
- **Preferences:** Android budget smartphone, high-contrast UI under bright sunlight, offline support for transient mobile blackspots.

### Persona 4: Ananya Iyer (Super Admin & Operations Lead)
- **Role:** Operations Manager (Age 32, Bengaluru)
- **Goals:** Real-time visibility into platform health, fraud velocity monitoring, rapid verification of restaurant KYC submissions (FSSAI/GST), and dispute settlement.
- **Frustrations:** Fragmented monitoring tools, manual database queries to resolve failed transactions, lack of audit trails for refund authorizations.
- **Preferences:** High data-density desktop dashboard, real-time WebSocket metrics feeds, one-click test restaurant generation for QA.

---

## 4. User Stories

### 4.1 Customer User Stories
- **US-C01:** As a diner, I want to authenticate instantly using Email OTP or Google OAuth so that I never have to remember a password.
- **US-C02:** As a diner, I want the app to auto-detect my GPS coordinates or let me search my address manually so that food is delivered to the exact doorstep.
- **US-C03:** As a diner, I want to filter restaurants by cuisine, rating, veg/non-veg status, and delivery distance so that I can find exactly what I crave in seconds.
- **US-C04:** As a diner, I want to customize menu items with portion sizes, toppings, spice levels, and cooking notes so that my food matches my taste.
- **US-C05:** As a diner, I want to review an itemized price breakdown (base price, GST, delivery fee, platform fee, coupon discount) before paying so that there are no hidden surprises.
- **US-C06:** As a diner, I want to pay seamlessly via Razorpay Sandbox (UPI, Card, Netbanking) or Cash on Delivery so that checkout is reliable.
- **US-C07:** As a diner, I want real-time step-by-step order tracking with push notifications so that I know exactly when my food is prepared and arriving.
- **US-C08:** As a diner, I want to toggle between English, Hindi, and Kannada so that I can use the app in my primary language.
- **US-C09:** As a diner, I want to reorder past meals with a single tap from my order history.
- **US-C10:** As a diner, I want to rate restaurants and leave verified reviews after delivery so that other diners benefit from my feedback.

### 4.2 Restaurant Partner User Stories
- **US-R01:** As a restaurant manager, I want to register my restaurant with FSSAI license, GSTIN, and bank verification so that my business is legally compliant.
- **US-R02:** As a restaurant manager, I want an audio-visual live order terminal that alerts me immediately when a new order arrives so that I can accept or reject it.
- **US-R03:** As a kitchen lead, I want to set dynamic preparation times (15m, 25m, 40m) so that delivery partners arrive right as the food is packed.
- **US-R04:** As a restaurant manager, I want to add, edit, categorize, and toggle item availability in real time so that customers never order out-of-stock items.
- **US-R05:** As a business owner, I want daily and weekly analytics on gross order value, net payouts, top-selling dishes, and customer feedback.
- **US-R06:** As a business owner, I want to configure promotional discounts and minimum order thresholds to boost slow-hour sales.

### 4.3 Admin User Stories
- **US-A01:** As an admin, I want a live operational dashboard showing real-time active orders, platform revenue, and server health.
- **US-A02:** As an admin, I want to review restaurant onboarding applications, verify FSSAI document uploads, and approve or reject licenses.
- **US-A03:** As an admin, I want to view all platform orders, inspect state transitions, override stuck orders, and trigger refunds with audit logs.
- **US-A04:** As an admin, I want to generate pre-loaded test restaurants with full menus in one click so that QA and demonstrations run smoothly.
- **US-A05:** As an admin, I want automated fraud detection flags for velocity anomalies (e.g. repeated failed payments or coupon abuse).

### 4.4 Rider User Stories (Phase 1b)
- **US-D01:** As a delivery rider, I want to receive nearby delivery job broadcasts and accept or reject them within a 30-second window.
- **US-D02:** As a delivery rider, I want GPS-guided turn-by-turn routing between the restaurant pickup and customer dropoff locations.
- **US-D03:** As a delivery rider, I want customer dropoff verification via a 4-digit OTP so that deliveries are indisputably verified.

---

## 5. Complete Feature List (F01 - F42)

| Feature ID | Feature Name | Description | Priority | Acceptance Criteria | Assigned Build Chunk |
|------------|--------------|-------------|----------|---------------------|----------------------|
| **F01** | Email OTP & OAuth Auth | Passwordless Supabase authentication with 6-digit email OTP and Google OAuth | P0 | Auth tokens issued, sessions persist across reboots, rate-limited to 3 attempts/min | Chunk 02, 03 |
| **F02** | Geolocation & Address Picker | Auto-detect coordinates via GPS and support manual address pinning with OpenStreetMap | P0 | Resolves reverse geocode in <500ms, saves default address, validates serviceability | Chunk 07 |
| **F03** | Typo-Tolerant Search & Filters | Search restaurants and dishes with Meilisearch, filtering by cuisine, rating, veg/non-veg | P0 | Returns results in <50ms, handles 2-character typos, provides faceted counts | Chunk 04, 07 |
| **F04** | Restaurant Detail Page | Rich restaurant profile displaying banner, FSSAI badge, operating hours, categorised menu | P0 | Renders menu hierarchy, veg badges, photo galleries, and promotional badges | Chunk 07 |
| **F05** | Cart Management | Client-side cart with server price validation, item quantities, and fee calculation | P0 | Prevents multi-restaurant carts with modal prompt, computes GST (5%) & fees | Chunk 04, 07 |
| **F06** | Item Customization Modal | Addon selector supporting radio variants (size), checkboxes (toppings), and notes | P0 | Calculates variant delta prices, enforces min/max addon constraints | Chunk 04, 07 |
| **F07** | Checkout Flow | Streamlined checkout screen linking address, coupon input, delivery tip, and payment | P0 | Persists form on error, validates delivery radius (<15km), shows clear summary | Chunk 04, 07 |
| **F08** | Razorpay Sandbox & COD | Payment gateway supporting test UPI VPAs, cards, netbanking, plus Cash on Delivery | P0 | Idempotency key generated per order, webhook verifies payment signature | Chunk 04 |
| **F09** | Real-Time Order Tracking | Live tracking state machine with step indicators and estimated arrival countdown | P0 | State updates within 1s via WebSocket, transitions through all 8 order states | Chunk 08 |
| **F10** | Saved Address Book | Storage for Home, Work, and Custom addresses with delivery notes (e.g. gate code) | P0 | CRUD operations on addresses, tagged with lat/lng coordinates | Chunk 07 |
| **F11** | Order History & 1-Tap Reorder | Tabular order log with invoice download and instant re-population of current cart | P0 | Re-adds active items to cart, flags unavailable items cleanly | Chunk 07 |
| **F12** | Push Notifications (FCM) | Firebase Cloud Messaging dispatch for order lifecycle milestones | P0 | Triggers on Order Placed, Confirmed, Out for Delivery, Delivered | Chunk 08 |
| **F13** | Reviews & Star Ratings | Post-delivery 1-to-5 star rating system with dish feedback and text review | P0 | Only verified purchasers can review, updates restaurant aggregate rating | Chunk 07 |
| **F14** | Coupon & Promo Engine | Validation engine for percentage, flat, and free-delivery discounts with min-spend rules | P0 | Validates expiry, max discount cap, usage limits per user | Chunk 04 |
| **F15** | Quick Bite Gold Membership | Subscription model unlocking zero delivery fees on orders above Rs 199 and dining perks | P0 | Flag in user profile, applies auto-discount during checkout price calculation | Chunk 04 |
| **F16** | Dining-Out Table Booking | Discovery of dine-in restaurants, reservation booking slot selector, and bill payment | P0 | Select date, time slot, guest count; sends instant booking confirmation | Chunk 04, 07 |
| **F17** | Global Veg Mode Toggle | Persistent header toggle filtering out all non-vegetarian items and restaurants | P0 | Global state filter, updates search and restaurant menus instantly | Chunk 07 |
| **F18** | Dark & Light Mode Theme | System-adaptive theme switcher with complete CSS variable token propagation | P0 | Zero flash of unstyled content, contrast ratio >= 4.5:1 on all text | Chunk 06 |
| **F19** | Multi-Language UI (EN/HI/KN) | Internationalization support for English, Hindi, and Kannada using react-i18next | P0 | Runtime language toggle without app restart, 100% key coverage for core flows | Chunk 06 |
| **F20** | User Profile Management | User account settings for name, phone, email, veg preference, dietary allergens | P0 | Updates Supabase user metadata, input validated via Zod | Chunk 07 |
| **F21** | Restaurant KYC Onboarding | Multi-step partner onboarding collecting FSSAI, GSTIN, PAN, bank details, and menu | P0 | Validates document formats, stores files in Cloudflare R2, status marked PENDING | Chunk 04, 07 |
| **F22** | Live Order Terminal | Web terminal with audio chimes, order accept/reject buttons, and prep timer controls | P0 | WebSockets connection with auto-reconnect, audible alert on incoming order | Chunk 07, 08 |
| **F23** | Menu & Catalog Manager | Category creation, dish creation, pricing, veg/non-veg tags, and instant stock toggle | P0 | Real-time stock toggle propagates to customer search in <2 seconds | Chunk 07 |
| **F24** | Partner Analytics Dashboard | Financial metrics, daily gross sales, order volume, cancellation rate, peak hours chart | P0 | Visualized using responsive SVG charts, exports CSV reports | Chunk 07 |
| **F25** | Commission & Payout Ledger | Transparent calculation of platform commission (15%), GST deductions, net payout | P0 | Weekly settlement ledger with downloadable payout receipts | Chunk 07 |
| **F26** | Restaurant Profile & Timings | Setting operating hours, slot timings, holiday closures, contact information | P0 | Disables order placement automatically outside open hours | Chunk 07 |
| **F27** | Partner Review Management | Interface for restaurateurs to view customer feedback and post official replies | P0 | Displays verified badge, notifies customer on partner response | Chunk 07 |
| **F28** | Restaurant-Funded Promos | Self-serve coupon builder for restaurants to create discount campaigns | P0 | Restaurant absorbs discount cost, bounded by minimum order value | Chunk 04, 07 |
| **F29** | Admin Operations Dashboard | Bird's-eye metrics: platform GMV, active orders, live riders, server health | P0 | Real-time polling + WebSockets, system health indicators | Chunk 07 |
| **F30** | Partner Approval Pipeline | Admin interface to inspect restaurant applications, verify FSSAI numbers, approve | P0 | Status change triggers email notification to restaurant owner via Resend | Chunk 07 |
| **F31** | Order Dispute Resolution | Search all platform orders, inspect timeline logs, trigger partial/full refunds | P0 | Idempotent refund execution with mandatory admin reason logging | Chunk 07 |
| **F32** | User & Role Administration | Manage user permissions, ban fraudulent accounts, reset sessions | P0 | Super-admin RBAC protection, session termination via Redis blocklist | Chunk 07 |
| **F33** | Platform Promo Campaigns | Create global coupon codes (e.g. WELCOME50) funded by platform | P0 | Enforces global budget limits and user redemption limits | Chunk 07 |
| **F34** | Demo Test Restaurant Generator | One-click tool to spin up realistic test restaurants with full menus and imagery | P0 | Generates 15 menu items, high-res sample photos, operational hours in <3s | Chunk 07 |
| **F35** | Content Moderation Queue | Queue for reviewing uploaded restaurant banners and flagged customer reviews | P0 | Soft-delete / approve flags with audit log | Chunk 07 |
| **F36** | Fraud & Velocity Monitoring | Rule-based engine detecting high-frequency cancellations and suspicious refund claims | P0 | Flags accounts exceeding 3 cancellations/week or rapid IP switching | Chunk 07 |
| **F37** | Rider Onboarding (KYC) | Driver registration collecting driving license, vehicle RC, bank account, and selfie | P1b | Admin verification pipeline, status management | Future Chunk |
| **F38** | Delivery Dispatch & Accept | Broadcast order assignment to closest active rider within 3km radius | P1b | 30-second accept/reject countdown timer before fallback to next rider | Future Chunk |
| **F39** | In-App GPS Navigation | Turn-by-turn map routing from current position to restaurant and customer drop | P1b | OSRM routing engine integration with polyline display | Future Chunk |
| **F40** | OTP Delivery Verification | 4-digit customer-held OTP required to complete order dropoff | P1b | Prevents false delivery claims, matches order record in database | Future Chunk |
| **F41** | Rider Earnings Ledger | Daily earnings tracking, incentive bonuses, distance pay calculation, cash collection | P1b | Tracks COD cash collected in hand versus pending payouts | Future Chunk |
| **F42** | Live Rider GPS Streaming | Background geolocation streaming from rider device to customer live tracking map | P1b | Throttled GPS coordinates emitted over WebSocket every 5 seconds | Future Chunk |

---

## 6. Non-Functional Requirements (NFRs)

### 6.1 Performance
- **API Response Times:** 95th percentile (P95) latency < 200ms for read endpoints; P95 < 350ms for write endpoints.
- **Search Response:** Meilisearch query latency < 50ms for typo-tolerant restaurant and dish queries.
- **Client App Load Time:** Time to Interactive (TTI) < 2.5 seconds on a standard 4G mobile network.
- **Database Query Execution:** Indexed queries must execute in < 25ms. Spatial PostGIS queries must complete in < 60ms.

### 6.2 Security
- **Authentication & Authorization:** Supabase Auth JWT with RS256 signature verification. Role-based access control (RBAC) enforced on all private backend routes.
- **Data Protection:** Zero plain-text secrets in code repositories. Sensitive banking and KYC documents encrypted at rest using AES-256.
- **SQL Injection Prevention:** 100% parameterized SQL queries via Prisma ORM / pg client. No raw string concatenation.
- **Input Sanitization:** All payload schemas validated at the API boundary using Zod before reaching controllers.
- **Rate Limiting:** Token-bucket rate limiting enforced via Upstash Redis (100 req/min for standard endpoints, 5 req/min for auth/checkout).

### 6.3 Accessibility
- Strict adherence to WCAG 2.1 Level AA standards.
- High-contrast visual modes for text readability under harsh sunlight.
- Comprehensive screen-reader labels (`aria-label` and React Native `accessibilityLabel`) on all buttons, inputs, and state badges.
- Minimum interactive touch target dimensions of 44x44 points.

### 6.4 Reliability & Fault Tolerance
- **Graceful Degradation:** When external services (e.g. payment gateway or search) encounter downtime, fall back to cached data and offline indicators.
- **Form Data Resilience:** All form fields automatically backed up to local device storage on every keystroke, preventing data loss during network failure or accidental tab closure.
- **WebSocket Reconnection:** Automatic exponential backoff reconnection strategy (1s, 2s, 4s, 8s, up to 30s max) with heartbeat ping-pong intervals every 25 seconds.

---

## 7. Success Metrics & Key Performance Indicators (KPIs)

1. **System Health:** 99.9% uptime for core API and database layers.
2. **Order Conversion:** > 88% cart-to-order completion rate for authenticated users.
3. **Dispatch Velocity:** Average time from order placement to restaurant acceptance < 90 seconds.
4. **Search Accuracy:** > 95% of search queries yield relevant restaurant or dish results without zero-result dead ends.
5. **App Stability:** Crash-free session rate exceeding 99.8% on both iOS and Android.

---

## 8. Constraints & Operating Boundaries

- **Cloud Budget:** Zero operational cost (Free Tier Only) for the initial MVP stage. Must strictly operate within:
  - Supabase: 50,000 MAU, 500MB PostgreSQL storage.
  - Upstash Redis: 10,000 commands per day.
  - MongoDB Atlas: 512MB shared storage.
  - Render: Single free web service instance (with cold-start mitigation).
  - Vercel: Free Hobby tier for frontend hosting.
  - Cloudflare R2: 10GB object storage with zero egress fees.
- **Geographic Boundary:** Serviceability initially localized to selected city zones (e.g., Koramangala / Indiranagar, Bengaluru) with a 15km delivery ceiling.

---

## 9. Out of Scope for Phase 1 MVP

1. **Quick Bite Mart (Instant Grocery):** Dark store management and 10-minute grocery delivery (Frozen for Phase 3).
2. **Quick Bite Supply (B2B Procurement):** Wholesale raw ingredient procurement for restaurant kitchens (Frozen for Phase 3).
3. **Quick Bite Events (Live Ticketing):** Concert and dining event ticketing platform (Frozen for Phase 3).
4. **Automated Drone Dispatch:** Drone delivery integrations.
5. **Multi-Currency Processing:** International cards and non-INR currencies.

---

## 10. Future Roadmap

- **Phase 1b (Weeks 17-20):** Rider Partner Native Mobile App, automated nearest-rider dispatch algorithm, real-time GPS coordinate streaming, and OTP drop confirmation.
- **Phase 2 (Post-Funding):** Live payment gateway migration, WhatsApp conversational ordering, automated voice order confirmation for busy kitchens, and AI-driven personalized dietary recommendations.
- **Phase 3 (Enterprise Scale):** Launch of Quick Bite Mart (dark-store micro-fulfillment) and Quick Bite Supply (B2B food service supplies).
