# Quick Bite Platform -- Implementation Plan & Technical Specification

**Version:** 2.0.0  
**Date:** September 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Device Native Food Delivery Ecosystem)  
**Execution Framework:** 4 Production Build Chunks with Verification Gates  

---

## 1. Project Identity & Architecture Baseline

| Attribute | Specification Details |
| :--- | :--- |
| **Project Name** | Quick Bite |
| **Industry Benchmark** | Zomato & Blinkit (Eternal Ltd) |
| **Architecture** | 4 Standalone Native Mobile Apps + Centralized Node.js API + Cloud Storage & Tunnel |
| **Target Hardware** | 4 Separate Physical Smartphones/Tablets running Android & iOS |
| **Primary Backend** | Node.js (v20+ LTS), Express, TypeScript, Socket.IO |
| **Database** | PostgreSQL 15 + PostGIS (Supabase Free Tier / Cloud Instance) |
| **Object Cloud Storage**| Cloudflare R2 / S3-Compatible Storage (10 GB Free, Zero Egress) |
| **Public Networking** | Cloudflare Secure Tunnel (`cloudflared` HTTPS & WSS) |
| **Geospatial Engine** | OpenStreetMap (OSM) + OSRM Routing (100% Free) |
| **Production Target Cost**| Rs 0 / Month (100% Free Tier Services) |

---

## 2. Monorepo Applications & Packages Mapping

```
quick-bites/
├── apps/
│   ├── customer-mobile/       # Device 1: Consumer Discovery & Ordering (Expo React Native)
│   ├── restaurant-mobile/     # Device 2: Kitchen Live Order Terminal (Expo React Native)
│   ├── delivery-mobile/       # Device 3: Rider Logistics & Navigation (Expo React Native)
│   ├── admin-mobile/          # Device 4: Operations & KYC Review (Expo React Native)
│   └── backend-api/           # Authoritative REST API & Socket.IO Gateway
├── packages/
│   ├── design-system/         # Shared Stitch UI tokens, Plus Jakarta Sans, Lucide icons
│   ├── shared-types/          # Shared TypeScript interfaces across all 4 apps and API
│   └── pricing-engine/        # Shared calculation logic for taxes, fees, and commissions
└── scripts/
    └── start-tunnel.ps1       # One-click Cloudflare tunnel launcher for public HTTPS/WSS
```

---

## 3. Four-Chunk Build Roadmap (Phase 4 Execution)

### Chunk 1: Authoritative Backend, Database Schemas & Production Tunnel
- **Scope:**
  1. Update PostgreSQL schema with tables: `users`, `wallets`, `wallet_transactions`, `restaurants`, `menu_categories`, `menu_items`, `menu_item_variants`, `menu_item_addons`, `delivery_riders`, `orders`, `order_items`, `kyc_documents`, `reviews`.
  2. Implement rich database seeder: 8 authentic Indian restaurants (North Indian, South Indian, Biryani, Pizza, Chinese, Street Food, Desserts) with 100+ categorized dishes, variant prices, and veg/non-veg tags.
  3. Implement domain routes:
     - Auth: `/api/auth/register`, `/api/auth/login`, `/api/auth/me` with role-based JWT issuance.
     - KYC: `/api/kyc/upload` (multipart R2 upload), `/api/kyc/submit`, `/api/kyc/status`.
     - Admin: `/api/admin/kyc/pending`, `/api/admin/kyc/review`, `/api/admin/orders/:id/refund`, `/api/admin/suspend`.
     - Rider: `/api/riders/shift`, `/api/riders/orders/:id/claim`, `/api/riders/orders/:id/verify-otp`.
     - Wallet: `/api/wallets/me`, `/api/wallets/split-pay`.
  4. Implement Socket.IO real-time rooms and event handlers:
     - `order:placed` -> triggers kitchen chime on Device 2.
     - `order:accepted` -> triggers 15s broadcast modal on Device 3.
     - `rider:telemetry` -> streams 3s GPS coords to Device 1.
  5. Setup Cloudflare tunnel script for persistent public HTTPS and WSS endpoints.
- **Verification Gate:** Run automated test scripts validating all endpoints, seed integrity, and WebSocket message propagation.

### Chunk 2: Restaurant Partner Mobile App (`apps/restaurant-mobile`)
- **Scope:**
  1. Scaffold Expo React Native app importing `packages/design-system` and `packages/shared-types`.
  2. Implement Partner Registration & KYC Onboarding:
     - Form: FSSAI license (14 digits), GSTIN, bank payout info.
     - Cloud upload: Storefront photo & FSSAI license document.
     - State Gate: "KYC Under Verification" screen until approved by Admin.
  3. Implement Live Kitchen Terminal:
     - Looping kitchen audio chime on incoming orders.
     - 120-second accept/reject countdown timer.
     - KOT (Kitchen Order Ticket) modal displaying dish portion sizes and customer notes.
     - Prep time selector (15m, 25m, 40m).
     - Menu Stock Manager: 1-tap In-Stock / Out-of-Stock switch for all dishes.
     - Pickup Code verification input.
     - Daily sales & settlement ledger screen.
- **Verification Gate:** Run app via Expo/Android, test incoming order socket reception, sound playback, and state updates.

### Chunk 3: Delivery Partner Mobile App (`apps/delivery-mobile`)
- **Scope:**
  1. Scaffold Expo React Native app importing design system tokens.
  2. Implement Rider Onboarding & KYC:
     - Vehicle type selection (Motorcycle, EV, Bicycle).
     - Driving license number & document photo upload.
     - State Gate: "Background Check Underway" screen until approved by Admin.
  3. Implement Rider Logistics Terminal:
     - Shift Switch: "Go Online" / "Go Offline" toggle.
     - 15-second order broadcast card with sound alert.
     - Turn-by-turn routing via OpenStreetMap & OSRM.
     - 3-second GPS telemetry streamer (background watchPosition service).
     - Pickup handshake: marks "Reached Restaurant" and submits pickup code.
     - Doorstep OTP Handshake: keypad input for customer's 4-digit OTP.
     - COD cash collection confirmation.
     - Daily earnings & trip history dashboard.
- **Verification Gate:** Test order broadcast acceptance, GPS streaming over WebSockets, and OTP validation.

### Chunk 4: Admin & Operations Mobile App (`apps/admin-mobile`) & Customer App Integration
- **Scope:**
  1. Scaffold Expo React Native app for Operations & City Managers.
  2. Implement Operations Command Center:
     - Real-time marketplace pulse cards (active orders, GMV, online fleet).
     - Restaurant KYC Approval Queue with direct document preview and 1-tap Approve/Reject.
     - Rider KYC Approval Queue with driving license preview and 1-tap Approve/Reject.
     - Live Order Monitor with status timeline overrides.
     - Dispute & Instant Wallet Refund tool.
     - Emergency 1-tap partner suspension toggle.
  3. Connect Customer Mobile App (`apps/customer-mobile`) to the production tunnel URL.
  4. Execute full end-to-end 4-device transaction test.
- **Verification Gate:** Place an order on Device 1 -> Accept on Device 2 -> Claim & Navigate on Device 3 -> Complete with OTP -> Verify audit in Device 4.

---

## 4. Quality & Compliance Standards

- **Zero Mock / Zero Fake Accounts:** All accounts are stored in PostgreSQL with hashed passwords.
- **Zero Raw Emojis:** Lucide icons exclusively across all mobile screens.
- **Stitch UI Compliance:** Plus Jakarta Sans font, `#FF4F18` Saffron / Crimson colors, bubbly cards (`border-radius: 20px`), tactile touch feedback.
- **Production Resilience:** Graceful handling of network drops, auto-reconnecting WebSockets, and idempotent financial mutations.
