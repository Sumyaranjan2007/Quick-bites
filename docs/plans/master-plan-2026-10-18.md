# Master plan — features, maps, live tracking, security and the new feel (18 Oct 2026)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

**Status: plan only. Nothing is built until the owner says "make".** This is the one plan to follow.
It takes in, and replaces as the order of work:
[`k1-k3-fixes-2026-10-17.md`](k1-k3-fixes-2026-10-17.md),
[`new-architecture-and-animations-2026-10-17.md`](new-architecture-and-animations-2026-10-17.md) (its steps stay the recipe for Stage C),
[`customer-app-feel-2026-10-17.md`](customer-app-feel-2026-10-17.md) (its phases stay the recipe for Stage D), and
the motion spec in [`design/motion/`](../../design/motion/README.md).

**How to keep it current:** when a step is built, change its row in the **Tracker** (status, commit,
date) and add one line under "Built" at the end of its stage. Never delete a row.

---

## For the owner, in one screen

| | |
|---|---|
| **What you get** | 23 changes you asked for on 17–18 Oct, Google Maps everywhere with a moving bike on the customer's map, the polished feel and motion, and a full security pass. Every app and both websites stay in step. |
| **Order** | Server first (no app build needed, goes live on push), then the app engine, then the screens, then security, then one build of all four apps. Nothing later can break something earlier, because each stage only builds on finished, tested stages. |
| **Time** | About 6–8 weeks of AI work plus your phone tests (estimates per stage below). |
| **What only you can do** | Google Cloud billing + 3 keys, Exotel account (masked calls), photos/illustrations, Play Console declarations, answers to the 6 questions below. List: §"Owner's list". |
| **Cost to run** | Google Maps: maps inside the apps are free; address search, road distance and snap-to-road are metered with monthly free amounts (check the India price list in the Cloud console). Exotel: per-minute call charges + a virtual number. Railway Pro: already paid. |

### Owner decisions (18 Oct 2026, "make" given)

| # | Decision |
|---|---|
| Q1 | **No permanent delete.** Two admin actions instead: **Remove** (account closed: cannot sign in anywhere; may register again fresh) and **Block** (closed AND its email, phone, FSSAI/GSTIN/PAN/licence numbers can never be used again on any of our apps). Data kept. |
| Q2 | A rider/partner who asked to delete: can sign in to see money and settle dues, gets no new orders/trips until an admin approves or rejects. |
| Q3 | Help chat answers itself with **fixed answers** from our policies + live order/refund status; then a person. No AI writing replies. |
| Q4 | Login top: our own animated Quick Bites illustration (default, not yet confirmed). |
| Q5 | Illustrations: AI-drafted, hand-finished in our colours; food photos stay real (default, confirm before Stage D). |
| Q6 | Dispatch: one rider at a time, 108 s each; after **5** riders operations is alerted, offers keep cycling. |
| – | **Masked calls (B9) on hold** by the owner; today's behaviour stays (number shown only during the live trip). |
| – | Everything fully secured, optimised, nothing existing disturbed (Rules section). |

---

## Tracker (one row per item; update as we build)

Status: ⬜ not started · 🟨 exists partly today · ✅ built in this plan.

| # | Item (owner's words, short) | Today in the code | Stage | Status |
|---|---|---|---|---|
| K1 | Rider "Call customer" has no number | fix written, uncommitted (`orderService.ts`, `riderRouter.ts`) | A1 | ✅ 18 Oct |
| K2 | Bad `Origin` → 500 | fix written, uncommitted (`cors.ts`) | A1 | ✅ 18 Oct |
| K3 | Confirm links lost on deploy | fix written, uncommitted (`authRouter.ts`, `client.ts`) | A1 | ✅ 18 Oct |
| 1a | Restaurants within **35 km** | one admin radius `maxDeliveryKm` = 35 (owner, 18 Oct: kitchens no longer choose), list and checkout same circle (`deliveryRadiusKm`, `pricingConfig.ts`) | B1 | ✅ 18 Oct |
| 1b | Offer trip to **one** rider at a time, nearest free online first, **108 s** to accept, then next | today: up to 6 riders woken at once, first tap wins (`modules/orders/tripOffers.ts:52`) | B4 | 🟨 |
| 2 | Kitchen ticket (receipt) to print, no prices, after Accept | invoices with prices exist (`modules/payments/statementPdf.ts`); no kitchen ticket | B10 | ⬜ |
| 3 | Offline kitchen shows "Not delivering currently"; list by customer's location | server ✅: closed kitchens listed, after open ones in every sort; Customer app label changed (reaches phones with the next build) | B1 | ✅ 18 Oct (app at G) |
| 4 | Admin: **Remove** or **Block** a restaurant/rider (Q1), by role permission | account blocking exists (`accountBlocking` suite); no identifier ban; roles exist (`modules/admin/permissions.ts`) | B6 | 🟨 |
| 5 | Kitchen type veg / non-veg / both on profile; **Pure Veg seal** only admins give | `isPureVeg` exists, admin-set (`peopleRoutes.ts:604`); no kitchen type, no seal look | B5 | 🟨 |
| 6 | Rider calls customer without seeing the number | **built but switched off**: Exotel masked call (`modules/orders/callMasking.ts`, route in `orderRouter.ts:~780`); Rider app still dials the number. **On hold (owner, 18 Oct)** | B9 | ⏸ |
| 7 | Customer: choose location / save address **first**, then restaurants; without address → our recommended list | address book exists (`AddressBookScreen.tsx`), not first; the "no location → recommended" server part moved to B5 (needs the recommended list) | B5 + D3 | 🟨 |
| 8 | Admin "Create": build a whole restaurant / rider / partner account, verify and upload for them | no admin-create; KYC approve exists | B6 | ⬜ |
| 9 | Partner switches off a **whole menu section** (e.g. dosa after 7 pm) | dish-by-dish only (`restaurantRouter.ts:600-635`) | B5 | ⬜ |
| 10 | Every Admin/Partner app feature also on the websites | **automatic**: the websites are the same app code (`scripts/build-web.mjs`); each stage checks the web build | all | ✅ (by design) |
| 11 | KYC and uploads arranged **per person** (restaurant, rider, customer), view and download | one queue by status (`admin-mobile/src/screens/DocumentsScreen.tsx`) | B7 | 🟨 |
| 12 | Forgot password with email code; admin can reset for partner/rider | emailed reset codes were removed (`delivery-mobile/src/screens/LoginScreen.tsx:251`); admin reset exists (`/admin/staff/:id/reset-password`) | B6 | 🟨 |
| 13 | Customer: liked restaurants in a **Favourites** section | favourites saved (`/customers/favourites`), heart on cards; no section | D3 | 🟨 |
| 14 | Rider delete = request; admin approves after seeing everything | request flow exists (`modules/platform/staffDeletion.ts`, People → Deletion requests); review page thin | B6 | 🟨 |
| 15 | Same for restaurants | partner request exists (Help Centre); same review page | B6 | 🟨 |
| 16 | Help chat: answers itself first, then a person with all the info | tickets + replies exist (`supportRepository.ts`, admin Support) | B8 | 🟨 |
| 17 | Admin picks **recommended** restaurants shown first | nothing | B5 | ⬜ |
| 18 | More profile fields; phone/email change only with a code | profile edits reviewed by admin (`modules/restaurants/profileEdits.ts`); no code check on contact change | B6 | 🟨 |
| 19 | Real delivery time from cooking + distance; "We're ahead of time!" | `modules/orders/eta.ts` (speed + handling + prep) | B3 + D | 🟨 |
| 20 | Proper edit options in every profile | partial per app | B6 + E | 🟨 |
| 21 | **Google Maps** everywhere + moving bike on the customer map | Mapbox today (server `modules/places/*`, apps `src/lib/nativeMap.ts`) | B2 + C2 + D | ⬜ |
| 22 | Rider: clear consent for live tracking, reliable updates | background GPS exists (`delivery-mobile/src/lib/shiftService.ts`); no prominent disclosure screen | B11 + E | 🟨 |
| 23 | Full security pass + harden against reverse-engineering + a security guideline | parts exist (secrets checks, ProGuard on, server checks) | F | 🟨 |
| F1 | The leader's feel: Lexend Deca, press feel, soft haptics, images, motion | spec written (`design/motion/`) | C + D + E | ⬜ |

---

## Stage A — Make the ground solid (server only, no app build) · ~2 days

| Step | What | Done when |
|---|---|---|
| A1 | ✅ Finish K1–K3 exactly as `k1-k3-fixes-2026-10-17.md` "Still to do" (checks, mutation, gate, docs) | gate green, pushed, `/health` uptime reset |
| A2 | **Railway Pro used properly**: raise the backend service's memory/CPU (the whole store lives in memory, `db/client.ts`); turn on Postgres backups and check one restore on a copy; static outbound IP if Railway offers it on Pro (lets the Google server key be locked to our IP); usage alerts. **One instance only** (no replicas: data, sockets, timers live in one process) | owner screenshot of settings; restore tested |
| A3 | Security baseline (read-only audit before features add more surface): every route's guard (`docs/generated/ROUTES.md`), rate limits on sign-in/codes, file-upload checks, `npm audit`; findings go to Stage F, urgent ones fixed here | audit table in `docs/SECURITY.md` (new, Stage F owns it) |

**Built:** A1 (18 Oct): K1 customer phone on orders + old-order fallback; K2 refused origin → 403; K3 confirm links in the store. Checks in `platform`, `customerAddsRole`, `anonymousAccess`, 4 mutations caught.

## Stage B — Server features, in dependency order (each step: server + its suite + docs, pushed alone) · ~3 weeks

Every step: Zod validation on input, permission per admin role, `durable` writes for anything money or account, one suite in `src/test/`, `node scripts/docs/route-inventory.mjs`, websites build. Apps change in Stage D/E, except where a step says "app".

### B1 — Where a customer is, and what they see (#1a, #3, #7 server)
- Global setting **max distance 35 km** (Admin → Rates, editable); a kitchen is shown when the customer is within the **smaller** of 35 km and the kitchen's own radius; default kitchen radius raised so 35 km is real (owner may lower per kitchen). Distance by road from B2 when cached, straight line for listing speed.
- Closed or offline kitchens **stay in the list**, greyed, labelled **"Not delivering currently"** (and "Opens at 11:00" when hours say so), sorted after open ones; cannot be ordered (server already refuses).
- List endpoint takes the delivery address/coordinates; no coordinates → returns `recommended` list (B5) and a flag the app uses to ask for location first (D3).

### B2 — Google Maps on the server (#21 server half)
Same seam as the 22 Sep move, in reverse (`modules/places/placesService.ts`, `routingService.ts`; every caller unchanged):

| Need | Google API |
|---|---|
| address search | Places API (New) Autocomplete + Place Details (session tokens, so one search = one charge) |
| pin → address | Geocoding API (reverse) |
| one restaurant → door distance + time with traffic | Routes API `computeRoutes` (TRAFFIC_AWARE) |
| many pairs (dispatch, listing) | Routes API `computeRouteMatrix` |
| rider trail on roads | Roads API Snap to Roads (only while a trip is live, batched every ~30 s, up to 100 points per call) |

Keep the cache, the circuit breaker and the straight-line fallback (a failed map call must never fail an order). New variable `GOOGLE_MAPS_SERVER_KEY` (Railway); `MAPBOX_ACCESS_TOKEN` removed only after Stage D ships. `/health` shows `services.maps.provider`.

### B3 — Honest delivery time (#19 server)
ETA = kitchen's **own measured** cooking time (median of its last 20 orders for the cart size; default `DEFAULT_PREP_MINUTES` until it has 20) + rider to kitchen (B4's chosen rider, Routes API) + kitchen to door with traffic + handover. Recomputed on each status change and every rider GPS update while carrying; sent on the order socket. The promise shown at checkout is frozen on the order; tracking shows live ETA and **"ahead"** when live ETA < promise by ≥ 3 min.

### B4 — Rider dispatch, one at a time (#1b)
- When food is near ready (prep remaining ≤ rider's travel time to the kitchen) the server picks **the best free rider**: online, approved, no active trip, cash under ceiling, not declined this order, location fresh (< 2 min), shortest **road time** to the kitchen (Routes matrix), ties → fewer trips today.
- That rider gets a full-screen offer + push (existing channel `new-orders`) with a **108 s** countdown. State on the order (`offer: { riderId, expiresAt, round }`), saved durably, so a deploy mid-offer continues.
- Accept → assigned. Decline or 108 s pass → next rider by the same rule. The sweeper (`orderSweeper.ts`) checks expiries every few seconds; the old "wake 6 at once" path is retired in the same commit (one dispatcher, no duplicates).
- After Q6's limit, operations is alerted and cycling continues; operations can assign by hand (exists).
- Rider app (Stage E): the offer screen shows the countdown; the trip disappears when it moves on.

### B5 — Restaurant profile, menu sections, recommended (#5, #9, #17)
- `cuisineType: 'VEG' | 'NON_VEG' | 'BOTH'` chosen by the partner (profile edit, reviewed as today). `pureVegSeal: { by, at }` set **only** by admins with permission `restaurants.pureVegSeal`; the seal overrides the partner's choice in what customers see; filtering by Pure Veg uses the seal.
- **Section switch**: each menu category gets `isAvailable` + optional "back at" time; switching a section off hides/greys all its dishes for customers at once and the server refuses them in carts; switching on restores each dish's own setting (dish switches are not overwritten). Partner app and admin both.
- **Recommended**: admin list (permission `restaurants.recommend`) with order; shown first on the home feed and as the list when no address is set (B1).

### B6 — Accounts (#4, #8, #12, #14, #15, #18, #20 server)
- **Forgot password (partner, rider, admin)**: code to the account's email (Brevo, 10 min, 5 tries, rate-limited), then new password; every session signed out (`SESSION_REVOKED` exists). Later, phone code by SMS when MSG91 is live (same flow, other driver).
- **Admin resets a password** for a partner/rider (exists for staff: extend to both, audit-logged, the person gets an email).
- **Change phone/email**: code to the **new** address/number (email today, SMS later) before it is saved; old email told.
- **More editable fields** per profile (partner: phone, email, GSTIN/FSSAI with document, address+pin, cuisine type, hours, packaging fee request, bank via payee flow; rider: phone, email, vehicle, emergency contact; customer: name, email, phone with code). One list per role in `shared-types`.
- **Admin "Create"** (permission `accounts.create`): one form builds a partner account + restaurant (or a rider), uploads their documents, approves KYC, sets a temporary password emailed to them with "change on first sign-in". Uses the same repositories as self-sign-up (no second path).
- **Deletion requests** (rider and partner): request → account off duty (Q2) → admin page shows everything needed: dues and cash in hand (from `payouts.ts`/`cashDeposits.ts`), open orders, documents, trip/order counts, last activity → Approve (only when dues are zero or settled) or Reject with a reason. Exists in part; the review page is the new work.
- **Remove / Block** (Q1; permissions `accounts.remove`, `accounts.block`; super admin by default; type-the-name confirm; audit-logged): only with no open orders. **Remove** closes the account on every app (sessions revoked, kitchen hidden, rider off dispatch), keeps all data; they may register again as a new account. **Block** does the same and adds the email, phone and document numbers (FSSAI, GSTIN, PAN, licence) to a `blockedIdentifiers` list (stored hashed) that every sign-up, sign-in, contact change and admin Create checks, on all four apps and both websites. Unblock possible by permission. Extends the existing blocking (`accountBlocking` suite) rather than adding a second one.

### B7 — One record per person (#11)
Admin → People → (restaurant | rider | customer) → **Record**: profile, every document grouped by type with status and date, every photo, bank (masked), orders/trips, money, tickets, audit history; each file opens and downloads; "Download all" as one ZIP. The KYC queue stays for approvals and links into the record.

### B8 — Help chat (#16)
In-app chat (customer, partner, rider): first a guided menu from **our** policies (order late, missing item, refund status, payment, account, payouts) that answers from live data (order status, refund state); "Talk to us" opens a ticket with the order, the chat so far and the person's info attached, and staff reply in the same thread (existing tickets). Q3 decides any AI.

### B9 — Calls without showing numbers (#6) — ON HOLD (owner, 18 Oct)
How the big apps do it (researched): the platform rents a **virtual number** from a telephony provider; the rider taps Call, the server asks the provider to call the rider and the customer and bridge them; neither sees the other's number ([Exotel number masking](https://exotel.com/use-cases/number-masking/), Swiggy is a published Exotel customer: [case study](https://exotel.com/case-study/swiggy-streamlined-its-operations-with-exotel-heres-how/)). We already have this for Exotel (`callMasking.ts`). Work: owner opens an Exotel account + number; Rider app's Call button uses the masked route; customer can call the rider the same way; calls only allowed while the trip is live; fallback when Exotel is down: the real number, shown only during the live trip (today's behaviour, `contactVisibility.ts`).

### B10 — Kitchen ticket to print (#2)
Server makes a **thermal receipt PDF** (80 mm wide; 58 mm option in partner settings) with: our logo, kitchen name, **order number** big, time placed, "Delivery" + customer first name only, item lines with **quantity** and options/notes, item count, cutlery/instructions, pickup code, QR of the order number; **no prices**. Download/print button on the order card right after **Accept** in Live orders, and in order history; same on the website. Phone prints through Android's print dialog (`expo-print`, SDK pin 15.0.8) to any printer it can see, or the PDF can be shared to a Bluetooth printer app.

### B11 — Live tracking data path (#21, #22 server)
Rider position every ~4 s while carrying (8 s while going to the kitchen), sent over the socket with REST fallback (exists); server keeps the last fix + heading + speed, snaps a batch to roads (B2), relays to the order room; stale (> 30 s) is shown as "updating…". Only riders on a live trip are relayed (exists, `contactVisibility.ts`).

**Built:** B1 (18 Oct): one delivery radius on the map, 35 km, admin-set (`maxDeliveryKm`; kitchens' own `serviceRadiusKm` is now ignored, still accepted from old Partner apps), same circle for the list and checkout (`deliveryRadiusKm`); applied once to live rates (`applyOwnerDecisions20261018`, flag `rates:radius-35-2026-10-18`). Owner's extra decisions the same day: rider ₹/km slides ₹12 (to 4 km) → ₹8 (at 35 km) (`riderPerKmAt`), cash on delivery only up to 15 road km (`codMaxDistanceKm`, `COD_TOO_FAR`, quote `cashUnavailableReason`; `acceptsCash` folds it in for old apps). Closed kitchens stay listed, after open ones in every sort. Admin Rates shows all new knobs and worked examples from `riderPayFor`. Partner sign-up no longer asks a radius. Suite `deliveryRadius` (20 checks); `charges`, `ledger`, `membership`, `regression` updated to the new rule; 8 mutations caught. **Moved to B5:** no-location → recommended list + flag. Review D7 answered by the owner's decision (one radius; the sliding rate makes 35 km cost ₹280, not ₹420).

## Stage C — App engine (all four apps) · ~1 week
1. New Architecture + Reanimated 4 + Gesture Handler + expo-image + FlashList + Lottie + expo-haptics, exactly as `new-architecture-and-animations-2026-10-17.md` steps 1–5 (phone checklist must pass).
2. **Mapbox → Google Maps in the apps**: remove `@rnmapbox/maps` and its build tokens; add `react-native-maps` at the SDK pin (1.20.1) with `android.config.googleMaps.apiKey` in each `app.config.js` (Android always uses Google with react-native-maps; iPhone uses `provider="google"`, which needs the iOS key). Rewrite only the seam `src/lib/nativeMap.ts` (Customer, Partner, Rider) so screens keep their imports. Address search keeps going through our server.
3. `expo-print` (Partner) for B10.

**Built:** –

## Stage D — Customer app (the leader's feel, our brand) · ~2 weeks
Recipe: `customer-app-feel-2026-10-17.md` phases 1–4 and `design/motion/`.

| Step | What |
|---|---|
| D1 | Base: tokens, Lexend Deca, `PressableScale`, soft haptics (Android + iPhone), `FoodImage`, skeletons, sheets |
| D2 | Sign-in screen (Q4 artwork) + code screen |
| D3 | **Location first** (#7): after sign-in, a full-screen "Where should we deliver?" (use my location / search / saved addresses / save this exact pin with house, floor, landmark); skipping shows "Recommended by Quick Bites" (B5) with a banner "Set your location to see every restaurant near you". Home → Favourites section (#13) above the main list when you have any. |
| D4 | Home, search, restaurant page (section switch greys a whole section, "Not delivering currently", Pure Veg seal badge), add to cart, dish sheet, checkout |
| D5 | **Tracking with the moving bike** (#21): Google map, our own bike icon (top-down, maroon, flat, rotates to heading); each GPS fix → marker glides from the last point to the new one over the time between fixes (Android `animateMarkerToCoordinate`, iPhone `AnimatedRegion` timing, both documented by react-native-maps), heading from the last two snapped points; camera fits kitchen + bike + home and eases, stops following while the customer drags; route line from Routes API polyline; "We're ahead of time!" card (B3) |
| D6 | Profile edits with codes (#18, #20), help chat (#16), orders, addresses |

**Built:** –

## Stage E — Partner, Rider, Operations apps + websites · ~1.5 weeks

| App | Work |
|---|---|
| Partner | kitchen ticket print (B10), section switch (B5), cuisine type + seal shown (B5), more profile fields with codes (B6), forgot password (B6), deletion request status (B6), help chat (B8), Google map (C2), base feel (D1 pieces) |
| Rider | **tracking consent** (#22): before the first "Go online", a full screen in plain words: "Quick Bites uses your location while you are online, even when the app is closed or the screen is off, to give you nearby orders and show customers where their food is. It stops when you go offline." → then the system permission (foreground, then "Allow all the time"); a persistent notification while online (foreground service, exists); a status chip online/updating/GPS off with a fix button; 108 s offer countdown (B4); masked Call (B9); forgot password; deletion status; help chat; Google map; base feel |
| Operations | Create (B6), Record per person (B7), deletion review (B6), delete restaurant (B6), Pure Veg seal + recommended list (B5), max distance setting (B1), dispatch monitor (B4), roles for the new permissions, base feel |
| Websites | nothing separate: built from the Partner/Operations code; each step runs `node scripts/build-web.mjs` and checks the feature in a browser; the web keeps its simple Glass Kitchen look |

**Built:** –

## Stage F — Security (#23) · ~1 week, plus checks inside every stage

Truth first: **no app can be made impossible to reverse-engineer** (we read the leader's app this week). The protection that works is: nothing secret inside the app, and the server checking everything.

| Area | Work |
|---|---|
| Server | every route's guard re-checked (mount list in `middlewares/auth.ts`), ownership checks on every id, rate limits on sign-in/codes/search/uploads, upload type/size sniffing, no stack traces to clients, audit log on every admin write (exists), dependency audit, secrets only on Railway |
| Accounts | password rules, code lockouts, sessions revoked on password/contact change, admin 2-step for destructive actions (delete, payouts over threshold exists) |
| Apps | Play Integrity API check on sign-in and order placement (server verifies the token), R8/ProGuard on (already `enableProguardInReleaseBuilds`), Hermes bytecode (already), no keys except restricted map keys (`check-apk-secrets.mjs`), tokens in secure storage (`expo-secure-store`), HTTPS only, certificate pinning only if Railway's certificate chain is stable (decide in F) |
| Map/phone keys | Android key restricted to package + **both** SHA-1s (upload key and Play app-signing key); iOS key to bundle id; server key to the APIs it uses (+ Railway static IP if available) |
| Data | Postgres backups (A2), payee numbers encrypted (exists), anonymised deletions (B6), logs without phone/email |
| Deliverable | `docs/SECURITY.md`: the rules every change must follow + the checklist run before each release |

**Built:** –

## Stage G — Test, build, release · ~3–4 days
Gate + all checks (`docs/TESTING.md`); phone tests of every stage's checklist (motion on and off); web check; then **only on "make APK"**: one build of all four apps (versionCode 34+), archive, Play upload, new reviews, update Play Console: Data safety (location, calls), background-location declaration + video, App access (reviewer code), Advertising ID.

---

## Owner's list (only you can do these)

| When | What |
|---|---|
| Before B2 | **Google Maps keys** (steps below) and put the server key on Railway as `GOOGLE_MAPS_SERVER_KEY`, the app keys in the root `.env` |
| Before B9 | Exotel account (business KYC), one virtual number; put `EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID` on Railway |
| Before A2 | Railway: memory/CPU, Postgres backups, static IP (if offered), usage alerts |
| Before D2 | Answer Q1–Q6; tagline; artwork decision (Q5) |
| Before G | Play Console: background-location declaration + a short video of the consent screen and a delivery; Data safety update |
| Any time | Brevo sending domain (codes into inbox, not spam); MSG91 DLT for SMS codes |

### Getting the Google Maps keys (Google Cloud console, ~20 minutes)
Sources: Google's setup and key-security guides ([get an API key](https://developers.google.cn/maps/documentation/android-sdk/get-api-key), [security best practices](https://developers.google.com/maps/api-key-best-practices)).
1. console.cloud.google.com → create project **Quick Bites Maps** → Billing → link your billing account (card required).
2. APIs & Services → Library → enable: **Maps SDK for Android**, **Maps SDK for iOS**, **Places API (New)**, **Geocoding API**, **Routes API**, **Roads API**.
3. Credentials → Create API key ×3 and name them:
   - **qb-android**: Application restriction *Android apps* → add each package (`in.quickbites.app`, `com.quickbite.partner`, `in.quickbite.rider`, `com.quickbite.admin`) with **two** SHA-1s each: the upload key's (ours) and the **app-signing key's from Play Console → Test and release → App integrity → App signing**. API restriction: Maps SDK for Android only.
   - **qb-ios**: *iOS apps* → bundle `in.quickbites.app`; API restriction: Maps SDK for iOS.
   - **qb-server**: *IP addresses* (Railway static IP if you have one, else none); API restriction: Places (New), Geocoding, Routes, Roads.
4. Billing → Budgets & alerts → a monthly budget with alerts at 50/90/100%.
5. Quotas: set a daily cap on Places, Routes, Roads so a bug cannot run up a bill.
6. Put the values on Railway / in `.env` yourself and tell me only "keys are set" (never paste a key in chat).

---

## Rules for every step (so nothing breaks)
- Check the feature exists first; extend it, never a second copy (seniordev ladder). Money/account state: grep every writer first (`CLAUDE.md` §8).
- Server steps ship alone, behind the gate, and stay compatible with the apps on phones today (old app versions keep working).
- Each new admin power has its own permission, so roles can share it out (#4).
- Each step updates its docs (`docs/*` maps, `CHANGELOG.md`, this Tracker) in the same commit.
- No file from the private competitor study enters the repo.
