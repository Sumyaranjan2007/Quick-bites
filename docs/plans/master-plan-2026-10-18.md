# Master plan — features, maps, live tracking, security and the new feel (18 Oct 2026)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

## START HERE — any new session (AI or developer) continues from this file

The owner may open a fresh session and paste only this file's path. Do this, in order:

1. **Load the main skills first** (Skill tool): `seniordev`, then `cleancode`. Follow them on every
   change: read the code first, reuse what exists, shortest correct diff, one runnable check per
   non-trivial rule, mutation-check it (break the guard, watch the check fail, put it back).
   Also available when a step needs them: `security-review`, `superpowers:verification-before-completion`,
   `expo:*` (Stages C–E), `vercel-react-native-skills`, `skills:react-native-best-practices`,
   `ui-ux-designer`, context7 (library docs), mobile-mcp (phone/emulator).
2. **Read**: `CLAUDE.md` (owner, money rules §4, working rules §8), `docs/FOLDER_MAP.md`, then this
   file's **Owner decisions**, **Who builds what**, **Tracker** and **Findings** tables, then the top
   3 entries of `CHANGELOG.md`.
3. **See where work stopped**: `git log --oneline -15`, `git status --short`. Uncommitted files that
   are NOT yours may be another session's work in progress (check "Who builds what" and file times):
   never edit, stage, stash or revert them. The next step is the first Tracker row not ✅ in the
   current stage, in your own column of "Who builds what".
4. **Each step**: server change + one suite (listed in `SUITES` in `scripts/run-backend-tests.mjs`)
   + docs in the same commit (`CHANGELOG.md` top entry "For the owner" first, this Tracker row,
   the stage's **Built:** line, the maps in `docs/`). Gate: `node scripts/run-backend-tests.mjs`
   (if it refuses because another session's new suite is not listed yet, run a scratch copy of the
   runner with only `assertEverySuiteIsListed()` removed, never edit their file). Typecheck. Stage by
   explicit path only. Push `main` (deploys live), then ask devops-sre to confirm `/health`.
5. **Team sessions** (started 18 Oct, may still exist): security-reviewer, code-reviewer, qa-engineer,
   devops-sre, product-designer. They write only their own files (`docs/SECURITY.md`,
   `docs/reviews/REVIEW_LOG.md`, `docs/qa/QA_PLAN.md`, `docs/ops/OPS_GUIDE.md`, `design/`) and send
   findings; fix theirs that fall in your files, then reply with the commit.
6. **Never**: money rules changed without the owner; secrets in any tracked file (repo is PUBLIC);
   competitor names or assets in the repo; `git add -A` / stash / reset / clean; APK builds unless the
   owner says "make APK"; signing in to live with the owner's password.
7. **Owner decisions still open** are marked ⏳ in the Findings table: build around them with
   today's behaviour, never decide them yourself.

## Status

**Building, owner said "make" (18 Oct 2026).** Live on production: A1, B1, B3, B4, B5, B7, B8, B10, Stage F
part (see Tracker). This is the one plan to follow.
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

## Who builds what (owner, 18 Oct 2026: two sessions in parallel, same folder)

| Session | Steps | Files it owns (the other never edits them) |
|---|---|---|
| **Senior dev clean code skills** (main; the only one that pushes) | done: B1, B5, B4, B3 · now: B6, security L1 (authRouter part), R2, R3 · then C–G with the owner | `routes/{authRouter,restaurantRouter-B5 parts}.ts`, `routes/admin/{peopleRoutes,catalogRoutes}.ts`, `db/repositories/userRepository.ts`, `modules/orders/{orderService,orderSweeper,tripOffers,eta,opsRescue}.ts`, `modules/{restaurants,search,places}/*` |
| **b8-help-chat** (parallel; commits, never pushes, sends the hash to the main session) | done: B8, B10, B7, Stage F L2/L4/R6 · now: B11 live tracking data, security L1 (restaurantRouter/walletRouter), L3, L5, L6, review R5 | `routes/riderRouter.ts` (telemetry parts; B4 claim/list/decline stay as built), `sockets/{socketServer,socketAuth}.ts` (location handling; B3 `eta` field stays), `db/repositories/riderRepository.ts`, `routes/kycRouter.ts`, `routes/walletRouter.ts`, `db/normaliseStore.ts`, the L1/L3/L5/L6 lines in `routes/restaurantRouter.ts` |

Shared files (`CHANGELOG.md`, this plan, `docs/TESTING.md`, `scripts/run-backend-tests.mjs`, `shared-types`, `CLAUDE.md`, `REVIEW_LOG.md`): re-read right before a small additive edit. Stage by path only.

## Tracker (one row per item; update as we build)

Status: ⬜ not started · 🟨 exists partly today · ✅ built in this plan.

| # | Item (owner's words, short) | Today in the code | Stage | Status |
|---|---|---|---|---|
| K1 | Rider "Call customer" has no number | fix written, uncommitted (`orderService.ts`, `riderRouter.ts`) | A1 | ✅ 18 Oct |
| K2 | Bad `Origin` → 500 | fix written, uncommitted (`cors.ts`) | A1 | ✅ 18 Oct |
| K3 | Confirm links lost on deploy | fix written, uncommitted (`authRouter.ts`, `client.ts`) | A1 | ✅ 18 Oct |
| 1a | Restaurants within **35 km** | one admin radius `maxDeliveryKm` = 35 (owner, 18 Oct: kitchens no longer choose), list and checkout same circle (`deliveryRadiusKm`, `pricingConfig.ts`) | B1 | ✅ 18 Oct |
| 1b | Offer trip to **one** rider at a time, nearest free online first, **108 s** to accept, then next | server ✅: `order.riderOffer` + `modules/orders/tripOffers.ts` (one offer per trip and per rider, timer per offer + sweeper backstop, decline moves on at once, alert after 5, keeps cycling); claim only by the offered rider in time; Rider-app countdown screen in Stage E | B4 | ✅ 18 Oct (app E) |
| 2 | Kitchen ticket (receipt) to print, no prices, after Accept | server ✅: `GET /api/orders/:id/kitchen-ticket?width=80|58` (`modules/orders/kitchenTicket.ts`, PDF one page as long as the order); Print button in Partner app + website in Stage E | B10 | ✅ 18 Oct (app E) |
| 3 | Offline kitchen shows "Not delivering currently"; list by customer's location | server ✅: closed kitchens listed, after open ones in every sort; Customer app label changed (reaches phones with the next build) | B1 | ✅ 18 Oct (app at G) |
| 4 | Admin: **Remove** or **Block** a restaurant/rider (Q1), by role permission | server ✅: Block bans email (canonical), phone, FSSAI, GSTIN, licence (`modules/platform/blockedIdentifiers.ts`); Remove `POST /api/admin/accounts/:userId/remove` (typed name, reason, per-kind permission, data kept, may re-register); suite `removeAndBlock`; screens in Stage E | B6 | ✅ 18 Oct (app E) |
| 5 | Kitchen type veg / non-veg / both on profile; **Pure Veg seal** only admins give | server ✅: `cuisineType` (partner, reviewed edit), `isPureVeg` = the seal (permission `catalog.restaurants.pureVegSeal`), seal outranks the type for customers; badge look in Stage D | B5 | ✅ 18 Oct (apps D/E) |
| 6 | Rider calls customer without seeing the number | **built but switched off**: Exotel masked call (`modules/orders/callMasking.ts`, route in `orderRouter.ts:~780`); Rider app still dials the number. **On hold (owner, 18 Oct)** | B9 | ⏸ |
| 7 | Customer: choose location / save address **first**, then restaurants; without address → our recommended list | server ✅ (B5): no location → `listKind: 'recommended'`, `needsLocation: true`; the location-first screen is D3 | B5 + D3 | 🟨 (server done) |
| 8 | Admin "Create": build a whole restaurant / rider / partner account, verify and upload for them | server ✅: `POST /api/admin/accounts/create` (sign-up's own builders, temporary password emailed, per-kind permission); documents via existing `/api/kyc/submit`, approval via existing review; suite `adminCreate`; screen in Stage E | B6 | ✅ 18 Oct (app E) |
| 9 | Partner switches off a **whole menu section** (e.g. dosa after 7 pm) | server ✅: section switch with optional "back at" time, partner + admin routes, `modules/restaurants/menuSections.ts`; switches in the apps in Stage E | B5 | ✅ 18 Oct (apps E) |
| 10 | Every Admin/Partner app feature also on the websites | **automatic**: the websites are the same app code (`scripts/build-web.mjs`); each stage checks the web build | all | ✅ (by design) |
| 11 | KYC and uploads arranged **per person** (restaurant, rider, customer), view and download | server ✅: `GET /api/admin/records/:kind/:id` (documents grouped, photos, tickets, history, each by permission), one file or all as ZIP (`routes/admin/recordRoutes.ts`); Record screen in Stage E | B7 | ✅ 18 Oct (app E) |
| 12 | Forgot password with email code; admin can reset for partner/rider | server ✅: forgot/reset by email code (`/api/auth/password/forgot`, `/reset`, suite `passwordReset`); admin reset for partner/rider already existed (`/admin/staff/:id/reset-password`, per-kind permission, audit, sessions cut); app screens in Stage E | B6 | ✅ 18 Oct (app E) |
| 13 | Customer: liked restaurants in a **Favourites** section | favourites saved (`/customers/favourites`), heart on cards; no section | D3 | 🟨 |
| 14 | Rider delete = request; admin approves after seeing everything | server ✅: request keeps sign-in (Q2), no new trips (`DELETION_PENDING`), admin list carries dues, cash, orders, documents, last activity; review screen in Stage E | B6 | ✅ 18 Oct (app E) |
| 15 | Same for restaurants | server ✅ same flow (kitchen closed while pending) | B6 | ✅ 18 Oct (app E) |
| 16 | Help chat: answers itself first, then a person with all the info | server ✅: `GET /api/support/help` (topics per app) and `/help/:topic` (fixed answers from live data, `modules/support/helpChat.ts`); "Talk to us" = the existing ticket with the chat rebuilt by the server; staff reply pushed; screens in Stage D/E | B8 | ✅ 18 Oct (apps D/E) |
| 17 | Admin picks **recommended** restaurants shown first | server ✅: `GET/PUT /api/admin/recommended-restaurants` (permission `catalog.restaurants.recommend`), first on the home in admins' order; Operations screen in Stage E | B5 | ✅ 18 Oct (app E) |
| 18 | More profile fields; phone/email change only with a code | profile edits reviewed by admin (`modules/restaurants/profileEdits.ts`); no code check on contact change | B6 | 🟨 |
| 19 | Real delivery time from cooking + distance; "We're ahead of time!" | server ✅: kitchen's measured cooking time (median of last 20 by cart size), rider's ride to the kitchen, promise frozen at checkout (`promisedArrivalAt`), `eta.ahead`; ETA on status and rider-position sockets; quote `estimatedDeliveryMinutes`. Road time with B2; card in Stage D | B3 + D | ✅ 18 Oct (server) |
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

**Built:** B1 (18 Oct, `1078afb`, live and observed on production): one delivery radius on the map, 35 km, admin-set (`maxDeliveryKm`; kitchens' own `serviceRadiusKm` is now ignored, still accepted from old Partner apps), same circle for the list and checkout (`deliveryRadiusKm`); applied once to live rates (`applyOwnerDecisions20261018`, flag `rates:radius-35-2026-10-18`). Owner's extra decisions the same day: rider ₹/km slides ₹12 (to 4 km) → ₹8 (at 35 km) (`riderPerKmAt`), cash on delivery only up to 15 road km (`codMaxDistanceKm`, `COD_TOO_FAR`, quote `cashUnavailableReason`; `acceptsCash` folds it in for old apps). Closed kitchens stay listed, after open ones in every sort. Admin Rates shows all new knobs and worked examples from `riderPayFor`. Partner sign-up no longer asks a radius. Suite `deliveryRadius` (20 checks); `charges`, `ledger`, `membership`, `regression` updated to the new rule; 8 mutations caught. **Moved to B5:** no-location → recommended list + flag. Review D7 answered by the owner's decision (one radius; the sliding rate makes 35 km cost ₹280, not ₹420).
B5 (18 Oct): kitchen type `cuisineType` VEG/NON_VEG/BOTH (partner, reviewed profile edit; sign-up tick sets it); `isPureVeg` is now the admin-only **seal** (permission `catalog.restaurants.pureVegSeal`; the admin app may still send the unchanged value), it outranks the type in what customers see and drives the Pure Veg filter (no live kitchen had it on, so nothing changed for customers). **Section switch**: `POST /api/restaurants/:id/menu/sections/:categoryId/availability` (owner) and `/api/admin/menus/:restaurantId/sections/:categoryId/availability` (`catalog.menus.edit`, audit-logged), optional `backAt` (≤ 7 days); one rule `menuSections.ts` read by the menu, quote, checkout, reorder and search; dishes keep their own switches; a passed `backAt` counts as on at once and the sweeper clears it (review D9). **Recommended**: `GET/PUT /api/admin/recommended-restaurants` (`catalog.restaurants.recommend`, audit-logged, stored in `settings`), first on the home (after the open/closed split), the whole list when no location and no search text (`listKind: 'recommended'`, `needsLocation`); empty list = old behaviour. Both new permissions: super admin only by default (Roles can share them). Suite `catalogueCuration` (37); 15 mutations caught. Apps (seal badge, section switches, recommended screen, location-first) in Stage D/E.
B8 (18 Oct): help chat, server half (#16, Q3: fixed answers, no AI). `GET /api/support/help?orderId=` gives the app's topics (customer: late, item missing/wrong, refund status, payment, change address, cancel, account, other; partner: payouts, menu changes, orders, documents, account, other; rider: payouts, cash deposit, trip, documents, account, other), a greeting and the order card; `GET /api/support/help/:topic?orderId=` answers in fixed sentences from our policies filled with live data (order status + arrival from `eta.ts`, refund case state, `duesFor` owed/blockers + last payment, `cashStanding`, KYC state, menu requests). A topic from another app is 404 `TOPIC_NOT_FOUND`; orders only your own (`isPartyTo`: customer by account, rider by rider record, partner by owned kitchen; a customer-app session of a partner is a customer only). "Talk to us" is `POST /api/support/tickets` with new optional `helpTopics`, `appVersion`, `platform`: the server rebuilds `helpChat` (never copies the app's text), attaches the order in question, returns the same ticket on a double tap (2 min) and refuses a 6th ticket in an hour (429 `TOO_MANY_TICKETS`). Fixed on the way: riders and partners could not attach their own trip/kitchen order to a ticket (rider id compared with the user id); a rider's/partner's own reply marked their ticket as staff-handled and could not reopen a solved one; staff replies now push the person (`SUPPORT_REPLY`, no reply text on the lock screen). Old apps unchanged (only optional fields added). Suite `helpChat` (46); 13 mutations caught. Screens (chips, bubbles, composer) in Stage D (customer) and E (partner, rider); admin Support showing `helpChat` with the ticket is a small Stage E item.
B10 (18 Oct): kitchen ticket, server half (#2). `GET /api/orders/:id/kitchen-ticket?width=80|58` (default 80) returns an inline PDF (`QuickBites-ticket-<order>.pdf`) one page exactly as tall as the order (no page break for the printer to cut): kitchen name, order number big, CANCELLED line when cancelled, placed time/date, customer first name, `qty x dish` with chosen options (names frozen on the order at checkout by `dishOptions.ts`), item count, pickup code. Never on it: price, total, payment method, phone, address, delivery code. Allowed: the kitchen that owns the order (by `roles`, so a customer-app session of the partner is refused) once accepted (409 `NOT_ACCEPTED` before), and staff with `orders.detail.view`. Built on `utils/simplePdf.ts` (now takes a page size; A4 default unchanged). Not built (seniordev): logo image, QR code, Lexend font (Helvetica only, no new dependency); cutlery/note lines (no such order fields). Suite `kitchenTicket` (22); 9 mutations caught. Partner app button (after Accept, in history, 80/58 setting) and the website button in Stage E.
B7 (18 Oct): one record per person, server half (#11). New `routes/admin/recordRoutes.ts` (mounted in `adminRouter.ts`): `GET /api/admin/records/:kind/:id` (kind `restaurant` | `rider` | `customer`; permission `users.restaurants.view` / `users.drivers.view` / `users.customers.view`) returns name, account (`userId`), photos (cover, gallery, dish photos / profile photo), documents grouped Licences / Tax / Identity / Bank / Other with status, dates, `file` = image | link | missing and a download path (no file bodies; Aadhaar masked to the last 4), support tickets, and the audit history about that person (their record, account, documents, tickets). Documents need `documents.view`, tickets `support.tickets.view`, history `admin.audit.view`; without one, that part is `null`. `.../documents/:docId/file` (only through its own person; link → 302; no file → 404 `FILE_MISSING`) and `.../documents.zip` (every stored file + `index.txt` listing links and missing ones) need `documents.view` and are audit-logged (`DOCUMENT_DOWNLOADED`, `DOCUMENTS_DOWNLOADED_ALL`). Profile, orders/trips and money stay on the People detail routes (`detailPath` in the answer); no new permission. Not built: the phone/email "reveal" with a History line (spec), photo replace/reject (D4). Suite `personRecord` (28); 11 mutations caught. Record screen (tabs, web left column) in Stage E.

B4 (18 Oct): **one rider at a time** (owner Q6). `offerTripToNearbyRiders` keeps its name (all 5 callers unchanged) and now offers to the single best rider: online, not passed on it, not holding another offer (review D4), no active trip, under the cash ceiling; ranked by not-yet-asked, fresh position (< 2 min), nearest the kitchen, fewer trips today. State `order.riderOffer {riderId, offeredAt, expiresAt, round}` saved durably before the push; a timer per offer for the exact 108 s (review D3) and the sweeper as restart backstop; expiry tells the previous rider (data-only withdrawal) and moves on; decline moves on at once (`moveOfferOnAfterDecline`); after `riderOffersBeforeAlert` (5) riders one NO_RIDER_FOUND alert, offers keep cycling; the time-based alert remains for "nobody to ask". Claim (`/riders/orders/:id/claim`) refuses `OFFER_NOT_YOURS` / `OFFER_EXPIRED`; the offer list returns only the rider's own offer with `offerExpiresAt`, so Rider apps on phones keep working and cannot jump the queue (review D5); accept or a hand assignment clears the offer. Rates `riderOfferSeconds` 108 and `riderOffersBeforeAlert` 5 (Admin → Rates); `riderOfferWaveMinutes` retired. **Deliberate difference:** a stale position ranks a rider lower instead of excluding them, because today's Rider app reports a position only after moving 50 m; make it strict once the Stage E app sends a heartbeat. Suite `riderTripPush` rewritten (33 checks), `flows`/`opsRescue`/`pipeline`/`regression` use the test helper `offerTo`; 11 mutations caught.
B3 (18 Oct): **honest delivery time.** `eta.ts`: `kitchenPrepMinutes` = median of the kitchen's last 20 orders of the same cart size (accepted → ready; default until 20); while cooking the wait is max(cooking left, chosen rider's ride to the kitchen); food ready → the rider's ride; `promisedArrivalAt` frozen at checkout; `eta.ahead` when the live estimate beats it by ≥ 3 min. Sent on `order:status_update` and `rider:location_update` (straight line, never a paid map call per tick: review D2). Quote adds `estimatedDeliveryMinutes`. Road time via Routes API arrives with B2. Suite `honestEta` (13); 8 mutations caught.

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
| Operations | Create (B6), Record per person (B7), deletion review (B6), delete restaurant (B6), Pure Veg seal + recommended list (B5), max distance setting (B1), help chat shown on the Support ticket (B8 `helpChat`, app version), Record per person screen on `/admin/records` (B7), dispatch monitor (B4), roles for the new permissions, base feel |
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

**Built:** findings outside the main session's files (18 Oct): L2 socket tokens pinned to HS256 (`sockets/socketServer.ts`, one line), L4 browser origins only our exact hosts (`middlewares/cors.ts`: the `*.vercel.app` / `*.railway.app` allowance removed; our pages are the same host), review R6 refusals (4xx) logged at WARN, failures (5xx) at ERROR (`middlewares/errorHandler.ts`). Checks added to `sockets.security` and `anonymousAccess`; 3 mutations caught. L1, L3, L5, L6, R2, R3 are in the main session's files and stay with it.

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

## Findings from the role sessions that change this plan (18 Oct 2026)

Each line: who found it, what changes, status. Full detail in the role's own file.

| # | From | Finding → change | Status |
|---|---|---|---|
| F-1 | security (`docs/SECURITY.md`) | M1: a profile edit could take another account's phone → refused (`PHONE_IN_USE`) | ✅ 18 Oct (main) |
| F-1b | security round 2 | L7: pinless address could pay cash for any trip → cash needs a pin (`COD_NEEDS_PIN`); L1 (sign-in routes) raw errors → error handler; L8 (record link redirect) goes with L5 | ✅ L7, L1-auth 18 Oct (main); L8 with L5 (parallel) |
| F-1c | review round 2 | S1 race in B4 offers (two riders, or one rider two trips) → fixed; S2 alert counts riders; S3 "today" in India time | ✅ 18 Oct (main) |
| F-12 | review B1-1 | With "one rate for the whole trip", a short-trip rate above about ₹15/km (₹8 at 35 km) makes a 28 km trip pay more than a 35 km one (₹20/km: 28 km ₹300, 35 km ₹280). **Owner decision**: (a) keep it and the Rates screen refuses such settings, or (b) pay each km at its own rate (₹12 for the first 4 km, then each further km a little less, down to ₹8): longer always pays more, any rate allowed; 35 km would pay about ₹358 instead of ₹280 | ⏳ owner |
| F-2 | review R2, R3 | deletion now also strips refund cases; expired confirm links pruned by the sweeper | ✅ 18 Oct (main) |
| F-3 | review R1 | K1 made **automatic RazorpayX refund payout links** reachable (`refunds.ts:234`; before, no phone meant the manual queue). **Owner decision**: keep automatic links, or keep refunds manual until RazorpayX is live | ⏳ owner |
| F-4 | review D1, D2 | No Roads/Routes call per GPS fix: B11 projects the rider onto the `computeRoutes` polyline on our server (snap only if off-route); B3 recomputes road time only on status change/off-route | rule for B2/B11 |
| F-5 | devops (`docs/ops/OPS_GUIDE.md`) | Railway stops reading `railway.json` after **1 Dec 2026**: owner copies its settings (+ draining 30 s, overlap 0) to the dashboard **before 15 Nov**, then we delete the file and its mentions in one commit | ⏳ owner, then main |
| F-6 | devops | Deploy overlap: a write on the old server during a deploy can be overwritten by the new one (both in memory). Until fixed: deploy outside 12:00–14:30 and 19:00–22:30. Fix: new server re-reads documents changed after its boot (one suite) — new step **A4** | ⬜ A4 |
| F-7 | designer (`design/system/`) | Lexend Deca has no Hindi/Kannada letters: Stage D1 also bundles **Noto Sans Devanagari + Noto Sans Kannada** (OFL) and picks by language | rule for D1 |
| F-8 | designer | Colour contrast fails accessibility on muted text, veg/non-veg, rating, gold: new values in `design/system/README.md`, applied in D1 | rule for D1 |
| F-9 | designer | Partner/Rider/Operations use a different maroon and cream than Customer: **owner decision** one shared colour set (Stage E) | ⏳ owner |
| F-10 | designer | Kitchen ticket cannot print option names ("Extra cheese"): orders store option ids only → store option names at checkout; there is no order cooking note field. Ticket width setting 80/58 mm; CANCELLED line | B10 follow-up |
| F-11 | designer | Rider offer shows the drop **area** only before accept; customer sees an honest "running late, new time" card, not only "ahead" | rule for E/D |

## Rules for every step (so nothing breaks)
- Check the feature exists first; extend it, never a second copy (seniordev ladder). Money/account state: grep every writer first (`CLAUDE.md` §8).
- Server steps ship alone, behind the gate, and stay compatible with the apps on phones today (old app versions keep working).
- Each new admin power has its own permission, so roles can share it out (#4).
- Each step updates its docs (`docs/*` maps, `CHANGELOG.md`, this Tracker) in the same commit.
- No file from the private competitor study enters the repo.
