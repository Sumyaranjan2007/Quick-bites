# Quick Bite Platform -- Technical Architecture Document (TAD)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Architecture & Engineering Team  

---

## 1. System Architecture Overview

Quick Bite is designed as a modular monolith backend supporting three distinct frontend clients. The architecture decouples client interfaces while centralizing data consistency, business validation, and real-time state machines in a single, high-efficiency Node.js + TypeScript service layer.

### System Architecture Diagram (ASCII)

```
+----------------------------------------------------------------------------------------------------+
|                                         CLIENT LAYER                                               |
|                                                                                                    |
|  +---------------------------+   +-------------------------------+   +--------------------------+  |
|  |       Customer App        |   |   Restaurant Partner Portal   |   |     Admin Dashboard      |  |
|  |    (React Native/Expo)    |   |      (React 18 + Vite Web)    |   |   (React 18 + Vite Web)  |  |
|  |     [Android / iOS]       |   |      [Desktop/Tablet Web]     |   |       [Desktop Web]      |  |
|  +-------------+-------------+   +---------------+---------------+   +------------+-------------+  |
+----------------|---------------------------------|--------------------------------|----------------+
                 | HTTPS / WSS                     | HTTPS / WSS                    | HTTPS / WSS
                 v                                 v                                v
+----------------------------------------------------------------------------------------------------+
|                                 EDGE & TRAFFIC MANAGEMENT (Cloudflare)                             |
|                                                                                                    |
|  * TLS 1.3 Termination  * DDoS Protection  * Edge Caching (Static Assets)  * GeoIP Headers         |
+--------------------------------------------------+-------------------------------------------------+
                                                   | Reverse Proxy
                                                   v
+----------------------------------------------------------------------------------------------------+
|                                BACKEND CORE API (Node.js + Express)                                |
|                                                                                                    |
|  +----------------------------------------------------------------------------------------------+  |
|  |                                  GLOBAL MIDDLEWARE PIPELINE                                  |  |
|  |  * Security Headers (Helmet)  * CORS Whitelist  * JSON Parser  * Rate Limiter (Token Bucket) |  |
|  |  * Correlation ID Generator   * Supabase JWT Verifier (Auth)   * Zod Request Validator       |  |
|  |  * Global Error Boundary Handler                                                             |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                  |                                                 |
|  +-----------------------------------------------+-------------------------------------------+  |
|  |                                    DOMAIN MODULE SERVICES                                 |  |
|  |                                                                                           |  |
|  |  [Auth Module]       [Restaurant Catalog]    [Menu & Inventory]    [Cart & Pricing Engine] |  |
|  |  [Order State Mach]  [Payment & Settlement]  [Review & Rating]     [Coupon & Promo Engine] |  |
|  |  [Delivery Dispatch] [Dining Reservation]    [Admin & Fraud Radar] [Notification Engine]  |  |
|  +-----------------------------------------------+-------------------------------------------+  |
|                                                  |                                                 |
|  +-----------------------------------------------+-------------------------------------------+  |
|  |                           REAL-TIME WEBSOCKET HUB (Socket.io)                             |  |
|  |  * Room Isolation: order:<id> | restaurant:<id> | rider:<id> | admin:broadcast            |  |
|  |  * Heartbeat / Ping-Pong (25s) * Reconnect Backoff * Event Broker Interface               |  |
|  +----------------------------------------------------------------------------------------------+  |
+-------------------+------------------------------+-----------------------------+-------------------+
                    |                              |                             |
                    v                              v                             v
+-----------------------+      +-----------------------+      +----------------------+
|  RELATIONAL STORAGE   |      |   DOCUMENT STORAGE    |      |    IN-MEMORY CACHE   |
|  (Supabase PostgreSQL)|      |  (MongoDB Atlas M0)   |      |   (Upstash Redis)    |
|                       |      |                       |      |                      |
| * Users & Auth RLS    |      | * Dynamic Menu Items  |      | * Session Cache      |
| * Orders & Line Items |      | * Customization Trees |      | * Token Bucket Limits|
| * Ledger & Settlements|      | * Review Texts & UGC  |      | * Live Geolocation   |
| * PostGIS Geofencing  |      | * Audit Activity Logs |      | * Active Order State |
+-----------------------+      +-----------------------+      +----------------------+
                    |                              |                             |
                    +------------------------------+-----------------------------+
                                                   |
                                                   v
+----------------------------------------------------------------------------------------------------+
|                                    THIRD-PARTY INTEGRATION FABRIC                                  |
|                                                                                                    |
|  +--------------------+  +--------------------+  +--------------------+  +----------------------+  |
|  | Razorpay (Sandbox) |  |   Cloudflare R2    |  |  Meilisearch Cloud |  | OpenStreetMap / OSRM |  |
|  | * Simulated UPI    |  | * Menu Photos      |  | * Typo-Tolerant    |  | * Reverse Geocoding  |  |
|  | * Cards / Netbank  |  | * KYC Documents    |  |   Search Index     |  | * Routing & Distance |  |
|  | * Signature Verify |  | * Zero Egress Fees |  | * Sub-50ms Query   |  | * Polylines          |  |
|  +--------------------+  +--------------------+  +--------------------+  +----------------------+  |
|                                                                                                    |
|  +--------------------------------------------+  +----------------------------------------------+  |
|  |         Firebase Cloud Messaging (FCM)     |  |                  Resend                      |  |
|  | * Background Push Notifications            |  | * Transactional Email & OTP Delivery         |  |
|  | * Mobile Device Tokens                     |  | * PDF Order Invoices & Receipts              |  |
|  +--------------------------------------------+  +----------------------------------------------+  |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Component Inventory

| Component / Module | Technology | Purpose & Responsibility | Primary Interfaces |
|--------------------|------------|--------------------------|--------------------|
| **Customer App** | React Native (Expo SDK 52) | Mobile user client for restaurant discovery, ordering, and live order tracking. | REST API, WebSockets (Socket.io) |
| **Restaurant Partner Portal** | React 18, Vite, Tailwind/Vanilla CSS | Web client for restaurant managers to handle live orders, menus, and business analytics. | REST API, WebSockets (Socket.io) |
| **Admin Dashboard** | React 18, Vite, TanStack Query | Web client for platform governance, KYC verification, dispute resolution, and test data generation. | REST API, WebSockets |
| **API Gateway & App Server** | Node.js (v20 LTS), Express, TypeScript | Central application server providing route handling, middleware orchestration, and domain services. | HTTP/2, WebSocket |
| **Auth Service** | Supabase Auth (GoTrue) | Manages passwordless email OTP, Google OAuth tokens, and session lifecycles. | Supabase Client, JWT RS256 |
| **Primary Relational DB** | PostgreSQL 15 + PostGIS (Supabase) | Authoritative source of truth for transactional data: users, orders, payments, payouts, and spatial fences. | Prisma ORM, pg connection pool |
| **Catalog & Document DB** | MongoDB Atlas (M0 Shared) | Flexible document store for nested menu hierarchies, customizable addon option groups, and audit trails. | Mongoose / MongoDB Native |
| **In-Memory Cache & Broker** | Upstash Redis | High-speed cache for rate limits, active order snapshots, live driver coordinates, and session blocklists. | ioredis / Upstash REST |
| **Search Engine** | Meilisearch Cloud | Sub-50ms typo-tolerant search engine indexing restaurant profiles, cuisines, and dish catalogs. | Meilisearch JS Client |
| **Object Storage** | Cloudflare R2 | S3-compatible asset store with zero egress fees for user avatars, restaurant banners, dish photos, and KYC scans. | AWS S3 SDK v3 |
| **Payment Gateway** | Razorpay Sandbox | Simulated payment order creation, UPI intent simulation, card checkout, and webhook signature verification. | Razorpay Node SDK |
| **Push Notification Service**| Firebase Cloud Messaging (FCM) | Reliable delivery of real-time mobile push notifications for backgrounded customer apps. | Firebase Admin SDK |
| **Email Delivery Engine** | Resend | Dispatch of transactional email OTPs, passwordless login tokens, and order confirmation PDF invoices. | Resend Node SDK |
| **Mapping & Routing** | OpenStreetMap + OSRM Engine | Free cartography tiles, reverse geocoding (Nominatim), and distance matrix route calculations. | Leaflet / RN Maps / OSRM API |

---

## 3. Tech Stack Specification

| Architectural Layer | Technology Selected | Version | Selection Rationale & Advantages |
|---------------------|---------------------|---------|----------------------------------|
| **Mobile Runtime** | React Native + Expo | SDK 52 | Single codebase for iOS and Android, robust OTA updates, native device hardware access (GPS, camera, push). |
| **Web Runtime** | React 18 + Vite | 18.3.x / 5.x | Ultra-fast Hot Module Replacement (HMR), optimized production asset chunking, lightweight client bundle. |
| **Backend Runtime** | Node.js (LTS) | 20.x | Non-blocking asynchronous I/O event loop, high throughput for I/O bound delivery operations, shared TypeScript types. |
| **Monorepo Manager** | Turborepo | 2.x | High-speed build pipeline caching, shared package orchestration across mobile, web, and backend. |
| **Relational Database**| Supabase PostgreSQL | 15.x | Integrated Auth, Row-Level Security (RLS), ACID transactions, PostGIS extension for geospatial radius queries. |
| **Geospatial Engine** | PostGIS | 3.3.x | Native `ST_DWithin` and `ST_Distance` spatial indexing for sub-second restaurant radius lookups. |
| **Document Store** | MongoDB Atlas | 7.x | Highly nested JSON structures for complex food item options (size, toppings, spice variants) without schema friction. |
| **Distributed Cache** | Upstash Redis | 7.x | Serverless Redis with per-request pricing, 10,000 free commands/day, persistent in-memory data structures. |
| **Search Engine** | Meilisearch | 1.10.x | Typo-tolerance, faceted search, sub-50ms response, zero setup hassle compared to heavy Elasticsearch clusters. |
| **Real-Time Layer** | Socket.io | 4.8.x | Robust fallback mechanisms (WebSocket -> HTTP long polling), built-in rooms, automatic reconnection with backoff. |
| **Validation Layer** | Zod | 3.23.x | End-to-end type safety, runtime schema validation at API boundaries, seamless TypeScript inference. |
| **ORM / Data Access** | Prisma | 5.20.x | Type-safe SQL client, auto-generated migrations, connection pooling support, intuitive query syntax. |

---

## 4. End-to-End Data Flow Architecture

### Flow 1: User Authentication & Token Issuance
```
[User Client] -------- 1. POST /api/v1/auth/send-otp { email } --------> [Backend API]
                                                                              |
                                                          2. Generate OTP & Store in Redis (TTL: 300s)
                                                                              |
                                                          3. Send Email via Resend API
                                                                              v
[User Client] <------- 4. HTTP 200 { message: "OTP sent" } -------------+
      |
      | 5. User enters 6-digit code
      v
[User Client] -------- 6. POST /api/v1/auth/verify-otp { email, code } -> [Backend API]
                                                                              |
                                                          7. Validate Code against Redis / Supabase
                                                                              |
                                                          8. Fetch or Create User in PostgreSQL
                                                                              |
                                                          9. Issue JWT Pair (Access: 15m, Refresh: 7d)
                                                                              v
[User Client] <------- 10. HTTP 200 { accessToken, refreshToken, user } -+
```

### Flow 2: Order Placement, Idempotent Payment & State Machine
```
[Customer App] ------ 1. POST /api/v1/orders { items, addressId, paymentMethod, idempotencyKey }
                           |
                           v
                    [Backend API]
                           |
                           +---> 2. Check Idempotency Key in Redis (Prevent duplicate charges)
                           +---> 3. Validate Restaurant Operating Hours & Item Stock in DB
                           +---> 4. Recalculate Bill (Items + 5% GST + Delivery Fee + Platform Fee - Coupon)
                           +---> 5. Create Order Record in PostgreSQL (Status: PAYMENT_PENDING)
                           |
       +-------------------+-------------------+
       | (If Razorpay)                         | (If Cash on Delivery)
       v                                       v
6. Create Razorpay Order                6. Mark Order: ORDER_PLACED
7. Return { orderId, razorpayOrderId }  7. Return { orderId, status: "ORDER_PLACED" }
       |                                       |
8. Customer completes payment                  |
9. Razorpay Webhook received                   |
   - Verify HMAC SHA256 Signature              |
   - Update Order: ORDER_PLACED                |
       +-------------------+-------------------+
                           |
                           v
         [8. Emit WebSocket Event: "order:new"]
                           |
             +-------------+-------------+
             |                           |
             v                           v
  [Restaurant Web Terminal]       [Customer Tracking Screen]
  - Ring Audio Chime              - Transition to "Waiting for Restaurant"
  - Display Order Details
```

---

## 5. WebSocket Real-Time Architecture

### Connection Lifecycle & Security
1. **Handshake Auth:** WebSocket connections require an `auth.token` query parameter or handshake header containing a valid Supabase JWT.
2. **Room Partitioning:**
   - `order:<orderId>`: Subscribed by the ordering customer, fulfilling restaurant, assigned rider, and listening admins.
   - `restaurant:<restaurantId>`: Subscribed by active restaurant kitchen terminals for incoming order alerts.
   - `rider:<riderId>`: Subscribed by delivery partners for order broadcasts and dispatch assignments.
   - `admin:broadcast`: Subscribed by operational admins for global platform metrics and alerts.
3. **Heartbeat & Resiliency:**
   - Client sends `ping` every 25 seconds; server responds with `pong`.
   - If no pong is received within 20 seconds, connection drops and initiates reconnect with exponential backoff (1s, 2s, 4s, 8s, up to 30s ceiling).

### Event Specification Matrix

| Event Name | Sender | Receiver Room | Payload Schema | Action Triggered |
|------------|--------|---------------|----------------|------------------|
| `order:created` | Backend API | `restaurant:<id>` | `{ orderId, items, total, customerName }` | Terminal triggers audio chime and shows modal. |
| `order:status_update` | Backend / Rest. | `order:<id>` | `{ orderId, status, estimatedTime, timestamp }` | Customer tracking UI advances progress bar. |
| `order:prep_time` | Restaurant | `order:<id>` | `{ orderId, prepMinutes: 25 }` | Updates customer ETA countdown timer. |
| `rider:location_update` | Rider Device | `order:<id>` | `{ orderId, latitude, longitude, bearing }` | Customer map updates rider marker position. |
| `order:dispatched` | Restaurant/Rider | `order:<id>` | `{ orderId, riderName, riderPhone }` | Customer app reveals rider card and call button. |

---

## 6. Caching Architecture & Invalidation Strategy

```
+----------------------------------------------------------------------------------------------------+
|                                    MULTI-TIER CACHING TOPOLOGY                                     |
|                                                                                                    |
|  [L1: Application Memory Cache]  --> Fast in-process LRU cache (Node.js memory, max 500 items)     |
|                                      * System configuration flags (Veg Mode rules, Platform Fee)   |
|                                      * TTL: 60 seconds                                             |
|                                                                                                    |
|  [L2: Distributed Upstash Redis] --> Shared Redis instance                                        |
|                                      * Restaurant Profile Data (TTL: 600s)                         |
|                                      * Category & Menu Catalogs (TTL: 300s)                        |
|                                      * User Session & Permissions (TTL: 900s)                      |
|                                      * Rate Limiting Token Buckets (Sliding window: 60s)           |
|                                                                                                    |
|  [L3: Cloudflare Edge Cache]    --> Static assets & CDN                                            |
|                                      * Dish photos & Restaurant banners (TTL: 86400s / 1 day)      |
+----------------------------------------------------------------------------------------------------+
```

### Cache Invalidation Triggers
- **Menu Edit Invalidation:** When a restaurant manager modifies item availability, pricing, or details via `PUT /api/v1/restaurants/:id/menu`, the server immediately purges Redis keys matching `menu:restaurant:<id>*` and re-indexes the Meilisearch catalog.
- **Order State Invalidation:** Order status changes update the canonical PostgreSQL record and refresh the Redis active order cache `order:active:<orderId>` atomically.

---

## 7. Security Architecture & RBAC Matrix

### Role-Based Access Control (RBAC) Matrix

| Entity / Resource | Public (Guest) | Customer (Diner) | Restaurant Partner | Admin (Ops) |
|-------------------|----------------|------------------|--------------------|-------------|
| **Restaurant Info** | Read-Only | Read-Only | Read / Update (Own) | Full (CRUD) |
| **Menus & Dishes** | Read-Only | Read-Only | Full (Own Restaurant) | Full (CRUD) |
| **Orders** | None | Create / Read (Own) | Read / Update Status (Own) | Full (CRUD + Refund)|
| **Addresses** | None | Full (Own Account)| None | Read-Only (Dispute) |
| **Reviews** | Read-Only | Create / Read (Own)| Read / Reply (Own) | Full (Moderate/Delete)|
| **Coupons** | Read-Only (Active)| Validate & Apply | Create / Read (Own Store)| Full (Platform-wide) |
| **Payout Ledger** | None | None | Read-Only (Own Ledger) | Full (Audit/Settle) |
| **Fraud Radar** | None | None | None | Full Access |

---

## 8. Scaling Plan & Load Horizons

### Phase 1: MVP Horizon (0 - 5,000 MAU)
- **Deployment:** Single Node.js server container on Render Free Tier + Supabase Postgres Free Tier + Upstash Redis Free Tier.
- **Mitigation for Cold Starts:** Scheduled lightweight synthetic ping every 10 minutes to prevent container sleep.
- **Traffic Ceiling:** ~50 concurrent WebSocket connections; ~20 orders/hour.

### Phase 2: Growth Horizon (5,000 - 50,000 MAU)
- **Deployment:** 2x Node.js stateless app instances behind Cloudflare Load Balancer.
- **Database:** Supabase Pro tier with connection pooling (PgBouncer) enabling up to 200 concurrent DB connections.
- **Traffic Ceiling:** ~1,000 concurrent WebSockets; ~250 orders/hour.

### Phase 3: Scale Horizon (50,000+ MAU)
- **Deployment:** Kubernetes / AWS ECS container cluster with horizontal pod autoscaling (HPA) based on CPU and latency metrics.
- **Database:** PostgreSQL primary with 2 read replicas; Redis Cluster for partitioned real-time session distribution.

---

## 9. System Dependency Graph

```
[Customer App / Web Portals]
          |
          v
[API Gateway / Express Server]
          |
          +---> [Auth Middleware] --------> [Supabase Auth]
          |
          +---> [Rate Limiter] -----------> [Upstash Redis]
          |
          +---> [Order Controller] --------> [Prisma ORM] --------> [Supabase PostgreSQL]
          |            |
          |            +------------------> [Socket.io Hub] -------> [Connected Clients]
          |            |
          |            +------------------> [Razorpay Gateway]
          |            |
          |            +------------------> [Resend / FCM]
          |
          +---> [Catalog Controller] -----> [Mongoose] -----------> [MongoDB Atlas]
                       |
                       +------------------> [Meilisearch Engine]
```
