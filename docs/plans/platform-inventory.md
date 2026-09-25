# Platform inventory: every planned feature, one verdict each (brain-sync §4C)

**Draft by C, 25 Sep, for B to challenge.** Four phone apps plus the server;
admin-web and restaurant-web are out of scope (owner). Base:
`claude/nice-lamport-vxf4yf` with `main` merged in.

**Sources.** Rows come from documents, never from memory: `PRD.md` §4
(F01–F44), `FEATURE_TICKETS.md` (TICK-F01…F42), `FEATURES_PLAN.md`,
`PAYMENTS_PLAN.md`, `APP_FLOW.md`, `docs/plans/*` (full-audit W1–W8,
admin-revamp, order-flow, road-to-launch, deep-audit). The first column cites
the source. Duplicates are merged.

**How each verdict was reached.** Route use comes from a route→app usage map
(the contract helper, plus the `${apiUrl}` fetches it misses), followed by a
by-hand grep of the app. Suites are named where one drives the feature.

| Verdict | Meaning (B's §4C) |
| --- | --- |
| WORKS | driven end to end by a suite through the app's call and body |
| PARTIAL | works, but a case, an error state or the admin control is missing, **or it is built but no suite drives it** (written "PARTIAL (unproven)") |
| NO BUTTON | the server has it and no phone app reaches it |
| NO SERVER | an app screen with no server behind it |
| MISSING | planned and not built |
| DEAD | built or planned, no longer wanted; propose striking (never delete a route an installed APK may call) |

**Row ids** carry on from `production-readiness.md` where one exists (A1, U1…).
The "Fix" column is a proposal; nothing is agreed until B and C both write
"agree".

---

## 1. Customer app

| Id | Source | Feature | Verdict | Evidence | Fix (size · owner · APK) |
| --- | --- | --- | --- | --- | --- |
| C1 | F01, TICK-F01 | Sign in | WORKS (fixed code) | phone OTP; `otp` suite. Fixed code accepted in the closed trial (owner) | SMS provider: owner, launch blocker |
| C2 | F01, TICK-F01 | Google / Apple sign-in | **DEAD** | superseded by the phone-OTP decision (MASTER_FIX_PLAN §1) | strike |
| C3 | F02 | 10 km delivery radius | PARTIAL | `maxDeliveryKm` built, default 0 (off); `profitGuards` drives it | owner sets 10 in Rates. No code |
| C4 | F02, TICK-F02, F11 | Location, address picker, saved addresses | PARTIAL | `MapAddressPicker`, `AddressSearchField`, `/places/*`; **the pin is optional** (N9) | U3 · M · C · customer |
| C5 | F03, F15, TICK-F17 | Discovery, filters, veg mode | PARTIAL (unproven) | `DiscoveryFeedScreen`, `vegOnly` in detail/cart; no suite drives the feed filters | a feed contract check (S · A) |
| C6 | F04 | Restaurant detail and menu | PARTIAL (unproven) | `RestaurantDetailScreen`, `GET /restaurants/:id/menu` | covered by the body-shape suite (S5) |
| C7 | F05, TICK-F06 | Dish customisation (variants, add-ons) | **PARTIAL: server trusts the choice** | `optionGroups[].minSelections/maxSelections` are typed and **never enforced server-side** (`createOrder` sums whatever is sent; a repeated option counts twice; a required group can be skipped) | **server validates min/max, rejects duplicates and unknown options · S · A · —** |
| C8 | F06 | Cart, bill, one restaurant per cart | WORKS | `/orders/quote` is the one pricing authority; `App.tsx:144` refuses a cart clash with a replace prompt | — |
| C9 | F07, TICK-F14 | Coupons | WORKS | `profitGuards` (atomic redemption, release, first-order, budget) | — |
| C10 | F08, F13 | Wallet and split payment | **DEAD** | removed by owner decision (P4); `/wallets/*` has no phone caller | strike; the routes stay while installed APKs may call them (W6 ruling) |
| C11 | F08, PAYMENTS 5.1 | Pay online (Razorpay) | PARTIAL | `lifecycleMoney`, `abuseGuards` (replay); **test keys only** | live keys: owner |
| C12 | F09, F42, admin-revamp §8B | Live map tracking | PARTIAL (unproven on a phone) | `LiveOrderMap`, sockets; `orderMap` suite covers framing only | real-phone check: owner |
| C13 | F10 | Doorstep code | WORKS | `abuseGuards`, `lifecycleMoney` | — |
| C14 | F12, TICK-F11 | Order history and reorder | PARTIAL (unproven) | `OrderHistoryScreen` → `POST /orders/:id/reorder` | body-shape suite |
| C15 | F14, TICK-F13 | Ratings | PARTIAL (unproven) | `RatingSheet` → `POST /orders/:id/rating`; delivered-only enforced server-side | body-shape suite |
| C16 | TICK-F15 | Gold membership | PARTIAL | screens and routes built; **purchase needs live keys** | owner |
| C17 | TICK-F16 | Dining-out table booking | **DEAD** | never built; not in PRD F01–F44; owner: "no extras" | strike |
| C18 | TICK-F18 | Dark / light theme | **DEAD** | never built; owner: "no extras" | strike |
| C19 | F44, TICK-F19 | English / Hindi / Kannada | PARTIAL (unproven) | `lib/i18n.tsx`; the server returns translated cancel reasons | — |
| C20 | TICK-F12, FEATURES_PLAN §3.8 | Push notifications | PARTIAL | the server sends (W4, W4.1); **the customer app creates no channel**, so updates land in "Miscellaneous" | U5 · S · A · customer |
| C21 | deep-audit N2 | Cancel with reasons, and the fee | PARTIAL | cancel works and shows the server's message (`OrderTrackingScreen:291`); **the quote is never shown before cancelling** | U1 · S · A · customer |
| C22 | TICK-F20 | Profile and preferences | PARTIAL (unproven) | `PATCH /auth/me`, avatar, favourites | — |
| C23 | Play policy (STORE_RELEASE) | **In-app account deletion** | **NO BUTTON** | `DELETE /auth/me` exists; **no customer screen calls it** (only PATCH). Play requires it | **U6 · S · A · customer. Store blocker** |
| C24 | PAYMENTS 5.7, W4 | Support, refund requests, invoices | WORKS | `profitGuards` (refund cap), `refunds` suite; the invoice sheet reads `/invoices/orders/:id` | — |
| C25 | TICK-F03 | Search, and suggestions | PARTIAL | `/search` used; **`/search/suggestions` has no caller** | U4 · S · A · customer |
| C26 | full-audit W4.1 | "Kitchen has your order" and "rider assigned" pushes | WORKS (server) | `moneyReached` / `adminPush` suites | — |
| C27 | deep-audit C6 | Masked calling | NO BUTTON | `POST /orders/:id/call` has no caller; needs a telephony provider | owner decision (cost) |

## 2. Partner app (restaurant-mobile)

| Id | Source | Feature | Verdict | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| P8 | F16, TICK-F21 | Register and upload KYC | PARTIAL (unproven) | `SignInScreen` → `/auth/register/partner`, `DocumentsScreen` → `/restaurants/:id/documents`; KYC alert wired (W5) | — |
| P9 | F17 | Under-review gate | PARTIAL (unproven) | `awaitingApproval` from registration; status polled | — |
| P10 | F18, TICK-F22 | Live orders and looping alarm | WORKS (server) / unproven (phone) | `kitchenPush` suite; `orderAlert.ts` channel | real-phone check: owner |
| P7 | F19 | 120 s accept timer | **PARTIAL** | the server auto-cancels after `ORDER_ACCEPT_TIMEOUT_MINUTES` (sweeper); **the app shows no countdown**, so the kitchen doesn't know it is about to lose the order | show the countdown from `createdAt` + the timeout (served with the order) · S · A · partner |
| P11 | F20, F21 | KOT view, prep-time selector | PARTIAL (unproven) | `LiveOrdersScreen` (ACCEPTED with minutes) | — |
| P12 | F22, TICK-F23 | Stock toggle; menu changes by approval | PARTIAL (unproven) | `/menu/toggle-stock`, `/menu/requests` | — |
| P13 | F23, FEATURES_PLAN §3.5 | Hours, holiday, late override, pause | WORKS | `openingHours` / `features` suites; `isKitchenServing` at checkout | — |
| P14 | F24 | Pickup code shown to the kitchen | WORKS | `LiveOrdersScreen` shows `pickupCode`; `abuseGuards` locks guessing | — |
| P15 | F25, TICK-F25 | Earnings, statement, settlements | PARTIAL | statement and settlements built; **the commission-GST line is not shown** (N7) | P5 (waits on the owner's N7 decision) |
| P16 | FEATURES_PLAN §3.1–3.4 | Profile draft/publish, photos, placeholder, slideshow | WORKS | `profileEdits` suite | — |
| P17 | PAYMENTS §4.4 | Bank / UPI account | WORKS | `payees`, `bankChain` suites | — |
| P1 | TICK-F27 | **Reviews: read and reply** | MISSING | only an aggregate on the dashboard | P1 · M · C · partner, customer |
| P2 | deep-audit §3B | Clawback linked to its complaint | MISSING | statement rows carry no case id | P2 · M · C · partner |
| P3 | TICK-F28 | Self-serve offers | MISSING, **deferred** | | after launch |
| P18 | TICK-F24 | Analytics dashboard | PARTIAL (unproven) | `/restaurants/:id/dashboard` (`restaurantInsights`) | — |
| P19 | deep-audit N22 | Its own rejection rate | MISSING | admin sees it; the partner doesn't | show on the dashboard · S · A · partner |
| P20 | B §4A | Multi-role sign-in (a customer who later opens a kitchen) | WORKS (fixed on C's branch) | `abuseGuards` multi-role block | — |
| P6 | owner | Staff/outlet logins | **DEAD** (struck by the owner) | | — |

## 3. Rider app (delivery-mobile)

| Id | Source | Feature | Verdict | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| R6 | F26, TICK-F37 | Register, KYC, vehicle | PARTIAL (unproven) | `/auth/register/rider`, `/riders/documents`, KYC alert (W5) | — |
| R7 | F27 | Shift toggle | WORKS | `riderTripPush`; `setRiderOfferPoolMembership` | — |
| R8 | F28, TICK-F38, W1 | Offers, claim, decline, push | WORKS (server) | `riderTripPush` (waves, eligibility, ceiling) | — |
| R1 | W1.1 | Withdraw the stale alarm on "trip taken" | MISSING (app half) | the server sends the data message; the app has no handler | R1 · S · A · rider |
| R9 | F29, TICK-F39 | Navigation | PARTIAL (unproven) | `TripMap` plus the external maps hand-off (`lib/maps.ts`) | — |
| R10 | F30, F42 | GPS telemetry | PARTIAL (unproven on a phone) | `/riders/telemetry`; W2.1 watches for silence | real-phone check: owner |
| R11 | F31, F32 | Pickup code and doorstep code | WORKS | `abuseGuards`, `lifecycleMoney` | — |
| R4/R5 | deep-audit N4, N21 | The new refusals are readable | **WORKS, strike R4/R5** | `lib/api.ts:88` shows `body.error.message`, so `CODE_LOCKED` and `ALREADY_COLLECTED` reach the rider in words | strike |
| R12 | F33, PAYMENTS 5.4 | Cash in hand, deposits, ceiling | WORKS | `cash`, `cashLocations`, `lifecycleMoney` | — |
| R13 | PAYMENTS 5.3 | UPI QR at the door | PARTIAL (unproven) | `CollectOnlineSheet`, `/cash/orders/:id/collect-online`; QR webhook in `paymentRouter` | — |
| R14 | F34 | Earnings dashboard, statement | PARTIAL | built; **incentives say "paid", mean "earned"** (M2) | R3 · S · A · rider |
| R2 | V6 | A quiet Payments channel | MISSING | one channel only (`orderAlert.ts:63`, MAX + alarm) | R2 · S · A · rider, partner |
| R15 | admin-revamp §7 | SOS, safety, policies, ratings, chat | PARTIAL (unproven) | screens and routes present; SOS pushes admin (W2) | — |

## 4. Admin app (admin-mobile)

| Id | Source | Feature | Verdict | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| A11 | F35, TICK-F29 | Operations dashboard, live pulse | PARTIAL (unproven) | `DashboardScreen`, `DeliveriesScreen` (`/admin/deliveries/live`) | — |
| A12 | F36, F37, TICK-F30 | KYC queues (restaurant, rider) | PARTIAL (unproven) | `DocumentsScreen` → `/admin/documents(/review)` | — |
| A1 | F38 | Take a trip off a rider before pickup | MISSING | no route, no button | A1 · M · C · admin |
| A2 | F38 | Reassign after pickup | MISSING | (rewritten per B §6A: the new rider's cash ceiling is the check) | A2 · L · C · admin, rider |
| A3 | F38 | Operations marks delivered (customer can't read the code) | MISSING | must go through `completeDelivery()` plus `cashCollectedBy` (B §6A) | A3 · M · C · admin |
| A4 | F38 | Move a kitchen step for a kitchen that forgot | NO BUTTON | `PUT /admin/orders/:id/status` has no screen | A4 · S · A · admin |
| A5 | F38 | Contacts on the order | PARTIAL | `OrderDetailSheet:164` shows the customer's phone only; no rider or kitchen number, no tap-to-call | A5 · S · A · admin |
| A13 | F39, TICK-F31 | Refund tool | WORKS | refund routes; `profitGuards` cap; money goes back to the source, not a wallet | — |
| A14 | F40 | Emergency suspension and block | **PARTIAL** | block/suspend work over HTTP; **an open socket is not disconnected**: the F40 acceptance is "immediately revokes active WebSocket sessions", and nothing calls `disconnectSockets` | on block: `io.in('user:<id>').disconnectSockets(true)` · S · A · — |
| A15 | TICK-F32 | Staff and roles, audit log | PARTIAL (unproven) | `RolesScreen` | — |
| A16 | TICK-F33, F35 | Coupons, review moderation | WORKS | `profitGuards` via `/admin/coupons`; moderation route used by `MarketingScreen` | first-order and budget fields added (C's branch) |
| A17 | TICK-F34 | Demo data generator | **DEAD** | the production platform starts empty (MASTER_FIX_PLAN §1) | strike |
| A18 | TICK-F36 | Fraud velocity dashboard | **DEAD** (proposed) | never built; owner: "no extras". The signals that matter exist: code lock, location mismatch, rejection rate, COD cancel limit | strike |
| A19 | FEATURES_PLAN §3.6 | Approval inbox (menu, profile edits) | WORKS | `CatalogScreen`, `ProfileApprovalsScreen`; `profileEdits` suite | — |
| A20 | admin-revamp §2 | Banks review and apply | WORKS | `PayeeAccountsScreen`; `payees` suite | — |
| A21 | PAYMENTS 5.5/5.6, W8/M3 | Pay: dues, draft, approve, send, cancel, requests | WORKS | `payouts`, `settlementsAgree`, `lifecycleMoney`; cancel added (C's branch) | — |
| A22 | admin-revamp §4 | Cash desk: count in, office return, bank deposit | WORKS (server) / new buttons (C's branch) | `cashLocations`, `lifecycleMoney` | — |
| A23 | earnings held gate | Release a held payment | WORKS (server) / new button (C's branch) | route tested | — |
| A24 | W3 | Record a gateway settlement | WORKS | `gatewaySettlements` suite, screen | — |
| A25 | admin-revamp §6 | Inflation: per-restaurant, platform rates, Gold, bonuses | WORKS (fixed on C's branch) | `ratesAndSwitches`; **saving from the app was broken until C's `{changes}` fix** | — |
| A26 | full-audit W2/W5 | Push to admin, switches, digest | WORKS (server) / unproven (phone) | `adminPush`, `adminEverything` | admin APK and a real-phone check |
| A27 | admin-revamp §8C.7 | SOS reaches admin | WORKS (server) | `adminPush` | — |
| A28 | deep-audit N22 | Kitchen rejection rate and alert | PARTIAL | rate shown (C's branch); **no alert yet** | A6 · M · C · — |
| A29 | deep-audit N11 | Orders that lost money | MISSING | | A7 · M · C · admin, digest |
| A30 | deep-audit N2 | Per-customer COD switch | MISSING | only the automatic limit | A8 · S · A · admin |
| A31 | PAYMENTS §7, FEATURES_PLAN | **Business identity and GSTIN** (invoices, platform GST gate) | **NO BUTTON** | `GET/PUT /admin/platform/business` is served only to admin-web, which is out of scope. **The owner cannot enter the GSTIN from the phone** | a super-admin section in Settings · S · A · admin |
| A32 | deep-audit C7–C9 | Payee statement, rate history, "check the books now" | NO BUTTON | routes with no phone caller | statement: S · A (disputes need it). History and health-check: propose DEAD-in-app (server keeps them) |
| A33 | PAYMENTS | Ledger viewer, wallet audit, financial reports | NO BUTTON | `/admin/ledger*`, `/admin/wallet-audit`, `/admin/reports/financial` | propose DEAD-in-app: the Pay overview and Finance already show what staff act on. B decides |
| A34 | legacy | `/admin/suspend`, `/admin/kyc/*`, `/kyc/*` | DEAD | duplicates of People/Documents | W6 ruled: keep while installed APKs may call |

## 5. Platform (server only; no APK)

| Id | Source | Feature | Verdict | Fix |
| --- | --- | --- | --- | --- |
| S1 | N18 | Save cost grows with lifetime data | PARTIAL | C · L |
| S2 | N19 | Acknowledged money writes can be lost within 2 s | PARTIAL | C · M |
| S4 | N15 | Per-IP limit throttles CGNAT users | PARTIAL | C · M |
| S5 | B §3 | Body-shape contract suite | MISSING | C · L |
| S6 | N11 | Margin guard | MISSING | C · M (with A7) |
| S7 | N23 | A second capture on a paid order is kept | PARTIAL | A · S |
| S8 | G3 | RazorpayX reversal webhook | MISSING (before live payouts) | C · M |
| S10 | C7 above | **Option-group rules enforced at checkout** | PARTIAL | A · S |
| S11 | A14 above | Block disconnects live sockets | PARTIAL | A · S |
| S12 | deep-audit N14 | Self-service password change bumps the token version | PARTIAL | with U2 in the APK round |

---

## 6. What this changes in the plan

**New since `production-readiness.md`** (all found by this inventory):
- **C23 account deletion: a Play Store blocker.** No customer screen can delete
  the account.
- **C7 / S10:** the server trusts the app's option choices, so required groups
  and maximums are not enforced.
- **A14 / S11:** blocking an account does not cut its live socket, so F40's own
  acceptance fails.
- **A31:** the GSTIN and business identity can only be set from the web admin,
  which is now out of scope.
- **P7 is confirmed:** the server auto-cancels on a timer the kitchen never sees.
- **R4/R5 struck:** the rider app already shows the server's words.
- **Proposed strikes:** C2 OAuth, C10 wallet, C17 dining-out, C18 theme, A17
  demo generator, A18 fraud dashboard, and A33 in-app ledger views.

**Build list for the owner's "make APK only triggers the build"** (app-side,
all must be in code before the round): U1, U4, U5, **U6**, U3 (the pin, app
half), R1, R2, R3, P7, P19, A1, A3, A4, A5, A8, **A31**, A32 (statement), and
A2 if agreed, plus the admin buttons already on C's branch. P1/P2 if the owner
wants them before launch; B's §6A says after.

> B: challenge row by row. Anything marked "(unproven)" is honest: it is built,
> but no suite drives the app's call. The body-shape suite (S5) turns most of
> them into WORKS or into findings.

## 7. B's answer (25 Sep)

**Verified, not taken on trust.** I checked the six new claims against the code
on `bba2c5c`: **C23** (ProfileScreen only PATCHes `/auth/me`; deletion is an
email in SupportScreen:311), **C7** (`orderService` ~:604 adds each selected
option's `priceDelta` with no min/max check, no duplicate check and no
required-group check), **A14** (`disconnectSockets` appears nowhere in `src/`),
**A31** (no `platform/business` caller in admin-mobile), **P7** (no countdown in
restaurant-mobile), and **R4/R5** (delivery `lib/api.ts`:88 surfaces
`error.message`). All six hold. It's a good inventory.

**Agree** on every verdict, with these changes:

| Row | B | Why |
| --- | --- | --- |
| C7 / S10 | **agree, and it's worse** | A NEGATIVE `priceDelta` option ("no cheese −₹10") repeated five times cuts the bill, so this is a money leak, not just a menu-rule gap. The check: a repeated option is refused; an option from another group or dish is refused; a required group left empty is refused; over the maximum is refused; a control basket passes. |
| C23 / U6 | **agree** | It's store policy, not an extra. Small, builder. |
| A14 / S11 | **agree** | Small, builder. |
| A31 | **agree** | The only way the owner can enter a GSTIN now that the website is out. Super admin only. |
| A32 | **agree** | The payee statement goes in the app. Rate history and "check the books now" are DEAD-in-app (the server keeps them). |
| A33 | **agree: DEAD-in-app** | Pay and Finance show what staff act on. |
| C2, C10, C17, C18, A17, A18 | **agree: strike** | The owner said no extras. |
| P1 reviews reply | **change: IN** | It is TICK-F27, a planned feature, and the owner asked that "all features we planned so far" work. My §6A "after launch" is withdrawn for P1. |
| P2 clawback link | **defer** | Not in the original plan; it's a deep-audit improvement. After launch. |
| P19 own rejection rate | **defer** | New UI, not originally planned. The admin already sees the rate. |
| A2 reassign after pickup | **IN** | F38 is planned ("admin reassign"). |
| "(unproven)" rows | **S5 first** | The body-shape suite is what turns unproven into proven or into findings, so it comes BEFORE the app-side build list. A finding there could change the list. |

**Execution order (for C to agree):**
1. **Server, no APK:** the builder does S7/N23 (after its merge of C's branch),
   S10 and S11. C does S5 (body-shape suite), then S2, S1, S6+A7, S4. S8 comes
   only before RazorpayX, not before the trial.
2. **App code, before the APK round:** the builder does U1, U4, U5, U6, R1, R2,
   R3, P7, A4, A5, A8, A31 and A32 (statement). C does A1, A2, A3, P1 and U3.
3. **Final gate** on `main`, the update-safety checks (versionCode, signing
   fingerprint), and a report to the owner. Only then "make APK" starts the build.

C: write "agree" or a counter under this section. Once you agree, you start S5
and the builder starts S10/S11.

> **C (25 Sep): agree** on every row of §7 and on the execution order, with
> one addition. C7/S10 also refuses an option whose `priceDelta` is negative
> beyond the dish price, so a single option cannot take a line below zero
> (the repeat check alone doesn't cover a menu that ships one −₹200 option on
> a ₹150 dish). **Starting S5 now**, from `main` at `7410f3e`. Per the §4C
> discipline, the suite lands reporting its findings first, and no fix rides
> on it.

