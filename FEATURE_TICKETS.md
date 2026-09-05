# Quick Bite Platform -- Feature Development Tickets (FEATURE_TICKETS)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Engineering Team  

---

## 1. Feature Tickets Summary Matrix

| Ticket ID | Feature ID | Feature Title | Portal | Priority | Effort | Depends On | Assigned Chunk |
|-----------|------------|---------------|--------|----------|--------|------------|----------------|
| TICK-F01 | F01 | Email OTP & Google OAuth Authentication | Customer App | P0 | 5 SP | None | Chunk 02, 03 |
| TICK-F02 | F02 | Geolocation Detection & Address Picker | Customer App | P0 | 5 SP | TICK-F01 | Chunk 07 |
| TICK-F03 | F03 | Typo-Tolerant Search & Cuisines Filtering | Customer App | P0 | 8 SP | TICK-F02 | Chunk 04, 07 |
| TICK-F04 | F04 | Restaurant Detail Page & Catalog Browsing | Customer App | P0 | 8 SP | TICK-F03 | Chunk 07 |
| TICK-F05 | F05 | Cart Management & Real-Time Price Breakdown | Customer App | P0 | 5 SP | TICK-F04 | Chunk 04, 07 |
| TICK-F06 | F06 | Item Customization Modal (Variants & Addons) | Customer App | P0 | 5 SP | TICK-F05 | Chunk 04, 07 |
| TICK-F07 | F07 | Checkout Flow & Order Submission | Customer App | P0 | 8 SP | TICK-F05, TICK-F06 | Chunk 04, 07 |
| TICK-F08 | F08 | Razorpay Sandbox & Cash on Delivery Payments | Customer App | P0 | 8 SP | TICK-F07 | Chunk 04 |
| TICK-F09 | F09 | Real-Time Order Tracking & State Machine | Customer App | P0 | 8 SP | TICK-F08 | Chunk 08 |
| TICK-F10 | F10 | Saved Address Book (Home/Work/Other) | Customer App | P0 | 3 SP | TICK-F02 | Chunk 07 |
| TICK-F11 | F11 | Order History & One-Tap Reorder | Customer App | P0 | 5 SP | TICK-F09 | Chunk 07 |
| TICK-F12 | F12 | Push Notifications for Order Updates (FCM) | Customer App | P0 | 5 SP | TICK-F09 | Chunk 08 |
| TICK-F13 | F13 | Restaurant Reviews & Star Ratings | Customer App | P0 | 5 SP | TICK-F11 | Chunk 07 |
| TICK-F14 | F14 | Coupon & Promotional Discount Engine | Customer App | P0 | 5 SP | TICK-F05 | Chunk 04 |
| TICK-F15 | F15 | Quick Bite Gold Membership Subscription | Customer App | P0 | 5 SP | TICK-F05 | Chunk 04 |
| TICK-F16 | F16 | Dining-Out Table Booking & Discovery | Customer App | P0 | 5 SP | TICK-F04 | Chunk 04, 07 |
| TICK-F17 | F17 | Global Veg Mode Filter Toggle | Customer App | P0 | 3 SP | TICK-F03, TICK-F04 | Chunk 07 |
| TICK-F18 | F18 | Dark & Light Mode Theme Engine | Customer App / Web | P0 | 3 SP | None | Chunk 06 |
| TICK-F19 | F19 | Multi-Language UI Support (English, Hindi, Kannada) | All Portals | P0 | 5 SP | None | Chunk 06 |
| TICK-F20 | F20 | User Profile & Preferences Management | Customer App | P0 | 3 SP | TICK-F01 | Chunk 07 |
| TICK-F21 | F21 | Restaurant KYC Onboarding & Legal Verification | Restaurant Portal | P0 | 8 SP | None | Chunk 04, 07 |
| TICK-F22 | F22 | Real-Time Order Terminal for Kitchens | Restaurant Portal | P0 | 8 SP | TICK-F08 | Chunk 07, 08 |
| TICK-F23 | F23 | Menu Catalog & Instant Availability Manager | Restaurant Portal | P0 | 8 SP | None | Chunk 07 |
| TICK-F24 | F24 | Restaurant Analytics & Revenue Dashboard | Restaurant Portal | P0 | 5 SP | TICK-F22 | Chunk 07 |
| TICK-F25 | F25 | Commission Ledger & Payout Settlement Summary | Restaurant Portal | P0 | 5 SP | TICK-F24 | Chunk 07 |
| TICK-F26 | F26 | Restaurant Profile & Operating Hours Schedule | Restaurant Portal | P0 | 3 SP | None | Chunk 07 |
| TICK-F27 | F27 | Partner Review Management & Customer Replies | Restaurant Portal | P0 | 3 SP | TICK-F13 | Chunk 07 |
| TICK-F28 | F28 | Self-Serve Restaurant Promo & Discount Creator | Restaurant Portal | P0 | 5 SP | TICK-F14 | Chunk 04, 07 |
| TICK-F29 | F29 | Admin Operations Control Tower & Metrics | Admin Dashboard | P0 | 5 SP | None | Chunk 07 |
| TICK-F30 | F30 | Restaurant KYC Verification & Approval Pipeline | Admin Dashboard | P0 | 5 SP | TICK-F21 | Chunk 07 |
| TICK-F31 | F31 | Global Order Dispute Resolution & Refund Console | Admin Dashboard | P0 | 8 SP | TICK-F08 | Chunk 07 |
| TICK-F32 | F32 | User & Role Administration Console | Admin Dashboard | P0 | 5 SP | TICK-F01 | Chunk 07 |
| TICK-F33 | F33 | Platform-Wide Promotional Campaign Manager | Admin Dashboard | P0 | 5 SP | TICK-F14 | Chunk 07 |
| TICK-F34 | F34 | Demo Test Restaurant Generator Tool | Admin Dashboard | P0 | 5 SP | TICK-F04, TICK-F23 | Chunk 07 |
| TICK-F35 | F35 | UGC & Content Moderation Queue | Admin Dashboard | P0 | 5 SP | TICK-F13 | Chunk 07 |
| TICK-F36 | F36 | Fraud Velocity & Anomaly Detection Dashboard | Admin Dashboard | P0 | 5 SP | TICK-F08, TICK-F14 | Chunk 07 |
| TICK-F37 | F37 | Rider Partner KYC & Vehicle Onboarding | Rider App (Phase 1b) | P1b | 8 SP | None | Future Chunk |
| TICK-F38 | F38 | Order Dispatch Broadcast & Accept/Reject | Rider App (Phase 1b) | P1b | 8 SP | TICK-F22 | Future Chunk |
| TICK-F39 | F39 | Turn-by-Turn GPS Navigation & Routing | Rider App (Phase 1b) | P1b | 8 SP | TICK-F38 | Future Chunk |
| TICK-F40 | F40 | Secure OTP-Based Delivery Verification | Rider App (Phase 1b) | P1b | 5 SP | TICK-F38 | Future Chunk |
| TICK-F41 | F41 | Rider Earnings Ledger & Cash-in-Hand Tracker | Rider App (Phase 1b) | P1b | 5 SP | TICK-F40 | Future Chunk |
| TICK-F42 | F42 | Live Rider GPS Streaming & Customer Map Tracking | Customer App / Rider App | P1b | 8 SP | TICK-F09, TICK-F38 | Future Chunk |

---

## 2. Detailed Feature Ticket Specifications

### TICK-F01: Email OTP & Google OAuth Authentication
- **Feature ID:** F01
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 02, 03
- **Dependencies:** None
- **Description:** Passwordless authentication engine supporting email OTP and Google OAuth via Supabase Auth.

#### Definition of Done (DoD)
- Users can register and log in via 6-digit OTP received via email or Google sign-in; JWT tokens issued and stored securely; sessions auto-refresh.

#### Test Cases (Given / When / Then)
- **Given:** Given a registered or new email address
- **When:** When user submits email and enters correct 6-digit OTP within 5 minutes
- **Then:** Then auth tokens (access & refresh) are saved, user profile created in DB, and navigated to Home.

#### Edge Cases Handled
- Expired OTP (5m timeout); 3 incorrect OTP entries locks account for 15 minutes; network failure during OAuth callback.

#### Security & Compliance Considerations
- JWT stored in SecureStore on mobile; refresh token rotation; rate limiting 3 OTP sends per minute per IP.

#### 4-State UI Implementation
- **Loading State:** Loading (Spinner/Overlay while sending OTP)
- **Success State:** Success (Redirect to Home)
- **Error State:** Error (Inline red message with retry CTA)
- **Empty State:** Empty (Clean form with inputs).

---

### TICK-F02: Geolocation Detection & Address Picker
- **Feature ID:** F02
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F01
- **Description:** Auto-detect device GPS location and support interactive map pin dropping with OpenStreetMap Nominatim reverse geocoding.

#### Definition of Done (DoD)
- Device coordinates translated into human-readable street address; fallback to manual search if GPS denied.

#### Test Cases (Given / When / Then)
- **Given:** Given user opens app with GPS permission granted
- **When:** When app initializes location provider
- **Then:** Then coordinates are reverse-geocoded to street name and city, displayed in top header bar.

#### Edge Cases Handled
- GPS permission denied by user; device in airplane mode; coordinates fall outside supported delivery zones.

#### Security & Compliance Considerations
- Coordinates validated on backend to prevent arbitrary spoofed values outside boundary limits.

#### 4-State UI Implementation
- **Loading State:** Loading (Shimmering address pill in header)
- **Success State:** Success (Address displayed)
- **Error State:** Error (Address lookup failed with manual retry)
- **Empty State:** Empty (Prompt: Select Location).

---

### TICK-F03: Typo-Tolerant Search & Cuisines Filtering
- **Feature ID:** F03
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 8 SP | **Assigned Chunk:** Chunk 04, 07
- **Dependencies:** TICK-F02
- **Description:** Full-text typo-tolerant search across restaurants and menu items powered by Meilisearch with dynamic faceted filtering.

#### Definition of Done (DoD)
- Search query returns matches in <50ms with 2-char typo tolerance; filters for Veg/Non-Veg, Rating 4.0+, and Distance.

#### Test Cases (Given / When / Then)
- **Given:** Given a query with a typo like "piza" or "biryani"
- **When:** When user types query in search bar with 300ms debounce
- **Then:** Then matching dishes and restaurants are displayed ranked by relevance and proximity.

#### Edge Cases Handled
- Zero matches found; search input containing SQL/script injection payloads; special characters and emojis.

#### Security & Compliance Considerations
- Input sanitization against regex DoS; parameterized queries against search index.

#### 4-State UI Implementation
- **Loading State:** Loading (Grid of skeleton restaurant cards)
- **Success State:** Success (List of matching restaurants/dishes)
- **Error State:** Error (Search unavailable with retry)
- **Empty State:** Empty (No results found with popular suggestions).

---

### TICK-F04: Restaurant Detail Page & Catalog Browsing
- **Feature ID:** F04
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 8 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F03
- **Description:** Rich restaurant profile displaying operational status, FSSAI registration badge, categories, dish cards, and dietary tags.

#### Definition of Done (DoD)
- Displays full categorized menu with veg badges, dish images, prices, and instant Add button.

#### Test Cases (Given / When / Then)
- **Given:** Given user clicks on a restaurant card in the feed
- **When:** When restaurant detail screen mounts
- **Then:** Then restaurant metadata, banner, FSSAI license, and menu categories are fetched and rendered.

#### Edge Cases Handled
- Restaurant currently closed/offline; restaurant has empty menu; slow image loading from CDN.

#### Security & Compliance Considerations
- Restaurant ID validated; inactive/unapproved restaurants hidden from public access.

#### 4-State UI Implementation
- **Loading State:** Loading (Skeleton banner and menu item rows)
- **Success State:** Success (Full interactive menu)
- **Error State:** Error (Unable to load restaurant details with retry)
- **Empty State:** Empty (Menu temporarily unavailable).

---

### TICK-F05: Cart Management & Real-Time Price Breakdown
- **Feature ID:** F05
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 04, 07
- **Dependencies:** TICK-F04
- **Description:** Client-side cart with quantity stepper, single-restaurant enforcement modal, and server-side fee recalculation.

#### Definition of Done (DoD)
- Users can add, increment, decrement, and clear items; bill breakdown calculates item total, GST, packaging, and delivery fee.

#### Test Cases (Given / When / Then)
- **Given:** Given an item in the cart from Restaurant A
- **When:** When user attempts to add an item from Restaurant B
- **Then:** Then an alert modal appears prompting whether to discard current cart or cancel.

#### Edge Cases Handled
- Item goes out of stock while in cart; prices modified on server; quantity exceeds max 20.

#### Security & Compliance Considerations
- All prices validated server-side during checkout; never trust client cart total.

#### 4-State UI Implementation
- **Loading State:** Loading (Price calculation spinner)
- **Success State:** Success (Itemized cart list and total)
- **Error State:** Error (Price discrepancy alert)
- **Empty State:** Empty (Empty cart illustration with "Browse Food" CTA).

---

### TICK-F06: Item Customization Modal (Variants & Addons)
- **Feature ID:** F06
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 04, 07
- **Dependencies:** TICK-F05
- **Description:** Modal dialog allowing users to choose portion sizes (radio), toppings/addons (checkboxes), spice level, and cooking notes.

#### Definition of Done (DoD)
- Dynamically calculates total price as addons are selected; enforces minimum and maximum selection constraints.

#### Test Cases (Given / When / Then)
- **Given:** Given a customizable dish (e.g. Pizza with size and extra cheese)
- **When:** When user clicks "ADD"
- **Then:** Then modal opens, requires 1 size selection, allows optional toppings, and updates button price.

#### Edge Cases Handled
- Required variant not selected; special instructions exceed 150 characters.

#### Security & Compliance Considerations
- Addon IDs and prices validated server-side against MongoDB catalog.

#### 4-State UI Implementation
- **Loading State:** Loading (Skeleton modal)
- **Success State:** Success (Interactive option groups)
- **Error State:** Error (Failed to load options)
- **Empty State:** Empty (Standard item added directly without modal).

---

### TICK-F07: Checkout Flow & Order Submission
- **Feature ID:** F07
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 8 SP | **Assigned Chunk:** Chunk 04, 07
- **Dependencies:** TICK-F05, TICK-F06
- **Description:** Comprehensive checkout screen combining delivery address, delivery instructions, coupon redemption, and payment trigger.

#### Definition of Done (DoD)
- Submits order with client-generated idempotency key; validates delivery radius (<15km); transitions to tracking.

#### Test Cases (Given / When / Then)
- **Given:** Given a valid cart with items
- **When:** When user selects saved address, verifies total, and taps "Proceed to Pay"
- **Then:** Then backend creates order record and returns payment order ID or confirms COD order.

#### Edge Cases Handled
- Network timeout during submission; restaurant closes during checkout; address out of delivery range.

#### Security & Compliance Considerations
- Idempotency key prevents duplicate charges; address coordinate distance re-verified in PostGIS.

#### 4-State UI Implementation
- **Loading State:** Loading (Placing order progress modal)
- **Success State:** Success (Redirect to live tracking)
- **Error State:** Error (Order failed banner with retry)
- **Empty State:** Empty (Cart empty redirect).

---

### TICK-F08: Razorpay Sandbox & Cash on Delivery Payments
- **Feature ID:** F08
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 8 SP | **Assigned Chunk:** Chunk 04
- **Dependencies:** TICK-F07
- **Description:** Payment processing integrating Razorpay Sandbox (UPI, cards, netbanking) and Cash on Delivery with signature verification.

#### Definition of Done (DoD)
- Generates Razorpay order, opens payment sheet, verifies HMAC SHA256 signature upon completion, handles COD fallback.

#### Test Cases (Given / When / Then)
- **Given:** Given an order ready for payment
- **When:** When customer completes payment via test UPI VPA or selects COD
- **Then:** Then payment transaction is verified on backend and order state advances to ORDER_PLACED.

#### Edge Cases Handled
- Customer drops payment halfway; webhook arrives before frontend redirect; signature verification mismatch.

#### Security & Compliance Considerations
- HMAC signature verification on backend; zero plaintext card storage; webhook replay attack prevention.

#### 4-State UI Implementation
- **Loading State:** Loading (Opening secure gateway)
- **Success State:** Success (Payment verified checkmark)
- **Error State:** Error (Payment failed dialog with retry CTA)
- **Empty State:** Empty (N/A).

---

### TICK-F09: Real-Time Order Tracking & State Machine
- **Feature ID:** F09
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 8 SP | **Assigned Chunk:** Chunk 08
- **Dependencies:** TICK-F08
- **Description:** Live tracking screen displaying step progress through 8 lifecycle states with ETA timer and live socket updates.

#### Definition of Done (DoD)
- Connects to Socket.io room order:<id>; updates status indicators instantly upon receiving status events.

#### Test Cases (Given / When / Then)
- **Given:** Given an active placed order
- **When:** When restaurant updates status to PREPARING or READY
- **Then:** Then tracking screen animates progress step and updates estimated delivery countdown.

#### Edge Cases Handled
- WebSocket disconnects mid-delivery; order gets cancelled by restaurant; order takes longer than original ETA.

#### Security & Compliance Considerations
- Socket connection authenticated with JWT; user can only join room for their own order ID.

#### 4-State UI Implementation
- **Loading State:** Loading (Skeleton tracking card)
- **Success State:** Success (Live status timeline with active step)
- **Error State:** Error (Connection lost banner with reconnect button)
- **Empty State:** Empty (No active order found).

---

### TICK-F10: Saved Address Book (Home/Work/Other)
- **Feature ID:** F10
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 3 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F02
- **Description:** Address management enabling users to save, label (Home, Work, Other), edit, and delete delivery locations with map pins.

#### Definition of Done (DoD)
- Full CRUD operations on addresses; default address selection persists across sessions.

#### Test Cases (Given / When / Then)
- **Given:** Given user in address management settings
- **When:** When user adds new address with building name, street, and coordinates
- **Then:** Then address is saved in PostgreSQL and immediately available at checkout.

#### Edge Cases Handled
- User attempts to save address with missing floor/door number; deleting the active default address.

#### Security & Compliance Considerations
- User isolation: user can only access addresses where user_id matches JWT sub.

#### 4-State UI Implementation
- **Loading State:** Loading (Address card skeletons)
- **Success State:** Success (List of saved addresses)
- **Error State:** Error (Failed to save address)
- **Empty State:** Empty (No saved addresses with "Add New Address" CTA).

---

### TICK-F11: Order History & One-Tap Reorder
- **Feature ID:** F11
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F09
- **Description:** Chronological order history list displaying past orders, item summaries, bill totals, invoice downloads, and reorder button.

#### Definition of Done (DoD)
- Displays past orders with paginated infinite scroll; Reorder button checks current item availability and populates cart.

#### Test Cases (Given / When / Then)
- **Given:** Given a past delivered order
- **When:** When user taps "Reorder"
- **Then:** Then system checks if items are still in stock; available items added to cart; alert shown for any discontinued item.

#### Edge Cases Handled
- All items from past order are discontinued; restaurant has permanently closed.

#### Security & Compliance Considerations
- Users can only view their own order history; invoice links signed with time-limited URLs.

#### 4-State UI Implementation
- **Loading State:** Loading (List of skeleton order cards)
- **Success State:** Success (Past orders list)
- **Error State:** Error (Unable to load orders)
- **Empty State:** Empty (No past orders with "Order Now" CTA).

---

### TICK-F12: Push Notifications for Order Updates (FCM)
- **Feature ID:** F12
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 08
- **Dependencies:** TICK-F09
- **Description:** Firebase Cloud Messaging integration for background and lock-screen notifications on key order lifecycle events.

#### Definition of Done (DoD)
- Device registers FCM token on launch; backend sends push notification on Placed, Accepted, Out for Delivery, and Delivered.

#### Test Cases (Given / When / Then)
- **Given:** Given an app in background on customer device
- **When:** When restaurant accepts order and sets 20-min prep time
- **Then:** Then native push alert displays: "Your order has been accepted! Delivery in ~30 mins".

#### Edge Cases Handled
- User denies push notification permissions; token expired or refreshed by Google Play services.

#### Security & Compliance Considerations
- Device tokens stored securely in DB tied to user_id; tokens cleared on user logout.

#### 4-State UI Implementation
- **Loading State:** Loading (N/A - Background)
- **Success State:** Success (System push banner)
- **Error State:** Error (Silent failure with in-app toast fallback)
- **Empty State:** Empty (N/A).

---

### TICK-F13: Restaurant Reviews & Star Ratings
- **Feature ID:** F13
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F11
- **Description:** Post-delivery review system allowing diners to give a 1-5 star rating, select praise tags, and write feedback.

#### Definition of Done (DoD)
- Can only be submitted for completed orders; updates restaurant average rating score and total review count in real time.

#### Test Cases (Given / When / Then)
- **Given:** Given an order marked DELIVERED
- **When:** When user submits 5-star rating with comment "Delicious food"
- **Then:** Then review saved in MongoDB, restaurant aggregate rating updated in PostgreSQL, and card shown on restaurant page.

#### Edge Cases Handled
- User attempts to review same order multiple times; profanity or abusive language in review text.

#### Security & Compliance Considerations
- Verified purchase check: user must possess an order with status DELIVERED; rate-limited to 1 review per order.

#### 4-State UI Implementation
- **Loading State:** Loading (Submitting review spinner)
- **Success State:** Success (Thank you confirmation modal)
- **Error State:** Error (Submission failed retry)
- **Empty State:** Empty (No reviews yet badge).

---

### TICK-F14: Coupon & Promotional Discount Engine
- **Feature ID:** F14
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 04
- **Dependencies:** TICK-F05
- **Description:** Dynamic promo engine evaluating percentage discounts, flat cashbacks, free delivery, minimum order rules, and usage caps.

#### Definition of Done (DoD)
- Validates coupon code, calculates discount amount, enforces maximum discount ceiling, and rejects expired codes.

#### Test Cases (Given / When / Then)
- **Given:** Given a cart with total Rs 400 and coupon CODE20 (20% off up to Rs 50, min order Rs 300)
- **When:** When user enters and applies CODE20
- **Then:** Then Rs 50 discount is applied to bill summary and discount badge is displayed.

#### Edge Cases Handled
- Cart subtotal falls below minimum threshold after removing an item; user has already used single-use code.

#### Security & Compliance Considerations
- Coupon validation executed server-side; race condition prevented via atomic redemption increment.

#### 4-State UI Implementation
- **Loading State:** Loading (Validating coupon code)
- **Success State:** Success (Coupon applied with savings message)
- **Error State:** Error (Invalid/expired coupon reason)
- **Empty State:** Empty (List of available coupons).

---

### TICK-F15: Quick Bite Gold Membership Subscription
- **Feature ID:** F15
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 04
- **Dependencies:** TICK-F05
- **Description:** Subscription membership granting zero delivery fees on orders above Rs 199 and VIP dining discounts at partner restaurants.

#### Definition of Done (DoD)
- Gold plan purchase flow; activates is_gold flag on user profile; automatically deducts delivery fee at checkout.

#### Test Cases (Given / When / Then)
- **Given:** Given an active Quick Bite Gold subscriber
- **When:** When customer builds a cart with food total >= Rs 199
- **Then:** Then delivery fee line item shows "Rs 0 (Gold Free Delivery)" with strikethrough original fee.

#### Edge Cases Handled
- Cart total is Rs 198 (below threshold); subscription expired.

#### Security & Compliance Considerations
- Subscription status and expiry date validated server-side during checkout calculation.

#### 4-State UI Implementation
- **Loading State:** Loading (Activating membership)
- **Success State:** Success (Gold badge displayed on profile)
- **Error State:** Error (Subscription activation failed)
- **Empty State:** Empty (Gold upsell banner).

---

### TICK-F16: Dining-Out Table Booking & Discovery
- **Feature ID:** F16
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 04, 07
- **Dependencies:** TICK-F04
- **Description:** Discovery module for dine-in venues, slot booking for table reservations, and in-app dining discount bill settlement.

#### Definition of Done (DoD)
- Users can pick date, time slot, guest count; receives instant booking confirmation voucher; restaurant notified.

#### Test Cases (Given / When / Then)
- **Given:** Given a dining partner restaurant with available slots
- **When:** When user reserves table for 4 guests on Friday 8:00 PM
- **Then:** Then reservation record created in DB, confirmation SMS/Email sent, and reservation appears in "My Bookings".

#### Edge Cases Handled
- Slot fully booked; reservation cancelled less than 1 hour before arrival.

#### Security & Compliance Considerations
- Slot capacity locking using Redis mutex to prevent double-booking identical tables.

#### 4-State UI Implementation
- **Loading State:** Loading (Fetching available slots)
- **Success State:** Success (Reservation confirmed card)
- **Error State:** Error (Slot no longer available)
- **Empty State:** Empty (No slots available for chosen date).

---

### TICK-F17: Global Veg Mode Filter Toggle
- **Feature ID:** F17
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 3 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F03, TICK-F04
- **Description:** Persistent header toggle that filters out all non-vegetarian dishes and pure non-veg restaurants across the entire app.

#### Definition of Done (DoD)
- Activating toggle instantly filters Home feed, search results, and restaurant menus to show 100% vegetarian options only.

#### Test Cases (Given / When / Then)
- **Given:** Given user enables Veg Mode switch in header
- **When:** When user navigates to any restaurant menu or searches for dishes
- **Then:** Then all non-veg items (red square badge) are hidden; green leaf badge displayed in header.

#### Edge Cases Handled
- Restaurant has zero vegetarian items; turning off veg mode restores previous cart items cleanly.

#### Security & Compliance Considerations
- Client state synced to user preferences table in DB if logged in.

#### 4-State UI Implementation
- **Loading State:** Loading (Instant local state update)
- **Success State:** Success (Veg-only catalog rendered)
- **Error State:** Error (N/A)
- **Empty State:** Empty (No vegetarian items found prompt).

---

### TICK-F18: Dark & Light Mode Theme Engine
- **Feature ID:** F18
- **Portal:** Customer App / Web
- **Priority:** P0 | **Effort Estimate:** 3 SP | **Assigned Chunk:** Chunk 06
- **Dependencies:** None
- **Description:** Dynamic theming system supporting System Default, Force Dark, and Force Light modes using CSS variables and React Context.

#### Definition of Done (DoD)
- Switches all colors, surfaces, text, borders, and shadows seamlessly without page refresh or unstyled flicker.

#### Test Cases (Given / When / Then)
- **Given:** Given user toggles Dark Mode in settings
- **When:** When theme context updates
- **Then:** Then background changes to dark space navy (#060918), text to high-contrast white (#F8FAFC), with zero contrast loss.

#### Edge Cases Handled
- System OS switches between day/night while app is in foreground; custom brand colors maintain legible contrast.

#### Security & Compliance Considerations
- Preferences saved locally in theme storage key; no server security implications.

#### 4-State UI Implementation
- **Loading State:** Loading (Instant transition)
- **Success State:** Success (Themed UI)
- **Error State:** Error (N/A)
- **Empty State:** Empty (N/A).

---

### TICK-F19: Multi-Language UI Support (English, Hindi, Kannada)
- **Feature ID:** F19
- **Portal:** All Portals
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 06
- **Dependencies:** None
- **Description:** Internationalization (i18n) framework using react-i18next supporting complete UI translation in English, Hindi, and Kannada.

#### Definition of Done (DoD)
- Language switcher updates all navigation, headings, buttons, cart summaries, and alert dialogs dynamically.

#### Test Cases (Given / When / Then)
- **Given:** Given user selects "ಕನ್ನಡ" (Kannada) in language settings
- **When:** When language change event fires
- **Then:** Then all UI text keys render Kannada translations immediately; preference saved in local storage.

#### Edge Cases Handled
- Missing translation key falls back to English; text length variations causing layout wrapping.

#### Security & Compliance Considerations
- Translation JSON files packaged locally; no untrusted remote script injection.

#### 4-State UI Implementation
- **Loading State:** Loading (Instant string lookup)
- **Success State:** Success (Translated UI)
- **Error State:** Error (Fallback to English string)
- **Empty State:** Empty (N/A).

---

### TICK-F20: User Profile & Preferences Management
- **Feature ID:** F20
- **Portal:** Customer App
- **Priority:** P0 | **Effort Estimate:** 3 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F01
- **Description:** Profile screen allowing users to edit full name, phone number, email address, dietary restrictions, and avatar photo.

#### Definition of Done (DoD)
- Updates user profile in Supabase; avatar uploaded to Cloudflare R2; input validated via Zod schema.

#### Test Cases (Given / When / Then)
- **Given:** Given an authenticated user
- **When:** When user edits their display name and updates phone number
- **Then:** Then changes are saved to DB and reflected immediately across app headers.

#### Edge Cases Handled
- Phone number in invalid Indian format; avatar image upload exceeds 5MB limit.

#### Security & Compliance Considerations
- Phone number format verified (+91 10-digit); image mime-type validated (jpeg/png/webp only).

#### 4-State UI Implementation
- **Loading State:** Loading (Saving profile spinner)
- **Success State:** Success (Profile updated toast)
- **Error State:** Error (Validation error messages)
- **Empty State:** Empty (Default avatar placeholder).

---

### TICK-F21: Restaurant KYC Onboarding & Legal Verification
- **Feature ID:** F21
- **Portal:** Restaurant Portal
- **Priority:** P0 | **Effort Estimate:** 8 SP | **Assigned Chunk:** Chunk 04, 07
- **Dependencies:** None
- **Description:** Multi-step registration workflow for restaurant partners to submit FSSAI license, GSTIN, PAN, bank account, and kitchen photos.

#### Definition of Done (DoD)
- Form persists data on reload; uploads documents to Cloudflare R2; marks restaurant status as PENDING_APPROVAL.

#### Test Cases (Given / When / Then)
- **Given:** Given a new restaurant owner registering their business
- **When:** When all 4 onboarding steps are completed and submitted
- **Then:** Then documents stored in R2, KYC record created in DB, and review ticket created in Admin dashboard queue.

#### Edge Cases Handled
- FSSAI license number is not 14 digits; GSTIN format checksum invalid; user loses internet halfway through upload.

#### Security & Compliance Considerations
- Bank IFSC and account number encrypted at rest; KYC documents accessible only to verified Admins and owner.

#### 4-State UI Implementation
- **Loading State:** Loading (Uploading documents progress bar)
- **Success State:** Success (Submission received confirmation screen)
- **Error State:** Error (Invalid document alert)
- **Empty State:** Empty (Step 1 blank form).

---

### TICK-F22: Real-Time Order Terminal for Kitchens
- **Feature ID:** F22
- **Portal:** Restaurant Portal
- **Priority:** P0 | **Effort Estimate:** 8 SP | **Assigned Chunk:** Chunk 07, 08
- **Dependencies:** TICK-F08
- **Description:** Audio-visual order management terminal for restaurant operators to receive, accept, assign prep times, and mark food ready.

#### Definition of Done (DoD)
- Subscribes to restaurant:<id> WebSocket room; triggers audio chime on incoming order; provides 1-click Accept / Reject.

#### Test Cases (Given / When / Then)
- **Given:** Given kitchen terminal open on web browser
- **When:** When new customer order is placed
- **Then:** Then loud audio chime plays, new order modal pops up, and operator can select prep time (e.g. 20m) to accept.

#### Edge Cases Handled
- Browser tab backgrounded (audio permissions); WebSocket drops and reconnects; multiple incoming orders simultaneously.

#### Security & Compliance Considerations
- Only authenticated owners of the restaurant can access terminal; state transitions validated server-side.

#### 4-State UI Implementation
- **Loading State:** Loading (Terminal connecting indicator)
- **Success State:** Success (Live order board with Pending, Preparing, and Ready columns)
- **Error State:** Error (Connection lost banner)
- **Empty State:** Empty (No active orders illustration).

---

### TICK-F23: Menu Catalog & Instant Availability Manager
- **Feature ID:** F23
- **Portal:** Restaurant Portal
- **Priority:** P0 | **Effort Estimate:** 8 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** None
- **Description:** Menu editor for restaurant managers to create categories, add dishes, set prices, upload dish photos, and toggle In-Stock/Out-of-Stock.

#### Definition of Done (DoD)
- CRUD operations on menu items; instant stock toggle updates customer search and menus in < 2 seconds.

#### Test Cases (Given / When / Then)
- **Given:** Given an active dish in restaurant catalog
- **When:** When restaurant manager toggles stock switch to "Out of Stock"
- **Then:** Then item marked unavailable in MongoDB, Redis cache purged, and customer app greys out Add button immediately.

#### Edge Cases Handled
- Customer has item in cart right as restaurant marks it out of stock; price entered as negative or non-numeric.

#### Security & Compliance Considerations
- Price and stock mutations restricted to restaurant owner; dish descriptions sanitized against XSS.

#### 4-State UI Implementation
- **Loading State:** Loading (Menu skeleton list)
- **Success State:** Success (Categorized dish list with toggles)
- **Error State:** Error (Failed to update item)
- **Empty State:** Empty (No items in menu with "Add First Dish" CTA).

---

### TICK-F24: Restaurant Analytics & Revenue Dashboard
- **Feature ID:** F24
- **Portal:** Restaurant Portal
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F22
- **Description:** Business intelligence dashboard showing gross sales, completed orders, cancellation rate, peak ordering hours, and top dishes.

#### Definition of Done (DoD)
- Renders responsive SVG charts (daily/weekly/monthly); calculates average order value (AOV) and customer satisfaction score.

#### Test Cases (Given / When / Then)
- **Given:** Given restaurant with completed orders over past 30 days
- **When:** When manager opens Analytics tab
- **Then:** Then metrics cards, revenue trajectory line chart, and top 5 bestseller list are rendered.

#### Edge Cases Handled
- Brand new restaurant with 0 past orders; leap year / date timezone edge cases.

#### Security & Compliance Considerations
- Financial metrics strictly scoped to authenticated restaurant ID; zero data leakage across competitors.

#### 4-State UI Implementation
- **Loading State:** Loading (Skeleton metrics cards and chart placeholder)
- **Success State:** Success (Populated charts and metrics)
- **Error State:** Error (Unable to load analytics)
- **Empty State:** Empty (Zero sales notice with tips to boost orders).

---

### TICK-F25: Commission Ledger & Payout Settlement Summary
- **Feature ID:** F25
- **Portal:** Restaurant Portal
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F24
- **Description:** Financial ledger displaying transparent commission breakdown (15%), GST deductions, packaging recoveries, and weekly net payout status.

#### Definition of Done (DoD)
- Itemizes every order transaction; generates downloadable settlement statement with bank UTR reference numbers.

#### Test Cases (Given / When / Then)
- **Given:** Given a weekly settlement period
- **When:** When restaurant manager reviews Payouts tab
- **Then:** Then gross order value, platform fee deduction, 1% TDS, and net payable amount are shown with settlement date.

#### Edge Cases Handled
- Negative balance due to customer refunds; pending bank holiday delays.

#### Security & Compliance Considerations
- Banking details masked (shows last 4 digits only); ledger records immutable.

#### 4-State UI Implementation
- **Loading State:** Loading (Ledger table skeleton)
- **Success State:** Success (Itemized payout history)
- **Error State:** Error (Payout data unavailable)
- **Empty State:** Empty (No settlements yet).

---

### TICK-F26: Restaurant Profile & Operating Hours Schedule
- **Feature ID:** F26
- **Portal:** Restaurant Portal
- **Priority:** P0 | **Effort Estimate:** 3 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** None
- **Description:** Settings screen to configure restaurant name, address, cuisine tags, contact phone, and weekly opening/closing slot hours.

#### Definition of Done (DoD)
- Updates restaurant profile; automated cron/logic closes restaurant for ordering outside configured time slots.

#### Test Cases (Given / When / Then)
- **Given:** Given restaurant with operating hours 11:00 AM - 11:00 PM
- **When:** When local time is 11:30 PM
- **Then:** Then restaurant status automatically flags as "CLOSED", preventing new order placements in customer app.

#### Edge Cases Handled
- Operating hours cross midnight (e.g. 7:00 PM - 3:00 AM); temporary emergency closure switch.

#### Security & Compliance Considerations
- Changes strictly validated and authorized to owner.

#### 4-State UI Implementation
- **Loading State:** Loading (Form skeleton)
- **Success State:** Success (Schedule saved confirmation toast)
- **Error State:** Error (Validation error message)
- **Empty State:** Empty (Blank schedule with standard defaults).

---

### TICK-F27: Partner Review Management & Customer Replies
- **Feature ID:** F27
- **Portal:** Restaurant Portal
- **Priority:** P0 | **Effort Estimate:** 3 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F13
- **Description:** Customer feedback portal allowing restaurant managers to view all verified ratings, read reviews, and post public official replies.

#### Definition of Done (DoD)
- Displays review feed sorted by date or rating; allows single official reply per review; notifies reviewer on reply.

#### Test Cases (Given / When / Then)
- **Given:** Given a customer review on a restaurant
- **When:** When restaurant manager posts reply: "Thank you for the kind words!"
- **Then:** Then reply stored, verified partner badge displayed under review, and customer receives notification.

#### Edge Cases Handled
- Restaurant attempts to reply multiple times; reply contains abusive text.

#### Security & Compliance Considerations
- Replies sanitized against XSS; only owner can reply on behalf of the restaurant.

#### 4-State UI Implementation
- **Loading State:** Loading (Review card skeletons)
- **Success State:** Success (Review list with reply input)
- **Error State:** Error (Failed to post reply)
- **Empty State:** Empty (No customer reviews yet).

---

### TICK-F28: Self-Serve Restaurant Promo & Discount Creator
- **Feature ID:** F28
- **Portal:** Restaurant Portal
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 04, 07
- **Dependencies:** TICK-F14
- **Description:** Marketing tool for restaurants to configure store-funded coupons (e.g., 20% off up to Rs 60 on orders above Rs 250).

#### Definition of Done (DoD)
- Restaurant configures discount percentage, cap, validity dates; coupon immediately visible on restaurant menu page.

#### Test Cases (Given / When / Then)
- **Given:** Given restaurant owner creating weekend promo promo code WEEKEND20
- **When:** When promo is saved with active dates
- **Then:** Then coupon registered in DB, discount cost allocated to restaurant settlement, and banner shown on restaurant page.

#### Edge Cases Handled
- Discount exceeds 100%; promo start date is in the past; budget cap reached.

#### Security & Compliance Considerations
- Restricted to restaurant scope; cannot create platform-wide subsidies.

#### 4-State UI Implementation
- **Loading State:** Loading (Saving coupon)
- **Success State:** Success (Coupon active badge)
- **Error State:** Error (Form error messages)
- **Empty State:** Empty (No active campaigns with "Create Campaign" CTA).

---

### TICK-F29: Admin Operations Control Tower & Metrics
- **Feature ID:** F29
- **Portal:** Admin Dashboard
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** None
- **Description:** Real-time operational dashboard for platform administrators showing live order volume, active riders, server health, and GMV.

#### Definition of Done (DoD)
- Displays live counters updated via WebSockets/polling; highlights system alerts and latency spikes.

#### Test Cases (Given / When / Then)
- **Given:** Given super-admin logging into Admin Portal
- **When:** When dashboard mounts
- **Then:** Then live platform GMV, today active orders, online restaurants, and API health indicators are displayed.

#### Edge Cases Handled
- API gateway under heavy load; WebSocket connection to admin room lost.

#### Security & Compliance Considerations
- Protected by super-admin RBAC check; session automatically expires after 30 minutes of inactivity.

#### 4-State UI Implementation
- **Loading State:** Loading (Dashboard grid skeletons)
- **Success State:** Success (Live KPI metric cards)
- **Error State:** Error (System alert banner)
- **Empty State:** Empty (N/A).

---

### TICK-F30: Restaurant KYC Verification & Approval Pipeline
- **Feature ID:** F30
- **Portal:** Admin Dashboard
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F21
- **Description:** Admin workflow to review pending restaurant applications, inspect uploaded FSSAI/GST certificates, and approve or reject.

#### Definition of Done (DoD)
- Displays document viewer; 1-click Approve or Reject with reason; sends automated notification email to restaurant owner.

#### Test Cases (Given / When / Then)
- **Given:** Given a restaurant with status PENDING_APPROVAL
- **When:** When admin inspects documents and clicks "Approve Restaurant"
- **Then:** Then restaurant status updated to ACTIVE, search index updated, and confirmation email sent via Resend.

#### Edge Cases Handled
- Admin rejects application without providing a mandatory rejection reason.

#### Security & Compliance Considerations
- Approval audit trail logged with admin user ID, timestamp, and IP address.

#### 4-State UI Implementation
- **Loading State:** Loading (Table skeleton)
- **Success State:** Success (Application list with detail modal)
- **Error State:** Error (Action failed alert)
- **Empty State:** Empty (No pending applications queue clean).

---

### TICK-F31: Global Order Dispute Resolution & Refund Console
- **Feature ID:** F31
- **Portal:** Admin Dashboard
- **Priority:** P0 | **Effort Estimate:** 8 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F08
- **Description:** Administrative order console to look up any platform order, inspect full event timeline, and issue partial or full refunds.

#### Definition of Done (DoD)
- Admin can search by Order ID or User Phone; displays state transitions; executes idempotent Razorpay refund API call.

#### Test Cases (Given / When / Then)
- **Given:** Given a disputed order where food was spilled
- **When:** When admin selects "Issue Full Refund" with reason "Quality Issue"
- **Then:** Then Razorpay refund processed, ledger updated, customer notified, and order marked REFUNDED.

#### Edge Cases Handled
- Refund attempted on an already refunded order; payment was COD (triggers wallet credit instead of gateway refund).

#### Security & Compliance Considerations
- Refund actions require secondary confirmation modal; all refund events permanently recorded in audit logs.

#### 4-State UI Implementation
- **Loading State:** Loading (Processing refund)
- **Success State:** Success (Refund receipt and updated order state)
- **Error State:** Error (Gateway refund error)
- **Empty State:** Empty (No orders matching search).

---

### TICK-F32: User & Role Administration Console
- **Feature ID:** F32
- **Portal:** Admin Dashboard
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F01
- **Description:** Management interface for user accounts, role assignment (Customer, Partner, Admin), account suspension, and session revocation.

#### Definition of Done (DoD)
- Admins can search users, inspect order count, ban malicious users, and instantly terminate active JWT sessions via Redis blocklist.

#### Test Cases (Given / When / Then)
- **Given:** Given a fraudulent user account performing velocity abuse
- **When:** When admin clicks "Suspend Account"
- **Then:** Then user status set to BANNED, user ID added to Redis revocation cache, and all active sessions immediately rejected.

#### Edge Cases Handled
- Admin attempts to suspend their own account.

#### Security & Compliance Considerations
- Prevent self-demotion/banning; super-admin privilege escalation checks.

#### 4-State UI Implementation
- **Loading State:** Loading (User table skeleton)
- **Success State:** Success (User directory list)
- **Error State:** Error (Action failed toast)
- **Empty State:** Empty (No users found).

---

### TICK-F33: Platform-Wide Promotional Campaign Manager
- **Feature ID:** F33
- **Portal:** Admin Dashboard
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F14
- **Description:** Marketing management tool to create global coupons (e.g., QUICKBITE100) funded by platform, with total budget allocation limits.

#### Definition of Done (DoD)
- Admin configures code, discount type, max budget (e.g. Rs 50,000); auto-deactivates when budget cap is consumed.

#### Test Cases (Given / When / Then)
- **Given:** Given a platform-wide coupon with Rs 10,000 budget cap
- **When:** When cumulative discounts reach Rs 10,000
- **Then:** Then coupon status automatically flips to EXHAUSTED, preventing further customer applications.

#### Edge Cases Handled
- Two customers apply final coupon balance simultaneously (concurrency race condition).

#### Security & Compliance Considerations
- Atomic decrement in Redis to prevent exceeding marketing budget.

#### 4-State UI Implementation
- **Loading State:** Loading (Saving campaign)
- **Success State:** Success (Campaign live badge with spend tracker)
- **Error State:** Error (Validation error)
- **Empty State:** Empty (No active platform coupons).

---

### TICK-F34: Demo Test Restaurant Generator Tool
- **Feature ID:** F34
- **Portal:** Admin Dashboard
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F04, TICK-F23
- **Description:** One-click administrative tool to instantly populate the database with realistic sample restaurants, full menus, and dish images.

#### Definition of Done (DoD)
- Admin enters restaurant name or clicks "Generate Random"; creates restaurant, 15 categorized dishes with images in <3s.

#### Test Cases (Given / When / Then)
- **Given:** Given a clean or demo environment
- **When:** When admin clicks "Generate Test Restaurant" (e.g. Bangalore Biryani House)
- **Then:** Then complete restaurant, menu, categories, and working coordinates are inserted and indexed in Meilisearch.

#### Edge Cases Handled
- Executing generator in production mode (requires explicit confirmation).

#### Security & Compliance Considerations
- Tool only accessible to Admin users; disabled in production environments without debug key.

#### 4-State UI Implementation
- **Loading State:** Loading (Generating restaurant data animation)
- **Success State:** Success (Test restaurant created with direct link)
- **Error State:** Error (Generation failed)
- **Empty State:** Empty (N/A).

---

### TICK-F35: UGC & Content Moderation Queue
- **Feature ID:** F35
- **Portal:** Admin Dashboard
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F13
- **Description:** Review queue for customer dish photos, user reviews, and restaurant banners flagged by automated profanity filters or users.

#### Definition of Done (DoD)
- Admin can approve, hide, or permanently delete flagged content; removes violating images from Cloudflare R2.

#### Test Cases (Given / When / Then)
- **Given:** Given a customer review flagged for inappropriate language
- **When:** When admin clicks "Remove Content"
- **Then:** Then review text is masked, image unlinked, and reviewer notified of community guideline violation.

#### Edge Cases Handled
- Content already deleted by author prior to admin action.

#### Security & Compliance Considerations
- Permanent deletion wipes object from R2 storage.

#### 4-State UI Implementation
- **Loading State:** Loading (Queue table skeleton)
- **Success State:** Success (Moderation queue with approve/delete CTAs)
- **Error State:** Error (Action error)
- **Empty State:** Empty (Queue clear clean state).

---

### TICK-F36: Fraud Velocity & Anomaly Detection Dashboard
- **Feature ID:** F36
- **Portal:** Admin Dashboard
- **Priority:** P0 | **Effort Estimate:** 5 SP | **Assigned Chunk:** Chunk 07
- **Dependencies:** TICK-F08, TICK-F14
- **Description:** Automated monitoring console displaying accounts exhibiting high cancellation velocity, repeated payment failures, or coupon abuse.

#### Definition of Done (DoD)
- Flags users with >3 cancellations/week or >5 failed card attempts/hour; provides 1-click ban action.

#### Test Cases (Given / When / Then)
- **Given:** Given an account attempting rapid payment retries with different cards
- **When:** When velocity exceeds 5 attempts in 10 minutes
- **Then:** Then account appears in Fraud Radar with HIGH RISK badge and temporary checkout freeze.

#### Edge Cases Handled
- Legitimate customer with genuine bank OTP issues.

#### Security & Compliance Considerations
- Protects merchant account from payment gateway fraud penalties.

#### 4-State UI Implementation
- **Loading State:** Loading (Scanning radar animation)
- **Success State:** Success (List of flagged accounts with risk scores)
- **Error State:** Error (Radar offline alert)
- **Empty State:** Empty (No anomalies detected green shield).

---

### TICK-F37: Rider Partner KYC & Vehicle Onboarding
- **Feature ID:** F37
- **Portal:** Rider App (Phase 1b)
- **Priority:** P1b | **Effort Estimate:** 8 SP | **Assigned Chunk:** Future Chunk
- **Dependencies:** None
- **Description:** Driver registration collecting driving license, vehicle RC document, insurance, bank details, and selfie verification.

#### Definition of Done (DoD)
- Uploads verification documents to Cloudflare R2; status set to PENDING_APPROVAL; admin pipeline integration.

#### Test Cases (Given / When / Then)
- **Given:** Given a new delivery partner
- **When:** When documents submitted and verified by Admin
- **Then:** Then rider account activated and allowed to toggle status to "ONLINE".

#### Edge Cases Handled
- Driving license expired; image too blurry to read.

#### Security & Compliance Considerations
- Documents encrypted at rest; KYC review restricted to authorized operations leads.

#### 4-State UI Implementation
- **Loading State:** Loading (Uploading KYC documents)
- **Success State:** Success (Registration submitted)
- **Error State:** Error (Document verification failed)
- **Empty State:** Empty (Step 1 form).

---

### TICK-F38: Order Dispatch Broadcast & Accept/Reject
- **Feature ID:** F38
- **Portal:** Rider App (Phase 1b)
- **Priority:** P1b | **Effort Estimate:** 8 SP | **Assigned Chunk:** Future Chunk
- **Dependencies:** TICK-F22
- **Description:** Proximity-based dispatch algorithm broadcasting ready orders to closest available online rider within 3km.

#### Definition of Done (DoD)
- Rider receives audio alert with 30-second countdown to accept; auto-reassigns to next closest rider if rejected or timed out.

#### Test Cases (Given / When / Then)
- **Given:** Given an active online rider near a restaurant with food ready
- **When:** When order broadcast arrives on rider device
- **Then:** Then full-screen modal sounds alert showing pickup address, drop distance, and estimated payout (e.g. Rs 45).

#### Edge Cases Handled
- Rider loses cell connection during 30s countdown; all nearby riders decline order.

#### Security & Compliance Considerations
- Dispatch token single-use; atomic lock prevents multiple riders accepting same delivery.

#### 4-State UI Implementation
- **Loading State:** Loading (Waiting for orders radar)
- **Success State:** Success (Incoming job card with timer)
- **Error State:** Error (Job expired)
- **Empty State:** Empty (Looking for nearby deliveries).

---

### TICK-F39: Turn-by-Turn GPS Navigation & Routing
- **Feature ID:** F39
- **Portal:** Rider App (Phase 1b)
- **Priority:** P1b | **Effort Estimate:** 8 SP | **Assigned Chunk:** Future Chunk
- **Dependencies:** TICK-F38
- **Description:** Integrated GPS routing using OpenStreetMap and OSRM engine guiding rider to restaurant pickup and customer dropoff.

#### Definition of Done (DoD)
- Renders map route polyline, distance remaining, ETA, and 1-tap deep link to Google Maps / Apple Maps.

#### Test Cases (Given / When / Then)
- **Given:** Given an accepted delivery job
- **When:** When rider taps "Start Navigation"
- **Then:** Then route is mapped from current coordinates to destination with real-time turn guidance.

#### Edge Cases Handled
- Rider takes wrong turn (triggers automatic route recalculation); GPS satellite lock lost in tunnel.

#### Security & Compliance Considerations
- Customer phone number masked via proxy caller.

#### 4-State UI Implementation
- **Loading State:** Loading (Calculating route)
- **Success State:** Success (Live navigation map view)
- **Error State:** Error (Route calculation failed)
- **Empty State:** Empty (N/A).

---

### TICK-F40: Secure OTP-Based Delivery Verification
- **Feature ID:** F40
- **Portal:** Rider App (Phase 1b)
- **Priority:** P1b | **Effort Estimate:** 5 SP | **Assigned Chunk:** Future Chunk
- **Dependencies:** TICK-F38
- **Description:** Dropoff confirmation mechanism requiring rider to input a 4-digit secret OTP provided exclusively on the customer app.

#### Definition of Done (DoD)
- Matches input code against database order record; upon success, marks order DELIVERED and releases rider payout.

#### Test Cases (Given / When / Then)
- **Given:** Given rider at customer doorstep
- **When:** When rider asks customer for 4-digit OTP and inputs it into app
- **Then:** Then order successfully marked DELIVERED, customer tracking updates, and rider wallet credited.

#### Edge Cases Handled
- Customer phone dead (admin manual override flow); 3 incorrect OTP attempts triggers alert.

#### Security & Compliance Considerations
- OTP generated cryptographically on server; never transmitted to rider app payload.

#### 4-State UI Implementation
- **Loading State:** Loading (Verifying OTP)
- **Success State:** Success (Delivery complete animation)
- **Error State:** Error (Incorrect OTP entered with retry)
- **Empty State:** Empty (OTP numeric keypad).

---

### TICK-F41: Rider Earnings Ledger & Cash-in-Hand Tracker
- **Feature ID:** F41
- **Portal:** Rider App (Phase 1b)
- **Priority:** P1b | **Effort Estimate:** 5 SP | **Assigned Chunk:** Future Chunk
- **Dependencies:** TICK-F40
- **Description:** Financial tracker showing completed deliveries, base pay, distance incentives, tips, and physical COD cash collected in hand.

#### Definition of Done (DoD)
- Calculates daily earnings; tracks cash collected versus payout balance; alerts when cash-in-hand limit (Rs 2,000) is reached.

#### Test Cases (Given / When / Then)
- **Given:** Given rider completing deliveries throughout the shift
- **When:** When rider checks Earnings tab
- **Then:** Then total earned today, trips completed, and net payout after COD reconciliation are displayed.

#### Edge Cases Handled
- COD cash collected exceeds maximum allowable limit (temporarily pauses new COD assignments).

#### Security & Compliance Considerations
- Financial ledger reconciled daily against bank transfer records.

#### 4-State UI Implementation
- **Loading State:** Loading (Earnings skeleton)
- **Success State:** Success (Itemized trip earnings)
- **Error State:** Error (Failed to load earnings)
- **Empty State:** Empty (No trips completed today).

---

### TICK-F42: Live Rider GPS Streaming & Customer Map Tracking
- **Feature ID:** F42
- **Portal:** Customer App / Rider App
- **Priority:** P1b | **Effort Estimate:** 8 SP | **Assigned Chunk:** Future Chunk
- **Dependencies:** TICK-F09, TICK-F38
- **Description:** Background location streaming from rider phone to Redis, broadcast over Socket.io to customer tracking map.

#### Definition of Done (DoD)
- Rider app emits throttled coordinates every 5s; customer tracking map animates bike marker along route smoothly.

#### Test Cases (Given / When / Then)
- **Given:** Given an order with status OUT_FOR_DELIVERY
- **When:** When delivery rider moves along road
- **Then:** Then customer map screen updates rider marker with smooth bearing animation and refreshed ETA.

#### Edge Cases Handled
- Rider device battery saver kills background location; temporary cellular deadzone.

#### Security & Compliance Considerations
- Rider coordinates emitted only to active order room; streaming halts immediately upon delivery.

#### 4-State UI Implementation
- **Loading State:** Loading (Connecting live GPS)
- **Success State:** Success (Moving vehicle icon on map)
- **Error State:** Error (GPS signal paused banner)
- **Empty State:** Empty (N/A).

---

