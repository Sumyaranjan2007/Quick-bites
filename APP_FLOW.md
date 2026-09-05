# Quick Bite Platform -- Application Flow (APP_FLOW)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Product & UX Engineering Team  

---

## 1. Customer Mobile App Flow (React Native + Expo)

### 1.1 First-Time User Experience (FTUX) & Onboarding
```
[App Launch / Splash Screen]
         |
         v
[Language Selection Screen]
  - Options: English | Hindi (हिंदी) | Kannada (ಕನ್ನಡ)
  - Selection stored in AsyncStorage
         |
         v
[Location Permission Modal]
  +---> Granted ------> Reverse Geocode GPS via Nominatim -> Set Default Location
  +---> Denied -------> Open Manual Address Search Screen -> User pins address
         |
         v
[Auth Prompt Screen]
  +---> Option 1: "Continue with Google" -> OAuth Flow via Supabase
  +---> Option 2: "Continue with Email OTP" -> Enter Email -> 6-Digit Code -> Verified
  +---> Option 3: "Skip for Now" (Guest Mode) -> Limited to Browsing
         |
         v
[Home Discovery Feed]
```

### 1.2 Core Discovery & Ordering Journey
```
[Home Discovery Feed]
  |-- Header: Current Address Selector (Tap opens Saved Addresses Modal)
  |-- Quick Toggles: Veg Mode Switch, Cuisines Scroll, Sort by Rating / Distance
  |-- Banners: Top Offers & Quick Bite Gold Promotion
  |-- Restaurant Feed: Infinite Scroll cards with delivery time, ratings, tags
         |
         | (Tap Restaurant Card)
         v
[Restaurant Detail Screen]
  |-- Header: Banner Image, FSSAI Badge, Rating, Veg/Non-Veg icons, Prep time
  |-- Category Tabs: Bestsellers, Starters, Main Course, Desserts, Beverages
  |-- Dish Card: Title, Description, Price, Veg badge, Food Photo
         |
         | (Tap "ADD" Button)
         v
+-------------------------------------------------------------+
| Item Customization Modal (if variants/addons exist)          |
|  - Portion Size (Radio): Regular / Medium / Large           |
|  - Add-ons (Checkboxes): Extra Cheese, Dips, Toppings       |
|  - Spice Level (Radio): Mild / Medium / Hot                 |
|  - Cooking Notes (Text Input): Max 150 chars                |
|  - Bottom CTA: "Add Item Rs [Calculated Total]"             |
+-------------------------------------------------------------+
         |
         v
[Floating Cart Bar appears at bottom of screen]
  - Shows item count, total price, and "View Cart" CTA
         |
         | (Tap "View Cart")
         v
[Cart & Bill Screen]
  |-- Delivery Address Card (with "Change" button)
  |-- Itemized List with Stepper (+ / -) controls
  |-- Apply Coupon Section: Input box + List of active promo codes
  |-- Bill Summary:
  |     Item Total:                Rs 450.00
  |     Restaurant Packaging:      Rs  25.00
  |     Delivery Partner Fee:      Rs  35.00 (Rs 0 if Gold)
  |     Platform Fee:              Rs   5.00
  |     GST & Restaurant Taxes:    Rs  24.00
  |     Coupon Discount:         - Rs  50.00
  |     -------------------------------------
  |     To Pay:                    Rs 489.00
  |-- Bottom CTA: "Select Payment Method"
         |
         v
[Payment Selection Screen]
  |-- Saved UPI / Test UPI Options (Razorpay Sandbox)
  |-- Credit / Debit Cards (Simulated)
  |-- Netbanking (Simulated)
  |-- Cash on Delivery (COD)
         |
         | (Tap "Pay & Place Order")
         v
[Order Confirmation & Live Tracking Screen]
  - State 1: Order Placed (Waiting for restaurant acceptance)
  - State 2: Order Accepted (Kitchen is preparing your food)
  - State 3: Food Ready / Out for Delivery (Rider en route)
  - State 4: Order Arrived & Delivered (Enter OTP confirmation)
```

---

## 2. Restaurant Partner Web Portal Flow (React 18 + Vite)

### 2.1 Onboarding & KYC Pipeline
```
[Partner Portal Login]
         |
         v
[Auth Screen: Email OTP / Google OAuth]
         |
         v
[Check Restaurant Profile in DB]
  +---> Exists & Approved --------> [Live Order Terminal / Dashboard]
  +---> Exists & Pending ---------> [KYC In-Review Status Screen]
  +---> No Profile Found ---------> [Multi-Step Onboarding Wizard]
                                           |
                   +-----------------------+-----------------------+
                   | Step 1: Restaurant Basic Info (Name, Phone, Address, Lat/Lng)
                   | Step 2: Legal Documents (FSSAI 14-digit, GSTIN, PAN Card)
                   | Step 3: Bank Account Verification (Account Number, IFSC)
                   | Step 4: Initial Menu Upload (PDF or Manual Entry)
                   +-----------------------------------------------+
                                           |
                                           v
                              [Submit for Admin Verification]
```

### 2.2 Live Order Terminal Lifecycle
```
[Live Order Terminal Screen]
  - WebSockets Active Room: `restaurant:<restaurantId>`
  - Audio Chime loop enabled
         |
         | (Incoming WebSocket Event: `order:created`)
         v
[Incoming Order Modal / Alert Card]
  - Displays Order ID, Items ordered, Customization notes, Customer Name
  - Actions:
      +---> [ACCEPT ORDER]
      |        |
      |        v
      |     Prompt: Select Preparation Time (15 min / 25 min / 40 min)
      |        |
      |        v
      |     Order moves to "PREPARING" column
      |     WebSocket emits `order:status_update` with prep time
      |
      +---> [REJECT ORDER]
               |
               v
            Prompt: Select Reason (Out of Stock / Kitchen Overloaded / Closing)
               |
               v
            WebSocket emits `order:cancelled`, triggers customer refund
         |
         v
[Food Packaged & Ready]
  - Partner clicks "FOOD READY FOR PICKUP"
  - Order moves to "READY" column
  - Live alert dispatched to assigned delivery rider
```

---

## 3. Admin Dashboard Operations Flow

```
[Admin Secure Login] (/admin/login)
  - Requires Admin Role in Supabase JWT
         |
         v
[Platform Overview Dashboard]
  |-- Live Counters: Active Orders, Daily GMV, Registered Restaurants, Active Riders
  |-- Real-Time System Health Indicator (DB connection, Redis latency, WebSocket count)
  |-- Quick Navigation Sidebar:
        |-- 1. Restaurant Approvals (/admin/restaurants/kyc)
        |-- 2. Live Order Monitor (/admin/orders)
        |-- 3. Menu & Content Moderation (/admin/moderation)
        |-- 4. Fraud & Cancellation Radar (/admin/fraud)
        |-- 5. Test Data Generator (/admin/demo-tools)
         |
         +---> (Demo Tool Selected: "Generate Test Restaurant")
         |        |
         |        v
         |     Admin enters: Name, Cuisine, City
         |     Clicks "Generate 15 Dishes with Images"
         |     Database populated in < 3 seconds -> Immediately visible in Customer App
         |
         +---> (Dispute Triggered: Order Refund Request)
                  |
                  v
               Admin inspects order timeline and chat logs
               Clicks "Authorize Full Refund"
               Backend calls Razorpay Refund API & updates PostgreSQL ledger
```

---

## 4. UI State Transitions & The 4-State Rule

Every data-fetching component in Quick Bite strictly implements the 4 standard UI states to guarantee zero blank screens:

```
+------------------------------------------------------------------------------------+
|                                COMPONENT DATA LIFECYCLE                            |
|                                                                                    |
|                   +-----------------------------------------+                      |
|                   |           1. LOADING STATE              |                      |
|                   | * Skeleton pulse placeholder            |                      |
|                   | * Shapes match final content dimensions |                      |
|                   | * User interaction disabled             |                      |
|                   +--------------------+--------------------+                      |
|                                        |                                           |
|                  +---------------------+---------------------+                     |
|                  |                                           |                     |
|                  v (Data fetch resolved)                     v (Fetch throws error)|
|    +-----------------------------+           +----------------------------------+  |
|    |      2. SUCCESS STATE       |           |         3. ERROR STATE           |  |
|    | * Data rendered in full UI  |           | * Friendly non-technical message |  |
|    | * Micro-animations on load  |           | * Prominent "Try Again" CTA      |  |
|    | * Interactive elements live |           | * Error logged to Sentry / audit |  |
|    +--------------+--------------+           +----------------------------------+  |
|                   |                                                                |
|                   v (If returned array length === 0)                               |
|    +-----------------------------+                                                 |
|    |       4. EMPTY STATE        |                                                 |
|    | * Relevant contextual icon  |                                                 |
|    | * Descriptive empty message |                                                 |
|    | * Direct actionable CTA     |                                                 |
|    |   (e.g., "Explore Dishes")  |                                                 |
|    +-----------------------------+                                                 |
+------------------------------------------------------------------------------------+
```

---

## 5. Decision Trees for Conditional Flows

### 5.1 Cart & Multi-Restaurant Conflict
```
Customer taps "Add Item" from Restaurant B
                 |
                 v
   Is Cart currently empty?
   +--- YES ---> Add Item to Cart -> Open Floating Bar
   +--- NO  ---> Does Cart belong to Restaurant B?
                  +--- YES ---> Add Item to Cart
                  +--- NO  ---> Show Alert Modal:
                                "Replace items already in cart?"
                                "Your cart contains dishes from [Restaurant A].
                                 Do you want to discard them and start a new order?"
                                 +---> [Keep Cart] ----> Dismiss modal
                                 +---> [Discard Cart] -> Clear Cart -> Add Item from Rest B
```

### 5.2 Checkout Payment Fallback
```
Customer initiates Razorpay Sandbox Online Payment
                 |
                 v
   Did Razorpay SDK return success payload?
   +--- YES ---> Backend verifies HMAC signature -> Order Confirmed
   +--- NO  ---> Reason for failure:
                  +--- User Cancelled ---> Return to payment selector with message:
                  |                        "Payment cancelled. You can choose COD or retry."
                  +--- Gateway Timeout --> Keep order in PAYMENT_PENDING for 5 mins
                  |                        Poll status / allow customer to retry
                  +--- Payment Declined -> Prompt to select alternative UPI / Card / COD
```

---

## 6. Error Recovery & Offline Persistence Flows

### Form Resilience Protocol
- Every keystroke on sensitive forms (KYC Upload, Address Entry, Profile Settings, Restaurant Menu Creation) is automatically written to local storage (`AsyncStorage` on mobile, `localStorage` on web) under a scoped key (e.g. `draft:address:user_123`).
- If network disconnects, tab is closed, or app crashes, the form automatically re-populates the user's input on reload.
- Form draft is deleted only upon verified HTTP 200/201 response from the server.

### Network Reconnection Handling
- When connection drops, a top banner alerts: `[INFO] Offline Mode. Changes will sync once connected.`
- When connection restores, background jobs re-validate cart pricing and synchronize any pending local mutations.
