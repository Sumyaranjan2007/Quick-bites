# Quick Bite Platform -- Mental Model & System Mechanics (MENTAL_MODEL)

**Version:** 2.0.0  
**Date:** September 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Device Native Food Delivery Ecosystem)  
**Industry Benchmark:** Zomato & Blinkit (Eternal Ltd)  
**Deployment Target:** 4 Independent Native Mobile Apps on 4 Separate Physical Devices + Cloud Backend  

---

## 1. System Philosophy & Plain English Overview

Quick Bite is designed so that any engineer, product manager, or AI assistant can understand exactly how data, money, and state changes move through the ecosystem without confusion or ambiguity.

The core architecture follows a simple principle: **The Frontend is an Untrusted Display Engine; The Backend is the Authoritative Arbiter of State and Truth.**

No client (mobile app or partner terminal) ever calculates prices, assigns delivery states, or grants permissions on its own. Every action is verified, signed, and recorded centrally in our backend.

### The 4-Device Reality
Quick Bite is NOT a single app or a web-only demo. It is **4 independent native mobile applications** engineered to run on **4 separate physical smartphones or tablets**:

```
+------------------------------------------------------------------------------------+
|                             QUICK BITE CLOUD BACKEND                               |
|  - Node.js + Express REST API & Socket.IO Gateway (Port 4000)                      |
|  - PostgreSQL Database (Supabase Free Tier / Cloud Instance)                       |
|  - Cloudflare R2 / S3-Compatible Storage (KYC Documents & Food Imagery)            |
|  - Cloudflare Secure Production Tunnel (Public HTTPS & WSS Endpoints)              |
+------------------------------------------------------------------------------------+
       |                                |                        |                  |
       v                                v                        v                  v
+-------------------+      +--------------------+      +--------------------+      +-------------------+
|     DEVICE 1      |      |      DEVICE 2      |      |      DEVICE 3      |      |     DEVICE 4      |
|   Customer App    |      | Restaurant Partner |      |  Delivery Partner  |      |  Admin & Ops App  |
|  apps/customer-   |      | apps/restaurant-   |      |  apps/delivery-    |      |  apps/admin-      |
|      mobile       |      |      mobile        |      |      mobile        |      |      mobile       |
|  (Consumers)      |      |  (Kitchen Staff)   |      |   (Rider Fleet)    |      | (Superusers/Ops)  |
+-------------------+      +--------------------+      +--------------------+      +-------------------+
```

---

## 2. Real Cloud Backend & Zero-Mock Guarantee

There is **ZERO mock or simulated data** in the production path:
1. **Real Authentication:** All users authenticate via real credentials (Email/Password, Supabase Auth, Google/Apple OAuth). Every account has a cryptographically enforced `role` column (`customer`, `restaurant_owner`, `rider`, `admin`).
2. **Real Database Transactions:** Every order, address, dish customization, review, wallet deduction, and settlement is written to real PostgreSQL tables with foreign-key constraints and ACID guarantees.
3. **Real Internet Connectivity:** By exposing the backend via a persistent Cloudflare Tunnel (`cloudflared`) or cloud deployment, all 4 physical devices connect seamlessly over 4G/5G/Wi-Fi anywhere in the world.
4. **Real File & Image Storage:** KYC documents (FSSAI licenses, driving licenses, PAN cards) and dish photos are uploaded to Cloudflare R2 / cloud object buckets via multipart signed uploads.

---

## 3. "When User Does X, System Does Y Because Z"

### 3.1 Customer Placing an Order (Device 1)
- **When:** A customer taps "Place Order" on Device 1.
- **System Does:** 
  1. Validates the client-provided `idempotencyKey` (UUIDv4) to prevent duplicate charges.
  2. Queries PostgreSQL to verify the restaurant is `ACTIVE`, approved via KYC, and currently open for orders.
  3. Calculates geodesic distance between customer address and restaurant coordinates; rejects with error if distance exceeds **10 km**.
  4. Fetches real item prices, portion variant surcharges, and add-on costs from PostgreSQL.
  5. Computes authoritative bill: `Subtotal + 5% Food GST + Packaging Fee + Delivery Fee (Rs 30 base + Rs 10/km after 3km) + Platform Fee (Rs 5) - Validated Coupon`.
  6. Handles payment:
     - If Wallet balance used: atomically deducts from customer's `wallets` table.
     - If Split payment: records wallet amount and remaining balance via COD or Razorpay Test UPI.
  7. Inserts order row into `orders` table with status `PLACED`.
  8. Emits real-time WebSocket event `new_incoming_order` to the restaurant's private room `restaurant:<restaurantId>`.
- **Because:** Customers cannot be trusted to submit item prices, and network double-taps must never double-charge the consumer.

### 3.2 Restaurant Receiving & Accepting an Order (Device 2)
- **When:** Device 2 receives the order event.
- **System Does:**
  1. Restaurant app triggers a loud looping kitchen audio chime and starts a **120-second acceptance countdown timer**.
  2. Kitchen manager reviews items, portion notes, and kitchen instructions, then taps "Accept Order (20 Mins)".
  3. Server verifies that `req.user.id === restaurant.owner_id`.
  4. Updates order status in PostgreSQL to `PREPARING` and sets `prep_time_minutes = 20`.
  5. Emits `order_status_update` to room `order:<orderId>` (updating customer on Device 1).
  6. Dispatches order broadcast event `order_broadcast_available` to all online delivery partners within 5 km.
- **Because:** Immediate audible kitchen feedback ensures orders are acknowledged without delay, and preparation time establishes accurate consumer ETAs.

### 3.3 Delivery Rider Accepting the Broadcast (Device 3)
- **When:** An online rider within radius receives the broadcast notification.
- **System Does:**
  1. Delivery Partner app renders an urgent 15-second broadcast modal with pickup location, drop distance, and estimated earnings.
  2. First rider to tap "Accept Delivery" wins the atomic dispatch lock in PostgreSQL.
  3. Order transitions to `RIDER_ASSIGNED`, binding `rider_id = req.user.id`.
  4. Subsequent accept attempts from other riders receive `"Order already claimed"`.
  5. System generates a 4-digit **Pickup Code** for the restaurant handshake and a 4-digit **Delivery OTP** for the customer handshake.
  6. Updates Customer screen (Device 1) with rider name, phone, vehicle details, and initial location.
- **Because:** First-come atomic locks prevent multiple riders from traveling to the same restaurant for the same order.

### 3.4 Pickup Handshake at Restaurant (Device 2 & Device 3)
- **When:** Rider arrives at the restaurant kitchen.
- **System Does:**
  1. Rider confirms arrival (`REACHED_RESTAURANT`).
  2. Kitchen staff verifies the rider's order ID and validates the pickup code.
  3. Rider taps "Confirm Pickup". Order transitions to `OUT_FOR_DELIVERY`.
  4. Rider's device activates the 3-second GPS telemetry streamer.
- **Because:** A physical pickup handshake prevents accidental food handoffs to the wrong delivery partner.

### 3.5 Live OpenStreetMap Navigation & Live Telemetry (Device 3 to Device 1)
- **When:** Rider is en route to the customer's delivery location.
- **System Does:**
  1. Device 3 queries OSRM (Open Source Routing Machine) for turn-by-turn routing and navigation waypoints.
  2. Device 3 streams GPS latitude/longitude coordinates to the server every **3 seconds**.
  3. Server broadcasts coordinates to WebSocket room `order:<orderId>`.
  4. Customer App (Device 1) animates the delivery bike along the route polyline on OpenStreetMap in real-time.
- **Because:** High-frequency 3-second telemetry provides smooth, jitter-free bike tracking, matching modern consumer expectations (Zomato/Blinkit standard).

### 3.6 Doorstep Handshake & OTP Verification (Device 1 & Device 3)
- **When:** Rider arrives at customer doorstep.
- **System Does:**
  1. Customer screen on Device 1 displays the secret 4-digit **Delivery OTP** (e.g. `7419`).
  2. Rider asks customer for the code and inputs it into Device 3.
  3. Server verifies that the entered OTP matches `order.delivery_otp`.
  4. If payment was COD, rider confirms physical cash collection.
  5. Order status moves to `DELIVERED`.
  6. Financial ledger updates atomically:
     - Restaurant net earnings credited to restaurant settlement balance.
     - Delivery partner trip fee + distance bonus credited to rider wallet.
     - Platform commission (15%) and platform fee retained.
- **Because:** Doorstep OTP verification guarantees that food was physically delivered to the correct customer before releasing driver and restaurant earnings.

### 3.7 Admin Oversight, KYC Review & Dispute Resolution (Device 4)
- **When:** An administrator monitors the platform on Device 4.
- **System Does:**
  1. Displays real-time operational dashboard: total active orders, online riders, gross merchandise value (GMV), system alerts.
  2. Lists all pending Restaurant and Rider KYC registrations with direct document image inspection.
  3. Allows 1-click Approval or Rejection (with reason). Approved partners immediately transition from `PENDING_APPROVAL` to `ACTIVE`.
  4. In disputes (missing items, damaged packaging), Admin can execute an instant partial or full wallet refund to the customer, automatically logging the audit trail.
  5. Can suspend rogue restaurants or riders with immediate WebSocket session revocation.
- **Because:** Centralized administrative control ensures regulatory compliance (FSSAI) and maintains marketplace trust.

---

## 4. Multi-Tenant Role Isolation Architecture

Every API endpoint validates the incoming JWT signature and enforces strict role barriers:

| Role | Permitted Application | Forbidden Applications | Access Enforcement Rule |
| :--- | :--- | :--- | :--- |
| `customer` | `apps/customer-mobile` (Device 1) | Devices 2, 3, 4 | Blocked with 403 Forbidden: "Customer accounts cannot access partner terminals." |
| `restaurant_owner` | `apps/restaurant-mobile` (Device 2) | Devices 1, 3, 4 | Scoped strictly to restaurants where `restaurant.owner_id === req.user.id`. |
| `rider` | `apps/delivery-mobile` (Device 3) | Devices 1, 2, 4 | Scoped to assigned deliveries and rider's own wallet earnings. |
| `admin` | `apps/admin-mobile` (Device 4) | Direct customer ordering | Unrestricted read/write access across all tenants, disputes, and approvals. |

---

## 5. UI/UX Design System Standard

All 4 mobile applications follow the unified design specifications established in `design for customers/` and `design/DESIGN_TOKENS.md`:
- **Typography:** Plus Jakarta Sans across all headers, buttons, cards, and data badges.
- **Color Identity:**
  - Primary Brand Crimson / Warm Saffron: `#FF4F18` / `#E23744`
  - Pure Veg Green: `#0F8A3C` (background: `#E8F5E9`)
  - Non-Veg Red: `#E23744` (background: `#FDE8EA`)
  - Dark Surface / Slate: `#0F172A` / `#1E293B`
- **Component Style:** Tactile bubbly cards (`border-radius: 20px`), glassmorphism sheets, haptic micro-interactions on tap, and high dopamine visual feedback.
- **Iconography:** Lucide icons exclusively (no raw emojis anywhere in production code).
