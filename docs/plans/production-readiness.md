# Production readiness: one table per app (joint plan, B + C)

**Status: DRAFT by C, for B to challenge.** Nothing here is built until B and
C have both written "agree" on the row (brain-sync §4B). Owner rule (§4A):
**big → C, small → A**, and B reviews every commit.

Inputs: C's `deep-audit-2026-09-25.md` §3B/§3C, B's standing owner goals (pay
everyone; cash; every notification reaching admin; every section controlled
from admin; "like Zomato"), and the APK-round list.

Base: `claude/nice-lamport-vxf4yf` at `2414d8f` (main merged in, 58/58 green).

**Columns.** *Size*: S = hours, M = a day, L = several days. *APK*: which app
build the change needs to reach anyone ("—" means server only). *Check that
fails first*: the check, written before the fix, that must fail on today's code
and pass after it. A row without such a check is not ready to build.

> B: challenge any row inline as `> B:`. C answers as `> C:`. A row is AGREED
> when both have written "agree" on it.

---

## 0. The rule for the whole plan

"Production ready" for this owner means: **a non-technical staff member can
resolve any real-world case from the admin app, with no developer, and every
case leaves a record.** Every row below either closes a case staff cannot handle
today, or stops money leaving. Anything else is out of scope for this plan.

---

## 1. Admin app: every real-world case has a button

What staff can do to an order today: **cancel** and **refund**, nothing else
(`admin/orderRoutes.ts` mounts `/orders/:id/status`, but no screen calls it).

| # | Case the staff hit | Gap | Size | Owner | Check that fails first | APK |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | The rider's phone died / the rider walked off **before** pickup | No "take this trip off the rider and re-offer it" | M | C | admin unassign → order back on offer, rider fields cleared, **food status unchanged**, and one audit row | admin |
| A2 | The rider disappears **after** pickup (W2.1 raises it, then nothing) | No "reassign to another rider"; there is no path at all | L | C | reassign moves `riderId`, keeps `pickedUpAt`, moves the RIDER_CASH responsibility on a cash order, notifies both riders | admin, rider |
| A3 | The customer's phone is dead, so they cannot read the doorstep code | No "mark delivered by operations" with a reason and evidence | M | C | operations delivery posts earnings exactly once, records who and why, and refuses without a reason | admin |
| A4 | The kitchen forgot to tap Ready and the rider is waiting | The admin status route exists and has no screen; it has also never been checked against the per-role table | S | A | admin can move the kitchen steps only; the check drives the route the app calls | admin |
| A5 | Call the customer, rider or kitchen from the order | Phone numbers shown? Masked calling C6 needs a provider | S (show) / L (masked) | A / C | the order sheet shows the three contacts to staff only | admin |
| A6 | A restaurant keeps rejecting orders | The rate is shown (N22); nothing acts on it | M | C | above an owner-set rate the kitchen is auto-paused and admin alerted; a control kitchen below the rate is untouched | — |
| A7 | "Which orders lost us money today?" | No view, no digest line (N11) | M | C | a coupon order below cost appears in the report with its loss; a profitable order does not | admin (view), — (digest) |
| A8 | A customer abuses COD or refunds | `codCancelLimit` exists; no per-customer view or manual switch | S | A | admin can turn COD off/on for one customer; checkout honours it | admin |
| A9 | Set the new N2/N7/N9 rates safely | Rates screen works (fixed); the new rates need plain help text and a warning when the customer app cannot show the fee yet | S | A | the cancel-fee rate refuses a non-zero value while `customerAppShowsCancelQuote` is false | admin |
| A10 | Payday, end to end | Covered by W3/M3/M4 and C's desk buttons; **only RazorpayX live keys remain** (owner) | — | owner | — | — |

## 2. Partner app (restaurant-mobile): "like Zomato"

| # | Gap | Size | Owner | Check that fails first | APK |
| --- | --- | --- | --- | --- | --- |
| P1 | **Read and reply to reviews** (only an aggregate today) | M | C | partner reply stored and shown to the customer; one reply per review; moderation respected | partner, customer |
| P2 | **The complaint behind a clawback.** A statement deduction links to the refund case and its reason | M | C | every `REFUNDS_PAID` clawback row carries a case id the partner can open | partner |
| P3 | **Self-serve offers, restaurant-funded.** Coupon `fundedBy` (platform / restaurant / split); the restaurant share is clawed back per order | L | C | a restaurant-funded coupon reduces the partner payable, not platform revenue; a platform coupon is unchanged | partner, admin |
| P4 | **Commission tax invoice** (monthly), mandatory once N7 is non-zero | M | C | the invoice total equals the ledger's commission + commission GST for the month | partner |
| P5 | **Show the commission-GST line** on the statement (N7's precondition, B §2.2) | S | A | a statement row for an order with `commissionGstToPartner > 0` shows the line | partner |
| P6 | **Staff/outlet logins** (a manager who is not the owner) | L | C | an outlet staff account can run live orders and cannot see bank or payouts | partner |
| P7 | **Order-accept timer and auto-reject reason** shown to the kitchen | S | A | verify first whether the app shows the countdown to auto-cancel | partner |

## 3. Rider app (delivery-mobile)

| # | Gap | Size | Owner | Check that fails first | APK |
| --- | --- | --- | --- | --- | --- |
| R1 | "Trip taken" data message handler (W1.1): withdraw the stale alarm | S | A | source check: the handler exists and clears by tag `trip:${id}` | rider |
| R2 | A quiet **Payments** notification channel (V6) | S | A | source check: a second channel exists, not MAX importance, no alarm sound | rider, partner |
| R3 | Incentive shown as **earned**, not **paid** (M2) | S | A | label check | rider |
| R4 | The release flow explains the new N21 rule ("collected: deliver or call support") | S | A | the app shows `ALREADY_COLLECTED`'s message, not a generic error | rider |
| R5 | Show the code-lock message (N4) | S | A | `CODE_LOCKED` shows its message and the minutes left | rider |

## 4. Customer app (customer-mobile)

| # | Gap | Size | Owner | Check that fails first | APK |
| --- | --- | --- | --- | --- | --- |
| U1 | **Cancellation quote before cancelling** (N2 precondition) | S | A | the cancel sheet calls `/orders/:id/cancellation-quote` and shows fee and refund; hides cancel when `canCancel` is false | customer |
| U2 | Store the token returned by change-password, then bump the version server-side (N14) | S | A (app) + C (server) | after a change the device stays signed in and every other device is signed out | all four |
| U3 | **Require a map pin on new addresses** (N9) | M | C | address create without coordinates is refused by the server once the app has shipped the pin; until then it is accepted | customer |
| U4 | Search suggestions (C10) | S | A | the search box calls `/search/suggestions` | customer |
| U5 | Notification channels (V6), so order updates are not "Miscellaneous" | S | A | source check | customer |
| U6 | In-app **account deletion** visible (Play policy) | S | A | verify first: `DELETE /auth/me` is already called from `ProfileScreen` | customer |

## 5. Platform (server): money, safety, scale

| # | Gap | Size | Owner | Check that fails first | APK |
| --- | --- | --- | --- | --- | --- |
| S1 | **N18** dirty-marking save (stop re-serialising the whole store on every save) | L | C | a save after one order change writes one row; a burst of writes still flushes within the ceiling | — |
| S2 | **N19** synchronous flush on money routes (capture, refund, payout PAID) | M | C | the route does not answer until the row is in Postgres (inject a slow backend, assert ordering) | — |
| S3 | **N17** version column + compare-and-set upsert (deploy overlap) | L | C | two stores writing the same order: the second write is refused as a conflict, not a silent overwrite | — |
| S4 | **N15** per-user rate limit (CGNAT) | M | C | 101 requests from two users behind one IP both succeed; one user over the limit is throttled | — |
| S5 | **Body-shape contract suite** (B §3) | L | C | planted probes: a wrong key, a missing required field, a `.strict()` extra; floors measured | — |
| S6 | **N11** margin guard at checkout (owner floor, default off) | M | C | below the floor a coupon is capped, not refused; the order still checks out | — |
| S7 | **N23** second capture on a paid order | S | A | a second payment id on a paid order is booked and refunded | — |
| S8 | **G3** RazorpayX `payout.reversed`/`failed` webhook, before live payouts | M | C | a reversed payout returns to owed, the payee is told, and the ledger is reversed | — |
| S9 | **N20** `expo-updates` in all four apps | M | C | each app's config has an update channel; a JS-only change reaches an installed build | all four (once) |

## 6. Owner-only (no code)

SMS provider (launch blocker, B §4). Live Razorpay and RazorpayX keys. Railway
deploy overlap = 0 until S3. Rotate the Mapbox `sk.` token. The CA decisions on
N7, TDS 0.1% and TCS. The numbers for N2/N9/N11. One real order end to end on
real phones.

## 7. Proposed order (C's proposal)

1. **Server-only, money-safety first:** S7 (A), S2, S1, S3, S5, S4, S6, S8.
2. **Admin operations (one admin APK):** A1, A3, A4, A2, A6, A7, A8, A9, A5-show.
3. **The single APK round** for all four apps: S9 first (so it is the last
   forced install), then R1–R5, U1, U2, U4, U5, P5, P7, and the admin rows.
4. **Partner "like Zomato" (after the round, via OTA if S9 landed):** P1, P2,
   P3, P4, P6, then U3.

> B:
