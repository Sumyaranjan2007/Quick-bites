# Quick Bite Platform -- Product Requirements Document (PRD)

**Version:** 2.0.0  
**Date:** September 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Device Native Food Delivery Ecosystem)  
**Industry Benchmark:** Zomato & Blinkit (Eternal Ltd)  
**Architecture:** 4 Distinct Native Mobile Applications + Shared Cloud Backend  

---

## 1. Executive Summary

Quick Bite is an enterprise-grade food delivery and dining discovery ecosystem built for the Indian market, engineered to deliver high performance, transparency, and consumer delight. Operating across **four distinct native mobile applications** installed on **four separate physical smartphones/tablets**—Customer Mobile App, Restaurant Partner Mobile App, Delivery Partner Mobile App, and Admin & Operations Mobile App—Quick Bite matches diners with top local restaurants, rapid logistics fulfillment, and comprehensive administrative oversight. The entire ecosystem is architected to operate on 100% free-tier cloud infrastructure during initial rollout (Node.js API, PostgreSQL on Supabase, Cloudflare R2, and Cloudflare Secure Production Tunnels).

---

## 2. Problem Statement

The Indian food delivery ecosystem faces three critical friction points:
1. **Aggregator Commission Inflation:** Incumbents charge restaurant partners between 22% and 33% per order, pushing small and mid-sized eateries into negative unit economics and forcing artificial menu inflation for consumers.
2. **Hidden Consumer Surcharges:** Opaque pricing structures involving high packaging fees, surging platform fees, and unpredictable delivery costs erode customer trust.
3. **Operational Opacity & Logistics Friction:** Independent cloud kitchens and family-owned restaurants lack accessible, real-time tooling for automated inventory management, menu synchronization, transparent payout settlements, and fraud protection without paying prohibitive platform fees. Delivery partners suffer from inefficient routing and battery-draining apps.

Quick Bite solves this by delivering an ultra-responsive, lightweight platform with transparent item-level bill breakdowns, automated restaurant payout settlements, instant KYC onboarding, 4-stage real-time order handshakes, and localized multi-lingual access (English, Hindi, and Kannada).

---

## 3. Target Personas & The 4 Applications

### Application 1: Customer Mobile App (`apps/customer-mobile`)
- **Persona:** Rahul Sharma (Urban Consumer, Software Engineer, Age 24, Bengaluru)
- **Device Target:** Device 1 (Physical Smartphone)
- **Goals:** Sub-30 second ordering, bubbly interactive discovery feed, nested dish customization (portions, toppings, spice levels), live OpenStreetMap rider tracking, customer wallet with split payments.
- **Frustrations:** Aggressive surge fees, cold food due to delayed rider assignment, unresponsive customer support when items are missing.
- **Visual Design:** High dopamine bubbly cards (`border-radius: 20px`), `#FF4F18` Saffron / Crimson palette, Plus Jakarta Sans, Lucide icons.

### Application 2: Restaurant Partner Mobile App (`apps/restaurant-mobile`)
- **Persona:** Sunita Deshmukh (Restaurant Owner & Kitchen Manager, Age 46, Pune)
- **Device Target:** Device 2 (Kitchen Smartphone or Tablet)
- **Goals:** Fast partner KYC onboarding (FSSAI license, GSTIN, bank details), real-time order alert with loud looping kitchen chime, 120-second accept/reject countdown, KOT (Kitchen Order Ticket) display, 1-tap stock availability toggle.
- **Frustrations:** Complex enterprise dashboards, delayed payment reconciliation, unfair customer cancellation charges.

### Application 3: Delivery Partner Mobile App (`apps/delivery-mobile`)
- **Persona:** Vikram Singh (Gig Delivery Fleet Partner, Age 28, Hyderabad)
- **Device Target:** Device 3 (Rider Smartphone)
- **Goals:** Quick onboarding with Driving License & vehicle RC upload, shift check-in (Online/Offline), 15-second order broadcast card, turn-by-turn navigation via OpenStreetMap/OSRM, 3-second GPS telemetry streamer, restaurant pickup verification, and 4-digit doorstep delivery OTP handshake.
- **Frustrations:** Unfair penalties for restaurant delays, battery drain, navigation errors in dense residential complexes.

### Application 4: Admin & Operations Mobile App (`apps/admin-mobile`)
- **Persona:** Ananya Iyer (Super Admin & Operations Lead, Age 32, Bengaluru)
- **Device Target:** Device 4 (Operations Smartphone or Tablet)
- **Goals:** Real-time platform pulse (GMV, active orders, online fleet, server health), KYC document verification queue for approving restaurants and riders, instant dispute resolution with 1-tap wallet refunds, emergency partner suspension controls.
- **Frustrations:** Fragmented monitoring tools, manual database queries to resolve failed transactions, lack of audit trails for refund authorizations.

---

## 4. Comprehensive Feature Matrix (F01 - F44)

All 44 core features are in active development across the 4 native mobile applications and backend:

| Feature ID | Feature Name | Description | Target Application | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **F01** | Real Authentication & RBAC | Email/Password, Supabase Auth, Google/Apple OAuth with role enforcement | All 4 Apps | Rejects cross-portal logins with 403 Forbidden |
| **F02** | Geolocation & Geofencing | OpenStreetMap Nominatim geocoding; 10 km maximum delivery radius | Customer App | Blocks order placement beyond 10 km from restaurant |
| **F03** | Bubbly Discovery Feed | High dopamine category carousels, cuisine filters, veg mode switch | Customer App | Infinite scroll, instant filter update in <50ms |
| **F04** | Restaurant Detail Page | Cover photo, FSSAI badge, prep time, categorized menu hierarchy | Customer App | Smooth collapse headers, category anchors |
| **F05** | Nested Dish Customization | Portion variants (Regular/Large), add-on groups, spice level, notes | Customer App | Calculates live variant delta prices accurately |
| **F06** | Cart & Bill Breakdown | Item total, 5% Food GST, packaging fee, delivery fee, platform fee | Customer App | Prevents multi-restaurant items with clear modal |
| **F07** | Coupon & Promo Engine | Percentage/flat discounts with min-spend rules (e.g. WELCOME50) | Customer App | Server-validated, prevents multi-use abuse |
| **F08** | Multi-Tier Payment & Split Wallet | QuickBite Wallet (split payments) + COD + Razorpay Sandbox UPI | Customer App | Atomic balance deduction, webhook callback verification |
| **F09** | Live OpenStreetMap Tracking | Real-time map rendering with route polyline and rider marker | Customer App | Updates rider location every 3s via WebSockets |
| **F10** | Doorstep 4-Digit Delivery OTP | Secret OTP generated for customer and validated at rider delivery | Customer & Rider | Order cannot mark DELIVERED without valid OTP |
| **F11** | Customer Saved Addresses | Home, Work, and Custom tags with floor/landmark notes | Customer App | CRUD operations saved with PostGIS coordinates |
| **F12** | 1-Tap Reorder & History | Searchable order history with instant cart re-population | Customer App | Re-adds active items, flags out-of-stock items |
| **F13** | Customer Wallet & Refunds | In-app balance for promotional credits and instant dispute refunds | Customer App | Split payment support with COD/UPI |
| **F14** | Verified Reviews & Ratings | Post-delivery 1-to-5 star ratings with dish tags | Customer App | Restricted to verified delivered orders |
| **F15** | Global Veg Mode Toggle | Persistent header toggle filtering out non-vegetarian dishes | Customer App | Filters entire catalog to `is_veg = true` |
| **F16** | Restaurant KYC Registration | Multi-step onboarding with FSSAI, GSTIN, PAN, and bank upload | Restaurant App | Uploads to Cloudflare R2; status: `PENDING_APPROVAL` |
| **F17** | KYC Under Review Screen | Status screen blocking operations until Admin grants approval | Restaurant & Rider | Real-time polling/socket for instant activation |
| **F18** | Kitchen Live Order Terminal | Incoming order screen with loud looping audio chime | Restaurant App | Audio sounds until accepted or 120s timer expires |
| **F19** | 120s Order Acceptance Timer | Visual countdown timer to accept or reject incoming orders | Restaurant App | Auto-rejects or escalates if timer reaches 0 |
| **F20** | Kitchen Order Ticket (KOT) | Clean kitchen view with item quantities, portion variants, notes | Restaurant App | High-contrast typography for kitchen readability |
| **F21** | Dynamic Prep Time Selector | Declare prep duration (15m, 25m, 40m) updating customer ETA | Restaurant App | Adjusts delivery dispatch timing |
| **F22** | Menu & Stock Availability Toggle | 1-tap toggle to mark dishes In Stock or Out of Stock | Restaurant App | Propagates to customer search in <2 seconds |
| **F23** | Restaurant Operating Hours | Set open/closed hours, holiday schedules, emergency pause | Restaurant App | Auto-disables ordering when store is closed |
| **F24** | Restaurant Pickup Handshake | Validates rider's 4-digit pickup code before handing food | Restaurant App | Prevents accidental order handoff |
| **F25** | Restaurant Earnings & Ledger | Gross revenue, 15% platform commission deduction, net payout | Restaurant App | Weekly settlement reports and breakdown |
| **F26** | Rider KYC Onboarding | Registration collecting Driving License, vehicle type, and bank | Delivery App | Uploads to Cloudflare R2; status: `PENDING_APPROVAL` |
| **F27** | Rider Shift & Online Toggle | Online/Offline switch enabling or pausing broadcast reception | Delivery App | Real-time presence recorded in Redis/DB |
| **F28** | 15s Order Broadcast Modal | Urgent popup showing pickup restaurant, drop distance, pay | Delivery App | First-come atomic lock assigns order |
| **F29** | In-App Turn-by-Turn Navigation | OSRM routing from current location to restaurant and customer | Delivery App | Route polyline with distance and remaining minutes |
| **F30** | 3s GPS Telemetry Streamer | Background geolocation service streaming coordinates to server | Delivery App | Emits coordinates every 3s during active transit |
| **F31** | Pickup Verification Flow | Marks "Reached Restaurant" and submits pickup code | Delivery App | Transitions order status to `OUT_FOR_DELIVERY` |
| **F32** | Doorstep OTP Validation | Number keypad to input customer's 4-digit OTP | Delivery App | Authoritative server validation unlocks completion |
| **F33** | COD Cash Collection Ledger | Tracks physical cash collected in hand versus pending earnings | Delivery App | Prevents fraud with cash deposit limits |
| **F34** | Rider Earnings Dashboard | Today's earnings, distance pay, incentives, and tips | Delivery App | Instant daily balance updates |
| **F35** | Admin Operations Dashboard | Real-time platform pulse: active orders, GMV, online riders | Admin App | WebSockets live metrics feed |
| **F36** | Restaurant KYC Approval Queue | Review FSSAI/GST documents with image preview and 1-tap approval | Admin App | Updates status to `ACTIVE` and notifies partner |
| **F37** | Rider KYC Approval Queue | Review Driving License and vehicle RC with 1-tap approval | Admin App | Activates rider account for shift check-in |
| **F38** | Live Order Monitor & Overrides | View all active platform orders with status timeline | Admin App | Allows manual re-dispatch or forced cancellation |
| **F39** | Instant Dispute Refund Tool | 1-tap partial or full refund credit to customer wallet | Admin App | Generates immutable financial audit log |
| **F40** | Emergency Suspension Toggle | Instant 1-tap suspension of rogue restaurants or riders | Admin App | Immediately revokes active WebSocket sessions |
| **F41** | Pre-Seeded Indian Catalog | 8 authentic Indian restaurants with 100+ dishes pre-loaded | Backend / All | Instant rich data on launch without manual entry |
| **F42** | Production Cloudflare Tunnel | Public HTTPS & WSS gateway exposing local backend to internet | Infrastructure | Zero-cost global device connectivity |
| **F43** | Cloudflare R2 Storage Bucket | S3-compatible cloud object store for images and KYC files | Infrastructure | 10 GB free tier with zero egress costs |
| **F44** | Multi-Language Support (EN/HI/KN)| Internationalization support for English, Hindi, and Kannada | All 4 Apps | Seamless runtime toggle |

---

## 5. Non-Functional Requirements (NFRs)

1. **Performance:** API P95 latency < 150ms. GPS coordinates broadcast within 500ms of emission.
2. **Security:** JWT authentication with SHA-256 / RS-256 signatures. Strict RBAC. Zero plain-text passwords (bcrypt hash rounds = 10).
3. **Reliability:** Idempotent order placement and refund transactions. Automatic WebSocket reconnection with exponential backoff.
4. **Offline Resilience:** Rider app buffers GPS coordinates if mobile network momentarily drops and flushes upon reconnection.
5. **Aesthetics:** 100% adherence to Stitch UI design system, Plus Jakarta Sans typography, bubbly interactive cards, and zero emojis.
