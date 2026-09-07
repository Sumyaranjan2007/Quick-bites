# Quick Bite Platform -- Application Flow (APP_FLOW)

**Version:** 2.0.0  
**Date:** September 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Device Native Food Delivery Ecosystem)  
**Devices:** 4 Independent Mobile Applications across 4 Physical Smartphones/Tablets  

---

## 1. Device 1: Customer Mobile App Flow (`apps/customer-mobile`)

```
[App Launch / Splash Screen]
         |
         v
[Bubbly Onboarding & Language Selection]
   - English | Hindi (हिंदी) | Kannada (ಕನ್ನಡ)
   - Bubbly interactive cards with smooth page indicator
         |
         v
[Authentication Screen]
   - Email/Password Sign In or Register
   - Google / Apple OAuth Button
   - Role enforced: 'customer' (auto-assigned)
         |
         v
[Location Permission & Geofencing]
   - GPS Auto-Detection via OpenStreetMap Nominatim
   - Sets Delivery Address (Lat/Lng)
         |
         v
[Home Discovery Feed]
   - Header: Address Selector + Veg Mode Switch + QuickBite Wallet balance badge
   - Banners: Promo codes & Quick Bite Gold perks
   - Category Circles: Biryani, Pizza, North Indian, Desserts, Chinese
   - Restaurant Cards: Distance (<= 10km), Rating, Prep Time, Tags
         |
         | (Tap Restaurant)
         v
[Restaurant Menu Screen]
   - Cover photo, FSSAI badge, Veg/Non-Veg indicators
   - Categorized Menu Items (Starters, Main Course, Breads, Beverages)
         |
         | (Tap "ADD" on Dish)
         v
[Dish Customization Modal (if applicable)]
   - Portion Variant: Regular (+Rs 0) / Large (+Rs 70)
   - Add-on Toppings: Extra Cheese, Dips (Checkboxes)
   - Spice Level: Mild / Medium / Hot (Radio)
   - Special Cooking Instructions (Text Input)
   - CTA: "Add Item Rs [Price]"
         |
         | (Tap "View Cart")
         v
[Cart & Bill Breakdown Screen]
   - Item list with quantity steppers (+ / -)
   - Apply Coupon (e.g. WELCOME50) -> Instant server discount calculation
   - Transparent Bill Breakdown:
     * Item Total
     * 5% Food GST
     * Packaging Fee (Rs 20)
     * Delivery Fee (Rs 30 base + Rs 10/km beyond 3km)
     * Platform Fee (Rs 5)
     * Coupon Discount (- Rs 50)
     * Total To Pay
   - Payment Selection:
     * QuickBite Wallet (Split payment option enabled)
     * Cash on Delivery (COD)
     * Razorpay Sandbox Test UPI
         |
         | (Tap "Place Order")
         v
[Live Order Tracking Screen (OpenStreetMap)]
   - State 1: Order Placed (Waiting for kitchen)
   - State 2: Preparing in Kitchen (ETA countdown)
   - State 3: Rider Assigned (Rider details, photo, phone)
   - State 4: Out for Delivery (Live OSM Map shows delivery bike moving every 3 seconds)
   - Doorstep Handshake: Displays secret **4-Digit Delivery OTP** (e.g. 8421)
   - State 5: Delivered -> Prompts for Verified Star Review
```

---

## 2. Device 2: Restaurant Partner Mobile App (`apps/restaurant-mobile`)

```
[App Launch]
         |
         v
[Partner Authentication Screen]
   - Email & Password Login / Register
   - Role enforced: 'restaurant_owner'
         |
         v
[KYC Onboarding Check]
   +---> If KYC Not Submitted:
   |        - Enter Restaurant Name, Address, Phone, Pincode
   |        - Input 14-Digit FSSAI License Number
   |        - Input GSTIN
   |        - Upload FSSAI License Image & Storefront Photo (to Cloudflare R2)
   |        - Enter Bank Payout Details (Account Number, IFSC)
   |        - Submit -> Transitions to "PENDING_APPROVAL"
   |
   +---> If Status == "PENDING_APPROVAL":
   |        - Renders "KYC Under Verification" Screen
   |        - "Your documents are currently under review by Quick Bite Operations. 
   |           Approval takes 2-4 hours. Terminal will activate automatically."
   |
   +---> If Status == "ACTIVE":
            |
            v
[Live Kitchen Terminal]
   - Store Status Toggle: Online (Accepting Orders) / Offline
   - Menu Stock Manager: 1-tap In-Stock / Out-of-Stock switch for all dishes
   - Incoming Order Flow:
     * Plays loud looping kitchen audio chime
     * 120-second visual acceptance countdown timer
     * Displays KOT (Kitchen Order Ticket): Table/Order #, dishes, portion sizes, notes
     * Buttons: "Reject Order" | "Accept Order (Select Prep Time: 15m / 25m / 40m)"
   - Active Prep Queue:
     * List of orders currently cooking
     * When ready, kitchen staff taps "Food Ready for Pickup"
   - Rider Pickup Handshake:
     * Verifies Rider ID & checks 4-digit pickup code
     * Marks order as Handed Over
   - Daily Revenue & Settlement Ledger tab
```

---

## 3. Device 3: Delivery Partner Mobile App (`apps/delivery-mobile`)

```
[App Launch]
         |
         v
[Rider Authentication Screen]
   - Phone / Email Login or Registration
   - Role enforced: 'rider'
         |
         v
[Rider KYC Onboarding Check]
   +---> If KYC Not Submitted:
   |        - Select Vehicle Type: Motorcycle / Electric Vehicle / Bicycle
   |        - Input Driving License Number & Vehicle RC Number
   |        - Upload Driving License Photo & Selfie (to Cloudflare R2)
   |        - Enter Bank Account for Daily Payouts
   |        - Submit -> Transitions to "PENDING_APPROVAL"
   |
   +---> If Status == "PENDING_APPROVAL":
   |        - Renders "Background Verification in Progress" Screen
   |
   +---> If Status == "ACTIVE":
            |
            v
[Rider Logistics Terminal]
   - Shift Status: "Go Online" / "Go Offline" Toggle
   - Incoming Order Broadcast:
     * Urgent 15-second broadcast audio alert
     * Modal shows: Restaurant Name, Pickup Distance, Drop Distance, Estimated Earnings
     * CTA: "Accept Delivery" (First rider to tap wins atomic dispatch lock)
   - Pickup Leg:
     * Turn-by-turn navigation via OpenStreetMap & OSRM to restaurant
     * Taps "Reached Restaurant" upon arrival
     * Provides 4-digit Pickup Code to restaurant staff
     * Taps "Confirm Food Picked Up"
   - Delivery Leg:
     * 3-second background GPS telemetry activates (streams lat/lng to server)
     * Turn-by-turn navigation via OpenStreetMap to customer doorstep
     * Taps "Arrived at Customer"
   - Doorstep Handshake:
     * Asks customer for the 4-digit Delivery OTP
     * Enters OTP into rider keypad -> Server validates code
     * If COD: Confirms cash amount collected
     * Taps "Complete Delivery" -> Trip earnings credited to Rider Wallet
   - Earnings & Touchpoints Dashboard tab
```

---

## 4. Device 4: Admin & Operations Mobile App (`apps/admin-mobile`)

```
[App Launch]
         |
         v
[Admin Secure Login]
   - Email & Master Password
   - Role enforced: 'admin'
         |
         v
[Operations Command Center]
   - Real-Time Platform KPI Cards:
     * Active Orders in Transit
     * Online Delivery Fleet
     * Today's GMV (Gross Merchandise Value)
     * System Uptime & Socket Health
   - Partner KYC Verification Hub:
     * Tab 1: Restaurant KYC Queue
       - View restaurant profile, FSSAI number, GSTIN
       - Tap to inspect uploaded license image (from Cloudflare R2)
       - Action: "Approve Restaurant" (instantly sets ACTIVE) or "Reject with Reason"
     * Tab 2: Rider KYC Queue
       - View rider profile, vehicle type, driving license number
       - Inspect driving license image
       - Action: "Approve Rider" or "Reject"
   - Live Order Control Center:
     * List all live platform orders across all 8 states
     * Inspect order timeline logs (Placed at 18:30 -> Accepted at 18:31 -> Picked up at 18:42)
     * Emergency actions: "Re-assign Order to Another Rider" | "Force Cancel"
   - Dispute & Instant Refund Panel:
     * Review customer complaints (missing dish / delayed delivery)
     * 1-tap partial or full refund credited to customer's QuickBite Wallet
     * Automatically records immutable financial audit record
   - Security & Suspension Radar:
     * 1-tap emergency suspension toggle for fraudulent restaurants or abusive riders
     * Instantly terminates active WebSocket sessions
```

---

## 5. Sequence Diagram: The 4-Device Cross-Portal Handshake

```
CUSTOMER (Dev 1)      BACKEND / DB       RESTAURANT (Dev 2)     RIDER (Dev 3)     ADMIN (Dev 4)
      |                    |                     |                   |                  |
   1. Place Order -------->|                     |                   |                  |
      (Wallet/COD/UPI)     |-- Validate Geofence |                   |                  |
                           |-- Create Order      |                   |                  |
                           |                     |                   |                  |
                           |-- WebSocket Chime ->|                   |                  |
                           |   (120s Countdown)  |                   |                  |
                           |                     |                   |                  |
                           |<-- Accept Order ----|                   |                  |
                           |    (Prep: 20 mins)  |                   |                  |
                           |                     |                   |                  |
                           |----------------------------------------------------------->|
                           |                     |                   |            Log GMV / Order
                           |                     |                   |                  |
                           |-- 15s Broadcast ----------------------->|                  |
                           |                                         |                  |
                           |<-- Accept Broadcast --------------------|                  |
                           |    (Wins Lock)                          |                  |
                           |                                         |                  |
   2. Status: RIDER_ASSIGN |                                         |                  |
      Show Rider Details <-|                                         |                  |
                           |                                         |                  |
                           |<-- Reached Rest. -----------------------|                  |
                           |-- Notify Rest. ---->|                   |                  |
                           |                     |                   |                  |
                           |<-- Confirm Pickup --|                   |                  |
                           |                     |                   |                  |
                           |<-- Mark Picked Up ----------------------|                  |
                           |                                         |                  |
   3. Status: OUT_FOR_DEL  |                                         |                  |
      Show Delivery OTP <--|                                         |                  |
                           |                                         |                  |
                           |<-- 3s GPS Coords -----------------------|                  |
   4. Live Marker Update <-|    (Every 3s)                           |                  |
                           |                                         |                  |
                           |<-- Arrived At Drop ---------------------|                  |
                           |                                         |                  |
   5. Give 4-Digit OTP --------------------------------------------->|                  |
                           |                                         |                  |
                           |<-- Submit OTP --------------------------|                  |
                           |-- Verify OTP        |                   |                  |
                           |-- Atomic Settlement |                   |                  |
                           |   Credit Rest Payout|                   |                  |
                           |   Credit Rider Pay  |                   |                  |
                           |                     |                   |                  |
   6. Order DELIVERED <----|                     |                   |                  |
      Prompt Review        |----------------------------------------------------------->|
                           |                                         |          Order Completed
```
