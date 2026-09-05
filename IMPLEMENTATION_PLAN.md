# Quick Bite Platform -- Implementation Plan & Technical Specification

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Architecture & Engineering Team  

---

## 1. Project Identity

| Attribute | Specification Details |
|-----------|-----------------------|
| **Project Name** | Quick Bite |
| **System Architecture** | Modular Monolith Backend with Multi-Client Frontends |
| **Core Clients** | Customer Mobile App (Expo), Partner Web Portal (Vite), Admin Dashboard (Vite) |
| **Primary Backend** | Node.js (v20 LTS), Express, TypeScript |
| **Primary Relational DB** | PostgreSQL 15 with PostGIS (Supabase Free Tier) |
| **Catalog Document DB** | MongoDB Atlas (M0 Shared Cluster) |
| **Cache & Real-time State**| Upstash Redis (Serverless Free Tier) |
| **Search Engine** | Meilisearch Cloud |
| **Target Launch Budget** | Rs 0 / Month (100% Cloud Free Tiers) |

---

## 2. Third-Party Services & Free Tier Limits

| Service Name | Primary Capability | Authentication Mechanism | Free Tier Threshold | Fallback Strategy |
|--------------|--------------------|--------------------------|---------------------|-------------------|
| **Supabase** | User Auth & SQL DB | Secret Service Key & JWT | 50,000 MAU, 500MB DB | Local Docker Postgres |
| **Upstash Redis** | Cache & Rate Limiting | REST Token / Redis URL | 10,000 commands/day | In-memory LRU Map |
| **MongoDB Atlas** | Nested Food Catalogs | Connection String URI | 512MB storage | Local Mongo daemon |
| **Meilisearch** | Fast Food & Restaurant Search | Master API Key | 100,000 documents | PostgreSQL ILIKE query |
| **Cloudflare R2** | Image & Document Bucket | S3 Access Key & Secret | 10GB storage, 0 egress | Local file uploads |
| **Razorpay** | Payment Gateway | Key ID & Key Secret | Unlimited Sandbox Mode | Simulated Mock Handler |
| **Resend** | Transactional Emails | Bearer API Key | 3,000 emails/month | Console Log in Dev |
| **Firebase (FCM)**| Mobile Push Alerts | Google Service Account JSON| Unlimited push messages | In-app notification bell |
| **Render** | Node.js Server Hosting | Git Webhook / API Token | 750 free instance hours | Local Node runtime |
| **Vercel** | Web Dashboard Hosting | CLI / GitHub Integration | 100GB bandwidth | Local Vite preview |

---

## 3. Core Features Engineering Blueprint (F01 - F42)

### F01: Email OTP & OAuth Authentication
- **What:** Passwordless login and registration via email verification codes and Google OAuth.
- **How:** Integrated with Supabase GoTrue; sends 6-digit cryptographic tokens via Resend; verifies and issues access/refresh tokens.
- **Key Detail:** Tokens expire in 5 minutes; rate-limited to 3 attempts per minute per IP.
- **Why It Matters:** Eliminates password fatigue and friction, significantly reducing cart abandonment.

### F02: Geolocation & Address Picker
- **What:** Auto-detect coordinates via GPS and support interactive pin adjustments with OpenStreetMap Nominatim.
- **How:** Uses Expo Location API on mobile; queries Nominatim reverse-geocoding API; converts lat/lng to street address.
- **Key Detail:** Stores spatial point coordinates in PostGIS `geometry(Point, 4326)`.
- **Why It Matters:** Accurate geocoding ensures delivery riders navigate to the correct building entrance.

### F03: Typo-Tolerant Search & Cuisines Filtering
- **What:** Instant search across restaurants and dishes with cuisine, rating, and veg/non-veg facets.
- **How:** Syncs restaurant and menu documents to Meilisearch Cloud; client queries Meilisearch directly with 300ms debounce.
- **Key Detail:** Sub-50ms query response; handles 2-character spelling errors seamlessly.
- **Why It Matters:** Fast, error-forgiving search dramatically boosts order discovery and conversion.

### F04: Restaurant Detail Page & Catalog Browsing
- **What:** Rich restaurant page featuring food banners, FSSAI badges, categories, and dish cards.
- **How:** Fetches restaurant profile from PostgreSQL and full categorized menu hierarchy from MongoDB.
- **Key Detail:** Renders veg/non-veg indicators, calorie counts, preparation time, and minimum order values.
- **Why It Matters:** Provides a compelling, informative ordering interface that builds diner trust.

### F05: Cart Management & Price Breakdown
- **What:** Client-side cart state with server-side pricing validation, quantity steppers, and tax computation.
- **How:** Managed via Zustand on mobile/web; syncs to backend to recalculate subtotal, 5% GST, packaging, and delivery fee.
- **Key Detail:** Single-restaurant cart policy enforced with replacement confirmation dialog.
- **Why It Matters:** Prevents cart calculation tampering while providing clear bill transparency.

### F06: Item Customization Modal
- **What:** Modal dialog for selecting portion sizes, toppings, spice levels, and cooking notes.
- **How:** Dynamically parses addon option groups stored in MongoDB; calculates delta pricing in real time.
- **Key Detail:** Enforces min/max selection validation (e.g. "Select at least 1, max 3 toppings").
- **Why It Matters:** Allows diners to personalize meals to their exact preferences and dietary needs.

### F07: Checkout Flow & Order Submission
- **What:** Final order placement screen selecting address, coupon, delivery tip, and payment method.
- **How:** Generates client-side UUID idempotency key; validates delivery radius (<15km); submits order to backend.
- **Key Detail:** Form data persisted to local storage; restored automatically if network interrupts.
- **Why It Matters:** Smooth, resilient checkout flow ensures orders are never lost during mobile network drops.

### F08: Razorpay Sandbox & Cash on Delivery Payments
- **What:** Payment processing supporting simulated UPI VPAs, cards, netbanking, and COD.
- **How:** Backend creates Razorpay order; frontend opens checkout sheet; webhook validates HMAC SHA256 signature.
- **Key Detail:** Idempotent order processing ensures double-clicks never create duplicate payment charges.
- **Why It Matters:** Allows thorough end-to-end testing of payment flows without requiring real funds.

### F09: Real-Time Order Tracking & State Machine
- **What:** Step-by-step progress tracking across 8 lifecycle stages with ETA countdown.
- **How:** Connects to Socket.io room `order:<id>`; updates progress bar instantly on state events.
- **Key Detail:** State transitions: PLACED -> ACCEPTED -> PREPARING -> READY -> DISPATCHED -> DELIVERED.
- **Why It Matters:** Real-time visibility alleviates customer anxiety while waiting for food.

### F10: Saved Address Book
- **What:** Storage for Home, Work, and Custom addresses with delivery notes.
- **How:** CRUD endpoints backed by PostgreSQL `addresses` table; tagged with coordinates.
- **Key Detail:** Default address automatically loaded into cart during checkout.
- **Why It Matters:** Streamlines repeat ordering to under 15 seconds.

### F11: Order History & 1-Tap Reorder
- **What:** Archive of past orders with invoice downloads and instant cart re-population.
- **How:** Re-validates active dish availability; populates current cart with in-stock items.
- **Key Detail:** Highlights any discontinued items with a clear alert before proceeding.
- **Why It Matters:** High convenience feature that drives repeat customer retention.

### F12: Push Notifications for Order Updates (FCM)
- **What:** Background push notifications triggered on order confirmation, dispatch, and delivery.
- **How:** Server sends FCM payload using Firebase Admin SDK when order status updates in database.
- **Key Detail:** Tokens registered on app launch; updated automatically on user login.
- **Why It Matters:** Keeps users informed even when the mobile app is in the background or device is locked.

### F13: Restaurant Reviews & Star Ratings
- **What:** 1-5 star rating system with dish feedback and text review submission.
- **How:** Validates that reviewer completed an order with the restaurant; updates aggregate score in Postgres.
- **Key Detail:** Stored in MongoDB `reviews` collection; linked to restaurant ID and order ID.
- **Why It Matters:** Builds social proof and helps maintain food quality standards across the platform.

### F14: Coupon & Promo Engine
- **What:** Validation engine for percentage, flat, and free-delivery discounts with min-spend rules.
- **How:** Evaluates active promo rules in Redis/Postgres; checks user redemption limits and expiry.
- **Key Detail:** Atomic redemption counter prevents race conditions during flash promotions.
- **Why It Matters:** Drives customer acquisition and incentivizes higher order basket values.

### F15: Quick Bite Gold Subscription
- **What:** Membership model unlocking free delivery on orders above Rs 199 and dining discounts.
- **How:** User profile flag `is_gold: true`; pricing engine automatically zeroes delivery fee.
- **Key Detail:** Expiry timestamp checked dynamically on every checkout calculation.
- **Why It Matters:** Increases user retention, lifetime value, and order frequency.

### F16: Dining-Out Table Booking
- **What:** Discovery of dine-in venues, slot booking for table reservations, and discount bill payment.
- **How:** Reservation slots stored in PostgreSQL; Redis mutex locks slot during checkout.
- **Key Detail:** Sends instant booking voucher to customer phone and partner terminal.
- **Why It Matters:** Diversifies revenue streams beyond food delivery into dine-in hospitality.

### F17: Global Veg Mode Toggle
- **What:** Persistent header switch that filters out all non-vegetarian dishes and restaurants.
- **How:** Global React context state; filters search queries and catalog renders by `is_veg: true`.
- **Key Detail:** Visual green leaf indicator appears across app when active.
- **Why It Matters:** Critical feature for Indian consumers with strict vegetarian dietary requirements.

### F18: Dark & Light Mode Theme Engine
- **What:** System-adaptive theme switcher with complete CSS custom property token propagation.
- **How:** Implemented via React Theme Context; swaps root CSS variables dynamically.
- **Key Detail:** Zero unstyled content flicker; contrast ratio >= 4.5:1 on all text elements.
- **Why It Matters:** Improves visual ergonomics and preserves mobile battery life on OLED screens.

### F19: Multi-Language UI (English, Hindi, Kannada)
- **What:** Complete localization supporting English, Hindi (हिंदी), and Kannada (ಕನ್ನಡ).
- **How:** Powered by `react-i18next`; translations stored in JSON dictionaries; switched at runtime.
- **Key Detail:** 100% key coverage for buttons, navigation, errors, and checkout labels.
- **Why It Matters:** Ensures accessibility and adoption across diverse Indian regional demographics.

### F20: User Profile Management
- **What:** Account settings for editing name, phone, email, veg preference, and profile photo.
- **How:** Updates Supabase user metadata; profile photos stored in Cloudflare R2.
- **Key Detail:** Phone number validated against Indian standard (+91 10-digit).
- **Why It Matters:** Allows users to manage identity and dietary preferences easily.

### F21: Restaurant KYC Onboarding
- **What:** Multi-step partner onboarding collecting FSSAI license, GSTIN, PAN, bank account, and photos.
- **How:** Form data persisted to local storage; files uploaded to Cloudflare R2; status set to PENDING.
- **Key Detail:** Validates 14-digit FSSAI format and 15-character GSTIN structure.
- **Why It Matters:** Ensures strict compliance with Indian food safety and tax regulations.

### F22: Live Order Terminal for Kitchens
- **What:** Audio-visual web terminal for kitchen operators to accept/reject orders and set prep times.
- **How:** WebSockets connection to `restaurant:<id>`; triggers audible chime on incoming orders.
- **Key Detail:** 1-click accept buttons with 15m, 25m, 40m prep time selection.
- **Why It Matters:** Streamlines kitchen operations and prevents missed or delayed orders.

### F23: Menu Catalog & Instant Availability Manager
- **What:** Category and dish management with pricing, photos, and instant In-Stock/Out-of-Stock toggles.
- **How:** Updates MongoDB menu collection; immediately flushes Redis cache and updates search index.
- **Key Detail:** Stock changes reflect in customer app within 2 seconds.
- **Why It Matters:** Prevents customers from ordering items that are currently sold out in the kitchen.

### F24: Restaurant Analytics Dashboard
- **What:** Financial and operational metrics: gross sales, order volume, cancellation rates, peak hours.
- **How:** Aggregates PostgreSQL order records; visualized using responsive SVG charts.
- **Key Detail:** Exports CSV settlement reports for accounting reconciliation.
- **Why It Matters:** Empowers restaurant partners with actionable business intelligence.

### F25: Commission Ledger & Payout Summary
- **What:** Itemized ledger showing gross sales, 15% platform commission, GST deductions, and net payout.
- **How:** Tracks weekly settlement periods; generates downloadable payout summaries with UTR numbers.
- **Key Detail:** Immutable ledger records guarantee financial transparency.
- **Why It Matters:** Fosters trust between the platform and restaurant partners.

### F26: Restaurant Profile & Operating Hours
- **What:** Settings for configuring restaurant address, contact information, and weekly opening hours.
- **How:** Stored in PostgreSQL `restaurants` table; automated logic flags restaurant as CLOSED outside slots.
- **Key Detail:** Automatically disables ordering when kitchen is closed.
- **Why It Matters:** Prevents accidental order placement when restaurants are not operating.

### F27: Partner Review Management
- **What:** Feedback console allowing restaurant managers to read customer reviews and post official replies.
- **How:** Fetches MongoDB reviews; allows single official partner reply; notifies diner.
- **Key Detail:** Displays verified partner badge under official responses.
- **Why It Matters:** Enables restaurateurs to maintain customer satisfaction and resolve complaints.

### F28: Restaurant-Funded Promos
- **What:** Self-serve discount campaign builder for restaurants to create store-level coupons.
- **How:** Restaurant sets discount percentage and minimum order value; cost absorbed by restaurant.
- **Key Detail:** Validated at checkout and deducted from restaurant payout ledger.
- **Why It Matters:** Gives restaurants marketing autonomy to boost order volume during slow hours.

### F29: Admin Operations Control Tower
- **What:** Real-time dashboard showing platform GMV, active orders, live riders, and server health.
- **How:** Aggregates live platform state via WebSockets and periodic polling; alerts on anomalies.
- **Key Detail:** Real-time health gauges for database latency and error rates.
- **Why It Matters:** Gives platform operators total visibility over ecosystem performance.

### F30: Restaurant Approval Pipeline
- **What:** Admin interface to review onboarding applications, inspect FSSAI licenses, and approve partners.
- **How:** Document viewer for KYC scans; 1-click Approve or Reject; sends automated email via Resend.
- **Key Detail:** Status update automatically activates restaurant in public search.
- **Why It Matters:** Safeguards platform quality and enforces regulatory compliance.

### F31: Global Order Dispute Resolution
- **What:** Console to inspect order event logs, chat histories, and issue partial or full refunds.
- **How:** Searches all platform orders; executes idempotent Razorpay refund API calls.
- **Key Detail:** Mandatory admin reason logging for every processed refund.
- **Why It Matters:** Ensures fair, auditable resolution of customer delivery disputes.

### F32: User & Role Administration
- **What:** Management console for user accounts, role assignments, suspensions, and session revocation.
- **How:** Admins can search users, ban malicious accounts, and terminate JWTs via Redis blocklist.
- **Key Detail:** Prevents self-demotion or banning of the super-admin account.
- **Why It Matters:** Protects the platform from fraudulent actors and unauthorized access.

### F33: Platform-Wide Promo Campaigns
- **What:** Marketing tool to create global coupons (e.g. WELCOME50) with total spend budget caps.
- **How:** Tracks cumulative redemptions in Redis; automatically deactivates when budget cap is hit.
- **Key Detail:** Atomic decrement prevents coupon budget overruns.
- **Why It Matters:** Enables targeted growth campaigns without financial risk.

### F34: Demo Test Restaurant Generator
- **What:** 1-click tool to spin up realistic test restaurants with full menus and imagery.
- **How:** Generates 15 categorized dishes, high-res photos, and operating hours in < 3 seconds.
- **Key Detail:** Automatically indexes generated restaurant in Meilisearch.
- **Why It Matters:** Enables instant testing and demonstrations without waiting for real partner onboarding.

### F35: UGC & Content Moderation Queue
- **What:** Review queue for flagged dish photos, customer reviews, and restaurant banners.
- **How:** Automated profanity filter routes flagged content to admin queue; 1-click approve or delete.
- **Key Detail:** Deletes violating images permanently from Cloudflare R2.
- **Why It Matters:** Keeps the platform safe, respectful, and family-friendly.

### F36: Fraud Velocity & Anomaly Radar
- **What:** Monitoring console detecting high cancellation frequency, failed payments, and coupon abuse.
- **How:** Rule-based velocity checks in Redis; flags accounts exceeding thresholds with HIGH RISK badge.
- **Key Detail:** Automatically applies checkout freeze to suspicious accounts.
- **Why It Matters:** Protects merchant accounts and restaurant partners from fraudulent chargebacks.

### F37: Rider Partner KYC Onboarding (Phase 1b)
- **What:** Driver registration collecting driving license, vehicle RC, bank account, and selfie.
- **How:** Document uploads to Cloudflare R2; status set to PENDING_APPROVAL for admin review.
- **Key Detail:** Verifies license validity and vehicle roadworthiness.
- **Why It Matters:** Ensures delivery partners are legally qualified to operate.

### F38: Order Dispatch Broadcast & Accept (Phase 1b)
- **What:** Proximity-based dispatch broadcasting ready orders to closest active rider within 3km.
- **How:** Socket.io broadcast to `rider:<id>`; 30-second countdown timer to accept or auto-pass.
- **Key Detail:** Displays estimated earnings and pickup/drop distances on broadcast card.
- **Why It Matters:** Optimizes dispatch speed and minimizes rider idle time.

### F39: Turn-by-Turn GPS Navigation (Phase 1b)
- **What:** Map routing using OpenStreetMap and OSRM guiding rider between pickup and dropoff.
- **How:** Renders route polylines; provides 1-tap deep links to Google Maps / Apple Maps.
- **Key Detail:** Automatically recalculates route if rider takes a wrong turn.
- **Why It Matters:** Helps riders navigate unfamiliar neighborhoods efficiently.

### F40: Secure OTP Delivery Verification (Phase 1b)
- **What:** Dropoff confirmation requiring rider to input 4-digit code provided on customer app.
- **How:** Backend matches input code; upon match, marks order DELIVERED and credits rider wallet.
- **Key Detail:** Cryptographically generated code; never exposed in rider app payload.
- **Why It Matters:** Eliminates false delivery claims and disputes.

### F41: Rider Earnings Ledger & Cash Tracker (Phase 1b)
- **What:** Daily earnings tracking, incentive bonuses, distance pay, and physical COD cash collected.
- **How:** Itemizes delivery payouts; reconciles COD cash in hand against bank transfers.
- **Key Detail:** Pauses new COD assignments if cash-in-hand reaches Rs 2,000 ceiling.
- **Why It Matters:** Guarantees transparent accounting for gig workers.

### F42: Live Rider GPS Streaming (Phase 1b)
- **What:** Background location streaming from rider phone broadcast to customer tracking map.
- **How:** Throttled GPS coordinates emitted every 5s over WebSockets; animates vehicle marker.
- **Key Detail:** Battery-efficient background geolocation service.
- **Why It Matters:** Delivers an engaging, transparent live tracking experience for diners.

---

## 4. System Architecture Diagram (ASCII)

```
+----------------------------------------------------------------------------------------------------+
|                                         CLIENT PLATFORMS                                           |
|                                                                                                    |
|    +-----------------------------+   +-----------------------------+   +-----------------------+   |
|    |      Customer Mobile App    |   |  Restaurant Partner Portal  |   |    Admin Dashboard    |   |
|    |     (React Native / Expo)   |   |     (React 18 + Vite Web)   |   | (React 18 + Vite Web) |   |
|    +--------------+--------------+   +--------------+--------------+   +-----------+-----------+   |
+-------------------|---------------------------------|------------------------------|---------------+
                    | HTTPS / WSS                     | HTTPS / WSS                  | HTTPS / WSS
                    v                                 v                              v
+----------------------------------------------------------------------------------------------------+
|                                   CLOUDFLARE EDGE & REVERSE PROXY                                  |
|                                                                                                    |
|  * TLS 1.3 Termination   * WAF & DDoS Shield   * Static Asset Edge Cache   * GeoIP Country Header  |
+-------------------------------------------------+--------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                    BACKEND APPLICATION CLUSTER                                     |
|                                       (Node.js + Express)                                          |
|                                                                                                    |
|  +----------------------------------------------------------------------------------------------+  |
|  |                                  GLOBAL MIDDLEWARE PIPELINE                                  |  |
|  |  * Security Headers (Helmet)  * CORS Whitelist  * Rate Limiter (Token Bucket)  * JSON Parser |  |
|  |  * Request Correlation ID     * Supabase JWT Auth Middleware  * Zod Schema Validation Buffer |  |
|  |  * Global Error Boundary Handler                                                             |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                 |                                                  |
|  +----------------------------------------------+-----------------------------------------------+  |
|  |                                    DOMAIN LOGIC CONTROLLERS                                  |  |
|  |                                                                                              |  |
|  |  [Auth Service]     [Restaurant Catalog]   [Menu & Inventory]     [Cart & Pricing Engine]    |  |
|  |  [Order Manager]    [Razorpay Adapter]     [Review Aggregator]    [Coupon Validation Engine] |  |
|  |  [Delivery Hub]     [Dining Reservations]  [Admin Dispute Hub]    [Notification Dispatcher]  |  |
|  +----------------------------------------------+-----------------------------------------------+  |
|                                                 |                                                  |
|  +----------------------------------------------+-----------------------------------------------+  |
|  |                                 REAL-TIME WEBSOCKET HUB (Socket.io)                          |  |
|  |  * Room Management: order:<id>, restaurant:<id>, rider:<id>, admin:broadcast                |  |
|  |  * Heartbeat Ping-Pong (25s) * Reconnect Backoff Engine * State Synchronization Bus          |  |
|  +----------------------------------------------------------------------------------------------+  |
+--------------------+----------------------------+----------------------------+---------------------+
                     |                            |                            |
                     v                            v                            v
+------------------------+    +-----------------------+    +-----------------------+
|  RELATIONAL STORAGE    |    |   DOCUMENT STORAGE    |    |   DISTRIBUTED CACHE   |
|  (Supabase PostgreSQL) |    |  (MongoDB Atlas M0)   |    |    (Upstash Redis)    |
|                        |    |                       |    |                       |
|  * Users & Auth RLS    |    |  * Nested Menus       |    |  * Rate Limit Buckets |
|  * Orders & Ledger     |    |  * Dish Addons        |    |  * Session Blocklist  |
|  * PostGIS Geofencing  |    |  * Reviews & UGC      |    |  * Live Coordinates   |
|  * Financial Records   |    |  * Audit Event Logs   |    |  * Active Order State |
+------------------------+    +-----------------------+    +-----------------------+
```

---

## 5. Repository & Directory Structure

```
quick-bites/
|-- apps/
|   |-- customer-mobile/          # React Native + Expo Customer App
|   |   |-- app/                  # Expo Router file-based screens
|   |   |   |-- (auth)/           # Login, OTP verification screens
|   |   |   |-- (tabs)/           # Home, Search, Orders, Profile tabs
|   |   |   |-- restaurant/[id]   # Restaurant details & categorized menu
|   |   |   |-- cart              # Cart summary & coupon input
|   |   |   |-- checkout          # Address selection & payment sheet
|   |   |   `-- tracking/[id]     # Real-time order tracking map & status
|   |   |-- components/           # UI components with 4-state handlers
|   |   |-- hooks/                # Custom React hooks (useCart, useSocket)
|   |   `-- package.json
|   |
|   |-- restaurant-web/           # React 18 + Vite Restaurant Portal
|   |   |-- src/
|   |   |   |-- pages/            # Terminal, Menu, Analytics, Settings
|   |   |   |-- components/       # Order cards, sound chime, menu editors
|   |   |   `-- api/              # Restaurant API client
|   |   `-- package.json
|   |
|   |-- admin-web/                # React 18 + Vite Admin Dashboard
|   |   |-- src/
|   |   |   |-- pages/            # Control Tower, Approvals, Disputes, Fraud
|   |   |   |-- components/       # Metric cards, KYC viewers, demo generator
|   |   |   `-- api/              # Admin API client
|   |   `-- package.json
|   |
|   `-- backend-api/              # Node.js + Express TypeScript API Server
|       |-- src/
|       |   |-- config/           # Environment variables, DB pool connections
|       |   |-- middlewares/      # Auth, rate-limit, validation, errors
|       |   |-- modules/          # Domain modules (auth, orders, catalog...)
|       |   |   |-- auth/
|       |   |   |-- restaurants/
|       |   |   |-- menus/
|       |   |   |-- orders/
|       |   |   |-- payments/
|       |   |   `-- admin/
|       |   |-- sockets/          # Socket.io room handlers & event dispatch
|       |   |-- server.ts         # Server bootstrap & lifecycle hooks
|       `-- package.json
|
|-- packages/
|   |-- shared-types/             # Universal TypeScript interfaces & enums
|   |-- pricing-engine/           # Pure tax, commission, and fee calculation functions
|   |-- api-client/               # Type-safe Axios/fetch wrapper with interceptors
|   |-- design-system/            # CSS tokens, theme variables, and common styles
|   `-- config/                   # Shared ESLint, Prettier, and TSConfig rules
|
|-- build/                        # Build chunk execution specifications (00 - 09)
|-- legal/                        # Privacy policy, terms, compliance docs
|-- design/                       # UI prompts, CSS custom property tokens
|-- security/                     # Security verification checklists
|-- package.json                  # Root monorepo configuration
|-- turbo.json                    # Turborepo build pipeline configuration
```

---

## 6. Database DDL Schema (PostgreSQL 15 + PostGIS)

```sql
-- Enable PostGIS extension for spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'restaurant_owner', 'rider', 'super_admin')),
    is_gold BOOLEAN NOT NULL DEFAULT FALSE,
    gold_expires_at TIMESTAMP WITH TIME ZONE,
    preferred_language VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'kn')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Restaurants Table
CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(180) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address_line TEXT NOT NULL,
    city VARCHAR(50) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    coordinates GEOMETRY(Point, 4326) NOT NULL,
    fssai_license_number VARCHAR(14) NOT NULL,
    gstin VARCHAR(15),
    is_pure_veg BOOLEAN NOT NULL DEFAULT FALSE,
    packaging_fee DECIMAL(10, 2) NOT NULL DEFAULT 20.00,
    status VARCHAR(25) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
    rating_average DECIMAL(3, 2) NOT NULL DEFAULT 4.00,
    rating_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_restaurants_coords ON restaurants USING GIST (coordinates);
CREATE INDEX idx_restaurants_status ON restaurants (status);

-- 3. Addresses Table
CREATE TABLE addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(20) NOT NULL DEFAULT 'Home' CHECK (label IN ('Home', 'Work', 'Other')),
    address_line TEXT NOT NULL,
    landmark VARCHAR(100),
    coordinates GEOMETRY(Point, 4326) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_addresses_user ON addresses (user_id);

-- 4. Orders Table
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key UUID UNIQUE NOT NULL,
    order_number VARCHAR(20) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES users(id),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    delivery_address_id UUID NOT NULL REFERENCES addresses(id),
    status VARCHAR(25) NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (status IN ('PAYMENT_PENDING', 'ORDER_PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('RAZORPAY_SANDBOX', 'CASH_ON_DELIVERY')),
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    items_total DECIMAL(10, 2) NOT NULL,
    gst_amount DECIMAL(10, 2) NOT NULL,
    packaging_fee DECIMAL(10, 2) NOT NULL,
    delivery_fee DECIMAL(10, 2) NOT NULL,
    platform_fee DECIMAL(10, 2) NOT NULL DEFAULT 5.00,
    coupon_discount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(10, 2) NOT NULL,
    restaurant_net_payout DECIMAL(10, 2) NOT NULL,
    preparation_minutes INTEGER,
    delivery_otp VARCHAR(4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_restaurant ON orders (restaurant_id);
CREATE INDEX idx_orders_status ON orders (status);

-- 5. Order Items Table
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    mongo_dish_id VARCHAR(50) NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    customization_details JSONB,
    total_price DECIMAL(10, 2) NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
```

---

## 7. API Endpoints Table

| Method | Endpoint Path | Description | Auth Required | Rate Limit | Response Format |
|--------|---------------|-------------|---------------|------------|-----------------|
| **POST** | `/api/v1/auth/send-otp` | Dispatches 6-digit email OTP | None | 3 req/min | `{ success: true, message: "OTP sent" }` |
| **POST** | `/api/v1/auth/verify-otp` | Verifies OTP, returns JWTs | None | 5 req/min | `{ success: true, data: { tokens, user } }` |
| **GET** | `/api/v1/restaurants` | Discover nearby restaurants | Optional | 60 req/min | `{ success: true, data: [restaurants] }` |
| **GET** | `/api/v1/restaurants/:id` | Fetch restaurant & menu | Optional | 60 req/min | `{ success: true, data: { restaurant, menu } }` |
| **POST** | `/api/v1/cart/validate` | Recalculate bill & fees | Customer | 30 req/min | `{ success: true, data: { billBreakdown } }` |
| **POST** | `/api/v1/orders` | Submit order & initiate pay | Customer | 10 req/min | `{ success: true, data: { order, paymentParams } }` |
| **POST** | `/api/v1/orders/webhook` | Razorpay payment webhook | None (Signed) | 120 req/min | `{ status: "ok" }` |
| **GET** | `/api/v1/orders/:id/track` | Active order tracking state | Customer | 60 req/min | `{ success: true, data: { orderState } }` |
| **GET** | `/api/v1/addresses` | List saved addresses | Customer | 30 req/min | `{ success: true, data: [addresses] }` |
| **POST** | `/api/v1/addresses` | Create new saved address | Customer | 10 req/min | `{ success: true, data: address }` |
| **PUT** | `/api/v1/restaurant/terminal/order` | Accept/reject kitchen order | Partner | 60 req/min | `{ success: true, data: updatedOrder }` |
| **PUT** | `/api/v1/restaurant/menu/stock` | Toggle item in/out of stock | Partner | 30 req/min | `{ success: true, data: { inStock } }` |
| **GET** | `/api/v1/admin/dashboard` | Operations tower metrics | Admin | 30 req/min | `{ success: true, data: { kpis, health } }` |
| **POST** | `/api/v1/admin/demo/generate` | Generate test restaurant | Admin | 5 req/min | `{ success: true, data: testRestaurant }` |
| **GET** | `/health` | System health check probe | None | Unlimited | `{ status: "HEALTHY", services: {...} }` |

---

## 8. WebSocket Event Specifications

### Room Subscriptions:
- `order:<orderId>`: Live lifecycle and GPS tracking for a single order.
- `restaurant:<restaurantId>`: Real-time order terminal alerts for a restaurant.
- `admin:broadcast`: Platform-wide operational metrics stream.

### Event Message Payloads:

#### 1. Incoming Order Alert (`order:created`)
```json
{
  "event": "order:created",
  "data": {
    "orderId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "orderNumber": "QB-2026-8921",
    "customerName": "Rahul S.",
    "items": [
      { "name": "Paneer Butter Masala", "quantity": 1, "variant": "Full" },
      { "name": "Butter Naan", "quantity": 3 }
    ],
    "itemsTotal": 450.00,
    "placedAt": "2026-09-05T18:00:00Z"
  }
}
```

#### 2. Status Update (`order:status_update`)
```json
{
  "event": "order:status_update",
  "data": {
    "orderId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "status": "PREPARING",
    "preparationMinutes": 20,
    "estimatedDeliveryTime": "2026-09-05T18:35:00Z",
    "timestamp": "2026-09-05T18:02:15Z"
  }
}
```

---

## 9. Design System CSS Custom Properties

```css
:root {
  /* Brand Core Colors */
  --color-primary: #E23744;         /* Vibrant Quick Bite Crimson */
  --color-primary-hover: #C62835;
  --color-primary-light: #FDE8EA;
  --color-accent: #FF8A00;          /* Warm Saffron Accent */
  
  /* Dietary Badges */
  --color-veg: #0F8A3C;             /* Food Standard Green */
  --color-nonveg: #E23744;          /* Food Standard Red */
  
  /* Neutral Palette (Light Mode Default) */
  --bg-app: #F8FAFC;
  --bg-surface: #FFFFFF;
  --bg-surface-elevated: #FFFFFF;
  --border-subtle: #E2E8F0;
  --border-focus: #E23744;
  --text-primary: #0F172A;
  --text-secondary: #64748B;
  --text-muted: #94A3B8;
  
  /* Status Colors */
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --color-info: #3B82F6;
  
  /* Spacing Scale (4px Base Unit) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  
  /* Border Radii */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
  
  /* Elevation Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  
  /* Animation Timing */
  --anim-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --anim-normal: 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Dark Mode Overrides */
[data-theme="dark"] {
  --bg-app: #060918;
  --bg-surface: #0F172A;
  --bg-surface-elevated: #1E293B;
  --border-subtle: #1E293B;
  --text-primary: #F8FAFC;
  --text-secondary: #94A3B8;
  --text-muted: #64748B;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
}
```

---

## 10. Security Hardening Measures

1. **Backend Parameterized SQL:** 100% of relational queries use Prisma parameterized inputs; raw string concatenation is strictly prohibited.
2. **Double-Token Auth Mechanism:** Short-lived access tokens (15m) paired with rotating refresh tokens (7d) stored in SecureStore on mobile and HTTP-Only cookies on web.
3. **API Boundary Validation:** Every endpoint request payload is validated using strict Zod schemas before hitting domain controllers.
4. **Token Bucket Rate Limiter:** Enforced via Upstash Redis per IP address and authenticated user ID.
5. **Security Headers:** Enforced via Helmet: Content Security Policy (CSP), Strict-Transport-Security (HSTS), X-Frame-Options: DENY, and X-Content-Type-Options: nosniff.
6. **Strict CORS Whitelist:** Allowed origins explicitly defined for mobile protocols and production web URLs.
7. **Idempotency Keys:** Mandatory UUID idempotency keys on all order submissions prevent duplicate payments.
8. **Tenant & Owner Isolation:** Every SQL query explicitly scopes mutations by `owner_id` or `user_id`.
9. **Zero Plaintext Secrets:** All keys loaded via environment variables; `.env` excluded from git via `.gitignore`.
10. **Sanitized User Inputs:** All customer review texts and merchant descriptions sanitized against XSS attacks.
