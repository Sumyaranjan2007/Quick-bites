# Full audit — 24 Sep 2026

Written by Session B (plan and review) after the owner asked for the whole
project to be audited: every bug, all dead code, every flow and case, the
payment system end to end, cash, every notification, admin receiving all
notifications, and every section controllable from admin.

**No APK and no build of any artifact.** Session A implements; Session B
reviews every commit against this document.

Against commit `518acc5`+ (tree clean, pushed, 44 suites green).

---

## 0. How to read this

Every finding in §1 was **verified by opening the file**, not inferred from a
comment, a grep window or a summary — this project's plans have been wrong nine
times when that rule was skipped (`admin-revamp-and-inflation.md` §11.2c).

Three suspected bugs were checked during this audit and turned out **not** to be
bugs. They are listed in §2 so nobody spends time on them again.

Things I could not confirm are in §3 as **tasks to verify**, not findings. Do not
build against them until they are confirmed.

---

## 1. Verified findings

### F1 — CRITICAL — riders are never told a trip is waiting when the app is closed

`fcmDispatcher.ts` has eleven notify methods. Exactly one targets a rider:
`notifyRiderNoShowWarning`. **Nothing pushes a rider a new trip.**

Trips reach riders only through the socket: `emitOrderAvailableForPickup`
(`socketServer.ts:418`) emits `order:available` to the `riders:available` room
(`:434`). A socket needs the app open and connected, and Android kills
background sockets. So a rider with the phone in their pocket learns of nothing,
food that is cooked sits on the pass, and the sweeper eventually raises
`NO_RIDER_FOUND` — which is F2.

**The rider app is already built to receive this.** `delivery-mobile/src/lib/orderAlert.ts`
creates the `new-orders` channel with a looping alarm — *"Rings until the rider
deals with the offer"*. The server never sends to it.

**It reaches riders without a new APK.** The shipped `QuickBites-Rider.apk` was
unzipped on 23 Sep and contains `new-orders`. Server-side only, exactly like the
kitchen push.

This is the rider equivalent of the partner push that did not exist
(`admin-revamp-and-inflation.md` §0), and it is very likely the cause of any
real-world "no rider found".

### F2 — CRITICAL — the admin is not told about the problems the system detects

The owner's words: *"notification for the admin portal should push all
notification so we can take a look (main is solving problems)."*

The platform **does** detect problems:

| Detected in | Problem |
| --- | --- |
| `orderSweeper.ts:158` | `NO_RIDER_FOUND` — cooked food, no rider |
| `orderSweeper.ts:96` | a restaurant did not accept inside `ORDER_ACCEPT_TIMEOUT_MINUTES`, so the order is cancelled |
| `paymentsHealth.ts:297` | a payout whose outcome never came back; a rider holding cash for days; books that stopped balancing |

Every one goes out through `emitOpsAlert` — **a socket event, to an admin
console that happens to be open.**

§8C's admin push (`adminNotifier.ts`) covers nine events: SOS, payout failed,
bank account filed, KYC, refund raised, support ticket, cash declared, menu
request, profile edit. **None of the problems above is among them.** The events
that most need a person, and that nobody else will report, are exactly the ones
missing.

### F3 — HIGH — money still at Razorpay is booked as money in the bank

`earnings.ts` books an online payment straight to `PLATFORM_BANK`:

```
const moneyHolder = paidOnline
  ? { account: 'PLATFORM_BANK', event: 'ORDER_PAID_ONLINE' }
  : { account: accountFor('RIDER_CASH', …), event: 'COD_COLLECTED' };
```

Razorpay settles to the bank a day or more later. Until then the money is at
Razorpay, not in the platform's account. **`GATEWAY_RECEIVABLE` exists for
exactly this — it is defined at `ledger.ts:75` and posted to nowhere.**

This is the same mistake §4.5 fixed for office cash, one step earlier in the
chain. Consequences: the pot panel's "In our bank" overstates, and the payday
shortfall warning (§4.5.4) can say the money is there when it is at Razorpay —
so a payout run funded by it bounces.

### F4 — HIGH — Razorpay's fee is never recorded

No gateway fee, MDR or processing fee is recorded anywhere in `src/` or
`packages/`. Razorpay deducts roughly 2% plus GST from each online payment before
settling.

So for every online order the ledger believes the platform received the full
amount. **The ledger's bank balance will never match the real bank statement**,
and the gap grows with every online order — and "genuinely ours" overstates by
the fee. The owner will reconcile against their statement, find it does not
match, and have no way to see why.

F3 and F4 are fixed together: the settlement is where the fee becomes visible.

### F5 — HIGH — nobody is told that money reached them

- **Partners and riders are never told they were paid.** `PAYOUT_SENT` exists
  only as a ledger event (`payouts.ts:515`) and an audit action
  (`payoutRoutes.ts:331`). No notification.
- **Customers are never told a refund was processed.** Admin is notified when a
  refund is *raised*; the customer hears nothing when it is *paid*.

For "pay everyone", the person being paid is the one who does not find out. The
result is a support call per payday.

### F6 — MEDIUM — the admin does not receive "everything"

The §8C digest tier and the per-category switch were deferred. The owner has now
asked for all notifications. F2 is the half that matters most; this is the rest.

### F7 — MEDIUM — twelve dead exports in the backend

Referenced nowhere, not even by a test:

| File | Export |
| --- | --- |
| `modules/admin/analytics.ts` | `TERMINAL_STATUSES` |
| `modules/admin/permissions.ts` | `hasPermission` |
| ~~`modules/orders/riderTrip.ts`~~ | ~~`isCarrying`~~ — **now used** by W2.1's `listCarrying`. Not dead. |
| `modules/payments/earnings.ts` | `partnerEarningsBalance` |
| `modules/payments/rails.ts` | `payoutsPossible` |
| `modules/payments/refunds.ts` | `refundStatusView` |
| `modules/payments/restaurantCharges.ts` | `listCharges` |
| `modules/restaurants/openingHours.ts` | `windowLengthMinutes` |
| `modules/restaurants/restaurantDocuments.ts` | `MANDATORY_RESTAURANT_DOCUMENTS` |
| `notifications/fcmTransport.ts` | `resetPushCredentialCache` |
| `sockets/socketServer.ts` | `getSocketServer` |
| `utils/phone.ts` | `isValidIndianPhone` |

Each was checked for whether it is a **safeguard nobody wired in** rather than
leftover code. None is — see §2.

Plus one dead ledger account: **`GATEWAY_RECEIVABLE`**, which F3 brings back
into use rather than deleting.

Sixteen more have only test callers. Thirteen are `reset…ForTesting` helpers and
are correct. Three are wrappers with no production caller —
`canTakeCodOrder`, `recordCashRefundAtDoor`, `refundAlreadyPaid` — decide each
individually in W6.

### F8 — MEDIUM — Pay and Settlements still disagree (Task 3.1)

Carried over. Pay derives "why can't this partner be paid" from `payouts.ts`
(hold, cash, minimum); Settlements from `accountBlockReason` (account only). For
a partner inside the hold period, one screen explains and the other is silent.
`blockedCode` on `DueRow` (added in step 9) is the shape the fix wants.

---

## 2. Checked and NOT bugs — do not re-investigate

| Suspected | Why it is fine |
| --- | --- |
| Payment reconciliation never starts | It does — `server.ts:131`. My first grep searched the wrong name. |
| The rider cash ceiling is not enforced (`canTakeCodOrder` unused) | Enforced at the accept gate, `riderRouter.ts:848–857`, via `cashStanding` directly. |
| Restaurants can go live without mandatory documents | `buildDocumentOverview` enforces the required set (`peopleRoutes.ts:709`). |
| Phone numbers are not validated | `phoneSchema` (zod) validates; `isValidIndianPhone` is a dead wrapper. |
| A cash customer cannot be refunded without RazorpayX | `manualReference` escape hatch (`refunds.ts:120`). |
| The owner cannot pay anybody without RazorpayX | The `MANUAL_BANK` rail is always available (`rails.ts:168`). |
| The Razorpay webhook is unsigned | Verified with HMAC (`razorpayAdapter.ts:201`). |
| Abandoned online payments are lost | `reconciliation.ts` asks Razorpay and completes or cancels. |

---

## 3. To verify — NOT findings yet

Checked and inconclusive. Confirm each against the file before building.

- **V1.** Does the rider's available-trips list hide cash orders from a rider
  already at the cash ceiling? If not, a rider sees a trip, taps accept and is
  refused — an error state the owner would call a bug.
- **V2.** Every admin section: does each queue, screen and platform switch
  actually control what it names? List them; exercise each.
- **V3.** Every screen in all four apps: does every fetch have an error state,
  or do some resolve to a blank card? The Bank screen's "nothing is coming up"
  was exactly this.
- **V4.** Frontend dead code. F7 is backend only — screens, components and
  client functions in the four apps are unscanned.
- **V5.** Customer notification completeness. Is the customer told the order
  was **accepted**, and that a **rider was assigned**? The list in F1 suggests
  not — `notifyOrderPreparing` is the first after placement.
- **V6.** Which notification channel a "you were paid" message should use in
  the partner and rider apps. It must NOT be the looping order alarm. If no quiet
  channel exists in the shipped APKs, F5 needs a build for those two apps.

- **V7. The platform makes NO durable delivery promise.** Found building W2.1.
  Every ETA is computed on read from the rider's current position; nothing
  records what the customer was told at checkout. So nothing can be "late"
  against a commitment, and **any future on-time rate, lateness refund or SLA
  has nothing to measure against.** Not obvious from `eta.ts`, which reads like it
  produces a promise. Decide whether to store the checkout estimate before
  building anything that depends on one.

---

## 4. The work — order and acceptance

Order is by harm, then by whether it reaches the owner without a build.

**Order: W1 ✅ → W1.1 ✅ → W1.2 ✅ → W2 ✅ → W2.1 ✅ → W3 ✅ (server `2702c81`, screen `d9daca3` — screen needs admin APK) → W4 (+W4.1) ✅ → W5 ✅ → M1 ✅ → M2 ✅ → P1 ✅ (`3b92ce1`) → W7.1 ✅ (`86dbdab`) → W7 → W8 → W6.** W1.1 and W1.2
are not new scope: they are W1 finishing its job, found by reviewing it.

### W1 — rider trip-offer push (F1) · **no APK needed**

- `notifyRiderTripAvailable` on `fcmDispatcher`, channel `new-orders` (read from
  the rider app source, comments stripped — §11.2 shape 8).
- Fire where `emitOrderAvailableForPickup` fires. **Keep the socket** — it is the
  fast path for an open app; push is for a closed one.
- Target riders who are **online and eligible**: not on a trip, and for a cash
  order not at the ceiling. The same eligibility the accept gate enforces, from
  the same function, or the push offers a trip the gate refuses.
- **Do not push every rider in the city for every trip.** Nearest first, the same
  order dispatch already uses.
- Never fail order progress because a push failed — the `tellTheKitchen` rule.
- **Check that fails:** a trip becomes available → an eligible rider is pushed on
  `new-orders`; a rider already on a trip is **not**; a rider at the cash ceiling
  is **not** pushed a cash trip.

> **W1 DONE** — `74aef19`, `cc05ed7`, `e30632f`. Reviewed: `cashCeilingBlocks`
> is the one source for the list (`riderRouter.ts:781`), the gate (`:862`) and
> the push (`tripOffers.ts:72`); and eligibility is filtered **before** the
> six-rider slice (`tripOffers.ts:128`), so six riders who can actually accept
> are woken rather than six who might not. **V1 was a real bug** and is fixed by
> the same function.

### W1.1 — the other five alarms are never stopped · **no APK for the server half**

Found reviewing W1. When the first of the six riders accepts, **nothing tells the
other five.** No "trip taken" message exists anywhere in the backend or the rider
app. Their notification stays in the tray; a rider who taps it later opens a trip
that is gone and is refused — the same *"told off for accepting an offer we just
made"* that V1 fixed on the list, arriving through the push instead.

- On assignment, send the other woken riders a **data-only** "trip taken"
  message keyed to the same notification id, so the notification is withdrawn.
- In the rider app, opening a taken trip says *"Another rider took this one"* —
  not a 409. That half needs a rider APK; the server half does not, and it is
  still worth shipping alone.
- **Check that fails:** six woken, one accepts → exactly five "trip taken"
  messages, to the five who did not, carrying the id of the original.

> **W1.1 DONE, `974251a` — and my "no APK" claim was wrong.** Tenth plan miss.
> There is no "delete that notification" message; clearing one means telling the
> app, and the shipped rider APK has no handler for a data-only withdrawal. It
> arrives and is ignored. **Clearing waits on a rider build.** It shipped anyway,
> because it is inert until then and needs no server change later.
>
> A visible "that trip is gone" message is not an alternative: a channel's sound
> is fixed when the app creates it, so it would play the looping alarm again —
> worse than the stale entry.
>
> **What works today** is the Android tag `trip:${orderId}` (`fcmDispatcher.ts:214`):
> later waves of one trip **replace** the earlier entry instead of stacking. A
> trip nobody takes for twenty minutes would otherwise leave four identical
> alarms, which is how a rider learns to clear the channel. That is the larger
> half of the problem, and it ships on the APK riders already have.

### W1.2 — one wave, and then nobody · **no APK needed**

> **W1.2 DONE, `ea02296`, `996df16`.** Verified: the sweeper imports
> `offerTripToNearbyRiders` (`orderSweeper.ts:36`), widens first (`:186`), and a
> sweep that woke somebody does not also alert (`:198`). The wait is
> `riderOfferWaveMinutes`, default 3, editable 1–60, and it is in `RATE_BOUNDS`
> so it is actually read.
>
> **The first mutation found something worse than the bug.** Remove the
> never-re-wake rule and the order does not merely repeat — it widens forever to
> the same six, and **`NO_RIDER_FOUND` never fires at all.** The rule is
> load-bearing for the alert existing.
>
> It reuses `offeredToRiderIds`, the field the offer list already writes, rather
> than a second mark for one fact. Consequence, accepted: a rider shown the trip
> on their open screen is not later woken about it. They have seen it.
>
> **For the owner:** `NO_RIDER_FOUND` now arrives **later** than before, by
> design — only after every wave has been tried. A visible change in when an
> alert appears.

Found reviewing W1. `offerTripToNearbyRiders` fires once, at the two call sites.
Nothing calls it again — `orderSweeper.ts` does not import `tripOffers` at all. If
the six nearest riders are asleep or ignoring it, **rider seven is never woken**,
and the order waits until the sweeper raises `NO_RIDER_FOUND`.

This is the "progressive widening" that `road-to-launch.md` §2.2 listed as not
built. The sweeper already runs on a timer and already knows which orders are
waiting for a rider.

- After a configurable wait with no acceptance, wake the **next** six by
  distance. Never re-wake a rider already woken for that order.
- Make the wait an admin setting beside the other dispatch rates, not a
  constant.
- `NO_RIDER_FOUND` (W2) should fire only once the waves are exhausted, not in
  parallel with them — otherwise the owner is alerted about a trip the platform
  is still actively offering.
- **Check that fails:** nobody accepts wave one → wave two wakes six **different**
  riders, further out; a rider from wave one is never pushed twice.

### W2 — admin problem alerts (F2) · **needs the admin APK**

> **Design question from Session A, answered.** `paymentsHealth` raises a batch
> of alerts per sweep, so one unhealthy morning would become a burst of pushes —
> the thing that gets a channel muted.
>
> **Collapse them.** One push per sweep for payments health, titled with the
> most severe alert, the count in the body, the detail on the screen it opens.
> And **fire only when the set changes** — a new alert appearing — never because
> the same ones are still there on the next tick. An unresolved problem that
> re-notifies every five minutes trains the reader to swipe it.
>
> **Do NOT collapse `NO_RIDER_FOUND` into it.** Different permission
> (`orders.deliveries.manage`, not finance), different urgency (food is going
> cold), and it is per order — two stuck orders are two problems with two
> different fixes. Dedup per order, as above.

- Push, from the same call sites that call `emitOpsAlert`: `NO_RIDER_FOUND`,
  not-accepted-and-cancelled, and each `paymentsHealth` alert.
- Urgent tier for `NO_RIDER_FOUND` — food is going cold. Needs-you for the rest.
- Keep `emitOpsAlert`. Socket for an open console, push for a closed phone.
- Dedup on the event and its subject, as §8C does — the sweeper runs on a timer
  and must not push the same stuck order every tick.
- Permission-targeted as §8C.2. `NO_RIDER_FOUND` → `orders.deliveries.manage`;
  payments health → `finance.payouts.manage`.
- **Check that fails:** one stuck order across three sweeper ticks produces
  **one** push, to an admin who can act on it, and none to one who cannot.

> **W2 DONE** — `b589f52`, `0e2e446`, `d66f298`. Six events: `NO_RIDER_FOUND`
> (urgent), `RIDER_NO_SHOW`, auto-cancel, `DELIVERY_LOCATION_MISMATCH`,
> `PAYMENT_RECOVERED`, and the collapsed payments-health push. Session A found a
> sixth problem that had no ops alert at all: an order cancelled because the
> kitchen never answered wrote a log line and an audit row, both of which need
> somebody to go looking.
>
> **`RIDER_NO_SHOW` is correctly NOT urgent**, confirmed by reading the rule
> rather than the name. It is **pre-pickup only**
> (`listAssignedAwaitingPickup`, `orderSweeper.ts:280`) — the food is still on
> the counter and `releaseRider` puts it straight back on offer, where W1.2's
> widening picks it up. The platform has recovered; somebody should know, nobody
> needs waking.
>
> **Two findings from the build, both worth keeping.** The generic ten-minute
> per-subject suppression from §8C silently overrode the set-based change
> detection — two mechanisms on one event and the weaker one won, so a problem
> that cleared and came back inside ten minutes was swallowed. And the order of
> `paymentsHealth`'s alerts is **not** severity: the ledger imbalance, which its
> own comment calls *"the loudest thing this job can say"*, is pushed near the
> end. A notifier taking `alerts[0]` as worst would have led with a cash-ageing
> line while the books were broken. The worst is now named explicitly.

### W2.1 — NEW: nothing watches a rider who has the food · **no APK needed**

**F9, found reviewing W2.** The sweeper iterates exactly two lists:

| `orderSweeper.ts` | Stage |
| --- | --- |
| `:111` `listAwaitingAction` | waiting for the kitchen, or for a rider |
| `:280` `listAssignedAwaitingPickup` | a rider accepted and has not collected |

**After pickup, nothing watches.** A rider who has collected the food and then
stops — a crash, a dead phone, a rider who walks off with a cash order — leaves
the order at out-for-delivery **forever**, with no alert anywhere. The customer
watches a map that has stopped moving. On a cash order, a person the platform
cannot see is holding both the food and the money.

This is the one `RIDER_NO_SHOW` cannot be: after pickup nothing can be
recovered by re-offering, because the food has left the building.

**Both signals already exist on the order**, so detection is cheap:
`riderLocationUpdatedAt`, and the ETA from `estimateArrival` (`eta.ts`).

- **Location gone silent** — no update for N minutes while carrying — **URGENT**.
  A rider who has stopped transmitting mid-delivery may be hurt. This is the
  case where the §8C argument for SOS applies without anybody pressing SOS.
- **Running late but still moving** — past ETA by a margin, location still
  updating — **ATTENTION**. Traffic, not an emergency.
- Both thresholds are admin settings in `RATE_BOUNDS`, not constants — and in
  that list, or they are editable and read by nothing (§6.2).
- Per order, deduped, cleared the moment the order is delivered.
- **Tell the customer too.** They are already watching the map stop; an honest
  *"we've lost contact with your rider and are looking into it"* is better than a
  map that silently freezes.
- **Check that fails:** a carrying rider whose last location is older than the
  threshold raises one urgent alert; the same rider **with** a fresh location but
  past ETA raises attention and not urgent; a **delivered** order raises neither.
  The last one matters — a detector that fires on every old order is noise.

> **W2.1 DONE** — `4d4e122`, `79277bb`. Verified: no stored delivery promise
> exists anywhere on an order; the overdue rate's help now reads *"minutes a rider
> may be carrying food"*.
>
> **My overdue tier could never fire — eleventh plan miss.** I specified "past ETA
> but still transmitting" using `estimateArrival`. That recomputes the journey from
> the rider's **current** position on every call, so the arrival is always in the
> future and "minutes past it" is always negative — the log read
> `lateByMinutes: -12` on a ninety-minute-old order. The tier was dead code.
> Lateness is now measured from `pickedUpAt`: how long the food has been out. A
> durable fact, and what an operator actually wants.
>
> **It was hidden by a conditional assertion.** The overdue checks were wrapped in
> `if (lateFlag)`, so they passed while the tier never fired. See §6.
>
> **Customer messaging, decided:** a silent-rider escalation **does** send the
> customer a second message, even after a "running late" one. The two are
> different kinds of fact — "late" means wait, "lost contact" means your food may
> not be coming. A customer told only the weaker one keeps waiting for dinner that
> may never arrive, which is a worse harm than one extra message. Escalation only
> (late → lost contact), never the reverse, never more than two per order.
>
> **The fixture helper** is at `src/test/helpers/ownFixture.ts`: unique per call,
> no accessor for an existing fixture, and deliberately no clean-up — a check that
> only passes because an earlier one tidied is the same bug pointing the other way.

### W3 — money in (F3 + F4) · **server: no APK · recording screen: admin APK**

- Online payment books to `GATEWAY_RECEIVABLE`, not `PLATFORM_BANK`.
- A settlement event moves `GATEWAY_RECEIVABLE → PLATFORM_BANK` for the amount
  Razorpay actually paid, and books the difference to a **gateway-fee expense**
  account. Source it from Razorpay's settlement data where available; otherwise
  an administrator records it from the statement, the way §4.5 records a bank
  deposit.
- The pot panel gains "At Razorpay, not yet settled", and "genuinely ours" is
  net of fees.
- **Do not rewrite historical entries.** Existing orders stay where they are;
  the change applies forward. Say so on the screen.
- **Check that fails:** a ₹1,000 online order leaves `PLATFORM_BANK` unchanged
  until settlement; settling ₹976.40 raises it by exactly ₹976.40 and books
  ₹23.60 as fee; revenue excludes the fee. Assert **all four accounts** move —
  a check on the bank alone passes while the fee vanishes.

### W3 review of the draft (24 Sep, Session B) — four defects, and a plan miss

**Plan miss (mine).** The spec above follows the money in and never follows it
back out. Razorpay takes a card **refund** out of the balance it is holding,
and the ledger books an online payment only at **delivery**. So an order that is
paid and then cancelled never enters the books. The ₹1,000 check above passes
while both of these are broken. The "no APK needed" label was also wrong: nothing in
the admin app can record a settlement, so the owner needs a screen.

- **R1** — SOURCE refunds credit `PLATFORM_BANK` (`refunds.ts` ~:228). A
  gateway refund must credit `GATEWAY_RECEIVABLE`; LINK and manual refunds stay
  bank. Without this the bank is understated forever and the refund is counted
  twice (in `REFUNDS_PAID` and again inside the derived fee).
- **R2** — book the **capture** when payment is confirmed, through one function
  called by all four paths that set PAID for gateway money: DEBIT
  `GATEWAY_RECEIVABLE` / CREDIT `CUSTOMER_PREPAID` (a new liability). Delivery
  draws from `CUSTOMER_PREPAID`. Refunding an undelivered order reverses the
  capture and posts no `REFUNDS_PAID`. Worked day: ₹500 delivered + ₹300 paid
  then refunded. Without R2 the settlement is **refused** as above outstanding.
- **R3** — the settlement takes the two figures Razorpay's statement prints
  (**amount settled** and **fees + tax**), not a "gross" the admin must work
  out. The receivable credit is their sum.
- **R4** — a replayed reference must be refused (409), not silently re-announced
  with the new request's figures.
- **Checks:** settlement moves exactly three accounts with revenue and payables
  byte-identical; pay → cancel → refund returns receivable and prepaid to
  their before-values; pay → deliver → refund by source vs by link; a double
  confirm books one capture; the worked day records; a replay gets 409.
- **Admin screen** under Money with the W7.1 four states. It needs the admin APK.

**Round 2 (same day).** R1–R4 landed in the working tree. Suite 18/20. Found:
- **R5** — the cancellation path (`orderService` ~:843) is a **second refund
  implementation** that posts nothing to the ledger. With captures booked, every
  cancelled prepaid order would leave its money showing "at Razorpay" forever.
  The check that claimed to cover it drove `sendRefund`, not the cancellation.
  Fix: cancellation calls `sendRefund`, so there is one refund function.
- **R6** — refunding money that was never captured (paid before the switch, or
  delivered before the ledger) must not touch `CUSTOMER_PREPAID`.
- **R7** — the new suite was **not in the runner's list**, so the gate exited 0
  with two failures in it. New false-pass shape: **the unregistered suite**. The
  fix is a mechanism: the runner fails when a `*.test.ts` file is not listed.
- **R9 (low)** — legacy wallet orders without a gateway payment stay on the bank.

**Accepted — `2702c81` (24 Sep).** R1–R9 in. Session B re-ran the gate: 47 suites, exit 0,
and the W3 suite's own banner appears in the output with 22/22. The cancellation
check drives `orderService.cancelOrder`, not `sendRefund`. The runner now exits 1
on an unlisted suite. Deviations accepted: three settlement inputs (amount
settled, fees, tax), since all three are addends; capture keyed on the order id,
since a door payment can arrive without a payment id. R8 was two faulty checks,
not faulty code: AppError exposes `.status`, and **`ownOrder`'s bill is a bare
total, so any check that money reaches a kitchen or rider needs `billFor()`**.
Still open: the Money screen for recording settlements (needs the admin APK).

### W4 — tell people money reached them (F5) · **possibly needs APKs — see V6**

- Partner and rider: *"You were paid ₹X into account ending 1234."* On a payout
  reaching `PAID`, never on draft. Never on a manual payout before the
  administrator has recorded the reference.
- Customer: *"Your refund of ₹X has been sent."* On settlement of the refund.
- Quiet channel — **never** the order alarm.
- **Check that fails:** a payout moving to PAID produces one push to its payee; a
  payout that FAILS produces none to the payee (and §8C's admin alert fires).

### W4 addendum — V5 and V6 are both CONFIRMED (24 Sep, Session B)

**V6 — there is no quiet channel.** `restaurant-mobile` and `delivery-mobile` each
create exactly one channel: the MAX-importance order alarm playing
`new_order.wav`. A "you were paid" on it would sound like a new order.

**But it does not need a build to arrive.** `customer-mobile` creates **no**
channels at all, so every customer push already lands in Android's automatic
fallback channel. A "you were paid" sent with **no channel id** takes the same
route on the partner and rider apps: delivered, as an ordinary notification,
without the alarm. Ship that now; a named "Payments" channel comes with the next
build of those two apps.

> Stated as reasoning from an observable, not as tested: it holds exactly as well
> as customer pushes hold today, and §8.3's real-phone test is what proves both.

**V5 — the customer misses two moments.** Mapped from `orderService.ts` status
dispatch:

| Status | Customer push |
| --- | --- |
| placed | yes |
| **ACCEPTED** | **no** |
| PREPARING | yes |
| **rider assigned** | **no** |
| READY_FOR_PICKUP | yes (carries the doorstep code) |
| OUT_FOR_DELIVERY | yes |
| DELIVERED | yes |

ACCEPTED matters more since §8B: it is the moment the new map appears, and the
customer is not told it is there. A rider being assigned is the "Rahul is on his
way to collect your order" moment the owner means by *"like Zomato"*.

**W4.1 —** push on the kitchen taking the order on, **once** — whichever of
ACCEPTED or PREPARING comes first — because a kitchen that taps both inside ten
seconds must not send two messages. And push when a rider is assigned, with their
first name. **Check that fails:** ACCEPTED then PREPARING within a minute produces
one push, not two.

### W4 — accepted `f0c081c` (24 Sep, Session B review)

Payee "you've been paid", customer "refund sent" (only when settled), a single
"kitchen has your order" message keyed on the order (so PREPARING no longer
sends its own), and "rider assigned" from the single `assignRider` caller.
**V6 correction:** the transport always sends a channel id (`'default'`, which no
app creates), so FCM uses the app's fallback channel. The assertion is "never
an alarm channel", enforced by a source check. My claim that an unknown channel
is dropped was wrong; the fallback is documented by Firebase.
- **G1** — `paymentsHealth` resolving UNCERTAIN→PAID is a second place a payout
  becomes PAID, and it told the payee nothing. Fix: one function for PAID,
  posting and notifying, called from both places.
- **G2** — QUEUED says "on its way", not "paid". Wording only until RazorpayX.
- **G3** — no reversal webhook. This is a RazorpayX prerequisite (§5).
- **G1/G2 landed `deb5583`.** `markPayoutPaid` is now the only place a payout
  becomes PAID. G1 was worse than a missing message: the health-check copy built
  the payable name by string concatenation, not `accountFor`. It matched only
  because nobody had changed the naming, and a drift would have cleared a payable
  nothing reads and paid the partner again. **Lesson: a check comparing against a
  hardcoded account string agrees with the drifted copy. Put `accountFor` on the
  expected side.**
- **W2.1 second customer message landed `2f00d4c`.** It fires on late → lost
  contact only, keyed on a stored tier. Session A's own note: the "never a third"
  check doesn't guard the cap alone; the recovery check does.

### W5 — the rest of "everything" to admin (F6) · **needs the admin APK**

- The digest: orders placed, delivered, cancelled, new sign-ups — twice a day.
- A per-category switch in admin Settings. **Default ON**, reading the owner's
  latest instruction literally; SOS and `NO_RIDER_FOUND` cannot be switched off.
- **Check that fails:** turning a category off stops its pushes and nothing else;
  SOS still arrives with every category off.
- **Added 24 Sep (Session B). I traced every admin alert to every place its record is created:**
  - **KYC alert unreachable.** `notifyAdminsKycSubmitted` fires only from
    `POST /kyc/submit` (`kycRouter.ts:138`), which **no app calls**. Restaurants
    upload via `POST /restaurants/:id/documents` (`restaurantRouter.ts` ~:909) and
    riders via `POST /riders/documents` (`riderRouter.ts` ~:421). Neither alerts.
    Wire both. `/kyc/submit` then goes to W6 as a dead route, if nothing else uses it.
  - **A failed automatic refund alerts nobody.** On cancellation, when the gateway
    refund fails the case is left PROCESSING, "needs manual settlement"
    (`orderService` cancel path), and no admin is told. The customer's money is
    stuck and silent. Problem tier: fire `notifyAdminsRefundRaised` or a dedicated
    `REFUND_STUCK` alert from the not-settled branch.
  - **New sign-ups alert nobody.** A partner registers as PENDING_APPROVAL
    (`authRouter.ts` ~:605) and a rider as kycStatus PENDING_APPROVAL (~:707).
    Both wait for the owner, and neither alerts. Add them, once per entity.
  - Checked and fine, one creation site each and alerted: support tickets,
    customer refund requests, menu requests, profile edits, bank accounts
    (`addAccount` has one caller), cash declared (the second `declareDeposit` is
    the admin's own desk entry).
  - **Check that fails:** drive the route **the app actually calls**, not the
    module or a sibling route. That is the exact false pass that hid the KYC alert.
- **Added after W3:** a problem alert when `GATEWAY_RECEIVABLE` has held money
  longer than a setting (default 3 days). Razorpay settles in about 2 days, so
  older money means a settlement was never recorded or never arrived. Fires on
  the change, like payments-health. The check: backdate a capture by 4 days and
  it fires; record the settlement and it clears.

### W5 — accepted `a9353cc`; the review found two money bugs (M1, M2), which go before W7.1

- **M1 — CRITICAL — cancelling a paid order from the admin app refunds nothing.**
  `admin/orderRoutes.ts` ~:251 is a third cancellation implementation. It credits
  the removed customer wallet, marks REFUNDED, and posts no ledger entry, no
  gateway refund, no refund case and no push. The admin app calls it
  (`OrderDetailSheet.tsx:71`). Fix: route to `orderService.cancelOrder`.
- **M2 — CRITICAL — rider incentives are shown PAID and never paid.**
  `riderMetrics.ts` ~:380 credits the wallet, which no payout reads. Fix: post to
  `RIDER_PAYABLE` against a new `EXPENSE_RIDER_INCENTIVE`, and post incentives
  already marked paid that have no ledger entry.
- **P1 — persistence.** The digest's sent-slot marker, the notification switches and
  `savePlans` write the store with no save. The switches survive only because an
  audit write nearby triggers one. Fix at the data function, plus a source check
  that every store write has a save, with an explicit allowlist.
- W6 additions: `/kyc/submit` (no caller), and the staff wallet-credit routes
  (`walletRouter` `/:userId/credit`, `peopleRoutes` ~:260).
- **Pattern, third time today:** a second or third copy of a money path that the
  fix to the first never reached: cancellation's refund (W3 R5), the health
  check's PAID (G1), the admin cancel (M1). Before closing any money fix, grep
  for every other place that sets the same state.

### M1/M2/P1/W7.1 — accepted (24 Sep)

- M1 also closed a missing `validateTransition`. The admin "refund" checkbox no
  longer decides whether a paid order gets its money back.
- M2's backfill runs at boot (after hydration) and from its endpoint.
  **Rider build item:** `IncentiveProgress.paid` now means "earned, goes out with
  your next payout", but the rider app still labels it "paid".
- W7.1 adds `ResourceError` to the eleven screens and doesn't convert them to
  `ResourceState`: working UI isn't rewritten to add one branch. The scanner
  accepts either.
- **Two new false-pass shapes** from mutating the W7.1 check: *referencing the
  error is not showing it* (a guard that only suppresses the empty state passed),
  and *one copy passing for two* (a "file contains the sentence" check passed
  with one of two components stripped). The second is the same shape as W5
  counting recipients instead of notifications.
- **W7 adds an app ↔ server route contract check** before the manual sweep:
  every path the four apps call must match a mounted route and method.

### W6 — dead code (F7) · **no APK needed for the backend**

- Remove the twelve dead exports in §F7 one commit each, gate green between.
- Decide `canTakeCodOrder`, `recordCashRefundAtDoor`, `refundAlreadyPaid`
  individually — keep a wrapper only if it names something the call site does
  not.
- **V4 is DONE (Session B, 24 Sep) and small.** Genuinely dead in the apps:
  `nativeMapUnavailableReason` in all **three** `nativeMap.ts` copies (written for
  a diagnostics screen never built) and `lastKnownShiftLocation` in the rider app.
  **Not** dead: `allPointsVisible` and `zoomForSpanIgnoringViewport` — the backend
  suite `orderMap.test.ts` imports them on purpose. **Leave** `MapRoute` and
  `Maps` in the partner copy and `useBlockHardwareBack` in admin's: each is unused
  in one app's copy of a file kept identical across apps, and trimming one copy
  breaks that. Remove only what is dead in every copy.
- **Removal is the whole of "optimise".** No rewrites of working code in the
  name of tidiness. The owner said do not break anything that works, and the
  cheapest way to honour that is to not touch it.

### W7.1 — V3 CONFIRMED: fourteen admin data sources hide their failures

Found 24 Sep by Session B. `useResource` returns an `error` and displays nothing
itself — no toast, no global handler. Eleven admin screens never read it for one
or more of their sources:

| Screen | Silent sources |
| --- | --- |
| `CatalogScreen` | `resource` |
| `DocumentsScreen` | `list` |
| `FinanceScreen` | `detail` |
| `GrievanceCard` | `policy` |
| `MenuPricingTab` | `menu` |
| `PayeeAccountsScreen` | `coverage` |
| `PayoutsScreen` | `history`, `requests` |
| `ProfileApprovalsScreen` | `list` |
| `RatesScreen` | `rates`, `membership`, `bonuses` |
| `RefundsScreen` | `resource` |
| `SupportScreen` | `resource` |

Concretely: if `/admin/rates/restaurants` fails, `rates.data` is null, `rows`
becomes `[]`, and the Inflation screen says **"No restaurants yet"**. A server
error presented as an empty list — **exactly the Bank defect the owner reported**,
in eleven more places. The owner said *"no error state"*; this is the largest
single source of them.

`useResource`'s own header says it exists so that *"one screen [does not end] up
silently swallowing its error"*. It cannot enforce that from inside itself.

**Fix it as a mechanism, per §11.2b:**
- A shared `<ResourceState>` (or equivalent) that renders loading, error with a
  retry, genuinely-empty, and content — so the three states cannot be confused.
- **A check that scans the admin screens, comments stripped, and fails when any
  `useResource` result's `.error` is never referenced.** Then the next screen
  written cannot reintroduce this. A rule in a comment would not survive the first
  new screen.
- **Check that fails:** a source whose request fails renders its error and a
  retry, never its empty state.

Needs the admin APK to reach the owner. The other three apps use a different
fetch pattern and passed the coarser check; W7 should confirm them properly.

### W7 — the verification sweep (§3)

V1–V6, each confirmed or struck, with anything confirmed becoming its own
fix-and-check. This is where "every section works, every case covered, no error
state" is actually established — by exercising it, not by reading it.

### W8 — Pay and Settlements agree (F8)

One source for "can this partner be paid right now", both screens reading it, the
assertion from `admin-revamp-and-inflation.md` §3.1 pasted in.

### Then: gate, report, stop

No build. Report to the owner what is done, what is proved, and — separately —
what only they can prove.

---

## 5. Only the owner can do these

| | |
| --- | --- |
| **Razorpay is in TEST mode** (`rzp_test_`) | No real customer payment can be taken until live keys are set on Railway. |
| **No RazorpayX keys** | Payouts are manual — `MANUAL_BANK`, record the UTR. That works; it is not automatic. **Before turning RazorpayX on**, the server must handle `payout.reversed` / `payout.failed` webhooks (W4 review G3). Today a queued payout that later reverses would stay PAID, and the payee would already have been told they were paid. |
| **The bank defect** | Run the diagnostic command. |
| **"Fix the Pay section"** | Say what was wrong with it. |
| **A push on a closed phone** | The only real test of every notification in this plan. |
| **Rotate the Mapbox `sk.` token** | It shipped in three APKs before the fix. |

---

## 6. Rules that apply to all of it

From `admin-revamp-and-inflation.md` §11, unchanged. The ones this work leans on
hardest:

- **A check that has never failed is not evidence.** Every check above is written
  as the mutation that should break it.
- **Notifications fire at the route, never in the data layer** (§11.2d) — the
  sweeper and payments health are the exception, being timers, and they must
  dedup.
- **One source per fact.** W1's eligibility, W8's blocker and W3's bank balance
  all fail the same way if a second copy is introduced.
- **A check reports PASS whenever its assertions do not run.** Three ways found
  in three days: an `async` body in a synchronous runner, a check that only
  arranges state, and an assertion inside `if (flag)` — which hid W2.1's dead
  tier. Every check must be able to fail on the path it names.
- **Two sessions, one tree.** Stage by path; `origin/main..HEAD` empty after every
  push.
