# QUICK BITE PLATFORM: COMPLETE SYSTEM RESEARCH DOCUMENT

**Project Name:** Quick Bite  
**Research Date:** September 2026  
**Document Type:** Comprehensive Architecture, Portals, System Design & Feasibility Blueprint  
**Industry Benchmark:** Zomato & Blinkit Ecosystem (Eternal Ltd)  
**Target Deployment:** iOS, Android, and Web  

---

## EXECUTIVE SUMMARY & ANSWERS TO YOUR QUESTIONS

### Q1: Can we build everything on a Free Tier? Which features must be frozen until funding?
**Direct Answer: YES, 85% to 90% of the entire Quick Bite core food delivery ecosystem can be built and run on a 100% FREE tier during development and initial pilot.**

Here is the exact breakdown between what is **Active on Free Tier** vs **Frozen until Funding**:

#### Active on Free Tier (Phase 1 MVP - Total Setup Cost: ₹0 to ₹2,900 max):
1. **Frontend Mobile Apps (Android & iOS):** React Native + Expo (100% Open Source & Free). One single codebase compiles to both iOS and Android.
2. **Backend API & WebSockets:** Node.js + Express / Fastify + Socket.io (self-hosted or free cloud instances on Render / Railway / Vercel).
3. **Primary Database (Relational):** PostgreSQL (Supabase Free Tier: 500MB database, 50,000 monthly active users, or local Docker).
4. **NoSQL / Documents:** MongoDB Atlas Free M0 Sandbox (512MB storage - plenty for thousands of menus and orders).
5. **Caching & Live State:** Redis (Upstash Free Tier: 10,000 commands/day or local Redis instance).
6. **Search Engine:** Meilisearch (Open source, ultra-fast typo-tolerant full-text search, runs locally or free Docker).
7. **Maps & Geolocation:** OpenStreetMap (OSM) + Leaflet / MapLibre (100% free with no per-request billing, replacing Google Maps API).
8. **Push Notifications:** Firebase Cloud Messaging (FCM) - Completely free and unlimited for push notifications on Android & iOS.
9. **Authentication & OTP:** Email-based OTP via SendGrid / Resend (Free 100-3,000 emails/month) or Supabase Auth. This completely bypasses costly SMS gateway charges.
10. **File & Image Storage:** Cloudflare R2 (10 GB free storage, zero egress fees) or Supabase Storage (1 GB free).
11. **Order Payments:** Cash on Delivery (COD) mode + Razorpay Test/Sandbox Mode (Free simulation of UPI, Cards, Netbanking without real money transfers).
12. **Hosting & CI/CD:** Vercel (Frontends & Dashboards) + Render/Railway (Backend APIs) + GitHub Actions (Free CI/CD).

#### Features FROZEN Until Seed Funding:
| Frozen Feature | Free MVP Alternative (Phase 1) | Upgrade After Funding (Phase 2/3) | Reason for Freeze |
|----------------|--------------------------------|-----------------------------------|-------------------|
| **SMS OTP Gateway** | Email OTP / In-App Verification | DLT-registered Twilio / MSG91 / Fast2SMS | Indian SMS costs ~₹0.15-0.25 per SMS + DLT registration fees |
| **Google Maps API** | OpenStreetMap (OSM) + OSRM Routing | Google Maps Platform (Directions, Places, Geocoding) | Google Maps charges $5-$10 per 1,000 API calls after $200 free credit |
| **Paid Payment Gateway Settlement** | Cash on Delivery (COD) + Test UPI Gateway | Razorpay / Cashfree / PayU Live Merchant Account | Requires registered business bank account, GST, and 2% txn fees |
| **Apple App Store Distribution** | Expo Go app & TestFlight Ad-Hoc | Apple Developer Program ($99/year / ~₹8,700/yr) | Requires annual Apple Developer fee |
| **Heavy Cloud ML Models** | Rule-Based Heuristics & Statistical Models | Hosted PyTorch / TensorFlow / Two-Tower Neural Recs | GPU cloud instances cost $50-$300+/month |
| **Quick Commerce Dark Stores (Quick Bite Mart)** | Software blueprint only (Frozen) | Leased micro-warehouses & inventory purchasing | Requires millions in real-estate leases & inventory capital |
| **B2B Supply Chain (Quick Bite Supply)** | Software blueprint only (Frozen) | Centralized sorting hubs & supplier credit lines | High working capital and physical logistics fleet |
| **Event Ticketing (Quick Bite Events)** | Software blueprint only (Frozen) | Venue integrations & ticketing partnerships | Requires commercial venue contracts and licensing |

---

### Q2: Will it work on both Android and Apple iOS?
**Direct Answer: YES.**  
By using **React Native with the Expo framework**, we write a single unified JavaScript/TypeScript codebase. It renders **100% native UI widgets** for both Android (Material Design components) and Apple iOS (Cupertino components). You do not need two separate teams or codebases.

---

### Q3: Can I download and test everything on my own phone?
**Direct Answer: YES, you can test everything on your physical Android phone and iPhone completely FREE without paying Google or Apple.**

Here are your 4 testing methods:
1. **Expo Go (Easiest & Free for both iPhone & Android):**
   - Install the free **Expo Go** app from the Google Play Store (Android) and Apple App Store (iPhone).
   - When we run the dev server, a QR code appears in your terminal.
   - Scan the QR code with your iPhone camera or Expo Go on Android: the app instantly loads on your physical phone with full live reloading!
2. **Android APK Sideload (Direct Install on Android):**
   - We can build an installable `.apk` file using Expo EAS Build (free tier) or local Gradle build.
   - You can download this APK directly to your phone via USB or WhatsApp/Google Drive, tap install, and test it as a standalone app without publishing to Google Play.
3. **Web Browser Testing (Free for all devices):**
   - The React Native web engine and React admin dashboards can run directly in Chrome, Safari, Edge, or Firefox on your PC or mobile browser.
4. **Emulators & Simulators (PC / Mac):**
   - Android Studio emulator runs on Windows/Mac/Linux.
   - iOS Simulator runs on macOS.

---

## TABLE OF CONTENTS

1. [Ecosystem Overview](#1-ecosystem-overview)
2. [Cost Strategy & Testing Roadmap](#2-cost-strategy--testing-roadmap)
3. [Portal 1: Customer App (Quick Bite)](#3-portal-1-customer-app-quick-bite)
4. [Portal 2: Restaurant Partner Portal (Quick Bite for Business)](#4-portal-2-restaurant-partner-portal-quick-bite-for-business)
5. [Portal 3: Delivery Partner App (Quick Bite Rider)](#5-portal-3-delivery-partner-app-quick-bite-rider)
6. [Portal 4: Quick Bite Supply (B2B Supply Chain - Phase 3 Funded)](#6-portal-4-quick-bite-supply-b2b-supply-chain)
7. [Portal 5: Quick Bite Mart (Quick Commerce - Phase 3 Funded)](#7-portal-5-quick-bite-mart-quick-commerce)
8. [Portal 6: Quick Bite Events (Going Out / Ticketing - Phase 3 Funded)](#8-portal-6-quick-bite-events-going-out--events)
9. [Portal 7: Admin & Operations Portal](#9-portal-7-admin--internal-operations-portal)
10. [System Architecture (Microservices & Free-Tier Stack)](#10-system-architecture)
11. [Core Algorithms & ML Systems (Production vs Free Heuristics)](#11-core-algorithms-and-ml-systems)
12. [Data Model & Database Design (PostgreSQL, MongoDB, Redis)](#12-data-model-and-database-design)
13. [Inter-Portal Connectivity Map & Live Data Flows](#13-inter-portal-connectivity-map)
14. [Payment Infrastructure & Settlement Lifecycle](#14-payment-infrastructure)
15. [Notification Infrastructure (FCM, WebSockets, Email)](#15-notification-infrastructure)
16. [Security & Fraud Detection Systems](#16-security-and-fraud-detection)
17. [Promotions & Advertising Engine](#17-promotions-and-advertising-engine)
18. [Replication Blueprint & Build Order](#18-replication-requirements-summary)

---

## 1. ECOSYSTEM OVERVIEW

Quick Bite is an integrated, multi-sided marketplace platform designed to deliver seamless food discovery, online ordering, last-mile logistics, partner empowerment, and administrative control. Benchmarked against the enterprise architecture of Zomato and Blinkit, Quick Bite interconnects 7 distinct portals sharing unified authentication, data synchronization, notification infrastructure, and geospatial routing.

### The 7 Portals of Quick Bite

| # | Portal | Platform | Target Stakeholder | Primary Function | Development Phase |
|---|--------|----------|--------------------|------------------|-------------------|
| 1 | **Quick Bite Customer App** | iOS, Android, Mobile Web | End consumers | Restaurant discovery, food ordering, live order tracking, reviews, dining offers | **Phase 1 (Active / Free)** |
| 2 | **Quick Bite for Business** | Web, Android, iOS Tablet | Restaurant owners & staff | Real-time order processing, menu management, prep time toggles, store analytics | **Phase 1 (Active / Free)** |
| 3 | **Quick Bite Rider** | Android, iOS | Delivery fleet partners | Order broadcasts, accept/reject, GPS turn-by-turn navigation, OTP pickup/drop, earnings | **Phase 1 (Active / Free)** |
| 4 | **Quick Bite Supply** | Web, Android, iOS | Restaurants & commercial kitchens | B2B bulk raw ingredient procurement, dairy/produce supply chain (Hyperpure model) | **Phase 3 (Frozen until Funding)** |
| 5 | **Quick Bite Mart** | iOS, Android | Consumers in high-density pockets | 10-20 minute quick commerce dark-store delivery (Blinkit model) | **Phase 3 (Frozen until Funding)** |
| 6 | **Quick Bite Events** | iOS, Android, Web | Consumers | Dining table reservations, nightlife bookings, concerts, movie ticketing (District model) | **Phase 3 (Frozen until Funding)** |
| 7 | **Quick Bite Admin Portal** | Web Dashboard | Operations, City Managers, Support | System-wide oversight, catalog moderation, rider dispatch, fraud detection, refunds | **Phase 1 (Active / Free)** |

### High-Level Interconnection Topology

```
                                  +------------------------------------+
                                  |     QUICK BITE HOLDINGS            |
                                  |   (Unified Identity & Data Layer)  |
                                  +------------------+-----------------+
                                                     |
             +---------------------------------------+---------------------------------------+
             |                                       |                                       |
  +----------v-----------+               +-----------v----------+               +------------v-----------+
  | QUICK BITE CORE FOOD |               | QUICK BITE MART      |               | QUICK BITE EVENTS      |
  |  Customer App        |               | Quick Commerce 15min |               | Ticketing & Dining     |
  |  Restaurant Portal   |               | [PHASE 3 - FROZEN]   |               | [PHASE 3 - FROZEN]     |
  |  Rider Logistics     |               +-----------+----------+               +------------+-----------+
  +----------+-----------+                           |                                       |
             |                                       |                                       |
             +-------------------+-------------------+-------------------+-------------------+
                                 |
                 SHARED INFRASTRUCTURE SERVICES
      +-------------------------------------------------------------+
      |  - User Identity (JWT / OAuth / Unified SSO)                |
      |  - Payment Engine (COD / Razorpay Mock & Live)              |
      |  - Real-Time Messaging (Socket.io WebSockets)               |
      |  - Notification Engine (Firebase Cloud Messaging + Email)   |
      |  - Geospatial Engine (PostGIS + OpenStreetMap / OSRM)       |
      |  - Event Bus (Redis Pub/Sub -> Scalable to Apache Kafka)    |
      +------------------------------+------------------------------+
                                     |
                         +-----------v-----------+
                         | QUICK BITE SUPPLY     |
                         | B2B Procurement Hub   |
                         | [PHASE 3 - FROZEN]    |
                         +-----------------------+
```

---

## 2. COST STRATEGY & TESTING ROADMAP

### Free-Tier Tech Stack Blueprint (Total Initial Capital: ₹0 to ₹2,900 max)

| Category | Component | Enterprise Solution (Costly) | Quick Bite Phase 1 Free Solution | Monthly Cost |
|----------|-----------|------------------------------|----------------------------------|--------------|
| **Mobile Apps** | iOS & Android Apps | Separate Swift + Kotlin | React Native + Expo | **₹0** |
| **Backend API** | App Server | AWS ECS / EKS Cluster | Node.js + Express on Render / Railway | **₹0** |
| **Database** | Primary SQL DB | AWS RDS Multi-AZ ($150+/mo) | PostgreSQL on Supabase (500MB free) | **₹0** |
| **Document Store** | Catalogs & Logs | MongoDB Dedicated ($60+/mo) | MongoDB Atlas M0 Free Tier (512MB) | **₹0** |
| **Cache & Queue** | Live state & Pub/Sub | AWS ElastiCache ($80+/mo) | Upstash Redis Free / Local Redis | **₹0** |
| **Search Engine** | Search & Autocomplete | Elastic Cloud ($95+/mo) | Meilisearch (Open-Source Docker) | **₹0** |
| **Maps & Routing** | Geocoding & Nav | Google Maps Platform ($200+/mo) | Leaflet + OpenStreetMap + OSRM | **₹0** |
| **Push Notifications**| Push Alerts | OneSignal Paid ($99/mo) | Firebase Cloud Messaging (FCM) | **₹0** |
| **Authentication**| Mobile OTP | Twilio / MSG91 (₹0.20/SMS) | Email OTP / In-App Mock OTP | **₹0** |
| **File Storage** | Menu photos, avatars | AWS S3 + CloudFront | Cloudflare R2 (10 GB free, $0 egress) | **₹0** |
| **Web Dashboards**| Admin & Restaurant UI | AWS Amplify / Vercel Pro | Vercel Hobby Tier | **₹0** |
| **App Testing** | Real device install | Apple Dev ($99/yr) + Play Store ($25) | Expo Go (iOS + Android) + APK Sideload | **₹0** |
| **Domain & SSL** | Custom Domain | Paid Registrar & SSL | Free .vercel.app / .onrender.com or ₹800/yr | **₹0 to ₹800** |
| **Optional Play Store**| Public Android Store | Google Play Developer | Google Play Account (One-time ₹2,100) | **₹2,100 (optional)** |
| **TOTAL INITIAL RUNWAY** | | | | **₹0 - ₹2,900** |

---

---

## 3. PORTAL 1: CUSTOMER APP (QUICK BITE)

The primary consumer-facing application. The most feature-rich portal in the ecosystem.

### 3.1 Authentication and Account

| Feature | Details |
|---------|---------|
| **Sign Up** | Phone number + OTP (primary), Email + password, Google OAuth, Apple Sign-In |
| **OTP System** | SMS-based OTP via DLT-registered templates (TRAI compliant), 6-digit code, 60s expiry, rate-limited to prevent abuse |
| **Session Management** | JWT-based tokens, refresh token rotation, multi-device support |
| **Profile** | Name, phone, email, profile picture, saved addresses (home/work/other), default payment method |
| **Account Linking** | Single identity shared across Quick Bite, Quick Bite Mart, and Quick Bite Events (SSO via Quick Bite Single Sign-On account) |

### 3.2 Home Screen and Discovery

| Feature | Details |
|---------|---------|
| **Location Detection** | GPS auto-detect + manual address entry, geofenced service areas |
| **Search Bar** | Full-text search with autocomplete, typo correction, NLP-powered intent detection (e.g., "best coffee cafe" parsed semantically) |
| **Restaurant Feed** | Algorithmic feed personalized per user -- ranked by ML model considering distance, rating, user history, prep time, restaurant performance |
| **Category Carousels** | Cuisine filters (North Indian, Chinese, Pizza, etc.), collection cards ("Great for Groups", "Newly Opened"), trending restaurants |
| **Filters** | Sort by: Relevance, Rating, Delivery Time, Cost (Low-High / High-Low). Filter by: Cuisine, Rating (4.0+), Pure Veg, Offers, Delivery Time, Cost Range |
| **Veg Mode** | Global toggle that filters entire app to show only vegetarian restaurants and dishes |
| **Banner Promotions** | Rotating carousel of sponsored/promotional banners linking to restaurant collections or offers |

### 3.3 Restaurant Detail Page

| Feature | Details |
|---------|---------|
| **Restaurant Info** | Name, cuisine tags, locality, distance, rating (aggregate), total reviews count, cost for two, delivery time estimate, delivery fee |
| **Photo Gallery** | User-uploaded + restaurant-uploaded food photos, moderated for quality |
| **Menu** | Categorized menu items with: name, description, price, veg/non-veg indicator, photo, customization options, availability toggle |
| **Item Customization** | Size variants (Regular/Medium/Large), add-ons/toppings, spice level, special instructions text field |
| **Reviews Section** | Star rating (1-5), text review, photo attachments, date, reviewer name, helpful/not helpful voting, restaurant reply |
| **Operating Hours** | Display open/closed status, scheduled ordering for closed restaurants |
| **Offers** | Restaurant-specific discount coupons displayed prominently |

### 3.4 Cart and Ordering System

| Feature | Details |
|---------|---------|
| **Cart Management** | Add/remove items, modify quantity, edit customizations, see item-level pricing |
| **Multi-Restaurant Warning** | If user adds items from Restaurant B while cart has Restaurant A items, prompt to clear cart |
| **Cart Persistence** | Cart survives app close/reopen, stored server-side with local cache |
| **Price Breakdown** | Item total, taxes (GST), delivery fee, packaging charges, platform fee, discounts applied, tip for delivery partner, final total |
| **Tip System** | Optional tip for delivery partner: preset amounts (Rs 20, 30, 50) + custom amount |
| **Cooking Instructions** | Free-text field for special instructions to the kitchen |
| **Schedule Orders** | Select future date/time for delivery (not all restaurants support this) |

### 3.5 Checkout Flow

```
Cart Review --> Address Selection/Confirmation --> Coupon/Offer Application
    --> Payment Method Selection --> Order Placement --> Order Confirmation
```

| Step | Details |
|------|---------|
| **Address** | Select from saved addresses or add new, GPS pin adjustment on map, landmark/floor/directions fields |
| **Coupons** | Scrollable list of applicable coupons (auto-sorted by max savings), manual promo code entry field, real-time validation |
| **Payment Methods** | UPI (Google Pay, PhonePe, Paytm, Quick Bite UPI via ICICI), Credit/Debit Cards (saved + new), Net Banking, Wallets, Cash on Delivery (COD) |
| **Order Placement** | Payment processing -> order creation -> event published to Kafka -> restaurant notified |

### 3.6 Order Tracking (Real-Time)

This is the most technically complex feature in the customer app.

**State Machine:**
```
ORDER_PLACED --> RESTAURANT_CONFIRMED --> PREPARING --> READY_FOR_PICKUP
    --> RIDER_ASSIGNED --> RIDER_AT_RESTAURANT --> PICKED_UP
    --> OUT_FOR_DELIVERY --> NEAR_YOU --> DELIVERED
```

| Feature | Details |
|---------|---------|
| **Live Map** | Real-time rider location on map, updated every 3-5 seconds via WebSocket |
| **ETA Updates** | Dynamic ETA recalculated at each stage based on ML model (traffic, weather, distance, rider speed) |
| **Status Milestones** | Push notification at each major state change |
| **Communication** | In-app call (masked number) and chat with delivery partner |
| **Contact Restaurant** | Call restaurant for order-specific queries |
| **Live Activity (iOS)** | Dynamic Island / Lock Screen live activity showing order status |
| **Cancel Order** | Allowed before restaurant confirms; partial/no refund after confirmation |

### 3.7 Post-Order Experience

| Feature | Details |
|---------|---------|
| **Rating Prompt** | Rate delivery (1-5 stars), rate food (1-5 stars), rate restaurant (1-5 stars) |
| **Review** | Write text review, attach photos, tag specific dishes |
| **Reorder** | One-tap reorder from order history |
| **Order History** | Complete list of past orders with date, items, total, status, receipt |
| **Complaint/Issue** | Report: missing items, wrong items, quality issues, late delivery, overcharging |
| **Refund** | Automatic/manual refund to original payment method or Quick Bite wallet credits |

### 3.8 Dining Out Features

| Feature | Details |
|---------|---------|
| **Table Booking** | Browse available time slots, select party size, instant confirmation |
| **Dining Offers** | Quick Bite Gold dining discounts (1+1 on food, 2+2 on drinks at partner restaurants) |
| **Bill Payment** | Pay restaurant bill through Quick Bite app for cashback/rewards |
| **Reviews for Dine-In** | Separate dine-in review flow with ambiance, food, service ratings |

### 3.9 Quick Bite Gold (Subscription/Loyalty)

| Feature | Details |
|---------|---------|
| **Pricing** | ~Rs 999/year (varies by promotions, often Rs 99-149 for 3 months on sale) |
| **Delivery Benefits** | Free delivery on orders above Rs 199 within 7-10 km radius |
| **Dining Benefits** | Up to 20-30% off food orders, 1+1 / 2+2 at partner restaurants |
| **Exclusive Access** | Early access to new restaurants, Gold-only events |
| **Priority** | Rush hour priority ordering |
| **Auto-Renewal** | Subscription auto-renews unless cancelled |
| **Bundled Offers** | Complementary Gold via credit card partnerships (ICICI, HDFC, etc.) |

### 3.10 Additional Customer Features

| Feature | Details |
|---------|---------|
| **Food on Train** | Order food to your train seat by entering PNR number |
| **Collections** | Curated restaurant lists ("Best Biryani in Delhi", "Pet-Friendly Cafes") |
| **Quick Bite Feed** | Social feed of reviews, photos, and food content from users you follow |
| **Addresses** | Save multiple addresses with labels (Home, Work, custom) |
| **Language Support** | Multi-language UI (Hindi, English, regional languages) |
| **Accessibility** | Screen reader support, font size adjustments |
| **Dark Mode** | System-preference-aware dark/light mode toggle |
| **Notifications Settings** | Granular control: order updates, offers, recommendations, etc. |

---

## 4. PORTAL 2: RESTAURANT PARTNER PORTAL (Quick Bite for Business)

The restaurant-facing application that manages the supply side of the food delivery marketplace.

### 4.1 Restaurant Onboarding Flow

```
Registration --> Document Upload --> KYC Verification --> Onboarding Call
    --> Dashboard Setup --> Menu Upload --> Photo Review --> Go Live
```

**Required Documents (KYC):**

| Document | Purpose | Mandatory |
|----------|---------|-----------|
| **FSSAI License** | Food safety certification (14-digit number) | YES |
| **PAN Card** | Tax identification (business or proprietor) | YES |
| **GST Certificate** | Tax compliance | YES |
| **Bank Account Details** | Payout processing (cancelled cheque or passbook) | YES |
| **Menu Card** | Pricing and item reference | YES |
| **Restaurant Photos** | Minimum 5-10 high-quality images | YES |
| **Address Proof** | Utility bill or rent agreement | YES |
| **Identity Proof** | Aadhaar or Passport of proprietor | YES |

**Verification Timeline:** 2-5 business days for document review and approval.

### 4.2 Commission Structure

| Component | Rate | Notes |
|-----------|------|-------|
| **Base Commission** | 18%-28% of order value | Varies by city, volume, exclusivity |
| **GST on Commission** | 18% of commission amount | Additional charge |
| **Payment Gateway Fee** | 1.5%-2% on online orders | Card/UPI processing |
| **Advertising (optional)** | 3%-10% CPC ads | Cost-per-click model |
| **Quick Bite Gold Participation** | Variable | Shared cost for Gold discounts |

**Payout Cycle:** Weekly bank transfers, with detailed settlement reports.

### 4.3 Restaurant Dashboard Features

#### 4.3.1 Order Management

| Feature | Details |
|---------|---------|
| **Incoming Orders** | Real-time order queue with audio alert, item details, customer notes |
| **Accept/Reject** | Timer-based acceptance (auto-reject after timeout), rejection requires reason |
| **Prep Time Setting** | Declare estimated preparation time per order |
| **Order Status Updates** | Mark as: Preparing, Ready for Pickup |
| **Order History** | Searchable archive of all past orders with filters (date, status, payment type) |
| **Bulk Order Management** | Handle large/catering orders with extended prep times |

#### 4.3.2 Menu and Catalogue Management

| Feature | Details |
|---------|---------|
| **Menu Editor** | Add/edit/delete items with name, description, price, category, tags |
| **Item Variants** | Size options (Small/Medium/Large), customization groups (toppings, extras) |
| **Item Photos** | Upload dish photos (moderated for quality, no AI-generated images allowed) |
| **Veg/Non-Veg Tags** | Mandatory labeling per item |
| **Category Management** | Create/reorder menu categories (Starters, Main Course, Beverages, etc.) |
| **Stock/Availability Toggle** | Mark items as in-stock or out-of-stock in real-time |
| **Timing-Based Menu** | Different menus for breakfast, lunch, dinner time slots |
| **Bulk Upload** | CSV/Excel import for large menus |
| **Price Updates** | Modify pricing with immediate effect |

#### 4.3.3 Business Analytics Dashboard

| Metric | Details |
|--------|---------|
| **Revenue Analytics** | Daily/weekly/monthly revenue breakdown, order count, average order value |
| **Rating Trends** | Average rating over time, recent review highlights |
| **Customer Insights** | New vs. repeat customers, peak ordering hours, popular items |
| **Competitor Benchmarks** | Compare performance against similar restaurants in the area |
| **Review Heatmaps** | Visual representation of review sentiment |
| **Order Acceptance Rate** | Percentage of orders accepted vs. rejected |
| **Prep Time Analytics** | Average preparation time, comparison to estimates |
| **Cancellation Analytics** | Cancellation rate, reasons breakdown |

#### 4.3.4 Operations Management

| Feature | Details |
|---------|---------|
| **Restaurant Timings** | Set operating hours per day, holiday schedules |
| **Leave Management** | Schedule planned closures (holidays, maintenance) |
| **Multi-Outlet Management** | Switch between multiple restaurant branches from single account |
| **Delivery Zone** | View the delivery radius serviced by the restaurant |
| **Staff Access** | Add sub-accounts for managers/staff with role-based permissions |

#### 4.3.5 Marketing and Growth Tools

| Feature | Details |
|---------|---------|
| **Offers/Discounts** | Create percentage-off or flat-off deals with minimum order value |
| **Target Segments** | Target: all customers, new customers only, repeat customers only |
| **Ad Campaigns** | Run CPC (Cost-Per-Click) sponsored listings within the Quick Bite app |
| **Performance Reports** | Track ad spend, impressions, clicks, conversions, ROI |
| **Social Media Ads** | Create Facebook/Instagram ads linking to Quick Bite listing |
| **Banner Promotions** | Apply for featured placement in app banners/collections |

#### 4.3.6 Quick Bite Supply Integration

| Feature | Details |
|---------|---------|
| **Supply Ordering** | Order ingredients/supplies directly from Quick Bite Supply within the partner app |
| **Quick Bite Supply Inside Badge** | Restaurants using Quick Bite Supply get a quality badge on their customer-facing listing |
| **Inventory Alerts** | Notifications when ordered supplies are running low |

#### 4.3.7 Support and Communication

| Feature | Details |
|---------|---------|
| **Customer Chat** | Respond to customer queries about orders |
| **Review Responses** | Reply to customer reviews publicly |
| **Quick Bite Support** | Access account manager, raise tickets, call support |
| **Knowledge Base** | Training materials, best practices, onboarding guides |

---

## 5. PORTAL 3: DELIVERY PARTNER APP (QUICK BITE RIDER)

The logistics workforce application used by gig delivery workers.

### 5.1 Delivery Partner Onboarding

```
Registration (Phone + OTP) --> Document Upload --> Background Verification
    --> Training Module --> First Delivery Shadowing --> Active Status
```

**Required Documents:**

| Document | Purpose |
|----------|---------|
| **Aadhaar Card** | Identity verification |
| **PAN Card** | Tax documentation |
| **Driving License** | Vehicle authorization (2-wheeler/4-wheeler) |
| **Vehicle RC** | Vehicle registration certificate |
| **Bank Account** | Earnings payout |
| **Profile Photo** | Identity verification during deliveries |

### 5.2 Core App Features

#### 5.2.1 Order Assignment and Management

| Feature | Details |
|---------|---------|
| **Order Notification** | Audio + visual alert with: restaurant name, pickup distance, drop distance, estimated earning |
| **Accept/Decline** | Time-limited accept button (15-20 seconds), decline with no immediate penalty (but affects priority score) |
| **Order Batching** | System may assign 2 nearby orders simultaneously for efficiency |
| **Order Details** | Customer name (first name only), items list, special instructions, restaurant address, customer address |
| **Status Updates** | Mark: Reached Restaurant, Order Picked Up, Reached Customer, Delivered |
| **Customer Communication** | In-app call (masked/VoIP number for privacy), in-app chat |
| **Issue Reporting** | Report: restaurant closed, long wait, customer unreachable, unsafe location |

#### 5.2.2 Navigation System

| Feature | Details |
|---------|---------|
| **Built-in Navigation** | Turn-by-turn directions to restaurant and then to customer |
| **Map Integration** | Google Maps / MapMyIndia integration |
| **GPS Tracking** | Continuous location reporting (every 3-5 seconds) using FusedLocationProviderClient (Android) / CoreLocation (iOS) |
| **Battery Optimization** | Adaptive location frequency -- higher during active delivery, lower during idle |
| **Geofence Detection** | Auto-detect arrival at restaurant and customer locations |

#### 5.2.3 Earnings and Payments

| Feature | Details |
|---------|---------|
| **Earnings Dashboard** | Real-time display of today's earnings, weekly total, monthly total |
| **Per-Order Breakdown** | Base fee + distance fee + time fee + surge bonus + tips |
| **Incentive Tracker** | Display: current touchpoints, next milestone bonus, multiplier active |
| **Payout Options** | Daily payout, weekly payout, instant withdrawal |
| **Payment History** | Detailed transaction log with order-level breakdown |
| **Tax Documents** | Downloadable earnings statements for tax filing |

#### 5.2.4 Incentive System

| Incentive Type | Details |
|----------------|---------|
| **Touchpoint System** | Each completed delivery earns touchpoints; multipliers during peak hours (1.5x-2.0x) |
| **Milestone Bonuses** | Cash bonuses at order count thresholds (e.g., Rs 100 bonus after 10 orders) |
| **Surge Pricing** | Higher per-delivery pay during peak demand (rain, festivals, late night) |
| **Referral Bonus** | Earn money for referring new delivery partners |
| **Weekly Challenges** | Gamified targets with bonus payouts |
| **Consistency Bonus** | Rewards for maintaining high acceptance rate and completion rate |

#### 5.2.5 Assignment Algorithm (How Orders are Assigned)

The delivery partner assignment is a real-time optimization problem solved by ML:

```
ORDER PLACED --> Calculate Restaurant Location
    --> Identify Available Partners in Radius (Geohash/QuadTree)
    --> Score Each Partner:
        * Distance to restaurant (lower = better)
        * Current workload (fewer active orders = better)
        * Historical performance (completion rate, speed, ratings)
        * Shift reliability (adherence to scheduled shifts)
        * Vehicle type suitability (large orders need 4-wheelers)
        * Battery/connectivity status
    --> Rank by Composite Score
    --> Assign to Top-Ranked Partner
    --> If Declined --> Assign to Next in Queue
    --> If No Partner Available --> Expand Search Radius
```

**Key Technical Details:**
- **Geospatial Indexing:** Uses Geohashing or H3 hexagonal cells for fast proximity queries
- **Processing:** Apache Flink for real-time stream processing of location data
- **Cache:** Redis stores latest rider locations for sub-millisecond retrieval
- **Queue:** Apache Kafka for event-driven order assignment pipeline

#### 5.2.6 Shift Management

| Feature | Details |
|---------|---------|
| **Flexible Shifts** | Choose full-time, part-time, or custom time blocks |
| **Shift Booking** | Book preferred time slots in advance (competitive -- high-demand slots fill fast) |
| **Auto Login/Logout** | System tracks active hours |
| **Break Management** | Pause accepting new orders during breaks |
| **Attendance Tracking** | Login streaks and consistency metrics |

#### 5.2.7 Safety and Benefits

| Feature | Details |
|---------|---------|
| **Emergency SOS** | One-tap emergency button connecting to local authorities |
| **Insurance** | Accidental injury coverage, medical insurance |
| **Online Doctor** | Telemedicine consultations |
| **Rain Gear** | Seasonal equipment support |
| **Safety Training** | In-app road safety and hygiene training modules |
| **COVID Protocols** | Temperature logging, sanitization tracking (introduced during pandemic) |

#### 5.2.8 Performance Metrics Tracked

| Metric | Impact |
|--------|--------|
| **Acceptance Rate** | Higher rate = better order priority |
| **Completion Rate** | Cancellations negatively impact score |
| **Average Delivery Time** | Faster = higher priority score |
| **Customer Rating** | Low ratings trigger review/deactivation |
| **On-Time Percentage** | Compared to ETA estimates |

### 5.3 Large Order Fleet (Specialized)

| Feature | Details |
|---------|---------|
| **Vehicle Type** | Dedicated electric vehicles with temperature-controlled compartments |
| **Capacity** | Orders for up to 50 people |
| **Assignment** | Separate queue for bulk/catering orders |
| **Equipment** | Larger hot bags, multiple compartment carriers |

---

## 6. PORTAL 4: QUICK BITE SUPPLY (B2B Supply Chain) [PHASE 3 - FROZEN UNTIL FUNDING]

Quick Bite's B2B ingredient and supply sourcing platform for restaurants, hotels, caterers, cloud kitchens, and food entrepreneurs.

### 6.1 Platform Overview

Quick Bite Supply digitizes the traditionally fragmented restaurant supply chain by connecting ingredient producers (farmers, mills, processors) directly with food businesses, bypassing middlemen.

### 6.2 Target Customers

| Segment | Examples |
|---------|---------|
| **Restaurants** | Dine-in restaurants, QSR chains |
| **Cloud Kitchens** | Delivery-only kitchens |
| **Hotels** | HoReCa (Hotel, Restaurant, Catering) |
| **Caterers** | Event and corporate catering |
| **Home Bakers** | Small-scale food entrepreneurs |
| **Street Food Vendors** | Expanding to informal food sector |

### 6.3 Product Categories

| Category | Examples |
|----------|---------|
| **Fresh Produce** | Vegetables, fruits, herbs |
| **Dairy** | Milk, cheese, butter, paneer |
| **Grains and Staples** | Rice, flour, lentils, spices |
| **Meat and Seafood** | Chicken, mutton, fish (sourced with traceability) |
| **Oils and Condiments** | Cooking oils, sauces, vinegars |
| **Beverages** | Tea, coffee, juices, syrups |
| **Packaging** | Containers, bags, wraps, eco-friendly packaging |
| **Kitchen Equipment** | Tools, crockery, utensils |
| **Value-Added Products** | Pre-cut vegetables, ready sauces, semi-finished items |

### 6.4 Key Platform Features

#### 6.4.1 Procurement and Ordering

| Feature | Details |
|---------|---------|
| **Product Catalog** | Searchable, categorized product listings with pricing, unit sizes, brand options |
| **Predictive Ordering** | AI-driven demand forecasting based on past purchase patterns |
| **Recurring Orders** | Set up automatic reorders on schedule |
| **Bulk Pricing** | Volume-based discounts |
| **Order Tracking** | Real-time status of placed orders |
| **Delivery Scheduling** | Choose delivery time slots |

#### 6.4.2 Inventory Management

| Feature | Details |
|---------|---------|
| **Stock Level Tracking** | Real-time inventory visibility |
| **Low-Stock Alerts** | Notifications when items drop below threshold |
| **Usage Analytics** | Consumption patterns over time |
| **Wastage Tracking** | Monitor and reduce food waste |

#### 6.4.3 Quality Assurance

| Feature | Details |
|---------|---------|
| **Farm-to-Fork Traceability** | Track ingredient origin from source to delivery |
| **Quality Certification** | All suppliers accredited, products tested |
| **Cold Chain Logistics** | Temperature-controlled warehousing and delivery for perishables |
| **FEFO Compliance** | First Expiry, First Out inventory management |
| **Return/Replacement** | Easy returns for quality issues |

#### 6.4.4 Financial Tools

| Feature | Details |
|---------|---------|
| **GST-Compliant Invoicing** | Automatic tax-compliant purchase reports |
| **Purchase Order Management** | Create, track, and manage POs |
| **Credit Line** | Working capital support for restaurant partners |
| **Payment Terms** | Flexible payment cycles |

#### 6.4.5 Culinary Development Centre

| Feature | Details |
|---------|---------|
| **Recipe Co-Creation** | Work with Quick Bite Supply chefs to develop custom recipes |
| **Custom Ingredients** | Source or create bespoke ingredients for unique dishes |
| **Menu Innovation** | Trend-based suggestions for new menu items |
| **Consistency Tools** | Standardized recipes for multi-outlet chains |

### 6.5 Supply Chain Architecture

```
FARMS / MILLS / PRODUCERS
        |
        v
QUICK BITE SUPPLY CENTRAL/REGIONAL HUBS
    (Quality checks, processing, storage)
        |
        v
TEMPERATURE-CONTROLLED DELIVERY FLEET
        |
        v
RESTAURANT / KITCHEN DOOR
```

### 6.6 Integration with Quick Bite Ecosystem

| Connection | Details |
|------------|---------|
| **Restaurant Partner App** | Direct ordering link from the partner dashboard |
| **Quick Bite Supply Inside Badge** | Restaurants sourcing from Quick Bite Supply get a trust badge on their customer-facing listing |
| **Quick Bite Mart Supply Sharing** | Quick Bite Supply's warehousing and logistics infrastructure is shared with Quick Bite Mart for grocery supply chain |
| **Data Feedback Loop** | Customer order data from Quick Bite informs Quick Bite Supply's demand forecasting for restaurants |

---

## 7. PORTAL 5: QUICK BITE MART (Quick Commerce) [PHASE 3 - FROZEN UNTIL FUNDING]

Quick Bite's quick-commerce subsidiary delivering groceries and essentials in 10-20 minutes.

### 7.1 Business Model

Quick Bite Mart operates on an **inventory-led dark store model**, not a marketplace. Unlike Quick Bite (where restaurants hold inventory), Quick Bite Mart owns and manages inventory in its own micro-warehouses.

### 7.2 Dark Store Operations

| Aspect | Details |
|--------|---------|
| **What is a Dark Store** | A purpose-built micro-fulfillment center (2,000-4,000 sq. ft.) that does NOT serve walk-in customers |
| **Network Scale** | 1,800+ dark stores across India (mid-2026) |
| **Service Radius** | Each store serves a 2-3 km radius |
| **Location Strategy** | Hyperlocal placement in densely populated residential areas |
| **Layout** | Optimized for rapid picking and packing (under 90 seconds to 3 minutes per order) |
| **SKU Count** | 5,000-8,000 SKUs per store (varies by store size and locality) |

### 7.3 Customer App Features

#### 7.3.1 Discovery and Search

| Feature | Details |
|---------|---------|
| **Home Screen** | Category-based browsing (Fruits, Vegetables, Dairy, Snacks, Beverages, etc.) |
| **Search** | Full-text search with autocomplete, brand search, barcode scan |
| **Personalized Recommendations** | Based on past orders and browsing behavior |
| **Trending/Seasonal** | Featured products, seasonal items, festival specials |
| **Store Assignment** | Automatic assignment to nearest dark store with inventory availability |

#### 7.3.2 Product Pages

| Feature | Details |
|---------|---------|
| **Product Info** | Name, brand, weight/quantity, price, MRP, discount percentage |
| **Images** | Multiple product images |
| **Variants** | Size/weight options |
| **Availability** | Real-time stock status (synced with WMS) |
| **Substitution** | Suggest alternatives if item is out of stock |

#### 7.3.3 Cart and Checkout

| Feature | Details |
|---------|---------|
| **Cart** | Add/remove items, quantity adjustment |
| **Minimum Order** | Minimum cart value for free delivery (varies by city) |
| **Delivery Fee** | Small order surcharge for orders below minimum |
| **Payment** | UPI, Cards, Net Banking, Wallets, COD, Quick Bite Mart Credits |
| **Delivery Time** | Displayed estimated delivery time (typically 10-20 minutes) |
| **Scheduling** | Option to schedule delivery for later time slots |

#### 7.3.4 Order Tracking

| Feature | Details |
|---------|---------|
| **Picking Status** | "Your order is being packed" with item-by-item confirmation |
| **Rider Assignment** | Assigned delivery partner with name and photo |
| **Live Tracking** | Real-time rider location on map |
| **ETA Updates** | Dynamic time remaining |
| **Communication** | Call/chat with delivery partner |

### 7.4 Inventory Management System (WMS)

```
BRAND/SUPPLIER --> Inwarding at Hub --> Hub-to-Dark-Store Replenishment
    --> Dark Store Shelf --> Customer Order --> Pick-Pack-Dispatch
```

| Component | Details |
|-----------|---------|
| **Demand Forecasting** | AI/ML models predict demand at hyper-local, SKU-specific, hourly level |
| **Automated Replenishment** | Reorder triggers based on real-time sales velocity and stock levels |
| **Fill Rate Tracking** | Percentage of orders fulfilled on time and in full (critical supplier KPI) |
| **FEFO Compliance** | First Expiry, First Out inventory rotation |
| **Expiry Tracking** | Automated alerts for items nearing expiry |
| **Shrinkage Management** | Track and minimize inventory loss (damage, theft, expiry) |
| **Real-Time Sync** | WMS syncs stock levels to customer app in real-time |

### 7.5 Logistics and Routing

| Feature | Details |
|---------|---------|
| **Order-to-Store Mapping** | Proprietary algorithm assigns order to nearest dark store with inventory |
| **Rider Assignment** | Similar to Quick Bite -- proximity-based assignment with performance scoring |
| **Route Optimization** | Shortest path calculation considering traffic, one-ways |
| **Batching** | Group nearby deliveries for a single rider |
| **SLA Monitoring** | Real-time tracking of delivery-time promises |

### 7.6 Seller/Brand Portal

| Feature | Details |
|---------|---------|
| **Inventory Inwarding** | Schedule slot-based deliveries to Quick Bite Mart hubs/dark stores |
| **Product Listing** | Manage SKU details, images, pricing |
| **Performance Dashboard** | Sales velocity, fill rates, return rates |
| **Promotional Tools** | In-app product promotions, sponsored placements |
| **Pricing Management** | Set MRP, selling price, promotional pricing |

### 7.7 Revenue Model

| Stream | Details |
|--------|---------|
| **Product Margin** | Difference between purchase price and selling price |
| **Delivery Fee** | Charges on small orders |
| **Advertising** | In-app product promotions and sponsored listings |
| **Quick Bite Mart Plus** | Subscription for free delivery and exclusive deals |
| **Platform Fee** | Small handling/convenience fee per order |

### 7.8 Technology Stack

| Component | Technology |
|-----------|------------|
| **Cloud** | Microsoft Azure |
| **WMS** | Proprietary Warehouse Management System |
| **Forecasting** | ML-based demand prediction models |
| **App** | React Native (cross-platform) |
| **Backend** | Microservices architecture |

---

## 8. PORTAL 6: QUICK BITE EVENTS (Going Out / Events) [PHASE 3 - FROZEN UNTIL FUNDING]

Quick Bite's standalone lifestyle and entertainment platform, launched in 2025 after acquiring Paytm's entertainment and ticketing business.

### 8.1 Strategic Purpose

Quick Bite Events was created to separate the "going-out" vertical from food delivery. Quick Bite's strategy is "super brands, not super app" -- each vertical gets its own dedicated experience.

### 8.2 Core Features

#### 8.2.1 Movie Ticketing

| Feature | Details |
|---------|---------|
| **Cinema Chains** | PVR-INOX, Cinepolis, Miraj, and independent theaters |
| **Movie Discovery** | Now Showing, Coming Soon, trending movies |
| **Show Times** | Browse available shows by date, time, cinema |
| **Seat Selection** | Interactive seat map with real-time availability |
| **Pricing** | Dynamic pricing by seat category, day, time |
| **Combo Deals** | F&B combos offered during booking |
| **Booking Confirmation** | QR code e-ticket |
| **Cancellation** | Cancellation/refund policy per cinema |

#### 8.2.2 Live Events and Ticketing

| Feature | Details |
|---------|---------|
| **Event Categories** | Concerts, comedy shows, music festivals, sports, cultural events, workshops |
| **Event Discovery** | Browse by category, date, location, trending |
| **Ticket Types** | General admission, VIP, early bird, group tickets |
| **Seating** | Venue-specific seat selection where applicable |
| **Artist/Performer Profiles** | Bio, upcoming shows, past events |
| **Social Sharing** | Share events with friends, group booking |

#### 8.2.3 Dining Reservations

| Feature | Details |
|---------|---------|
| **Restaurant Discovery** | Browse restaurants with dining-out focus |
| **Table Booking** | Select date, time, party size |
| **Instant Confirmation** | Real-time availability check |
| **Modification/Cancel** | Change or cancel reservations |
| **Pre-Order** | Option to pre-select menu items |

#### 8.2.4 Splitpay

| Feature | Details |
|---------|---------|
| **Bill Splitting** | Split restaurant bills among group members directly in-app |
| **Individual Payments** | Each person pays their share via their preferred method |
| **Cashback Rewards** | Earn cashback on Splitpay transactions |
| **Payment Methods** | UPI, cards, wallets |

#### 8.2.5 Shopping and Activities

| Feature | Details |
|---------|---------|
| **Attractions** | Book tickets to amusement parks (Wonderla, Imagicaa), water parks, zoos |
| **Sports** | Book sports courts, fitness activities |
| **Shopping Offers** | Deals at partner retail stores |
| **Pay in 3** | No-cost EMI payment option for shopping |

### 8.3 Account Integration

| Feature | Details |
|---------|---------|
| **SSO** | Login with existing Quick Bite or Quick Bite Mart account |
| **Profile Sync** | Shared user profile, payment methods, preferences |
| **Wallet** | Shared wallet/credits across Eternal ecosystem |
| **Recommendations** | Cross-platform recommendations based on combined user behavior |

### 8.4 Competitive Position

Quick Bite Events competes directly with:
- **BookMyShow** (movies and events)
- **Dineout** (dining reservations, now part of Swiggy)
- **Paytm Insider** (events -- acquired by Quick Bite)

---

## 9. PORTAL 7: ADMIN & OPERATIONS PORTAL (QUICK BITE ADMIN)

The internal-only web application used by Quick Bite's operations, support, and management teams.

### 9.1 Core Functions

| Module | Purpose |
|--------|---------|
| **Operations Dashboard** | Real-time view of all active orders, rider locations, restaurant statuses across all cities |
| **City Management** | Configure delivery zones, pricing rules, surge parameters per city/locality |
| **Restaurant Management** | Approve/reject restaurant applications, manage profiles, handle disputes |
| **Partner Management** | Delivery partner onboarding approval, performance monitoring, deactivation |
| **Customer Support** | Ticketing system, complaint resolution, refund processing |
| **Financial Operations** | Commission calculations, restaurant payouts, partner payouts, reconciliation |
| **Content Moderation** | Review moderation queue, photo approval, fake review detection |
| **Analytics** | Company-wide metrics, city-level dashboards, growth tracking |

### 9.2 Restaurant Operations

| Feature | Details |
|---------|---------|
| **Onboarding Queue** | Review and approve pending restaurant applications |
| **KYC Verification** | Validate uploaded documents (FSSAI, PAN, GST) |
| **Commission Configuration** | Set/modify commission rates per restaurant |
| **Performance Monitoring** | Track order acceptance rate, prep times, cancellation rates |
| **Quality Audits** | Flag restaurants with declining quality metrics |
| **Suspension/Delisting** | Temporarily suspend or permanently delist non-compliant restaurants |
| **Menu Review** | Approve menu changes, especially photos |

### 9.3 Delivery Operations

| Feature | Details |
|---------|---------|
| **Fleet Dashboard** | Real-time map of all active delivery partners |
| **Zone Management** | Define and adjust delivery zones and partner density targets |
| **Surge Management** | Configure surge multipliers based on demand/supply ratio |
| **Partner Performance** | Individual partner scorecards, violation tracking |
| **Incident Management** | Handle delivery accidents, complaints, disputes |
| **Payroll/Incentives** | Configure and audit incentive structures |

### 9.4 Customer Support System

| Component | Details |
|-----------|---------|
| **Chatbot (L1)** | AI-powered first line of support for common issues (refund, order status, cancellation) |
| **Live Agents (L2)** | Human support for complex issues escalated from chatbot |
| **Ticket System** | Every interaction creates a trackable ticket with unique ID |
| **Escalation Path** | L1 Chatbot --> L2 Agent --> L3 Supervisor --> Grievance Officer --> Nodal Officer |
| **Refund Authority** | Tiered refund limits (agents can approve up to X, supervisors up to Y) |
| **SLA Tracking** | Response time and resolution time SLAs per ticket priority |
| **Knowledge Base** | Internal wiki of common issues, resolution playbooks, policy guides |

**External Escalation (if unresolved):**
- Email: support@quickbite.com
- Grievance Officer: grievance.officer@quickbite.com
- Nodal Officer: nodal@quickbite.com
- National Consumer Helpline: 1915
- Consumer Forum: Under Consumer Protection Act 2019

### 9.5 Fraud Detection System

| Type | Detection Method |
|------|-----------------|
| **Fake Reviews** | NLP analysis of review text, behavioral pattern detection, account age/activity analysis |
| **Promotional Abuse** | Velocity checks (too many promo redemptions from same device/IP), multi-account detection |
| **Fake Refund Claims** | AI-based image analysis to detect edited/AI-generated photos of "damaged" food |
| **Payment Fraud** | Transaction anomaly detection, chargeback pattern analysis, credential stuffing prevention |
| **Restaurant Fraud** | Order inflation, fake orders for commission gaming, quality misrepresentation |
| **Delivery Fraud** | GPS spoofing detection, delivery time manipulation, false delivery confirmation |

**Fraud Detection Architecture:**

```
Transaction/Event
    |
    v
+-------------------+     +-------------------+     +-------------------+
| Transaction       | --> | Behavioral        | --> | Risk Score        |
| Analyzer          |     | Profiler          |     | Calculator        |
| (real-time)       |     | (pattern matching)|     | (ML model)        |
+-------------------+     +-------------------+     +-------------------+
                                                            |
                                                            v
                                                    +-------------------+
                                                    | Decision Engine   |
                                                    | ALLOW / FLAG /    |
                                                    | BLOCK / REVIEW    |
                                                    +-------------------+
```

### 9.6 Analytics Platform

| Dashboard | Metrics |
|-----------|---------|
| **Executive** | GMV, revenue, order count, active users, NPS, city-level breakdown |
| **Operations** | Avg delivery time, rider utilization, order acceptance rate, cancellation rate |
| **Growth** | New user acquisition, retention cohorts, CAC, LTV |
| **Financial** | Revenue per order, commission revenue, ad revenue, take rate |
| **Quality** | Average rating trends, complaint rate, refund rate |
| **Supply** | Active restaurants, new listings, churn rate, coverage gaps |
| **Demand** | Order density heatmaps, peak hour patterns, cuisine trends |

**Analytics Tech Stack:**
- **OLAP:** ClickHouse, Trino, Druid for high-speed analytical queries
- **Visualization:** Internal dashboards (likely custom-built or Grafana/Metabase)
- **Data Pipeline:** Apache Kafka for event streaming, Spark for batch processing

---

## 10. SYSTEM ARCHITECTURE

### 10.1 Architecture Pattern

Quick Bite uses a **microservices architecture** with **event-driven communication**. Each business domain is an independent service that can be deployed, scaled, and maintained independently.

### 10.2 Complete Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Mobile Frontend** | React Native | Cross-platform iOS and Android apps |
| **Web Frontend** | React.js | Consumer web, partner dashboards |
| **API Gateway** | Custom / Kong / Envoy | Request routing, rate limiting, auth |
| **Service Mesh** | Istio / Envoy | Service-to-service communication, security, observability |
| **Backend Services** | Node.js, Java, Python, Go | Different services use different languages based on needs |
| **Event Streaming** | Apache Kafka | Async event processing, order lifecycle, notifications |
| **Stream Processing** | Apache Flink | Real-time location processing, ETA computation |
| **OLTP Database** | PostgreSQL, MySQL | Transactional data (users, orders, payments) |
| **Document Store** | MongoDB | Flexible schema data (menus, reviews, content) |
| **Wide-Column Store** | Cassandra, DynamoDB | High-write-volume data (location logs, analytics events) |
| **Cache** | Redis | Session management, rider locations, hot data caching |
| **Search Engine** | Elasticsearch | Restaurant search, menu search, full-text search |
| **OLAP Analytics** | ClickHouse, Trino, Druid | Business analytics, dashboards, ad-hoc queries |
| **Object Storage** | AWS S3 / Cloud Storage | Images, videos, static assets |
| **CDN** | CloudFront / Fastly | Static asset delivery, image optimization |
| **Container Runtime** | Docker | Service containerization |
| **Orchestration** | Kubernetes (K8s) | Auto-scaling, service health, deployment management |
| **CI/CD** | Jenkins / GitHub Actions | Automated build, test, deploy pipelines |
| **Monitoring** | Prometheus, Grafana | Infrastructure and application monitoring |
| **Logging** | ELK Stack (Elasticsearch, Logstash, Kibana) | Centralized logging |
| **Error Tracking** | Sentry | Real-time error tracking and alerting |
| **ML Platform** | Custom / SageMaker | Model training, serving, A/B testing |
| **Push Notifications** | FCM (Firebase Cloud Messaging) | Mobile push notifications |
| **SMS** | DLT-registered gateway (TRAI compliant) | OTP, critical alerts |
| **Email** | SendGrid / SES | Transactional and marketing emails |
| **Maps** | Google Maps / MapMyIndia | Navigation, geocoding, distance calculation |

### 10.3 Microservices Inventory

| Service | Responsibility | Key Tech |
|---------|---------------|----------|
| **User Service** | Authentication, profiles, addresses, sessions | Node.js, PostgreSQL, Redis |
| **Restaurant Service** | Restaurant profiles, operating hours, onboarding | Java, PostgreSQL, Elasticsearch |
| **Catalog Service** | Menus, items, pricing, variants, availability | Node.js, MongoDB |
| **Order Service** | Order lifecycle state machine, validation, coordination | Java, PostgreSQL, Kafka |
| **Payment Service** | Payment processing, refunds, wallet, reconciliation | Java, PostgreSQL |
| **Delivery Service** | Rider assignment, tracking, fleet management | Go, Redis, Kafka, Flink |
| **Location Service** | GPS ingestion, geofencing, distance calculation | Go, Redis, Kafka |
| **Search Service** | Full-text search, autocomplete, ranking | Python, Elasticsearch |
| **Recommendation Service** | Personalized restaurant/item recommendations | Python, ML models |
| **Notification Service** | Push, SMS, email, in-app notifications | Node.js, Kafka, FCM |
| **Review Service** | Ratings, reviews, photos, moderation | Node.js, MongoDB, Elasticsearch |
| **Promotion Service** | Coupons, offers, promo code validation | Java, PostgreSQL, Redis |
| **Subscription Service** | Quick Bite Gold management, billing, benefits | Node.js, PostgreSQL |
| **Analytics Service** | Event ingestion, metric computation, dashboards | Python, ClickHouse, Kafka |
| **Fraud Service** | Real-time fraud detection, risk scoring | Python, ML models, Redis |
| **Support Service** | Ticket management, chatbot, escalation | Node.js, PostgreSQL |
| **Content Service** | Image upload, moderation, CDN management | Node.js, S3, CDN |
| **Pricing Service** | Dynamic pricing, surge calculation, fee computation | Python, Redis |
| **ETA Service** | Delivery time prediction, real-time recalculation | Python, ML models, Redis |

### 10.4 Architecture Diagram

```
+------------------------------------------------------------------+
|                        CLIENT LAYER                                |
|  +-------------+ +-------------+ +-------------+ +-------------+  |
|  | Customer    | | Restaurant  | | Delivery    | | Admin       |  |
|  | App (RN)   | | App (RN)   | | App (RN)   | | Web (React) |  |
|  +------+------+ +------+------+ +------+------+ +------+------+  |
+---------|---------------|---------------|---------------|----------+
          |               |               |               |
+---------v---------------v---------------v---------------v----------+
|                    API GATEWAY + LOAD BALANCER                      |
|   (Auth, Rate Limiting, Request Routing, SSL Termination)          |
+--+--------+--------+--------+--------+--------+--------+----------+
   |        |        |        |        |        |        |
   v        v        v        v        v        v        v
+------+ +------+ +------+ +------+ +------+ +------+ +------+
| User | |Rest- | |Order | |Pay-  | |Deliv-| |Notif | |Search|
| Svc  | |aurant| | Svc  | |ment  | |ery   | | Svc  | | Svc  |
+--+---+ |Svc   | +--+---+ |Svc   | |Svc   | +--+---+ +--+---+
   |     +--+---+    |     +--+---+ +--+---+    |        |
   |        |        |        |        |         |        |
   +--------+--------+--------+--------+---------+--------+
                           |
                    +------v------+
                    | APACHE KAFKA|  (Event Bus)
                    +------+------+
                           |
          +----------------+----------------+
          |                |                |
   +------v------+  +-----v------+  +------v------+
   |   Redis     |  | PostgreSQL |  |  MongoDB    |
   | (Cache,     |  | (OLTP,     |  | (Documents, |
   |  Sessions,  |  |  Orders,   |  |  Menus,     |
   |  Locations) |  |  Users)    |  |  Reviews)   |
   +-------------+  +------------+  +-------------+
          |                |
   +------v------+  +-----v------+
   |Elasticsearch|  | ClickHouse |
   | (Search,    |  | (OLAP,     |
   |  Discovery) |  |  Analytics)|
   +-------------+  +------------+
```

### 10.5 Communication Patterns

| Pattern | Use Case | Technology |
|---------|----------|------------|
| **Synchronous REST** | Client-to-service calls (place order, fetch menu) | HTTP/HTTPS + JSON |
| **Synchronous gRPC** | Service-to-service internal calls (low-latency) | gRPC + Protocol Buffers |
| **Async Event-Driven** | Order state changes, notification triggers, analytics events | Apache Kafka |
| **WebSocket** | Real-time rider tracking, order status updates to customer | WebSocket + Redis Pub/Sub |
| **Server-Sent Events (SSE)** | AI response streaming (if applicable) | SSE over HTTP |
| **Batch Processing** | Daily analytics, settlement calculations, report generation | Apache Spark |

### 10.6 Scalability Design

| Challenge | Solution |
|-----------|----------|
| **Peak Hour Load** | Kubernetes horizontal pod autoscaling based on CPU/request metrics |
| **Database Scaling** | Read replicas for read-heavy workloads, sharding for write-heavy tables |
| **Cache Stampede** | Request coalescing (thundering herd protection) on popular cache keys |
| **Location Data Volume** | Cassandra/DynamoDB for high-write-volume location logs |
| **Search Scale** | Elasticsearch cluster with index sharding and replication |
| **Event Processing** | Kafka partition-based parallelism for order processing |
| **Image Serving** | CDN with edge caching, WebP conversion, responsive sizes |
| **Global Availability** | Multi-AZ deployment, database replication across zones |

---

## 11. CORE ALGORITHMS AND ML SYSTEMS

### 11.1 Restaurant Recommendation Engine

**Architecture: Hybrid Multi-Stage System**

```
USER REQUEST (location, time, context)
    |
    v
STAGE 1: CANDIDATE GENERATION (fast filtering)
    - Geographic filter (restaurants within delivery radius)
    - Operational filter (open restaurants with available items)
    - Hard constraint filter (veg mode, dietary preferences)
    - Output: 200-500 candidate restaurants
    |
    v
STAGE 2: RANKING (ML model scoring)
    - Input features per restaurant:
        * User-restaurant interaction history (past orders, clicks, time spent)
        * Restaurant performance metrics (rating, order completion rate, prep time consistency)
        * Real-time signals (current demand, kitchen capacity, delivery time estimate)
        * Contextual signals (time of day, weather, day of week)
        * Content signals (cuisine match to user preferences)
    - Model: Gradient boosted trees (XGBoost/LightGBM) or deep learning ranker
    - Output: Scored and sorted list
    |
    v
STAGE 3: RE-RANKING AND BUSINESS RULES
    - Boost sponsored/promoted restaurants (with "Ad" label)
    - Diversity injection (avoid showing 10 pizza places in a row)
    - New restaurant boost (help new listings get initial visibility)
    - Freshness factor (recent positive momentum weighted higher)
    - Output: Final ranked feed shown to user
```

### 11.2 Search and NLP

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Query Understanding** | Word2Vec, BPE (Byte-Pair Encoding), LSTM | Parse user intent from natural language queries |
| **Spell Correction** | Edit distance + learned corrections | Handle typos ("piza" -> "pizza") |
| **Autocomplete** | Trie data structure + popularity ranking | Suggest completions as user types |
| **Semantic Search** | Embedding-based similarity | Match "best coffee cafe" to relevant results even without exact keyword match |
| **Code-Mixed Language** | Hinglish NLP models | Handle queries like "accha biryani" (Hindi+English mix) |
| **Geospatial Index** | H3 hexagonal cells / Geohash | Millisecond proximity queries |

### 11.3 ETA Prediction System

**Multi-Stage Dynamic Prediction:**

```
ORDER PLACEMENT
    |
    v
INITIAL ETA = Food Prep Time + Rider Assignment Time + Travel Time
    |
    |   (Recalculated at each stage)
    |
    v  RESTAURANT CONFIRMS
REVISED ETA = Actual Prep Estimate + Rider Proximity + Traffic Model
    |
    v  RIDER ASSIGNED
REVISED ETA = Rider-to-Restaurant Time + Prep Remaining + Restaurant-to-Customer Time
    |
    v  RIDER PICKS UP
REVISED ETA = Real-time Route Calculation + Traffic + Last-Mile Estimate
    |
    v  RIDER NEAR CUSTOMER
FINAL ETA = GPS distance / average walking speed + buffer
```

**ML Models Used:**
| Model | Purpose |
|-------|---------|
| **XGBoost / LightGBM** | Primary ETA regression model (tabular features) |
| **Random Forest** | Traffic pattern variability modeling |
| **LSTM (Bidirectional)** | Food Preparation Time prediction (sequential kitchen operations) |
| **Gradient Boosted Trees** | Route time estimation with feature interactions |

**Input Features:**
| Category | Features |
|----------|----------|
| **Geographic** | Haversine distance, route distance, elevation difference |
| **Traffic** | Real-time traffic density, historical traffic patterns for this route/time |
| **Weather** | Rain, fog, extreme heat (from weather API) |
| **Restaurant** | Historical prep times, current order queue depth, cuisine type complexity |
| **Rider** | Historical delivery speed, vehicle type, current location, active order count |
| **Temporal** | Hour of day, day of week, holiday flag, festival flag |
| **Demand** | Current order volume in area, rider supply-demand ratio |

### 11.4 Delivery Partner Assignment Algorithm

**Multi-Dimensional Priority Scoring:**

```python
# Pseudocode for assignment scoring
def calculate_partner_score(partner, order):
    score = 0

    # Distance factor (40% weight)
    distance_to_restaurant = haversine(partner.location, order.restaurant.location)
    score += (1 / distance_to_restaurant) * 0.40

    # Performance factor (25% weight)
    score += partner.completion_rate * 0.10
    score += partner.average_rating * 0.10
    score += partner.on_time_percentage * 0.05

    # Efficiency factor (20% weight)
    current_load = len(partner.active_orders)
    score += (1 / (current_load + 1)) * 0.10
    score += partner.shift_reliability * 0.10

    # Suitability factor (15% weight)
    if order.is_large and partner.vehicle == "4_wheeler":
        score += 0.10
    if order.items_temperature_sensitive and partner.has_hot_bag:
        score += 0.05

    return score
```

### 11.5 Dynamic Pricing / Surge Algorithm

```
SUPPLY (available riders in zone) vs DEMAND (incoming orders in zone)
    |
    v
SURGE_MULTIPLIER = f(demand/supply ratio, time_of_day, weather, zone_history)
    |
    |   Ratio 1:1   --> No surge (1.0x)
    |   Ratio 2:1   --> Mild surge (1.2x-1.5x)
    |   Ratio 3:1+  --> High surge (1.5x-2.0x+)
    |
    v
DELIVERY_FEE = base_fee * surge_multiplier + distance_component
RIDER_PAYOUT = base_payout * surge_multiplier + distance_component + incentive
```

### 11.6 Fraud Detection ML

| Model | Input | Output |
|-------|-------|--------|
| **Transaction Analyzer** | Payment amount, frequency, device fingerprint, IP | Risk score (0-100) |
| **Behavioral Profiler** | Order patterns, promo usage velocity, account age | Abuse probability |
| **Image Verification** | Uploaded photos for refund claims | Authenticity score (real vs. AI-edited) |
| **Review Authenticity** | Review text, reviewer history, timing patterns | Fake probability |
| **Merchant Risk Scorer** | Order inflation patterns, cancellation rates | Restaurant fraud score |

### 11.7 Rating System Algorithm

```
DISPLAYED_RATING != simple_average(all_ratings)

WEIGHTED_RATING = weighted_average(
    weight_by_recency(rating),        # Recent ratings matter more
    weight_by_reviewer_credibility(rating),  # Experienced reviewers weighted higher
    weight_by_order_verification(rating),     # Verified orders rated higher
    penalize_extreme_outliers(rating)         # Remove statistical anomalies
)

MATCH_SCORE (experimental) = personalized_score(
    user_taste_profile,
    restaurant_attributes,
    similar_user_preferences
)
```

---

## 12. DATA MODEL AND DATABASE DESIGN

### 12.1 Core Entities

```
+------------------+     +--------------------+     +------------------+
|      USERS       |     |   RESTAURANTS      |     | DELIVERY_PARTNERS|
|------------------|     |--------------------|     |------------------|
| id (PK)          |     | id (PK)            |     | id (PK)          |
| phone            |     | name               |     | phone            |
| email            |     | description        |     | name             |
| name             |     | cuisine_tags[]     |     | vehicle_type     |
| profile_image_url|     | address            |     | license_number   |
| created_at       |     | latitude           |     | latitude         |
| updated_at       |     | longitude          |     | longitude        |
| is_gold_member   |     | rating             |     | status           |
| gold_expiry      |     | total_reviews      |     | is_active        |
| preferred_lang   |     | cost_for_two       |     | performance_score|
| device_tokens[]  |     | is_active          |     | total_deliveries |
+--------+---------+     | is_veg_only        |     | bank_account_id  |
         |               | fssai_number       |     | created_at       |
         |               | commission_rate    |     +--------+---------+
         |               | opening_hours{}    |              |
         |               | owner_id (FK)      |              |
         |               +--------+-----------+              |
         |                        |                          |
+--------v---------+    +--------v-----------+    +----------v-------+
|   ADDRESSES      |    |   MENU_ITEMS       |    | PARTNER_EARNINGS |
|------------------|    |--------------------|    |------------------|
| id (PK)          |    | id (PK)            |    | id (PK)          |
| user_id (FK)     |    | restaurant_id (FK) |    | partner_id (FK)  |
| label            |    | name               |    | order_id (FK)    |
| address_line_1   |    | description        |    | base_fee         |
| address_line_2   |    | price              |    | distance_fee     |
| city             |    | category           |    | surge_bonus      |
| state            |    | is_veg             |    | tip_amount       |
| pincode          |    | image_url          |    | incentive        |
| latitude         |    | is_available       |    | total_earning    |
| longitude        |    | variants[]         |    | payout_status    |
| is_default       |    | customizations[]   |    | period           |
+------------------+    | display_order      |    +------------------+
                        +--------------------+
```

### 12.2 Order and Transaction Entities

```
+---------------------------+
|          ORDERS            |
|---------------------------|
| id (PK)                   |
| order_number (unique)     |
| user_id (FK)              |
| restaurant_id (FK)        |
| delivery_partner_id (FK)  |
| delivery_address_id (FK)  |
| status (enum)             |
|   [CREATED, CONFIRMED,    |
|    PREPARING, READY,      |
|    ASSIGNED, PICKED_UP,   |
|    OUT_FOR_DELIVERY,      |
|    DELIVERED, CANCELLED,  |
|    REFUNDED]              |
| subtotal                  |
| tax_amount                |
| delivery_fee              |
| packaging_charge          |
| platform_fee              |
| discount_amount           |
| tip_amount                |
| total_amount              |
| payment_method            |
| payment_status            |
| coupon_code               |
| cooking_instructions      |
| estimated_delivery_time   |
| actual_delivery_time      |
| placed_at                 |
| confirmed_at              |
| prepared_at               |
| picked_up_at              |
| delivered_at              |
| cancelled_at              |
| cancellation_reason       |
| is_scheduled              |
| scheduled_for             |
+-------------+-------------+
              |
    +---------+---------+
    |                   |
+---v-----------+  +----v-----------+
| ORDER_ITEMS   |  | ORDER_TIMELINE |
|---------------|  |----------------|
| id (PK)       |  | id (PK)        |
| order_id (FK) |  | order_id (FK)  |
| item_id (FK)  |  | status         |
| item_name     |  | timestamp      |
| quantity      |  | metadata{}     |
| unit_price    |  +----------------+
| total_price   |
| variants[]    |
| customizations|
| special_instr |
+---------------+

+-------------------+     +-------------------+
|    PAYMENTS       |     |    REFUNDS        |
|-------------------|     |-------------------|
| id (PK)           |     | id (PK)           |
| order_id (FK)     |     | order_id (FK)     |
| user_id (FK)      |     | payment_id (FK)   |
| amount            |     | amount            |
| method (enum)     |     | reason            |
| provider          |     | status            |
| provider_txn_id   |     | refund_to (enum)  |
| status (enum)     |     |   [ORIGINAL_METHOD|
| idempotency_key   |     |    WALLET_CREDITS]|
| metadata{}        |     | processed_at      |
| created_at        |     | created_at        |
| updated_at        |     +-------------------+
+-------------------+
```

### 12.3 Review and Rating Entities

```
+-------------------+     +-------------------+
|    REVIEWS        |     |  REVIEW_PHOTOS    |
|-------------------|     |-------------------|
| id (PK)           |     | id (PK)           |
| user_id (FK)      |     | review_id (FK)    |
| restaurant_id(FK) |     | image_url         |
| order_id (FK)     |     | thumbnail_url     |
| food_rating       |     | created_at        |
| delivery_rating   |     +-------------------+
| overall_rating    |
| review_text       |
| is_verified_order |
| helpful_count     |
| reported_count    |
| restaurant_reply  |
| reply_at          |
| is_flagged        |
| moderation_status |
| created_at        |
| updated_at        |
+-------------------+
```

### 12.4 Subscription and Promotions

```
+---------------------+     +-------------------+
| GOLD_SUBSCRIPTIONS  |     |    COUPONS        |
|---------------------|     |-------------------|
| id (PK)             |     | id (PK)           |
| user_id (FK)        |     | code (unique)     |
| plan_type           |     | description       |
| start_date          |     | discount_type     |
| end_date            |     |   [PERCENTAGE,    |
| amount_paid         |     |    FLAT_OFF]      |
| payment_id (FK)     |     | discount_value    |
| is_auto_renew       |     | max_discount      |
| status              |     | min_order_value   |
| source              |     | valid_from        |
|   [DIRECT, CREDIT   |     | valid_until       |
|    CARD_BUNDLED,     |     | usage_limit       |
|    PROMOTIONAL]     |     | per_user_limit    |
| created_at          |     | restaurant_id(FK) |
+---------------------+     |   (null = global) |
                             | is_active         |
                             | created_by        |
                             | target_segment    |
                             +-------------------+

+---------------------+
| COUPON_REDEMPTIONS  |
|---------------------|
| id (PK)             |
| coupon_id (FK)      |
| user_id (FK)        |
| order_id (FK)       |
| discount_applied    |
| redeemed_at         |
+---------------------+
```

### 12.5 Location and Tracking

```
+-------------------------+
| RIDER_LOCATION_LOG      |
|-------------------------|
| id (PK)                 |
| partner_id (FK)         |
| latitude                |
| longitude               |
| accuracy                |
| speed                   |
| bearing                 |
| timestamp               |
| order_id (FK, nullable) |
+-------------------------+
  (High-write table: Cassandra/DynamoDB)

+-------------------------+
| RIDER_CURRENT_LOCATION  |
|-------------------------|
| partner_id (PK)         |
| latitude                |
| longitude               |
| last_updated            |
+-------------------------+
  (Hot data: Redis with geo commands)
```

### 12.6 Notification Entities

```
+-------------------------+
| NOTIFICATIONS           |
|-------------------------|
| id (PK)                 |
| user_id (FK)            |
| type (enum)             |
|   [ORDER_UPDATE,        |
|    PROMOTION, REVIEW,   |
|    SYSTEM, MARKETING]   |
| title                   |
| body                    |
| image_url               |
| deep_link               |
| channel (enum)          |
|   [PUSH, SMS, EMAIL,    |
|    IN_APP]              |
| status (enum)           |
|   [PENDING, SENT,       |
|    DELIVERED, READ,     |
|    FAILED]              |
| sent_at                 |
| read_at                 |
| metadata{}              |
+-------------------------+
```

### 12.7 Key Indexes

| Table | Index | Purpose |
|-------|-------|---------|
| users | phone | Login lookup |
| users | email | Login lookup |
| orders | user_id, created_at DESC | Order history |
| orders | restaurant_id, status | Restaurant active orders |
| orders | delivery_partner_id, status | Rider active orders |
| menu_items | restaurant_id, category | Menu display |
| menu_items | restaurant_id, is_available | Available items filter |
| reviews | restaurant_id, created_at DESC | Restaurant reviews |
| rider_location_log | partner_id, timestamp DESC | Location history |
| payments | order_id | Payment lookup |
| payments | idempotency_key | Duplicate prevention |
| coupon_redemptions | user_id, coupon_id | Per-user usage check |
| notifications | user_id, created_at DESC | User notification feed |

### 12.8 Entity Relationship Summary

```
USER --1:N--> ADDRESSES
USER --1:N--> ORDERS
USER --1:N--> REVIEWS
USER --1:1--> GOLD_SUBSCRIPTION
USER --1:N--> NOTIFICATIONS

RESTAURANT --1:N--> MENU_ITEMS
RESTAURANT --1:N--> ORDERS
RESTAURANT --1:N--> REVIEWS
RESTAURANT --1:N--> COUPONS (restaurant-specific)

ORDER --1:N--> ORDER_ITEMS
ORDER --1:N--> ORDER_TIMELINE
ORDER --1:1--> PAYMENT
ORDER --0:1--> REFUND
ORDER --N:1--> USER
ORDER --N:1--> RESTAURANT
ORDER --N:1--> DELIVERY_PARTNER
ORDER --N:1--> ADDRESS

DELIVERY_PARTNER --1:N--> ORDERS
DELIVERY_PARTNER --1:N--> PARTNER_EARNINGS
DELIVERY_PARTNER --1:N--> RIDER_LOCATION_LOG

COUPON --1:N--> COUPON_REDEMPTIONS
```

---

## 13. INTER-PORTAL CONNECTIVITY MAP

This section maps every data flow and connection between the 7 portals.

### 13.1 Complete Connectivity Matrix

| From | To | Data Flow | Trigger | Protocol |
|------|----|-----------|---------|----------|
| **Customer App** | **Order Service** | Place order (items, address, payment) | User taps "Place Order" | REST API |
| **Order Service** | **Restaurant App** | New order notification | Order created | Kafka event -> Push notification |
| **Restaurant App** | **Order Service** | Accept/reject order, prep time update | Restaurant action | REST API |
| **Order Service** | **Delivery Service** | Assign delivery partner | Restaurant confirms order | Kafka event |
| **Delivery Service** | **Delivery App** | Order assignment notification | Partner selected by algorithm | Push notification |
| **Delivery App** | **Location Service** | GPS coordinates stream | Every 3-5 seconds during active delivery | gRPC / HTTP |
| **Location Service** | **Customer App** | Rider location updates | Location received | WebSocket |
| **Order Service** | **Customer App** | Order status changes | Each state transition | WebSocket + Push notification |
| **Order Service** | **Notification Service** | Status update events | State machine transition | Kafka event |
| **Notification Service** | **Customer App** | Push/SMS/Email notifications | Event consumed | FCM / SMS Gateway / Email |
| **Customer App** | **Payment Service** | Payment initiation | Checkout | REST API |
| **Payment Service** | **Payment Gateway** | Charge processing | Payment initiated | REST API (Razorpay/Custom) |
| **Payment Service** | **Order Service** | Payment confirmation | Charge successful | Kafka event |
| **Customer App** | **Review Service** | Submit rating/review | Post-delivery | REST API |
| **Review Service** | **Restaurant App** | New review notification | Review submitted | Push notification |
| **Restaurant App** | **Quick Bite Supply** | Supply order | Restaurant orders ingredients | Deep link / API |
| **Quick Bite Supply** | **Restaurant** | Delivery of supplies | Order fulfilled | Physical delivery + app tracking |
| **Admin Portal** | **All Services** | Configuration, moderation, overrides | Admin actions | Internal REST APIs |
| **Customer App** | **Quick Bite Events** | Account sync, cross-promotion | SSO link | OAuth / Shared session |
| **Customer App** | **Quick Bite Mart** | Account sync, cross-promotion | SSO link | OAuth / Shared session |
| **Analytics Service** | **Admin Portal** | Dashboards, metrics | Continuous | WebSocket / Polling |
| **Fraud Service** | **Order/Payment/Review Services** | Block/flag actions | Anomaly detected | Kafka event + API |
| **Promotion Service** | **Customer App** | Available coupons for user | Cart loaded / coupon page opened | REST API |
| **Customer App** | **Search Service** | Search queries | User types in search bar | REST API |
| **Search Service** | **Recommendation Service** | User context for ranking | Search executed | Internal RPC |

### 13.2 Order Flow: Complete End-to-End Data Path

```
CUSTOMER APP                 BACKEND                    RESTAURANT APP
     |                          |                            |
     |--- Place Order --------->|                            |
     |                          |--- Validate Order          |
     |                          |--- Process Payment ------->|--- (Payment Gateway)
     |                          |<-- Payment Confirmed ------|
     |                          |--- Create Order Record     |
     |                          |--- Publish ORDER_CREATED -->|--- (Kafka)
     |                          |                            |
     |                          |--- Push Notification ------>|
     |                          |                            |--- Restaurant sees new order
     |                          |                            |
     |                          |<-- Accept Order ------------|
     |                          |--- Update: CONFIRMED       |
     |<-- Status: Confirmed ----|                            |
     |    (WebSocket + Push)    |                            |
     |                          |                            |--- Kitchen prepares food
     |                          |<-- Update: PREPARING ------|
     |<-- Status: Preparing ----|                            |
     |                          |                            |
     |                          |--- Assign Delivery ------->|--- (Delivery Service)
     |                          |                            |
     |                          |                     DELIVERY APP
     |                          |                            |
     |                          |--- Push: New Order -------->|
     |                          |<-- Accept Assignment -------|
     |<-- Rider Assigned -------|                            |
     |                          |                            |
     |                          |<-- Update: READY ----------|  (Restaurant App)
     |<-- Status: Ready --------|                            |
     |                          |                            |
     |                          |<-- Rider at Restaurant ----|  (Delivery App)
     |                          |<-- Order Picked Up --------|
     |<-- Status: Picked Up ----|                            |
     |                          |                            |
     |<-- Live Location --------|<-- GPS Stream -------------|  (every 3-5s)
     |    (WebSocket)           |    (Location Service)      |
     |                          |                            |
     |                          |<-- Delivered --------------|
     |<-- Status: Delivered ----|                            |
     |    (Push Notification)   |                            |
     |                          |--- Settlement Calculation  |
     |                          |--- Restaurant Payout Queue |
     |                          |--- Rider Earnings Record   |
     |                          |                            |
     |--- Rate & Review ------->|                            |
     |                          |--- Update Restaurant Score |
     |                          |--- Notify Restaurant ------>|  (Restaurant App)
```

### 13.3 Shared Infrastructure Between Portals

| Shared Component | Used By | Purpose |
|------------------|---------|---------|
| **User Identity Service** | Quick Bite, Quick Bite Mart, Quick Bite Events | SSO, single account across all apps |
| **Payment Service** | Quick Bite, Quick Bite Mart, Quick Bite Events | Unified payment processing |
| **Wallet/Credits** | Quick Bite, Quick Bite Mart, Quick Bite Events | Shared wallet balance |
| **Notification Service** | All portals | Centralized notification delivery |
| **Analytics Pipeline** | All portals | Unified event tracking and dashboards |
| **Fraud Detection** | Quick Bite, Quick Bite Mart | Shared fraud models and blacklists |
| **Logistics Network** | Quick Bite, Quick Bite Mart | Shared delivery partner pool in some cases |
| **Quick Bite Supply Warehousing** | Quick Bite Supply, Quick Bite Mart | Shared supply chain infrastructure |
| **CDN / Image Service** | All portals | Shared image storage, processing, serving |
| **Map / Geocoding Service** | All portals | Shared location services |

---

## 14. PAYMENT INFRASTRUCTURE

### 14.1 Payment Methods Supported

| Method | Provider | Integration |
|--------|----------|-------------|
| **UPI** | Google Pay, PhonePe, Paytm, Quick Bite UPI (ICICI) | Intent-based deep link / collect request |
| **Credit Cards** | Visa, Mastercard, Amex, RuPay | Tokenized card storage, PCI DSS compliant |
| **Debit Cards** | All major banks | Same as credit cards |
| **Net Banking** | 50+ banks | Redirect-based flow |
| **Wallets** | Paytm Wallet, PhonePe Wallet, others | Wallet SDK integration |
| **Cash on Delivery** | Physical cash | Collected by delivery partner, reconciled |
| **Quick Bite Credits/Wallet** | Internal | Refund credits, promotional balance |

### 14.2 Payment Gateway

- **Primary:** Quick Bite Payments Private Limited (RBI-licensed payment aggregator, 2024)
- **Secondary/Fallback:** Razorpay (for certain payment modes)
- **Strategy:** Quick Bite is moving toward owning its payment infrastructure to reduce dependency on third-party gateways and lower transaction costs.

### 14.3 Payment Lifecycle

```
INITIATE PAYMENT
    |
    v
GENERATE IDEMPOTENCY KEY (client-generated UUID)
    |
    v
CHECK IDEMPOTENCY (has this key been processed before?)
    |--- YES --> Return cached result (prevent double charge)
    |--- NO  --> Continue
    |
    v
CREATE PAYMENT RECORD (status: PENDING)
    |
    v
SEND TO PAYMENT GATEWAY
    |
    +--- SUCCESS --> Update status: COMPLETED
    |                Publish PAYMENT_SUCCESS event
    |                Proceed with order creation
    |
    +--- FAILURE --> Update status: FAILED
    |                Return error to user
    |                Retry option shown
    |
    +--- TIMEOUT --> Update status: PENDING_VERIFICATION
                     Poll gateway for status
                     Resolve after confirmation
```

### 14.4 Settlement Flow (Restaurant Payouts)

```
ORDER DELIVERED
    |
    v
CALCULATE SETTLEMENT:
    Order Total
    - Platform Commission (18-28%)
    - GST on Commission (18% of commission)
    - Payment Gateway Fee (1.5-2%)
    - Ad Charges (if any)
    - Promotion Cost Share (if discount was split)
    + Tips (passed through to rider, not restaurant)
    = NET PAYOUT TO RESTAURANT
    |
    v
AGGREGATE WEEKLY
    |
    v
BANK TRANSFER (NEFT/IMPS)
    |
    v
SETTLEMENT REPORT (itemized, GST-compliant)
```

### 14.5 Refund Flow

| Scenario | Refund Method | Timeline |
|----------|---------------|----------|
| **Order Cancelled (pre-confirmation)** | Original payment method | 3-5 business days |
| **Order Cancelled (post-confirmation)** | Quick Bite Credits (partial) | Instant |
| **Quality Issue** | Quick Bite Credits or original method (based on severity) | Instant to 5 days |
| **Missing Items** | Proportional refund to original method | 3-5 business days |
| **Wrong Items** | Full refund + re-order option | 3-5 business days |
| **Late Delivery** | Quick Bite Credits (small compensation) | Instant |

---

## 15. NOTIFICATION INFRASTRUCTURE

### 15.1 Event-Driven Architecture

```
BUSINESS EVENT (e.g., OrderConfirmed)
    |
    v
PUBLISH TO KAFKA TOPIC (order.events)
    |
    v
NOTIFICATION SERVICE (Consumer)
    |
    +--- Determine notification type
    +--- Determine target user(s)
    +--- Determine channel(s) (Push / SMS / Email / In-App)
    +--- Apply user preferences (opt-in/opt-out)
    +--- Apply rate limiting (no spam)
    +--- Personalize content
    +--- Dispatch to appropriate channel
```

### 15.2 Notification Channels

| Channel | Technology | Use Cases | Latency |
|---------|-----------|-----------|---------|
| **Push Notification** | FCM (Android), APNs (iOS) | Order updates, promotions, re-engagement | <1 second |
| **SMS** | DLT-registered gateway (TRAI compliant) | OTP, critical order issues | <3 seconds |
| **Email** | SendGrid / Amazon SES | Order receipts, marketing campaigns, newsletters | <30 seconds |
| **In-App** | WebSocket / API pull | Real-time status updates, offers | <1 second |

### 15.3 Notification Types

| Category | Events | Target |
|----------|--------|--------|
| **Order Lifecycle** | Placed, Confirmed, Preparing, Picked Up, Delivered, Cancelled | Customer |
| **Rider Assignment** | New order, pickup reminder | Delivery Partner |
| **Restaurant Orders** | New order, customer cancel | Restaurant |
| **Promotions** | New offers, personalized deals, flash sales | Customer |
| **Reviews** | New review received, reply to your review | Restaurant, Customer |
| **Account** | OTP, password reset, subscription changes | Customer |
| **Re-engagement** | "Missing you!", cart abandonment, meal-time nudges | Customer |
| **System** | App updates, policy changes, maintenance | All |

### 15.4 Personalization Engine

| Signal | Use |
|--------|-----|
| **User Persona** | "Late-night snacker", "Weekend foodie", "Health-conscious" |
| **Order History** | Recommend based on past orders |
| **Time Windows** | Send notifications during user's typical ordering hours |
| **Weather** | "Rainy day? Warm soup delivered in 30 min" |
| **Abandoned Cart** | "Your biryani is waiting!" |
| **Frequency Cap** | Max 3-5 promotional notifications per day per user |

---

## 16. SECURITY AND FRAUD DETECTION

### 16.1 Authentication Security

| Layer | Implementation |
|-------|---------------|
| **OTP** | SMS-based, 6-digit, 60-second expiry, rate-limited (3 attempts per 10 minutes) |
| **Token** | JWT with short-lived access tokens (15-30 min) + long-lived refresh tokens |
| **Token Storage** | Secure storage (iOS Keychain / Android Keystore) |
| **Session** | Multi-device support, force logout capability |
| **Number Masking** | Customer-rider calls use virtual/masked numbers |
| **Device Fingerprinting** | Track device ID for fraud detection, multi-account prevention |

### 16.2 API Security

| Measure | Details |
|---------|---------|
| **HTTPS Everywhere** | TLS 1.3, certificate pinning in mobile apps |
| **API Gateway** | Rate limiting, request validation, DDoS protection |
| **Input Validation** | Schema validation on all endpoints (Joi/Zod/Pydantic) |
| **Parameterized Queries** | No SQL concatenation, ORM-based or prepared statements |
| **CORS** | Whitelist-only origins for web clients |
| **Security Headers** | CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| **API Versioning** | /api/v1/, /api/v2/ with backward compatibility |
| **Request Size Limits** | Body size limits per endpoint |

### 16.3 Data Security

| Measure | Details |
|---------|---------|
| **Encryption at Rest** | Database-level encryption, encrypted backups |
| **Encryption in Transit** | TLS for all communication, including internal services |
| **PCI DSS Compliance** | Payment data handled by certified payment processors |
| **PII Protection** | Personal data access-controlled, audit-logged |
| **Data Retention** | Defined retention periods per data type |
| **GDPR/India Data Protection** | Data deletion requests, data portability |

### 16.4 Fraud Prevention

| Fraud Type | Prevention Mechanism |
|------------|---------------------|
| **Account Takeover** | OTP verification, device fingerprinting, suspicious login alerts |
| **Multi-Accounting** | Device ID tracking, phone number linking, behavioral clustering |
| **Promo Abuse** | Velocity checks, device/IP deduplication, ML-based abuse detection |
| **Fake Reviews** | NLP text analysis, account credibility scoring, verified-order requirement |
| **Fake Refund Claims** | AI image analysis for edited/AI-generated photos, claim pattern analysis |
| **Restaurant Fraud** | Order inflation detection, cancellation pattern analysis |
| **Rider GPS Spoofing** | GPS consistency checks, accelerometer validation, route plausibility |
| **Payment Fraud** | Transaction risk scoring, card BIN analysis, velocity checks |
| **Credential Stuffing** | Rate limiting on login, CAPTCHA triggers, IP reputation |

---

## 17. PROMOTIONS AND ADVERTISING ENGINE

### 17.1 Coupon/Promo Code System

```
USER APPLIES COUPON
    |
    v
VALIDATE:
    - Code exists and is active
    - Within valid date range
    - User has not exceeded per-user limit
    - Order meets minimum order value
    - Restaurant is eligible (if restaurant-specific)
    - User segment matches (all / new / repeat)
    |
    +--- VALID --> Calculate discount, apply to order total
    +--- INVALID --> Return specific error message
```

### 17.2 Promotion Types

| Type | Description | Funded By |
|------|-------------|-----------|
| **Percentage Off** | e.g., 50% off up to Rs 100 | Restaurant + Quick Bite (split) |
| **Flat Off** | e.g., Rs 75 off on orders above Rs 300 | Restaurant + Quick Bite (split) |
| **Free Delivery** | Waive delivery fee | Quick Bite |
| **BOGO** | Buy 1 Get 1 on specific items | Restaurant |
| **First Order** | Special discount for new users | Quick Bite |
| **Wallet Cashback** | Cashback to Quick Bite Credits | Quick Bite |
| **Bank Offers** | Additional discount on specific bank cards | Bank partner |

### 17.3 Restaurant Advertising System

| Ad Product | Model | Placement |
|------------|-------|-----------|
| **Sponsored Listings** | CPC (Cost-Per-Click) | Search results, category pages, home feed |
| **Banner Ads** | CPM (Cost-Per-Thousand-Impressions) | Home screen carousel |
| **Featured Collections** | Fixed fee | Curated collection pages |
| **Social Media Ads** | CPC via Quick Bite's ad manager | Facebook/Instagram driving traffic to Quick Bite listing |

### 17.4 Psychological UX Triggers

| Trigger | Implementation |
|---------|---------------|
| **Countdown Timer** | "Offer expires in 4:32" on coupon cards |
| **Hidden Coupons** | Gamified "scratch card" or "treasure box" reveal |
| **Scarcity** | "Only 3 left at this price" |
| **Social Proof** | "432 people ordered from here today" |
| **Personalized Deals** | "We picked these offers for you" based on order history |

---

## 18. REPLICATION REQUIREMENTS SUMMARY

### 18.1 Minimum Viable Portals for Replication

| Priority | Portal | Justification |
|----------|--------|---------------|
| **P0 (Must Have)** | Customer App | Core consumer experience |
| **P0 (Must Have)** | Restaurant Partner Portal | Supply side -- without restaurants, no platform |
| **P0 (Must Have)** | Quick Bite Rider App | Logistics -- without riders, no delivery |
| **P0 (Must Have)** | Admin Portal | Operations management, cannot run without it |
| **P1 (Phase 2)** | Quick Bite Mart-equivalent | Quick commerce is a separate business vertical |
| **P2 (Phase 3)** | Quick Bite Supply-equivalent | B2B supply chain, can launch later |
| **P2 (Phase 3)** | Quick Bite Events-equivalent | Events/entertainment, independent vertical |

### 18.2 Core Systems to Build (Dependency Order)

```
1. User Identity + Auth Service          (foundation for everything)
2. Restaurant + Menu Service             (supply side content)
3. Search + Discovery Service            (how users find restaurants)
4. Order Service + State Machine         (core transaction flow)
5. Payment Service                       (money handling)
6. Delivery Assignment + Tracking        (logistics)
7. Notification Service                  (communication backbone)
8. Rating + Review Service               (trust and quality)
9. Promotion + Coupon Engine             (growth tool)
10. Admin + Operations Dashboard         (management layer)
11. Analytics Pipeline                   (data-driven decisions)
12. Fraud Detection                      (platform integrity)
```

### 18.3 Recommended Tech Stack for Replication

| Layer | Recommended Technology | Why |
|-------|----------------------|-----|
| **Mobile Apps** | React Native or Flutter | Cross-platform, single codebase |
| **Web Frontend** | React.js + Next.js | SEO for discovery, rich SPA for dashboards |
| **API Gateway** | Kong or custom Node.js gateway | Routing, rate limiting, auth |
| **Core Backend** | Node.js (Express/Fastify) or Go | Fast development, excellent async handling |
| **Order/Payment** | Java (Spring Boot) or Node.js | Transaction safety, strong typing |
| **ML Services** | Python (FastAPI) | ML ecosystem, model serving |
| **Event Streaming** | Apache Kafka or Redis Streams | Async communication, event sourcing |
| **OLTP Database** | PostgreSQL + PostGIS | Relational data + geospatial queries |
| **Document Store** | MongoDB | Flexible schemas (menus, reviews) |
| **Cache** | Redis | Sessions, locations, hot data |
| **Search** | Elasticsearch or Meilisearch | Full-text search, autocomplete |
| **Real-Time** | WebSocket (Socket.io) | Live tracking, order updates |
| **Push Notifications** | Firebase Cloud Messaging | Cross-platform push |
| **SMS** | MSG91 or Twilio (with DLT for India) | OTP, alerts |
| **Email** | SendGrid or Amazon SES | Transactional + marketing |
| **Storage** | AWS S3 or Cloudflare R2 | Images, documents |
| **CDN** | CloudFront or Cloudflare | Static asset delivery |
| **Maps** | Google Maps API or MapMyIndia | Geocoding, routing, display |
| **Payments** | Razorpay (India) | UPI, cards, net banking |
| **Container Orchestration** | Docker + Kubernetes | Deployment, scaling |
| **CI/CD** | GitHub Actions | Automated pipelines |
| **Monitoring** | Prometheus + Grafana | Metrics and alerting |
| **Logging** | ELK Stack or Loki | Centralized log management |
| **Error Tracking** | Sentry | Real-time error tracking |

### 18.4 Estimated Build Complexity

| Component | Complexity | Estimated Effort | Notes |
|-----------|-----------|------------------|-------|
| Customer App (MVP) | XL | 3-4 months (team of 4) | Most feature-rich portal |
| Restaurant Partner App | L | 2-3 months (team of 2) | Dashboard + order management |
| Quick Bite Rider App | L | 2-3 months (team of 2) | GPS tracking is complex |
| Backend Services (all) | XXL | 4-6 months (team of 4) | 15+ microservices |
| Admin Dashboard | L | 2-3 months (team of 2) | Internal tooling |
| ML/Algorithm Layer | XL | 3-4 months (team of 2) | Recommendation, ETA, search |
| Payment Integration | M | 1-2 months (team of 1) | Using Razorpay simplifies this |
| DevOps/Infrastructure | L | 1-2 months (team of 1) | K8s, CI/CD, monitoring |
| **TOTAL MVP** | **XXL** | **6-9 months** | **Team of 8-12 engineers** |

### 18.5 Key Challenges for Replication

| Challenge | Why It Is Hard | Mitigation |
|-----------|---------------|------------|
| **Real-Time Tracking** | High-frequency GPS data (every 3-5s from every active rider), WebSocket management at scale | Use Redis for latest location, Kafka for event stream, WebSocket rooms per order |
| **ETA Accuracy** | Requires ML model trained on millions of historical deliveries | Start with simple distance/time formula, improve with data over time |
| **Search Relevance** | Multi-signal ranking, NLP for query understanding | Start with Elasticsearch, add ML ranking later |
| **Fraud Prevention** | Evolving attack vectors, requires large data sets | Start with rule-based detection, add ML models as data grows |
| **Payment Reliability** | Double-charge prevention, refund handling, reconciliation | Idempotency keys, transaction state machine, webhook verification |
| **Scale** | Handling millions of concurrent users, orders, location updates | Start with monolith, decompose to microservices as needed |
| **Cold Start** | No restaurants or riders at launch | Focus on specific city/locality, manual onboarding, seed data |

### 18.6 Legal and Compliance Requirements (India)

| Requirement | Details |
|-------------|---------|
| **FSSAI** | Food safety compliance for all listed restaurants |
| **GST** | Tax calculation and reporting on commissions and services |
| **TRAI DLT** | Mandatory registration for sending SMS/OTP to Indian numbers |
| **RBI** | Payment aggregator licensing for handling payments |
| **IT Act** | Data protection, intermediary guidelines |
| **Consumer Protection Act** | Grievance redressal mechanism, refund policies |
| **Labor Laws** | Gig worker classification, insurance, safety |
| **Privacy Policy** | Clear data collection, usage, and sharing disclosure |
| **Terms of Service** | Platform usage terms, liability limitations |

---

**END OF RESEARCH DOCUMENT**

This document provides the complete foundation needed to understand and replicate the Quick Bite platform. Each portal's features, every inter-portal connection, the underlying architecture, core algorithms, data model, and infrastructure have been documented in sufficient detail to serve as a replication blueprint.