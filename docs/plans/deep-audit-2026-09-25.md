# Deep audit (25 Sep 2026): money leaks, loopholes and unconnected features

Written by **Session C** (the "Quick Bite" cloud session, watcher and helper) at
the owner's request. **Plan only, nothing is built here.** It is a companion to
`full-audit-2026-09-24.md` (Session B's plan, W1–W8), not a replacement for it.
Everything below is **new**: none of it appears in that document's F1–F9, V1–V7,
W1–W8, M1–M4 or its §2 "not bugs" list.

Against `eec21a4` (main = this branch's base). Every finding was confirmed by
opening the file; line numbers are from that commit. The Android apps come first,
as the owner asked, so every item says whether it needs a new APK.

Severity: **S0** = money leaves or accounts are taken over *today*, **S1** = a
repeatable loss or hole, **S2** = wrong, but bounded, **S3** = hygiene.

---

## 0. The top ten, in fix order

| # | Sev | What | APK? |
| --- | --- | --- | --- |
| N1 | S0 | A replayed `confirm-payment` or webhook brings a **cancelled/refunded order back to life** | no |
| N2 | S0 | Customer can cancel at **any stage up to out-for-delivery for a 100% refund**; the kitchen gets nothing for cooked food | server no · UI copy yes |
| N3 | S0 | A **rider can cancel** any order assigned to them, using *admin* reasons | no |
| N4 | S0 | The generic status route lets a rider **skip the pickup code**; delivery OTP and pickup code have **no attempt limit** | no |
| N5 | S0 | **Fixed OTP `123456` in production**: anyone can sign in as any customer by phone number | no (config + SMS provider) |
| N6 | S1 | **Refund stacking**: a second refund case can be raised and paid on an already-refunded order | no |
| N7 | S1 | **Commission GST (18%) and TCS (1%) are paid out of the platform's margin**, never deducted from the partner, which is about 3.7% of food value on every order | no (decision first) |
| N8 | S1 | **Coupon farming and exhaustion**: unlimited accounts (see N5), no new-user-only rule, redemptions never released, and a race on `usageLimit` | no |
| N9 | S1 | **Client-supplied `distanceKm`** prices the delivery whenever an address has no coordinates; no delivery radius, no minimum order | no |
| N21 | S0 | The rider's **"cancel trip" puts any non-delivered order back to ready-for-pickup**, including after pickup and on cancelled/refunded orders | no |
| N10 | S1 | **Nine admin tools built on the server have no button in the admin app**: cash desk, held-payment release, payout cancel, payout requests… | admin APK |

---

## 1. Money leaks and loopholes (the "always earning" part)

### N1 — S0 — A replayed payment confirmation resurrects a cancelled or refunded order

`orderService.confirmPayment` (`orderService.ts:929`) verifies the signature and
then **unconditionally** sets `paymentStatus = 'PAID'`, `status = 'ORDER_PLACED'`.
It never checks the current status. The route (`orderRouter.ts:333`) is
`authMiddleware()` with no ownership check.

The exploit: pay → cancel → auto-refund (money back) → call `confirm-payment`
again with the same (still valid) signature. The order is `ORDER_PLACED` +
`PAID` again, the kitchen is pushed a new order, the rider delivers it, and
delivery posts earnings against a capture that was already reversed. **Free
food, and the partner and rider get paid from platform money.** The same replay
works on a `DELIVERED` order (it resets to `ORDER_PLACED`, so the kitchen cooks
it twice).

`markPaidByGateway` (`:989`) guards only `paymentStatus === 'PAID'`. A refunded
order has `paymentStatus: 'REFUNDED'`, so a **Razorpay webhook retry**
(`payment.captured` is retried on any non-2xx) resurrects it too, with no
attacker involved.

**Fix:** one `markOrderPaid` guard used by both paths: only
`PAYMENT_PENDING → ORDER_PLACED`. Anything else is a no-op, except a capture
arriving on a `CANCELLED` unpaid order (reconciliation cancelled it first). That
one goes to an auto-refund, not a resurrection. `confirm-payment` also requires
`order.customerId === req.user.id`. `/payments/start` must refuse a `CANCELLED`
order (`paymentRouter.ts:93` checks only PAID).
**Checks (each must fail today):** replay confirm on a refunded order → 409, the
kitchen is not pushed, and the ledger is unchanged. Replay the webhook on a
refunded order → nothing. Capture on an auto-cancelled order → one refund, and
the order stays cancelled.

### N2 — S0 — Free cancellation at every stage, and the kitchen eats the loss

`VALID_TRANSITIONS` (`orderStateMachine.ts`) allows `CANCELLED` from every state
up to `OUT_FOR_DELIVERY`. `assertMayTransition` (`orderRouter.ts:432`) lets the
customer cancel whenever the state machine allows it, and `cancelOrder`
(`orderService.ts:798`) refunds **`bill.totalAmount` in full**, whatever the
stage. The order never reaches `DELIVERED`, so `postOrderEarnings` never runs:
**the partner is paid nothing for food they cooked, and the rider nothing for a
trip already driven.** On COD, the customer can refuse at the door, repeatedly,
at no cost.

**Fix (owner decides the numbers, and they live in `RATE_BOUNDS`):**
- Free cancellation only before `ACCEPTED` (or within N seconds of placing).
- After `ACCEPTED`: a customer-cancel fee, up to 100% once `PREPARING`, refund
  = total − fee. The fee funds a **kitchen compensation** posting (partner's
  food share) and, after pickup, the rider's trip pay.
- COD refusal at the door: count it per customer. After K refusals, COD is
  switched off for that account (`cash_on_delivery` is already per-platform, so
  this adds a per-customer flag).
- The customer app must say the fee *before* the cancel button is pressed. That
  part needs a customer APK. The server half does not.

### N3 — S0 — Riders can cancel orders with admin reasons

`assertMayTransition` returns early for the assigned rider with **any**
`nextStatus`, including `CANCELLED`. `actorForRole('rider')` returns `'admin'`
(`cancellationReasons.ts:185`), so the rider gets the admin reason list. A rider
holding a prepaid order can pick it up, cancel it, and keep it: the customer is
refunded 100% by the platform, and the kitchen is never paid.

**Fix:** a rider never cancels. The rider path is `releaseRider` (hand back)
before pickup, and SOS/support after. Map `rider` to no audience in
`actorForRole`, and refuse `CANCELLED` from riders in `assertMayTransition`.

### N4 — S0 — The generic status route skips the pickup code; OTPs can be brute-forced

- `PUT /orders/:id/status` lets the assigned rider move
  `READY_FOR_PICKUP → OUT_FOR_DELIVERY` **without the pickup code**. Only
  `/riders/orders/:id/verify-pickup` checks it. It also lets the restaurant
  owner move its own order to `HANDED_TO_RIDER`/`OUT_FOR_DELIVERY` with no
  rider, and to `CANCELLED` after the food has left.
- The delivery OTP is **4 digits**. Neither `transitionStatus` (`:1050`) nor
  `verifyDeliveryOtp`/`verifyPickup` counts failures. 10,000 codes at 100
  requests a minute is under two hours per IP. A rider can mark a prepaid order
  delivered without meeting the customer.

**Fix:** a per-role allowed-transition table (restaurant: `ACCEPTED`,
`PREPARING`, `READY_FOR_PICKUP`, and cancel only before `READY`; rider:
nothing, because they use the rider routes). Five failed OTP or pickup-code
attempts lock that order's code for 15 minutes and raise an admin alert.

### N5 — S0 — Fixed OTP in production means any customer account can be taken over

`OTP_PROVIDER=fixed` + `OTP_ALLOW_FIXED_IN_PRODUCTION=true` (the owner was told
to set this, `OWNER_ACTIONS.md:83`). Anyone who knows or guesses a phone number
signs in as that customer. They get the saved addresses, the order history, and
the ability to place COD orders to them. It is also what makes N8's coupon
farming unlimited. **Owner action:** pick MSG91 or Twilio (the code is already
provider-agnostic, `otpService.ts`). Until then, treat the customer app as a
closed beta.

### N6 — S1 — Refunds can be stacked on one order

`POST /support/refund-requests` (`supportRouter.ts:159`) only refuses while a case
is *open*; a `REFUNDED` case does not block a new one. The pay path
(`financeRoutes.ts:249`) caps **one case** at `orderTotal`, never
`orderTotal − already refunded`. An auto-refunded cancelled order can also get a
second case. **Fix:** refuse a request when refunded-so-far ≥ total. Cap every
payment at `total − refundedSoFar`, computed from the ledger (`REFUNDS_PAID` per
order, one source). Add a request window (e.g. 48h after delivery).

### N7 — S1 — Commission GST and TCS come out of the platform's pocket

`splitForOrder` (`earnings.ts:108`):
`partnerPaise = items + packaging − commission − tds`. Then
`TAX_GST_PAYABLE += gstOnFood + commissionGst` and `TAX_TCS_PAYABLE += tcs`, and
`REVENUE_FEES` takes **whatever is left**. So:
- **18% GST on the commission** is never charged to the partner. On a 15%
  commission that is 2.7% of food value, every order, from the platform's margin.
  (Zomato and Swiggy invoice it to the restaurant.)
- **TCS 1%** is credited as payable but not deducted from the partner either.
  Also, for restaurant services under GST s.9(5) the platform pays the food GST
  itself and **TCS does not apply**, so this may be a liability that should not
  exist at all.
- **TDS under s.194-O is 0.1% since 1 Oct 2024**, not the 1% in
  `DEFAULT_PRICING_RATES.tdsPercent`. Partners are over-withheld tenfold.
- The **18% GST inside the platform fee** (₹0.90 of ₹5.90) is booked as revenue,
  not as `TAX_GST_PAYABLE`.

Worked example with the default rates (₹300 food, 3 km, no coupon): the platform
nets about ₹31 after the ~2% gateway fee. Deducting commission GST and TCS from
the partner lifts that to about ₹42 (+35%). **Owner and CA decide the tax
treatment first.** Then the change is one function (`splitForOrder`) plus the
partner statement wording, and old orders stay as posted (forward only).

### N8 — S1 — Coupon farming, exhaustion and races

`couponService.validateCoupon`:
- `perUserLimit` is per account, and accounts are free (N5). There is no
  **new-customer-only** flag, so `WELCOME50` works for existing customers.
- `recordRedemption` runs at order **creation** (`orderService.ts:603`), for
  `PAYMENT_PENDING` orders too, and is **never released** on cancellation or
  abandonment. Anyone can create pending orders to burn a limited campaign's
  `usageLimit`.
- Validate and redeem are separated by `await roadDistance(...)`, so two
  concurrent orders both pass a `usageLimit` with one use left.
- `perUserLimit` scans every order ever placed on each checkout (O(n)).

**Fix:** redeem on `PAID`/`ORDER_PLACED` and release on cancel. Re-check and
increment in one synchronous step. Add a `newCustomersOnly` flag (no delivered
order on the account, phone, or device). Keep a per-coupon **max platform
spend** so a campaign has a budget, not just a count.

### N9 — S1 — The client can price its own delivery; no radius, no minimum order

- `CreateOrderSchema.distanceKm` is client-supplied. It is used whenever
  `restaurant.coordinates && address.coordinates` is falsy
  (`orderService.ts:512`), and `addressRouter` makes coordinates **optional**.
  So `distanceKm: 0.1` gives base delivery for any distance, and the rider's
  pay (`calculateTripPayout`) is underpaid off the same number. An address with
  no coordinates also disables the delivery-proximity check (`:1066`).
- A restaurant still on `UNSET_COORDINATES` (the MG Road placeholder,
  `restaurantLocation.ts:37`) is measured as if it were at MG Road. Confirm
  whether `createOrder` treats the placeholder as unset. It does not appear to.
- There is **no maximum delivery radius and no minimum order value** anywhere in
  the server (`grep` returns only coupon minimums).

**Fix:** ignore client `distanceKm` in `createOrder` entirely. Require
coordinates on new addresses (geocode the pin if the app lacks GPS), and refuse
an order with none. Add `maxDeliveryKm` and `minOrderValue` (global, with a
per-restaurant override) to `RATE_BOUNDS`, enforced in quote and create alike.

### N11 — S1 — No margin guard

Coupon + membership (up to 50%, uncapped when the plan sets no cap) + free
delivery can stack on one order. The ledger correctly books the loss as a
`REVENUE_FEES` debit (`earnings.ts:380`), but nothing prevents it and nothing
reports it. **Fix:** a per-order "platform contribution" figure on the quote.
Refuse (or cap the coupon) below a configurable floor. Add a daily admin digest
line: orders that lost money, and how much.

---

## 2. Security

| # | Sev | Finding | Fix |
| --- | --- | --- | --- |
| N12 | S1 | **Any restaurant owner can read any order** on the platform: `GET /orders/:id` treats every `restaurant_owner` as staff (`orderRouter.ts:94`) | staff = admin only. Restaurant = `order.restaurantId` is one they own |
| N13 | S2 | **Idempotency key is global, not per customer** (`orderRepository.ts:55`). Replaying another customer's key returns *their* order, which is also an O(n) scan per checkout | key = `customerId + key`, with an index map |
| N14 | S2 | **JWTs cannot be revoked.** 7-day tokens; logout and change-password do not invalidate them, and neither does a staff role removal for tokens still in flight (the role is re-read, but a sacked admin's token still authenticates as a user) | `tokenVersion` on the user, bumped on logout-all, password change and staff removal |
| N15 | S2 | **The rate limit is per IP**: 100/min global, 10/5 min auth. Indian mobile carriers put thousands of users behind one CGNAT IP, so real customers get throttled at scale | key authenticated routes by user id. Keep per-IP only for auth |
| N16 | S2 | Rider paths in `orderRouter` compare `order.riderId` (a `rdr_…` id) with `req.user.id` (a user id). `GET /orders` and `GET /orders/:id` never match for riders. It is harmless only because the rider app uses `/riders/*` | use `riderRepository.findByUserId` |

---

## 3. Features built on the server that no Android app reaches

Found by scanning all 277 mounted routes against every call in the four apps,
then checking each "unused" hit by hand. The scanner misses `apiFetch(`${apiUrl}…`)`
calls, so false positives were removed. **All of these are admin-app buttons
(one admin APK) unless noted.**

| # | Route(s) | What the owner cannot do today |
| --- | --- | --- |
| C1 | `POST /admin/cash/returns` | Clear a rider who hands cash in at the office without declaring it in the app. **Their payout stays blocked for ever** |
| C2 | `POST /admin/cash/bank-deposits` | Record office cash going to the bank. The pot panel and the payday-shortfall warning never see it |
| C3 | `POST /admin/payments/held/:orderId/release` | Release a payment held for missing proof of delivery. **The partner is never paid for a real order** |
| C4 | `POST /admin/payouts/:id/cancel` | Cancel a drafted payout |
| ~~C5~~ | `POST /admin/payouts/requests/:id/{seen,decline}` + `/earnings/payout-requests` | **Withdrawn, my error.** The "Ask to be paid" button was removed on purpose (step 9, see the comment in both `EarningsStatementScreen.tsx`); payouts run on the cadence. The earnings routes are leftovers, so they go to **W6 as dead code**. Keep the admin decline route until the orphaned requests (`admin-revamp` §11A) are cleared |
| C6 | `POST /orders/:id/call` | Masked calling between customer, rider and kitchen (all three apps) |
| C7 | `GET /admin/payouts/statement/:ownerType/:ownerId` | A per-partner or per-rider statement for disputes |
| C8 | `POST /admin/payments/health-check` | "Check the books now" (it runs only on the timer) |
| C9 | `GET /admin/pricing/config/history`, `/:version` | Rate change history (who changed commission, when) |
| C10 | `GET /search/suggestions` | Search-as-you-type in the customer app (customer APK) |
| C11 | `/kyc/submit`, `/kyc/status/*`, `/admin/kyc/*`, `/admin/suspend`, `/wallets/*` | Legacy duplicates. Delete in W6, don't connect |

Decision for the brain: C1–C4 are money-blocking and small, so they go into the
next admin APK. C6 needs a telephony provider (Exotel/Knowlarity) before it can
be connected.

> **Plan vs. reality: C1/C2 are marked done in `admin-revamp-and-inflation.md`
> §11A ("office cash and the admin cash return" under *Built and proved*), and
> §4.3 records the owner's explicit request for the button on the rider's
> People page.** The server half is built and tested. **No app calls it.**
> `PeopleScreen.tsx:544` shows "Cash in hand (COD)" read-only, and `grep` finds
> no `cash/returns` or `bank-deposits` in any app, at any commit. The owner
> believes this works. It is the plan's §11.2c ("the plan is a secondhand
> account") again. The fix is two buttons: Rider page → "Cash handed in", and
> Pay → Cash → "Banked".

| # | Missing admin tool | Why a non-technical staff member needs it |
| --- | --- | --- |
| C12 | **Staff password reset** (`POST /admin/staff/:userId/reset-password` exists, no screen, also noted in `road-to-launch.md` §2.2) | A locked-out colleague otherwise needs a developer |

---

## 3A. Rider app: the "cancel trip" route puts food back on the shelf

### N21 — S0 — `POST /riders/orders/:id/cancel` has no stage check

`riderRouter.ts:1213` refuses only `DELIVERED`. Otherwise it **unconditionally
sets `order.status = 'READY_FOR_PICKUP'`** and re-offers the trip to every
rider. So:
- **After pickup** (`OUT_FOR_DELIVERY`), the rider holding the food releases it.
  The order goes back on offer at the restaurant while the food is in rider 1's
  bag. On a COD order, rider 1 also leaves with nothing owed against them.
- **On a `CANCELLED`/`REFUNDED` order** that still carries its `riderId`, the
  order is **resurrected** to `READY_FOR_PICKUP`, re-offered, and can be
  delivered. Delivery then posts earnings for an order whose money was already
  refunded. It is the same class of hole as N1, from the rider side.
- **Before the food is ready** (`ACCEPTED`/`PREPARING`, when the restaurant
  offers riders early via `riderOfferAtStatus`), it **jumps the kitchen's food
  track forward** to ready. That breaks the two-track model
  (`order-flow-and-money-rebuild.md` §1.2: "`assignRider()` must not touch
  `order.status`"). The same rule applies to its inverse.
- It also stamps `cancelledAt` and `cancellationReason` on a live order, so
  reports and the customer app may read it as cancelled.

**Fix:** release is allowed only while `riderStage` is before `PICKED_UP` and
the order is not terminal. It touches **only** the rider track (clear rider
fields, `riderStage = 'UNASSIGNED'`) and **never** writes `status` or
`cancelledAt`. After pickup the only paths are delivery, SOS, or an admin
decision. Count releases per rider and feed them into the no-show metrics.

### N22 — S1 — A restaurant rejection costs the restaurant nothing

Restaurants may cancel with `ITEM_UNAVAILABLE`/`KITCHEN_OVERLOADED`/
`KITCHEN_CLOSED` at any stage before delivery. The platform refunds 100% and
eats any coupon, and the restaurant pays nothing. Zomato tracks a rejection
rate, lowers ranking, and charges for rejections after acceptance. **Fix:**
count restaurant cancellations per restaurant and show the rate on its admin
page. Above a threshold, auto-pause the kitchen and alert admin. After
`ACCEPTED`, an optional per-order penalty is clawed back from the partner
payable (the same mechanism as the refund clawback).

---

## 3B. "Like Zomato": what each app still lacks for production

Checked by listing every route each app calls against the server's routes.

**Partner app (restaurant-mobile).** Present: live orders with the four taps,
out-of-stock toggle, kitchen on/off, hours override, menu changes by request,
documents, bank, statement, settlements, profile edits, support, ratings
summary. **Missing:**
- **Read and reply to customer reviews.** Only an aggregate is shown, but
  replies drive repeat orders.
- **Order issue and complaint visibility.** A refund clawback reaches the
  statement with no link to the complaint that caused it, which leads to
  disputes.
- **Self-serve offers** (restaurant-funded discounts). This is also the main
  way to move coupon cost off the platform (see §5).
- **Commission tax invoice** (monthly GST invoice from the platform). This is
  mandatory the moment N7 charges GST on commission.
- **Staff or outlet logins** (a manager who is not the owner). Today one
  phone is the whole restaurant.
- **Rejection rate and ranking impact**, visible to the partner (N22).

**Rider app (delivery-mobile).** Present: shift, broadcast, claim or decline,
stages, pickup and OTP, cash declare and deposits, earnings, statement,
settlements, incentives, ratings, documents, bank, SOS, policies, chat.
**Missing:** the "trip taken" handler (W1.1), a quiet Payments channel (V6),
the incentive label saying *earned* not *paid* (M2), and a safe release flow
(N21).

**Customer app (customer-mobile).** Present: OTP login, discovery, search,
menu, cart and quote, coupons, tip, pay or COD, tracking with map and chat,
cancel, rating, reorder, invoices, refunds, support, Gold, addresses,
favourites. **Missing:**
- The cancellation fee shown before confirming (N2).
- Search suggestions (C10).
- Notification channels (V6).
- The address map pin **required**, not optional (N9).
- The **in-app account deletion** entry. The route exists, and the app calls
  `DELETE /auth/me` from `ProfileScreen`. Confirm it is visible, because Play
  Store policy requires it.

**Admin app (admin-mobile).** Adds C1–C4, C7–C9, C12, the cash-return button
on the rider page, and a **restaurant rejection-rate** and **loss-making
orders** view (N11, N22).

---

## 3C. Profit from day one: the levers that already exist, and the gaps

The platform has more pricing levers than most: food markup, packaging markup,
delivery markup, platform fee, extra charge, per-restaurant commission, and Gold
(`admin-revamp` §6). The risk is not a missing lever. **It is day-one defaults
that lose money, and holes that give it back.**

1. **A new restaurant starts at zero markup** (the Inflation screen warns about
   this). Set a non-zero default at approval, so no restaurant goes live
   earning only commission.
2. **Delivery is at or below cost at short distances with the defaults:**
   customer ₹30 (≤3 km), rider ₹25 + ₹6/km beyond 2 km, floor ₹30. At 3 km the
   rider costs ₹31. Either raise `deliveryBaseFee` or set
   `riderDeliveryMarkupPercent`, which starts at 0.
3. **Coupons are 100% platform-funded.** Add a `fundedBy`
   (platform / restaurant / split) field on coupons. Restaurant-funded offers
   are how Zomato and Swiggy run most discounts.
4. **Close the holes that give money back:** N1, N2, N3, N6, N21 (all
   server-only).
5. **Fix the tax leakage:** N7 (about 3.7% of food value per order).
6. **Minimum order and maximum radius:** N9.
7. **A margin guard and a daily "orders that lost money" report:** N11.
8. **Gold** needs live Razorpay keys before anyone can buy it.

With the defaults and none of the above, a ₹300 order nets about ₹31, and a
`WELCOME50` order loses about ₹19. With items 1, 2 and 5 at conservative
settings (5% food markup, ₹40 delivery base, commission GST charged), the same
order nets about ₹67 after the gateway fee (₹396.65 billed; partner ₹263.90;
rider ₹31; tax ₹26.85), and a ₹50 coupon order stays positive at about ₹17.

---

## 4. Platform and operations

- **N17 — S1 — Deploy overlap loses writes.** The store is hydrated once at boot
  (`postgresStore.ts`), and Railway runs the old and new instance side by side
  until the new one is healthy. Anything the old instance writes after the new
  one hydrated never reaches the new one's memory. On its next save, the new
  one overwrites any document both touched (an order accepted, a payment
  captured) with its stale copy. **Fix now:** set Railway's overlap to 0 so
  the old instance stops before the new one hydrates (a few seconds of 502s is
  better than silent loss). **Fix properly:** a version column and a
  compare-and-set upsert, as the file's own header already asks.
- **N18 — S2 — Every save stringifies every document ever written**
  (`saveStoreToDatabase` walks all collections to diff). CPU per save grows with
  lifetime order count and blocks the event loop. Mark documents dirty at write
  time instead.
- **N19 — S2 — A 2-second window of acknowledged-but-unsaved money writes.**
  Capture, refund and payout-PAID return success before the debounced flush
  (`client.ts:275`). Flush synchronously (`await flushStore()`) on those few
  routes.
- **N20 — S1 — No over-the-air updates.** None of the four apps has
  `expo-updates`, so every JS fix, including the dozen "needs the admin APK"
  items above, waits for a sideloaded build. Adding it once (a self-hosted or EAS
  update channel) turns most future app fixes into server-side pushes. **This is
  the single biggest speed-up for the Android-first plan**, and it itself needs
  one final APK per app.

---

## 5. Suggested order of work (for the brain to slot in after W7(a)/W6)

1. **N1, N3, N4, N21** — server-only, S0, small. One commit each, with the replay
   checks written as mutations first.
2. **N6, N12, N13, N9 (server half)** — server-only.
3. **N2** — needs the owner's fee numbers first (ask now, build after 1–2).
4. **N7** — needs the owner + CA decision. Ask now.
5. **N8, N11** — coupon rules and margin guard.
6. **N17 config change** — owner flips Railway overlap. Then N19, N18.
7. **Next APK round (all four apps, once):** N20 `expo-updates`, the C1–C4
   admin buttons, the N2 cancel-fee wording, the rider "trip taken" handler
   (W1.1), the Payments notification channel (V6), and the incentive label (M2).
   **One build per app, carrying everything.**
8. **Owner-only:** N5 (SMS provider), live Razorpay keys, Railway overlap setting.

Baseline for all of it: `npm test` on `eec21a4`, see §6.

## 6. Baseline gate on `eec21a4`

`npm test` in `apps/backend-api`, run by Session C on 25 Sep: **all 56 backend
suites passed (65.2 s), exit 0, no `[FAIL]` lines.** Every fix above must
leave this green, and must add a check that fails on `eec21a4` first.
