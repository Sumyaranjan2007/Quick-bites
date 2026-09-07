# Quick Bite Platform -- Technical Architecture Document (TAD)

**Version:** 2.0.0  
**Date:** September 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Device Native Food Delivery Ecosystem)  
**Author:** Quick Bite Architecture & Engineering Team  
**Deployment Model:** 4 Native Mobile Applications + Shared Node.js Backend + Cloud Storage & Tunnel  

---

## 1. System Architecture Overview

Quick Bite is designed as a centralized, high-efficiency Node.js + TypeScript service layer supporting **four independent native mobile applications** running on separate physical devices. The architecture decouples client interfaces while centralizing data consistency, business validation, and real-time state machines in a single authoritative backend.

### System Architecture Diagram (ASCII)

```
+----------------------------------------------------------------------------------------------------+
|                                    NATIVE CLIENT DEVICE LAYER                                      |
|                                                                                                    |
|  +---------------------+   +---------------------+   +---------------------+   +-----------------+ |
|  |    Customer App     |   | Restaurant Partner  |   |  Delivery Partner   |   | Admin & Ops App | |
|  | apps/customer-mobile|   |apps/restaurant-mobil|   |apps/delivery-mobile |   |apps/admin-mobile| |
|  |     [Device 1]      |   |     [Device 2]      |   |     [Device 3]      |   |   [Device 4]    | |
|  +----------+----------+   +----------+----------+   +----------+----------+   +--------+--------+ |
+-------------|-------------------------|-------------------------|-----------------------|----------+
              | HTTPS / WSS             | HTTPS / WSS             | HTTPS / WSS           | HTTPS / WSS
              v                         v                         v                       v
+----------------------------------------------------------------------------------------------------+
|                               CLOUDFLARE SECURE PRODUCTION TUNNEL                                  |
|                                                                                                    |
|  * TLS 1.3 Termination  * Public HTTPS & WSS Endpoint  * Zero-Egress Ingress  * Global Routing      |
+--------------------------------------------------+-------------------------------------------------+
                                                   | Reverse Proxy (Port 4000)
                                                   v
+----------------------------------------------------------------------------------------------------+
|                                BACKEND CORE API (Node.js + Express)                                |
|                                                                                                    |
|  +----------------------------------------------------------------------------------------------+  |
|  |                                  GLOBAL MIDDLEWARE PIPELINE                                  |  |
|  |  * Security Headers (Helmet)  * CORS Whitelist  * JSON Parser  * Rate Limiter (Token Bucket) |  |
|  |  * Correlation ID Generator   * JWT Auth & Role Verifier       * Zod Request Validator       |  |
|  |  * Global Error Boundary Handler                                                             |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                  |                                                 |
|  +-----------------------------------------------+-------------------------------------------+  |
|  |                                    DOMAIN MODULE SERVICES                                 |  |
|  |                                                                                           |  |
|  |  [Auth & RBAC Module] [Restaurant Catalog]   [Menu & Inventory]    [Cart & Pricing Engine] |  |
|  |  [Order State Mach]   [Payment & Split Wallet][Review & Rating]     [Coupon & Promo Engine] |  |
|  |  [Logistics Dispatch] [KYC Approval Pipeline] [Admin & Fraud Radar] [Notification Engine]  |  |
|  +-----------------------------------------------+-------------------------------------------+  |
|                                                  |                                                 |
|  +-----------------------------------------------+-------------------------------------------+  |
|  |                           REAL-TIME WEBSOCKET HUB (Socket.io)                             |  |
|  |  * Room Isolation: order:<id> | restaurant:<id> | rider:<id> | admin:live_feed          |  |
|  |  * Telemetry Streamer: 3s rider GPS broadcast to customer room                           |  |
|  |  * Audio Event Bus: new_incoming_order kitchen chime, 15s rider broadcast               |  |
|  +----------------------------------------------------------------------------------------------+  |
+-------------------+------------------------------+-----------------------------+-------------------+
                    |                              |                             |
                    v                              v                             v
+-----------------------+      +-----------------------+      +----------------------+
|  PRIMARY DATABASE     |      |   OBJECT CLOUD STORE  |      |   GEOSPATIAL ENGINE  |
|  (PostgreSQL / PostGIS|      |    (Cloudflare R2)    |      |  (OpenStreetMap /    |
|   Supabase Free Tier) |      |                       |      |       OSRM)          |
|                       |      | * KYC License Uploads |      |                      |
| * Users with Roles    |      | * Food Dish Photos    |      | * Reverse Geocoding  |
| * Restaurants & Menus |      | * Storefront Banners  |      | * Turn-by-Turn Routes|
| * Orders, OTPs & Items|      | * S3-Compatible API   |      | * Route Polylines    |
| * Wallets & Ledgers   |      | * 10 GB Free Storage  |      | * 10km Geofence Check|
+-----------------------+      +-----------------------+      +----------------------+
```

---

## 2. Component Inventory

| Component / Module | Technology | Target Device | Core Responsibility |
| :--- | :--- | :--- | :--- |
| **Customer App** | React Native (Expo SDK 52) | Device 1 (Consumer Phone) | Bubbly onboarding, restaurant feed, nested dish customization, split wallet checkout, live OSM rider tracking. |
| **Restaurant Partner App** | React Native (Expo SDK 52) | Device 2 (Kitchen Tablet/Phone)| Partner KYC upload, live order incoming screen with looping chime, 120s timer, KOT view, menu stock toggles. |
| **Delivery Partner App** | React Native (Expo SDK 52) | Device 3 (Rider Phone) | Rider KYC onboarding, shift online/offline toggle, 15s order broadcast card, OSRM turn-by-turn map, 3s GPS streaming, doorstep OTP. |
| **Admin & Operations App** | React Native (Expo SDK 52) | Device 4 (Operations Phone/Tablet)| Real-time marketplace pulse, KYC verification queue (FSSAI/DL previews), dispute resolution, instant wallet refunds. |
| **Backend Core API** | Node.js 20 LTS, Express, TypeScript | Cloud / Server (Port 4000) | Authoritative business logic, order state transitions, pricing engine, JWT issuance, database persistence. |
| **Real-Time Hub** | Socket.IO | Cloud / Server (Port 4000) | Multiplexed WebSocket rooms (`order:<id>`, `restaurant:<id>`, `rider:<id>`, `admin:live_feed`). |
| **Relational Database** | PostgreSQL 15 + PostGIS | Supabase Free Tier | Relational tables (`users`, `restaurants`, `menu_items`, `orders`, `wallets`, `kyc_documents`). |
| **Object Cloud Storage** | Cloudflare R2 | Cloudflare Free Tier | S3-compatible bucket for FSSAI documents, driving licenses, and high-res dish photos. |
| **Geospatial Engine** | OpenStreetMap + OSRM | Public Free APIs | 100% free tiles, reverse geocoding via Nominatim, and route polyline calculation. |

---

## 3. Real-Time WebSocket Event Protocol

All state changes are broadcast across authoritative Socket.IO rooms. No client can trigger events in rooms it does not own.

| Event Name | Source Client | Destination Room | Payload Structure | Action Triggered |
| :--- | :--- | :--- | :--- | :--- |
| `order:placed` | Backend | `restaurant:<restaurantId>` | `{ orderId, items, subtotal, prepLimitSeconds: 120 }` | Device 2 plays looping chime; starts 120s countdown. |
| `order:accepted` | Restaurant (Device 2)| `order:<orderId>`, `riders:broadcast`| `{ orderId, prepTimeMinutes, restaurantCoords }` | Customer ETA updated; broadcast card sent to nearby online riders (Device 3). |
| `order:claimed` | Rider (Device 3) | `order:<orderId>`, `restaurant:<id>` | `{ orderId, riderId, riderName, riderPhone }` | Binds rider to order; provides pickup code to kitchen. |
| `rider:telemetry` | Rider (Device 3) | `order:<orderId>` | `{ orderId, lat, lng, heading, speed }` | Customer map (Device 1) animates rider marker smoothly every 3 seconds. |
| `order:ready` | Restaurant (Device 2)| `order:<orderId>`, `rider:<riderId>` | `{ orderId, pickupOtpRequired: true }` | Rider notified food is packed and ready at pickup counter. |
| `order:picked_up` | Rider (Device 3) | `order:<orderId>` | `{ orderId, status: "OUT_FOR_DELIVERY" }` | Customer tracking screen reveals secret 4-digit Delivery OTP. |
| `order:delivered` | Rider (Device 3) | `order:<orderId>`, `admin:live_feed` | `{ orderId, deliveredAt, codCollected }` | Order completes; balances credited; Admin live log updated. |

---

## 4. Security & Cryptographic Boundaries

1. **Authentication Token:** Standardized JSON Web Tokens (JWT) signed using HS256/RS256 with 7-day expiry and refresh token rotation.
2. **Role Verification:** Middleware extracts user role from token and verifies against authorized roles:
   ```typescript
   export const requireRole = (allowedRoles: string[]) => {
     return (req: Request, res: Response, next: NextFunction) => {
       if (!req.user || !allowedRoles.includes(req.user.role)) {
         return res.status(403).json({ success: false, error: 'Forbidden: Insufficient role permissions' });
       }
       next();
     };
   };
   ```
3. **KYC Gate Enforcement:** For partner routes on `apps/restaurant-mobile` and `apps/delivery-mobile`, an additional middleware checks that `kyc_status === 'ACTIVE'`. If `PENDING_APPROVAL`, partners can only access the KYC submission and Under Review status screens.
