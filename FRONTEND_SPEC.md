# Quick Bite Platform -- Frontend Engineering Specification (FRONTEND_SPEC)

**Version:** 2.0.0  
**Date:** September 6, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Native Mobile Food Delivery Ecosystem)  
**Author:** Quick Bite Frontend Architecture & UX Engineering Team  

---

## 1. Multi-Device Native Architecture

The frontend consists of **4 distinct native mobile applications** engineered with React Native and compiled with Hermes bytecode for high-performance physical device execution:

1. **Customer Mobile App (`apps/customer-mobile`):** Consumer discovery, ordering, and live delivery tracking.
2. **Restaurant Mobile App (`apps/restaurant-mobile`):** Kitchen terminal, 120s order timer, KOT tickets, and menu stock manager.
3. **Delivery Mobile App (`apps/delivery-mobile`):** Shift toggling, 15s broadcast card, 3s GPS telemetry streamer, and doorstep OTP verification.
4. **Admin Mobile App (`apps/admin-mobile`):** Marketplace pulse, real-time GMV metrics, KYC verification queues, and instant dispute refunds.

---

## 2. Design System & Stitch UI Tokens

All 4 mobile applications strictly adhere to the Stitch UI design tokens defined in `packages/design-system`:

### Color Tokens
- **Brand Primary:** `#FF4F18` (Saffron / Crimson Accent)
- **Brand Primary 50:** `#FFF7ED` (Subtle Tint / Selected Chips)
- **Surface Dark:** `#0F172A` (Deep Slate / Header Backgrounds)
- **Surface Light:** `#FFFFFF` (Card Surfaces)
- **Surface Muted:** `#F8FAFC` (Canvas Background)
- **Dietary Veg:** `#16A34A` (FSSAI Pure Veg Green)
- **Dietary Non-Veg:** `#DC2626` (Red Triangle Marker)
- **Gold Accent:** `#D97706` (Quick Bite Gold Badge & Highlights)
- **Border Subtle:** `#E2E8F0` (Card Borders)
- **Text Primary:** `#0F172A` (Headings & High Contrast Text)
- **Text Secondary:** `#64748B` (Descriptions & Metadata)

### Iconography Rules
- **Zero Emojis:** Strictly prohibited across all documentation and production code.
- **Lucide Icons:** Uniformly powered by `lucide-react-native` (e.g. `Utensils`, `ShoppingBag`, `ChefHat`, `Bike`, `Activity`, `CheckCircle2`).

---

## 3. The 4-State Component Rule & Mobile Inventory

Every data-dependent component across all 4 applications must explicitly implement all four UI states:

| Component | 1. Loading State (Skeleton) | 2. Success State | 3. Error State (With Retry) | 4. Empty State (With CTA) |
|-----------|-----------------------------|------------------|-----------------------------|---------------------------|
| **RestaurantCard** (`customer-mobile`) | Shimmer rectangle + text placeholders | Food photography, title, cuisine tags, distance, rating | Red border with "Failed to load. [Retry]" | "No restaurants within 10km. [Change Location]" |
| **CartSheet** (`customer-mobile`) | Shimmer item rows + price placeholders | Itemized list, pricing engine tally, Gold free delivery, Checkout button | "Error calculating pricing. [Retry]" | Empty bag graphic with "Cart is empty. [Browse Menu]" |
| **LiveKitchenCard** (`restaurant-mobile`) | Pulsing border placeholder card | Order number, KOT dishes, 120s timer, Accept/Reject buttons | "Connection lost to kitchen socket. [Reconnect]" | "Kitchen queue empty. [View Past Orders]" |
| **BroadcastJobCard** (`delivery-mobile`) | Radial pulsing ring | 15s countdown, restaurant name, distance, payout, Accept button | "Broadcast expired or taken. [Refresh Shift]" | "No orders in your zone. Stay online." |
| **KycReviewCard** (`admin-mobile`) | Gray document outline skeleton | FSSAI / Driving license details, document photo, 1-tap Approve/Reject | "Unable to load document. [Reload Queue]" | "All partner KYC applications cleared." |

---

## 4. Hardware & Telemetry Specifications

| Action / Stream | Frequency / Timing | Implementation Details |
|-----------------|--------------------|------------------------|
| **Rider GPS Telemetry** | Every 3000ms | Emits `{ orderId, lat, lng, bearing }` via `POST /api/riders/telemetry`. Relayed over Socket.IO to customer order room and admin tower. |
| **Kitchen Acceptance Timer** | 120-second countdown | Ticks down on Kitchen Terminal. If 0 reached without action, triggers automatic escalation or reassignment. |
| **Rider Broadcast Expiry** | 15-second countdown | Flash broadcast to the nearest 3 active riders. First to accept locks the dispatch contract. |
| **Search Keystroke Input** | Debounced 300ms | Queries Meilisearch / PostgreSQL with sub-millisecond execution times. |
| **Doorstep OTP Handshake** | Synchronous | 4-digit secret OTP displayed on Customer App (`apps/customer-mobile`) and validated on Rider App (`apps/delivery-mobile`) against `/api/orders/:id/verify-otp`. |

---

## 5. Universal Cloud Tunnel & Server Switcher

All 4 mobile apps feature an integrated **Server / Cloud Tunnel URL** input on the login view and profile screen:
- **Default Emulator Endpoint:** `http://10.0.2.2:4000/api`
- **Default Localhost Endpoint:** `http://127.0.0.1:4000/api`
- **Cloudflare Public Tunnel:** `https://*.trycloudflare.com/api` (launched via `scripts/start-tunnel.ps1`)
- **LAN Wi-Fi IP:** `http://192.168.x.x:4000/api`

This guarantees that any mobile phone running on 4G/5G/Wi-Fi connects seamlessly to the backend without hardcoded IP dependencies.
