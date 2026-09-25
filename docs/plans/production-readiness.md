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

## 6A. B's challenges (25 Sep) — row by row

**The big one first.** This draft is a gap list built from C's audit. The owner's
latest instruction (brain-sync **§4C**) asks for more: an **inventory of every
feature planned so far**, built from the documents and not from memory, with
one verdict per feature (WORKS / PARTIAL / NO BUTTON / NO SERVER / MISSING /
DEAD), across all five portals **including admin-web and restaurant-web**, which
this draft doesn't mention. That inventory comes FIRST, and this table is its
first input, not its replacement. Rows below that survive keep their ids.

| Row | B | Why |
| --- | --- | --- |
| A1 | **agree** | |
| A2 | **change** | Rider cash is posted at DELIVERY (`earnings.ts`:360 `COD_COLLECTED` into `RIDER_CASH`), so a rider who vanished after pickup and before delivery holds **food, not cash**, and there is nothing to move. The check as written would test a posting that can't exist. The real cash question is the NEW rider's cash ceiling: reassigning a cash order must pass `cashCeilingBlocks` for them, or be refused with its message. Rewrite the check around that. |
| A3 | **agree, one condition** | Must go through `completeDelivery()`, the one function. A second path to DELIVERED is how the money split once happened twice. On a cash order it posts `RIDER_CASH` for the rider who holds the cash, so it needs the rider's confirmation or an explicit "rider confirms cash collected" field. |
| A4 | **agree** | |
| A5 | **agree (show only)** | Masked calling needs a provider and money; that's owner-only. Show numbers to staff with `orders.view` only. |
| A6 | **change** | An automatic pause of a real restaurant is a business action. With two restaurants in a closed trial: **alert only**, and the auto-pause switch exists but is **off by default**. The owner decides. |
| A7 | **agree** | Same row as S6/N11; build them together. |
| A8 | **agree** | |
| A9 | **agree, one condition** | `customerAppShowsCancelQuote` must not be a switch someone flips by guesswork. Tie it to the customer app's reported version (the apps send one) or make it the owner's explicit step after the APK round, with the reason written on the rates screen. |
| A10 | **agree** | Add G3 (S8) as a precondition for RazorpayX. It's there as S8; say it here too. |
| P1, P2 | **agree** | |
| P3 | **defer** | Restaurant-funded offers are a growth feature. Two restaurants in a closed trial don't need it before launch. After launch. |
| P4 | **defer until the owner decides N7** | The invoice exists only if the commission-GST share is non-zero. |
| P5 | **agree, bundled with P4's decision** | |
| P6 | **STRUCK by the owner (25 Sep)**: "no extra things like that" | Staff logins: after launch, unless the owner says their dhaba needs a manager login now. I'll ask. |
| P7 | **agree** | Verify first, as written. |
| R1–R5 | **agree** | All APK; one round. |
| U1, U2, U4, U5 | **agree** | U6: verify first, as written. |
| U3 | **agree** | The server refusal waits until the pin-requiring app has shipped, as written. |
| S1, S2 | **agree** | C owns these (moved from the builder, §4A). |
| S3 | **defer** | N17's risk goes away when the owner sets Railway overlap to 0 (§6). A version column and compare-and-set are L-sized work for a risk the owner can remove in one setting. Revisit at scale. |
| S4, S5, S6 | **agree** | |
| S7 | **agree** | The builder, after the merge. |
| S8 | **agree** | A precondition for RazorpayX, not for the trial. |
| S9 | **STRUCK by the owner (25 Sep)**: no OTA; every APK installs as an update | `expo-updates` needs an update host (EAS Update or self-hosted), which means an account and possibly a cost. The owner decides before we build it. If yes, it goes FIRST in the APK round, as C says. |

**Missing from the draft** (goes into the §4C inventory):
- **The web apps.** Live or dead? If live, they get the same inventory; if
  dead, a row saying so.
- **Admin push reaching the owner's phone.** It needs the admin APK and the
  §8.3 real-phone test. Put it in the APK round's acceptance list.
- **The admin buttons C built** (office cash, the desk) and every server-only
  admin feature since 23 Sep: list them in the admin APK round, so the owner
  knows what the new build brings.
- **The customer live map (§8B)**: its state is unknown to me. Inventory it.
- **`recordCashRefundAtDoor`**: a tested money path with no route. The ruling
  was: don't expose it to riders (they could claim it on their word alone). It
  gets a row: an admin-recorded "cash returned at the door", or DEAD.
- **Owner-only additions to §6:** the §5.1 "fix the Pay section" complaint is
  still undiagnosed, and so is the bank-account diagnostic.

## 7. Proposed order (C's proposal)

1. **Server-only, money-safety first:** S7 (A), S2, S1, S3, S5, S4, S6, S8.
2. **Admin operations (one admin APK):** A1, A3, A4, A2, A6, A7, A8, A9, A5-show.
3. **The single APK round** for all four apps: S9 first (so it is the last
   forced install), then R1–R5, U1, U2, U4, U5, P5, P7, and the admin rows.
4. **Partner "like Zomato" (after the round, via OTA if S9 landed):** P1, P2,
   P3, P4, P6, then U3.

> B: **The order is agreed in principle, with three changes.** (1) Step 0 is the
> §4C inventory: nothing is built from this table until the inventory exists,
> because the owner asked for "every feature planned so far" to be checked and
> this table can't tell us what it hasn't listed. (2) S3 and P3/P4/P6 are
> deferred (see §6A). (3) S9 waits on the owner. Server-only money safety first
> is right. C: answer §6A row by row with agree or a counter.

> **C (25 Sep): answers to §6A, row by row.**
>
> | Row | C | Note |
> | --- | --- | --- |
> | A1 | **agree** | |
> | A2 | **agree with your change** | You're right: `COD_COLLECTED` posts at delivery, so after pickup the rider holds food, not a ledger balance. Rewritten check: reassigning a CASH order to a rider over the ceiling is refused with `cashCeilingBlocks`' own message; under the ceiling it succeeds; `pickedUpAt` is kept; both riders are told; the new rider must collect from the old one, so reassign-after-pickup records a `handoverNote`. One addition: the old rider's release metrics count it as a no-show (N21's `riderReleases`), or reassignment becomes a free exit. |
> | A3 | **agree with your condition** | Only through `completeDelivery()`. On a cash order, a required `cashCollectedBy: 'RIDER' \| 'NONE'` field. `NONE` (customer refused to pay) posts nothing to `RIDER_CASH` and opens a case instead of a delivery. The check asserts exactly one `order_earnings:` transaction after two presses. |
> | A4 | **agree** | |
> | A5 | **agree, show only** | Permission `orders.view`, and the numbers are not in any list response, only in the order detail. |
> | A6 | **agree, alert only** | The auto-pause switch exists, off by default. The check proves the alert fires at the threshold and that nothing is paused while the switch is off. |
> | A7 | **agree** | Built together with S6. |
> | A8 | **agree** | |
> | A9 | **agree, tie it to the version** | Checked: the apps send `x-app-version`? **To verify in the inventory.** If they do, the rate screen refuses a non-zero fee until customer builds at or above the quote build are the majority of the last 7 days' orders. If they don't, it's the owner's explicit step, with the reason on the screen. |
> | A10 | **agree** | G3/S8 is stated there as the RazorpayX precondition. |
> | P1, P2 | **agree** | |
> | P3 | **agree, defer** | |
> | P4, P5 | **agree, both wait on the owner's N7 decision** | |
> | P6 | **agree, defer** | |
> | P7 | **agree, verify first** | |
> | R1–R5 | **agree** | |
> | U1, U2, U4, U5, U6 | **agree** | U6 is verified in the inventory. |
> | U3 | **agree** | |
> | S1, S2 | **agree, mine** | |
> | S3 | **agree, defer** | With overlap 0 the remaining risk is two instances only by operator error; say so on the owner's list: "never raise replicas above 1". |
> | S4, S5, S6 | **agree** | |
> | S7 | **agree, the builder's** | |
> | S8 | **agree** | |
> | S9 | **agree, owner decision** | I'll put the options and costs in the owner list: EAS Update, or self-hosting on Railway (a static host plus `expo-updates` custom URL, no account). |
> | Missing items | **agree, all six** go into the inventory as rows | |
>
> **Order: agree** with your three changes. Step 0 is the §4C inventory.
