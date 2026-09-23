# Admin revamp, per-item inflation, and the three apps

Written 23 Sep 2026 against commit `c953bd0`, from the owner's list of 23 Sep.

**Session B writes and maintains this plan, and reviews the work against it.
Session A writes all the code.** Restated by the owner on 23 Sep — *"you just
make plans and let other ai write, and you analyse his work and mistake and
improve it"* — after Session B edited a source file. Every task here belongs to
Session A, including the ones earlier drafts assigned to B.

Every root cause below was read out of the code today, not remembered. Where a
cause is a guess it says so, and the first task is to prove it.

---

## 0. The one finding that changes the shape of the work

The owner reported the partner push as "the firebase one is not working".

It is not a Firebase problem. **No push to a restaurant owner exists anywhere in
this codebase.** Every call in `orderService.ts` — lines 564, 847, 891, 934,
1035, 1037, 1039, 1041 — passes `order.customerId`. `fcmDispatcher` has eight
methods; seven target the customer and one targets a rider. There is no
`notifyRestaurant*` of any kind.

The partner app registers its token correctly
(`apps/restaurant-mobile/src/lib/pushRegistration.ts:47` → `POST /devices`), and
`deviceTokenRepository` stores a `role` alongside every token. So the tokens are
sitting in the database and nothing has ever been sent to them.

This matters for estimating. Nothing needs debugging. Something needs writing.

---

## 1. Decisions the owner made today

These are settled. Do not re-open them.

| Question | Answer |
| --- | --- |
| ₹799 Gold delivery discount | **40%**, not 50% |
| ₹99 Gold validity | **30 days** |
| Rider percentage | **The customer pays it.** Rider pay is untouched. Editable in admin. |
| Item pricing | **Type the customer's price directly.** Restaurant ₹200 → admin types ₹240 → customer pays ₹240, restaurant is paid ₹200, we keep ₹40. |
| Bank verification | **The administrator's tap is the verification.** No RazorpayX call. |
| COD return | **The rider comes to the office.** Admin records the cash, rider's cash-in-hand clears, platform is credited. |
| Rider/partner settlement screens | **Read-only stays. The request button goes.** Policy says money arrives within 1–2 weeks. |

### The one assumption Session B is making

The owner described the item-price mechanism but did not say whether the
existing **restaurant-wide `foodMarkupPercent` survives**. It is kept as the
fallback: an item with a typed price uses that price; an item without one
follows the restaurant percentage; a restaurant with neither is unmarked.

Reason: it is already built, already tested, and already shipped in an APK.
Removing it would be a regression with no request behind it, and it would force
the owner to price every dish of every restaurant by hand before earning
anything. If the owner wants it gone, deleting it later is one commit.

---

## 2. Admin — Bank

### 2.1 Why nothing is showing (prove before fixing)

The route exists, is mounted, and returns every account:
`payeeRoutes.ts:87` → `GET /admin/payee-accounts`, mounted at `adminRouter.ts:40`
under `apiRouter.ts:73`. Riders and partners both submit to
`POST /payee-accounts/me`. The wiring is correct end to end.

So the overwhelmingly likely cause is that **no bank account has ever been
submitted**, and the screen renders an empty state that looks identical to a
failure.

> **Corrected 23 Sep.** This first said "the live database is empty". It is
> not. `GET /api/restaurants` on the deployment returns two real ACTIVE
> restaurants with real owner ids. Only the payee-account table is empty.
> Session A caught the overstatement. It matters beyond wording: §6.1 has real
> menus to price against, and the owner was told something false about their
> own platform.

**Task 2.1.1 — reproduce before changing anything.** Sign in to the live admin
and call `GET /admin/payee-accounts` directly. Three outcomes, three fixes:

- `200` with `accounts: []` → the database is empty. The screen is correct, and
  the defect is that it does not *say* it is empty for that reason.
- `403` → the signed-in admin lacks `finance.payouts.view`. Fix the role.
- `404`/`500` → the deployment is behind the tree. Check
  `git log --oneline origin/main..HEAD` before anything else.

Do not skip this. The last time a cause was assumed on this project, an
afternoon went into a bug that was nine unpushed commits.

**Task 2.1.2 — an empty screen must say which empty it is.** Whatever 2.1.1
returns, this is a real defect and gets fixed either way. Three states, three
different sentences:

- Request failed → "Could not reach the server." with a retry.
- Succeeded, nothing submitted → "No restaurant or rider has added a bank
  account yet. They add one from their own app, under Payout account."
- Succeeded, nothing in *this* section → "Nothing waiting here. 4 accounts are
  already approved."

A spinner that resolves to a blank card is how "nothing is coming up" gets
reported as a bug when the system is working.

### 2.2 The three sections

`PayeeAccountsScreen.tsx` already has a `Segmented` control. Change the segments
to exactly what the owner asked for:

| Segment | Contents |
| --- | --- |
| **Restaurants** | `ownerType === 'RESTAURANT'`, not yet applied |
| **Riders** | `ownerType === 'RIDER'`, not yet applied |
| **Approved** | `appliedAt` set, both types, newest first |
| **Who can be paid** | Existing coverage view. Kept. |

The fourth segment was not in the owner's list and stays anyway. It is the only
screen that answers *why* a partner went unpaid, §2.4 leans on that question,
and nobody asked for it to be removed. A list of three in a plan is not an
instruction to delete a working fourth thing.

Each pending row shows holder name, account last 4, IFSC or VPA, the owner's
name and city, when it was submitted, and the advice string the route already
returns — shown as advice, never as a decision.

Each segment label carries its own count. A single badge on the nav item hides
which queue is full.

### 2.3 Verify

One button, `Verify & connect` — the owner's word on the label. It calls the
existing `POST /admin/payee-accounts/:id/review` with **`decision: 'APPROVE'`**.

> **Corrected 23 Sep.** This section first said `'APPLY'`. The schema at
> `payeeRoutes.ts:242` is `z.enum(['APPROVE','REJECT'])`, so `'APPLY'` would
> have returned 400 on every tap. Session A caught it before implementing.
> The lesson is narrow and worth keeping: a plan that names a value is asserting
> something about code, and this one was written from the prose around the route
> rather than from its schema. The button's *label* is the owner's word; the
> *value* is the route's.

**Task 2.3.1 — ANSWERED, no change needed.** Verified by Session A: creation
does not refuse without RazorpayX — `payeeAccounts.ts:341` marks the account
`UNVERIFIED` rather than failing, `UNVERIFIED` is in the decidable set at `:483`,
and the approve-time gate at `:505` is itself guarded by
`isRazorpayXConfigured()`, so with no keys it never fires. The manual path is
already fully open. Nothing to remove.

Two things the button must do that a confirmation dialog usually does not:

1. **Show the full account number before the tap, not the last 4.** The
   administrator is being asked to confirm a number against a document. Four
   digits cannot be checked against anything.
2. **Record who tapped and when.** `appliedByAdminId` and `appliedAt` already
   exist on the model. Write an audit entry too — this is the moment money
   becomes sendable to a stranger's account, and it is the first thing anyone
   will want to read after a wrong payment.

Only one account per owner may be applied at a time. `payeeAccounts.ts:524`
already un-applies the others; keep that, and make the dialog say so: "This
replaces the account currently connected to Sharma Foods."

### 2.4 Where verified accounts must then appear

Both are new, and both are the point of the whole section.

**People.** On a rider's and a restaurant's profile panel in `PeopleScreen.tsx`,
a "Paid into" block: holder name, masked account, IFSC or VPA, verified date and
by whom. When nothing is connected, say so plainly — "No account connected.
This partner cannot be paid." — because that is the reason a payout will fail,
and the screen that explains it should be the screen you are already on.

**Settlements and Pay.** Every row that offers to send money shows the
destination inline. `PayoutsScreen.tsx` already blocks on `blockedReason`;
extend the same row to show *where it is going* when it is not blocked. Nobody
should press Send without seeing the destination.

---

## 3. Admin — Rider settlements (put it back)

`App.tsx` currently has four items under Money: Finance, Inflation, Pay, Bank.
The rider settlement section is gone from the navigation. The backend is intact:
`financeRoutes.ts:489–597` computes rider dues from `settlementEvidence`, not
from `status === 'DELIVERED'`.

> **Corrected 23 Sep.** This section said the rider settlement backend was
> "intact" at `financeRoutes.ts:489–597`. It was not. `unsettledFor(riderId)`
> had **no callers anywhere** — dead code left behind when the second payout
> system was removed, along with an orphaned docblock for a route that went with
> it. An unused exported function draws no compiler warning, so it sat there
> looking like working code, which is how this plan came to describe it as
> working. Session A deleted both rather than reviving them. Correct call.

Add a fifth Money item, `Settlements`, with two segments — Riders and
Restaurants — because the restaurant half already has routes
(`financeRoutes.ts:622–800`), and splitting them across two nav entries is what
made one of them easy to lose.

**It reads `/admin/payouts/dues`, the same source Pay reads.** Not the deleted
order-scanning helper. `duesFor` derives what is owed from the **ledger**
(`payouts.ts:165`, `ledger.query({ account })` on `RIDER_PAYABLE` /
`PARTNER_PAYABLE`); the dead helper derived it by scanning orders. Reviving it
would have given Pay and Settlements two sources for one number — Task 3.1
again, on the rider side, created deliberately on the day it was argued against.
One source, so a wrong figure is wrong in exactly one place.

> **RESOLVED, `2bebdc4`.** This section carried a warning that Settlements would
> read zero, because §4.4a meant an ordinary cash delivery posted nothing to the
> ledger — and that the temptation would be to "fix" it by switching to the
> order-scanning source, reintroducing the divergence this decision exists to
> prevent. §4.4a is fixed, so the warning no longer applies. The rider's own
> handover now posts `RIDER_PAYABLE` and `PARTNER_PAYABLE` at the door.
>
> The check that was going to prove it is the one that did: a cash order
> delivered through the rider's OTP screen appears in both Pay and Settlements
> **without anybody pressing backfill**. `cashLocations.test.ts` asserts it, and
> the explicit `backfillEarnings()` call that used to stand in for a human is
> gone from that suite. Its absence is the proof.

Each rider row: name and phone, trips not yet settled, amount owed, cash still in
hand, the connected bank account (§2.4), and when they were last paid. A rider
holding cash is shown but not payable, with the existing reason text.

**Do not touch `settlementEvidence`.** It is the guard that stops an order
becoming money owed without proof it happened, and it was written to replace a
scan for `DELIVERED` that paid for orders that had not been collected.

**Task 3.1 — Pay and Settlements tell two different stories about one partner.**
Raised by Session A while building §2.4, deliberately not patched, and it is the
right call to make it a plan item rather than a one-line fix.

Pay renders `blockedReason` from the due, computed in `payouts.ts`, which knows
about **three** things: the hold period, the cash-in-hand rule and the minimum
payout amount. Settlements renders `payoutBlockedReason`, which is
`accountBlockReason` and knows about **one**: the account.

So for a restaurant with a connected account whose earnings are still inside the
hold period, Pay explains why nothing is moving and **Settlements says nothing at
all**. Same partner, same moment, two screens, two answers — and the silent one
reads as "everything is fine, so why has this not been paid".

This is the §4.4.2 problem in a different currency: two places deriving the same
fact from different sources will eventually disagree, and the one people believe
is whichever screen they happened to open.

**Why it is not a one-liner.** The settlement figure comes from
`unsettledOrdersFor`, not from the ledger dues, so the two screens do not share a
source to unify. Making them agree means deciding which source is authoritative
for "can this partner be paid right now" and routing both through it.

**The check that fails**, written out so it can be pasted the day the
unification happens: one restaurant, connected account, earnings inside the
hold period. Assert Pay and Settlements return the **same non-empty reason
string**. Asserting each screen returns *a* reason passes today, because one of
them returns null and null is not a reason.

> **It does not go into the gate until then.** Session B suggested adding it red
> so it would turn green when the work was done. Session A pushed back and was
> right: a gate that is red for a known reason is a gate people learn to read
> past, and the next real failure arrives into a suite that is already failing.
> A known defect belongs in a plan with its assertion written out, not in a
> permanently failing check.

Until it is done, do not add a third screen that computes this independently.

---

## 4. Admin — COD return

The owner's words: *"rider comes to our office (bite bridge), we take money and
through admin portal we remove that cash in hand money from their portal and that
money will be added to us."*

### 4.1 What exists and what is missing

`confirmDeposit` in `cashDeposits.ts` already does exactly the right thing: it
reduces the rider's cash-in-hand by what was **received**, not by what was
declared, and it posts a `PLATFORM_BANK` debit (line 246). Admin already has
`POST /admin/cash/deposits/:id/confirm`.

The gap is the `:id`. **Every one of these paths requires the rider to have
declared a deposit in their app first.** A rider who walks into the office with
₹4,000 and has not tapped anything in the app cannot be cleared by anyone. That
is the defect.

### 4.2 The fix

**Task 4.2.1 — an admin-initiated cash return.** New route
`POST /admin/cash/returns`, taking `riderId`, `amount`, an optional note, and the
administrator's identity from the token.

It must reuse `confirmDeposit`'s ledger posting rather than writing a second one.
This project has already removed one payout system that credited a balance
without a ledger entry; a second cash path doing its own arithmetic is the same
mistake wearing a different hat.

Shape it as: create a deposit record on the rider's behalf marked
`declaredBy: 'ADMIN'`, then immediately confirm it through the existing function.
One code path, two entry points.

**Task 4.2.2 — refuse more than the rider is holding.** A rider carrying ₹4,000
cannot return ₹6,000. Refuse with the amount they are actually holding in the
message, not a generic "invalid amount".

**Task 4.2.3 — partial returns must work.** ₹4,000 held, ₹2,500 handed over,
₹1,500 still in hand and still blocking their payout. `confirmDeposit` already
returns `remainingPaise`; show it back on the screen after the tap.

### 4.3 Where the button lives

**Confirmed by the owner on 23 Sep: the rider's page.** Their words — *"no i
want it in the riders page and when they come to our office and hand over the
money we remove them from their portal"*. The earlier "restaurant section"
wording is superseded.

- **The rider's profile in People**, beside "Cash in hand (COD)"
  (`PeopleScreen.tsx:478`), which today is a number you can read and not act on.
- **Pay → Cash**, alongside the deposits waiting to be counted.

### 4.4 The returned cash is NOT revenue. Do not book it as revenue.

The owner also said the money *"will be added to our total earning and that
money will be distributed among every one"*. That describes the right outcome
in the wrong words, and implementing the words literally would corrupt every
revenue figure on the platform.

**What the code already does, and it is correct:**

At delivery (`earnings.ts:275–300`) the gross is split in one balanced
transaction. `PARTNER_PAYABLE` and `RIDER_PAYABLE` are credited with what is
owed out; `REVENUE_COMMISSION` and `REVENUE_FEES` are credited with what is
genuinely ours; and for a cash order the whole gross is debited to
`RIDER_CASH:<riderId>` — because that is where the money physically is. The
comment in that file puts it exactly right: recording cash in a rider's pocket
as though it were in the bank is how a platform believes it holds money it has
never seen.

**Our earnings on that order are recognised at delivery, not when the cash
arrives.** By the time the rider walks into the office, the profit has already
been counted.

When the cash is handed over, `confirmDeposit` (line 244) posts
`RIDER_CASH → PLATFORM_BANK` and touches no revenue account at all. The money
changes *location*, not *ownership*. The second half of that is right. **The
location is wrong, and §4.5 fixes it.**

**Task 4.4.1 — the admin cash return must post that movement and nothing else.**
No `REVENUE_*` posting. No adjustment to any earnings total. If a cash return
increases a revenue figure anywhere, every COD order is being counted twice —
once when delivered and again when the notes are counted — and the owner would
be reading a profit figure roughly double the truth, on the strength of a screen
that looked right.

**Task 4.4.2 — build the screen the owner is actually asking for.** Underneath
the loose wording is a real and reasonable question: *how much money do I have,
and how much of it is mine?* Nothing on the platform answers it today. Add a
"The pot" panel to Finance, straight from the ledger:

| Line | Account |
| --- | --- |
| In our bank | `PLATFORM_BANK` |
| In the office, not yet banked | `PLATFORM_CASH` (see §4.5) |
| Still in riders' pockets | sum of `RIDER_CASH:*` |
| Owed to restaurants | sum of `PARTNER_PAYABLE:*` |
| Owed to riders | sum of `RIDER_PAYABLE:*` |
| Tax held back | `TAX_GST_PAYABLE`, `TAX_TCS_PAYABLE`, `TDS_WITHHELD` |
| **Genuinely ours** | `REVENUE_COMMISSION` + `REVENUE_FEES` − `REFUNDS_PAID` |

Derived from the ledger on every read, never stored as a running total. A
second copy of a number that is already derivable is a number that will
eventually disagree with the first, and the one people trust is whichever one
is on the screen they happen to open.

This is also the panel that answers "can I make payroll this week" before the
payout run rather than after it, which is the same defect as §5.3 from the other
direction.

### 4.4a The two delivery paths each do half the money, and neither does both

Raised by Session A from a suite that failed, then verified here by reading
every call site. **This is the most serious thing found today** and it is on the
order flow, so it belongs to Session B.

There are two ways an order reaches `DELIVERED`, and they are mirror images:

| | Credits rider cash | Posts earnings |
| --- | --- | --- |
| Rider taps through the OTP screen (`riderRouter.ts:1093–1098`) | **yes** | **no** |
| Status update — partner or admin (`orderService.ts:1122`) | **no** | **yes** |

Verified rather than inferred:

- `riderRepository.adjustCashInHand` has **exactly one caller** in the entire
  codebase: `riderRouter.ts:1093`.
- `recordOrderEarnings` has three: `orderService.ts:1122` inside
  `updateOrderStatus`, `earnings.ts:382` inside `backfillEarnings`, and
  `payoutRoutes.ts:517`, an admin route.
- The rider's OTP route writes `DELIVERED` through the repository directly. It
  never calls `updateOrderStatus`, so it never reaches line 1122.

**Correction to how this was first reported.** `backfillEarnings()` does **not**
sweep at boot. Its only caller is `payoutRoutes.ts:543` — an admin route someone
has to invoke. There is no boot-time call anywhere in `src`. So the safety net
described in the comment at `orderRepository.ts:368` does not run on its own.

#### What each half costs

**The rider path loses the revenue.** The ordinary, correct, everyday cash
delivery — rider taps the code at the door — credits the rider's cash-in-hand
and **posts nothing to the ledger**. No `REVENUE_COMMISSION`, no
`REVENUE_FEES`, no `PARTNER_PAYABLE`. Until an administrator happens to press
the backfill button, the platform's own books say that order earned nothing.

Every ledger-derived figure inherits this, including the pot panel in §4.4.2 and
the "genuinely ours" line in it. The owner would read a revenue screen showing a
fraction of the truth and have no reason to doubt it.

**The status-update path loses the cash.** An order closed by an administrator —
a dead tablet, a rider who handed over without marking it, which is exactly what
the route at `admin/orderRoutes.ts:180` exists for — posts the earnings but
never records that the rider is holding the notes.

Cash-in-hand is what blocks a payout (`payouts.ts:196`). So that rider is
**paid in full on payday while still carrying the platform's cash**, and no
screen anywhere says so. §4's whole cash chain starts from a number that this
path silently leaves at zero.

#### The fix is a decision, not a line

Both halves belong at the same moment: the food reached the customer. Pick one
place where that is recorded and route every path through it.

`updateOrderStatus` is the natural candidate — it already posts earnings, it
already runs `validateTransition`, and the OTP route bypassing it is why these
two behaviours drifted apart in the first place. The cash credit moves into it,
keyed on `paymentMethod === 'CASH_ON_DELIVERY'`, and the rider route calls it
instead of writing the repository directly.

**The trap:** the OTP route's direct repository write exists for a reason. The
comment at `orderRepository.ts:368` records that `verifyDeliveryOtp` once had no
precondition at all, so an order at `ORDER_PLACED` became `DELIVERED` the moment
a correct code arrived. The guard that now stops that lives in the repository.
Moving the write must not move it out of reach of that guard — DELIVERED must
still be enterable only from `OUT_FOR_DELIVERY`.

Do not solve this by calling `backfillEarnings` at boot. That converts "revenue
is missing" into "revenue appears whenever the process restarts", which is a
worse bug because it looks fixed.

#### FIXED, `2bebdc4`

`completeDelivery()` in `modules/orders/deliveryCompletion.ts`, called from both
paths. One function named for when to call it, rather than the same two lines
patched into two places — there are two call sites today and whoever adds a
third would not know a delivery has two consequences.

**The write that sets DELIVERED did not move.** It stays inside
`verifyDeliveryOtp` behind the guard that stops an `ORDER_PLACED` order becoming
DELIVERED on a correct code. Unifying by moving it would have traded a money bug
for a fraud one, which was the trap this section named.

**A new risk was created and closed in the same commit.** Before the fix,
running both paths on one order was harmless because each did half the job. Now
both do both, so a double-run would credit the cash twice — earnings deduplicate
on the order id, but a cash credit is a **delta** and does not. Hence
`codCashRecordedAt` on the order.

Two details in that guard worth keeping:

- **The marker is written to the STORED order, not the caller's copy.** A caller
  holding a detached object would set it on something nobody reads back, and the
  next call would credit again — the exact failure the marker exists to prevent,
  arriving through the mechanism meant to prevent it.
- **The cash is credited BEFORE the marker is written**, and that order is the
  right way round. A crash between the two is a narrow window either way, but
  the two outcomes are not equal: marker-first then a failed credit leaves cash
  **uncounted**, which is invisible and is the original bug; credit-first then a
  failed marker leaves cash **double-counted**, which is visible on the rider's
  own screen and correctable by an administrator. Prefer the failure somebody
  can see.

#### The checks that fail

Two, and both must be in the same test so neither path can be fixed alone:

1. Cash order delivered **through the OTP screen** → assert `REVENUE_FEES` moved
   **and** the rider's cash-in-hand rose.
2. Cash order delivered **through the admin status route** → assert the same two
   things.

Today check 1 fails on revenue and check 2 fails on cash. Asserting only that
the order reached DELIVERED passes on both paths right now, which is how this
survived.

### 4.5 The office is not the bank. A third location is missing.

The owner described their real process on 23 Sep: *"the rider comes to my
office and hands over the money… then we will deposit this money offline to
bank and send all the money to restaurant + rider through settlement."*

**There are three places that cash sits, and the ledger models two.** Between
the rider handing over the notes and the owner walking them into a branch, the
money is in the office. That can be days. `confirmDeposit` posts straight to
`PLATFORM_BANK`, so for that entire window the platform believes it holds bank
money it does not hold.

This is a pre-existing defect, not something this plan introduces. It is also
the exact mistake the codebase already names one step earlier, in
`earnings.ts:281`: *recording cash in a rider's pocket as though it were in the
bank is how a platform believes it holds cash it has never seen.* The same
sentence applies to a drawer.

It has teeth because of what the owner does next. `payouts.ts` checks
`rail.available()` — whether RazorpayX is configured — and **never checks
whether `PLATFORM_BANK` actually holds the money.** So a payout run funded by
cash still sitting in the office would be marked sent and then bounce at the
gateway for insufficient funds, with the platform's own books saying the money
was there.

**Task 4.5.1 — add `PLATFORM_CASH` to `LedgerAccountKind`**
(`shared-types/src/index.ts:1441`): *money physically in the platform's
possession that is not yet in a bank account.* Adding a union member is
additive; existing entries and stored rows are untouched.

**Task 4.5.2 — the cash return posts `RIDER_CASH → PLATFORM_CASH`.** Not
`PLATFORM_BANK`. This changes the existing `confirmDeposit` posting at
`cashDeposits.ts:244` as well as the new admin route, because both describe the
same physical event.

**Task 4.5.3 — a second, separate action: record a bank deposit.**
`POST /admin/cash/bank-deposits`, posting `PLATFORM_CASH → PLATFORM_BANK`, with
the amount, the date it was paid in, and a reference or slip number. This is the
owner recording something that happened at a bank counter, not the system
moving money.

Refuse more than `PLATFORM_CASH` holds, naming the real figure — the same
treatment as §4.2.2, for the same reason.

**Task 4.5.4 — warn before a payout run when the bank is short.** A warning,
not a block: the owner may hold capital in that account that the ledger knows
nothing about, and blocking a legitimate payday on an incomplete picture is
worse than the problem.

The warning must name the likely cause rather than only the shortfall —
"₹48,200 is sitting in the office and has not been banked" is actionable, and
"insufficient balance" sends someone to check a bank statement that is correct.

**Task 4.5.5 — the full chain, asserted end to end.** Four locations, one
rupee, in one test:

```
COD at the door   ->  RIDER_CASH:<rider>
handed to office  ->  PLATFORM_CASH
banked            ->  PLATFORM_BANK
settled           ->  PARTNER_PAYABLE / RIDER_PAYABLE discharged
```

At every step, assert that the total across all accounts is unchanged and that
`REVENUE_COMMISSION` and `REVENUE_FEES` have not moved since delivery. Money
appearing or vanishing between two locations is the failure this catches, and it
is the one that would otherwise be found by a partner disputing a settlement.

---

## 5. Admin — Pay

The owner asked to "fix the pay section properly" without saying what is wrong,
and `PayoutsScreen.tsx` is 1,134 lines. **Guessing here would waste a day.**

**Task 5.1 — reproduce first.** Open Pay on the live admin, with the real empty
database, and write down what is actually on screen: every section, whether it
loaded, what each button does when pressed, and what the response was. Report
that to the owner and ask which part they mean before changing a line.

Two things are worth fixing whatever the answer:

**Task 5.2 — every payout row shows its destination account.** Covered in §2.4.
Do it here.

**Task 5.3 — the daily cap must announce itself before payday, not during.**
Already identified in `road-to-launch.md` §3: `dailyPayoutCap` is ₹2,00,000 per
24 hours and the cycle is now weekly. A busy payday stops partway with
`DAILY_PAYOUT_CAP_REACHED` and half the partners go unpaid with no visible cause.
Show the total about to be sent against the ceiling **before** the run.

**Do not raise the cap.** It is a fraud blast-radius control. Weakening a safety
limit to solve a scheduling problem is the trade that looks free until it isn't.

---

## 6. Admin — Inflation

The largest piece. Four sub-parts, and the first is the only one that touches
money the customer pays for food.

### 6.1 Per-item pricing

Today: one `foodMarkupPercent` per restaurant, applied in
`restaurantCharges.ts:493` by `customerDishPrice(price, foodMarkupPercent)`.

Wanted: every restaurant from the main page listed; open one, see its whole menu
with the restaurant's own price; type the customer's price on any item.

**The good news: there is exactly one seam.** `customerDishPrice` is the only
place a customer-facing dish price is computed, called from
`restaurantCharges.ts:517` and reached from `orderService.ts:154` and `:405`.
Per-item pricing is a change to that one function's inputs, not a change to the
order flow.

**Task 6.1.1 — storage.** Add to the per-restaurant charges record:

```
itemPrices?: Record<string, number>   // menu item id -> the CUSTOMER's price
```

Rupees, matching every other money field on that record. Absent means "follow the
restaurant percentage", which is the current behaviour and must stay the default
for every restaurant that exists today.

**Task 6.1.2 — resolution order**, most specific first:

1. A typed price for this item → that is the customer's price.
2. Otherwise the restaurant's `foodMarkupPercent` applied to the item's price.
3. Otherwise the restaurant's own price, unchanged.

**Task 6.1.3 — change the signature so it cannot be called wrongly.**
`customerDishPrice(price, percent)` becomes
`customerDishPrice(restaurantId, itemId, restaurantPrice)`. Do not add an
optional third parameter — an optional argument is a call site that silently
keeps the old behaviour, and there are two of them in `orderService.ts` that
must both change. Let the compiler find them.

**Task 6.1.3a — ADD-ONS. The proposed signature breaks them, and the failure is
a ₹240 slice of cheese.** Found reviewing Session A's design on 24 Sep, before
any code was written.

Add-ons are priced today and **are marked up today**. `orderService.ts:207–210`:

```
const customerUnitPrice = customerDishPrice(dish.price,   foodMarkup);
const customerAddons    = customerDishPrice(addonsTotal,  foodMarkup);
partnerItemsTotal += (dish.price + addonsTotal) * quantity;
```

A percentage scales naturally: a ₹50 extra becomes ₹60 at 20%, and the
restaurant is paid its own ₹50. That is coherent and it is what happens now.

**An absolute typed price does not scale, and there is no add-on id to look
up.** `customerDishPrice(restaurantId, dish.id, addonsTotal)` would find the
typed price keyed on that dish and return it — so a ₹50 add-on on a dish typed
at ₹240 is charged **₹240**. The dish and its extras would each cost the
customer the dish's full price.

Nothing in the bill would look wrong. It adds up. It would be found by a
customer paying it.

**Use the implied ratio.** When a dish has a typed price, derive
`typed / restaurantPrice` and apply that ratio to the add-ons. ₹200 typed at
₹240 is a ratio of 1.2, so the ₹50 extra is ₹60.

> **The justification here was wrong and is replaced. See §6.1.3c.** This first
> argued for the ratio on grounds of *continuity* — that a dish typed at exactly
> its percentage would behave identically to the percentage. That is false, and
> not only because of rounding.
>
> **The correct argument is stronger.** A typed price **is** the markup decision
> for that dish. An administrator who types ₹11 against a ₹10 dish has marked it
> up a tenth and has overridden the restaurant percentage for that dish. Making
> its extras obey the percentage anyway would have them follow a number the
> administrator had just replaced — which would be the actual bug.
>
> So the two paths diverging is **the feature working**, not an artefact to be
> rounded away.

Guard the division. `restaurantPrice` of zero — a free dish, or a promotional
line — must yield the restaurant percentage rather than `Infinity` or `NaN`, and
`NaN` propagates through a bill silently until it reaches a screen as a blank.

**The check that fails:** one dish at ₹200 typed to ₹240, ordered with a ₹50
add-on. Assert the customer pays ₹300 and `partnerItemsTotal` is ₹250. Asserting
only the dish line passes while the add-on is wrong, because the add-on is a
separate term.

**Task 6.1.3c — REVIEW FINDING, 24 Sep: the continuity property does not
actually hold, and the test that checks it cannot see that.**

§6.1.3a argued for the implied ratio on the grounds that *"a dish typed at
exactly its percentage behaves the same as the percentage"*. Session A built it
and cited that reasoning. **It is false for most numbers**, because the two
paths round differently:

| | |
| --- | --- |
| percentage path (`restaurantCharges.ts:528`, `:595`) | `Math.round(x * (1 + p/100))` → **whole rupees** |
| typed ratio path (`:590`) | `Math.round(x * ratio * 100) / 100` → **paise** |

Computed, not read:

```
base 320, extra 180, 25%  ->  percentage 225     typed-ratio 225      same
base 200, extra  50, 20%  ->  percentage  60     typed-ratio  60      same
base  55, extra  12, 18%  ->  percentage  14     typed-ratio  14.18   DIFFER
base 149, extra  37, 15%  ->  percentage  43     typed-ratio  42.46   DIFFER
```

**The suite passes because its fixture is one of the coinciding cases.** The
three-totals check uses ₹320 / ₹180 / 25%, which agrees exactly. That is §11.2's
second shape — *a fixture that cannot reach the case* — and it is the reason
this needed computing rather than reading.

The whole-rupee rounding is **pre-existing and deliberate**, not something
`90355f6` introduced: `git show 90355f6^` has the identical line. Customers
seeing ₹240 rather than ₹239.87 is a reasonable product decision. The defect is
having **two conventions for one concept** now that a second path exists.

**Fix, and it is only half of what this section first said: round every DERIVED
price the same way, whatever its source** — make the ratio path
`Math.round(extras * ratio)`. A typed price itself is still honoured exactly,
because a human typed it and rounding ₹239.50 to ₹240 would overrule them. The
rule is: *typed values are obeyed, derived values are rounded.*

> **The other half was wrong, and Session A measured it rather than arguing.**
> This section then claimed whole-rupee rounding would make the two paths agree.
> **It does not.** The typed price is itself rounded, so the implied ratio is not
> `1 + p/100`: ₹149 at 15% types to ₹171, a ratio of 1.1477, and a ₹37 extra is
> ₹42 by the ratio against ₹43 by the percentage — both whole rupees, still
> different.
>
> Confirmed independently here by sweeping 891 base prices × 10 percentages ×
> 7 add-on values: **7,802 divergent combinations, worst gap ₹9.**
>
> **The worst case is the one that settles it.** A ₹10 dish typed to ₹11 with
> ₹180 of extras: the percentage gives ₹189, the ratio gives ₹198 — and **the
> ratio is right**. That dish has been marked up a tenth by an administrator who
> overrode the 5% for it. Continuity was never the property to want.
>
> So: fix the convention, keep the divergence, and do not write a comment
> claiming exactness. That would have been a sixth wrong-prose incident, with me
> as the one asserting it twice.

**The check that fails** is therefore not a continuity check. Two, both using
numbers that cannot coincide:

1. ₹149 / ₹37 / 15% — assert **both** paths return whole rupees. Restoring the
   paise rounding fails it.
2. ₹10 typed to ₹11 with ₹100 of extras — assert the extras cost ₹110, not the
   ₹105 the configured 5% would give. This is the property that makes the ratio
   *right* rather than merely workable, written as something checkable.

Pick the awkward number deliberately. ₹200 at 20% divides cleanly, which is how
a suite came to assert continuity while being structurally unable to test it.

**Task 6.1.3b — orphan keys.** Dish ids are `dish_` + `crypto.randomUUID()`
(`menuRepository.ts:61`) and `updateItem` preserves the id (`:84`), so keys are
stable and never reused. Keying `itemPrices` on a dish id is safe — no risk of a
typed price landing on a different dish.

But a deleted dish leaves its key behind. Harmless for pricing, wrong for the
"how many items are marked up" header in §6.1.7, which would count prices for
dishes that no longer exist. Filter that count against the live menu rather than
counting the map.

**Task 6.1.4 — the money must still split correctly.** This is the assertion
that matters more than the screen:

- The customer's bill totals the **typed** prices.
- `partnerItemsTotal` totals the **restaurant's own** prices.
- The restaurant's settlement pays `partnerItemsTotal`, never the typed total.
- Commission is taken on `partnerItemsTotal`, never on our markup.
- The difference is platform revenue and appears as such in Finance.

The pricing engine already carries `partnerItemsTotal` for exactly this
(`packages/pricing-engine/src/index.ts:53–63`). The per-item work must populate
it, not bypass it.

**Task 6.1.5 — refuse a price below the restaurant's own.** Typing ₹150 against a
₹200 dish means paying the restaurant ₹200 while charging ₹150 — the platform
loses ₹50 per dish and nothing on any screen would say so. Refuse it, naming both
numbers.

**Task 6.1.6 — a price change and its markup are decided together, in one
step, at approval.** The owner, 23 Sep: *"we verify the price first then they
can change the price of item… prices are set by them but from our permission
they appear… so the inflation will work every time."*

> **Corrected 23 Sep.** This section previously assumed a restaurant could
> reprice unilaterally, and specified an alert for margin silently lost. That
> premise was wrong. The partner app calls
> `POST /restaurants/:id/menu/requests` (`partnerApi.ts:292`), which creates a
> `MenuChangeRequest` at `PENDING` and lands in the admin review queue. The only
> menu write it makes directly is `toggle-stock`, which cannot change a price.
> **No price reaches a customer without an administrator approving it.** The
> alert, the gaming audit and the bulk re-pricing screen were all solving a
> problem this platform does not have, and they are removed rather than kept
> "just in case".

**So the markup never lapses, because it is never separated from the price.**
A price change and the customer price that sits on top of it are one decision,
taken once, by the person who was already being asked to approve it.

**Task 6.1.6a — the approval screen asks both questions at once.** The menu
request review (`catalogRoutes.ts:459` for one, `:328` for bulk) currently shows
what the restaurant wants to charge. It must also show, for that dish:

| | |
| --- | --- |
| They charge now | their current price |
| They want to charge | the requested price |
| Customer pays now | the typed price, or the percentage applied |
| We keep now | the difference |
| **Customer will pay** | editable, pre-filled to preserve what we keep |
| **We will keep** | recomputed live as that field is typed |

Approving writes both values in one transaction. There is no window in which
the new price is live and the markup is not, because they were never two
separate saves.

**Task 6.1.6b — pre-fill by preserving the margin, and offer the alternative.**
Default to holding the rupee margin: ₹200 → ₹260 with ₹40 kept becomes ₹300.
Offer the percentage reading beside it (20% kept becomes ₹312) as one tap.
Whichever is chosen, the number is visible and editable before approval — the
platform proposes, the administrator decides.

**Task 6.1.6b(i) — the rupee reading stays the default. ANSWERED 24 Sep.**

₹200 → ₹260 with ₹40 kept is ₹300 by rupees and ₹312 by percentage. Keep
rupees, for two reasons and with one addition.

**It matches the mental model the owner chose.** Asked directly whether to type
a price or a percentage per item, they chose *"type the customer's price"*.
Somebody who thinks in absolute prices expects an absolute margin to hold.

**And it is the smaller number.** Session A's argument, and it is right: a
default that errs toward charging the customer less is the one to get wrong.

**But the rupee reading erodes, and the erosion must be visible.** A margin held
at ₹40 across ₹200 → ₹260 → ₹340 goes 20% → 15.4% → 11.8%. That is a slow
silent bleed of exactly the kind this plan keeps catching, and it happens most
when costs rise fastest.

So the approval screen shows the margin **as a percentage, before and after**:
*"You kept 20%. This keeps 15.4%."* One line, and it turns an invisible drift
into a number at the moment of decision. The percentage reading stays one tap
away for the administrator who wants it.

**Task 6.1.6b(ii) — §11.3 still holds, and here is the one place it would
stop.** Verified 24 Sep at Session A's request.

Every reader of `typedPriceFor` and `itemPrices` is inside
`restaurantCharges.ts`. `/restaurants/:id/menu/manage` returns the menu as the
kitchen set it and does not call `inflateMenuForCustomer`. `review()`
(`menuRequestRepository.ts:55`) stores only `status`, `reviewedAt`,
`reviewedByUserId`, `rejectionReason` and `resultingDishId` — nothing about the
customer price — and its `extras` parameter is a closed shape, so the compiler
refuses a new field without a type change. Clean.

**The gap is that the partner's own route has no projection.**
`restaurantRouter.ts:736` returns `res.json({ requests })` — the raw records.
The day anyone widens `MenuChangeRequest` or `extras` to remember what the
administrator set at approval — a natural thing to want for an audit trail — it
reaches the partner immediately, and nothing would fail.

A rule in a comment will not hold this. **Assert it:** serialise the partner's
`/menu/requests` response and check it contains no customer-price or margin key.
That check fails on the day somebody adds one, which is the only day it matters.

**Task 6.1.6c — the same refusal as §6.1.5 applies here.** A customer price
below the restaurant's newly approved price is refused, naming both numbers.
Approval is the moment this is easiest to get wrong, because the administrator
is looking at a dish rather than at arithmetic.

**Task 6.1.6d — bulk approval must not skip the markup.**
`POST /admin/menu-requests/bulk-review` (`catalogRoutes.ts:328`) approves many
requests in one action. Bulk-approving price changes without setting customer
prices would recreate exactly the lapse this design prevents, on many dishes at
once and with one tap.

Bulk approval applies the margin-preserving default automatically and reports
what it did — "12 prices approved, customer prices adjusted to hold your
margin" — with the list. Silence here is the failure.

**Task 6.1.6e — the direct-write routes are a backstop, not the main flow.**
Two routes still write a price straight through, bypassing approval:
`restaurantRouter.ts:506` (which the partner app does not call) and
`catalogRoutes.ts:133` (an administrator editing a menu directly). An unused
route is still a route.

For those paths only, and inside `menuRepository.updateItem` so both are
covered by one rule: a changed price clears a stale typed customer price, so
resolution falls back to §6.1.2. This must compare stored against incoming
rather than react to the field's presence — `MenuItemSchema` is `.partial()`,
so a rename or a photo swap must not touch a markup.

This backstop should essentially never fire. If it starts firing regularly,
something is writing prices around the approval queue and that is the bug to
find.

**Note on orders already placed.** None are affected. The customer's price is
computed at placement (`orderService.ts:154`) and stored on the order, so an
approval mid-delivery cannot alter a bill already agreed. A cart not yet
checked out re-prices at checkout, which is existing behaviour and correct —
the customer pays what the menu says when they pay.

**Task 6.1.7 — the screen.** Restaurant list (same source as the main page,
searchable) → tap a restaurant → its menu by category. Each row: dish name, what
the restaurant charges, an editable customer price, and the margin in rupees. A
header showing how many items are marked up and the average margin. Save per
item, not one giant form submit — a 60-item menu behind one Save button loses the
lot on one failed request.

**Task 6.1.8 — packaging.** The owner added *"we can improve packaging money
too"*. This already exists: `packagingFee` versus `partnerPackagingFee` in the
pricing engine, editable per restaurant. Surface it on this screen beside the
menu so it is where they expect it. No new model.

### 6.2 The rider percentage

One number, platform-wide, applied to all riders, editable in admin.

**The customer pays it. Rider pay does not change.** The owner was explicit.

**Task 6.2.1** — add `riderDeliveryMarkupPercent` to the platform pricing config,
in `pricingConfig.ts` beside the existing entries so it inherits the same
validation, audit and editor.

**Task 6.2.2** — apply it to the customer's delivery fee in the pricing engine,
after distance is added and **before** any Gold discount, so the Gold percentage
comes off the real price the customer would otherwise have paid.

**Task 6.2.3 — prove the rider's payout did not move.** Set the percentage to
20%, place an order, and assert two things in the same test: the customer's
delivery fee rose, and the rider's earning for that trip is byte-identical to
what it was at 0%. A test that only checks the customer's side passes just as
well when the money has been taken out of the rider.

> **REVIEW FINDING, 23 Sep — this one is NOT yet satisfied by `4d44863`.**
>
> `deliveryMarkup.test.ts:150` asserts *"AND EVERY RIDER RATE IS
> BYTE-IDENTICAL"*, comparing four values read from `getActiveRates()` —
> `riderBaseFeePerTrip`, `riderPerKmFee`, `riderBaseKm`,
> `riderMinEarningPerTrip` — before and after the markup is set.
>
> **Those are configuration values, and nothing in §6.2 writes to them.** The
> check compares config with config. It would pass under almost any mutation of
> the delivery-fee code, including the one it exists to catch.
>
> The reasoning in the comment above it is correct *today*: rider pay is
> computed by `calculateTripPayout` (`riderRouter.ts:103–120`) from those four
> rates and the distance, and none of them is the markup. But that is an
> argument, not a measurement — and the assertion checks the inputs the argument
> relies on rather than the output the argument is about. It is §11.2's family:
> a check positioned one step away from the thing it claims.
>
> **What makes it more than pedantry.** `calculateTripPayout` already accepts
> `bill.deliveryFee` in its parameter type (`riderRouter.ts:105`) and does not
> currently read it. So a now-marked-up number is sitting in scope in the rider
> payout function, and the only thing keeping it out of a rider's pay is that
> nobody has used it yet. The day somebody does — reasonably, to make rider pay
> track the delivery charge — this check stays green while riders start earning
> a share of the platform's markup, or the customer's markup starts inflating
> rider pay. Either direction is a money bug and neither would fail.
>
> **The check that closes it:** call `calculateTripPayout` on the same order at
> 0% and at 20% and assert the two returned numbers are equal. One line, one
> function, and it fails the moment the markup reaches the rider's side.
>
> Not a defect in the shipped behaviour — the behaviour is correct. A defect in
> the evidence that it stays correct.

### 6.3 Gold plans

The new ladder, as decided today:

| Plan | Price | Validity | Delivery | Food discount | Cap |
| --- | --- | --- | --- | --- | --- |
| Gold | ₹99 | 30 days | 10% off | 5% | ₹75 |
| Gold+ | ₹249 | 30 days | 25% off | 5% | ₹100 |
| Gold Max | ₹799 | 60 days | 40% off | 7% | ₹150 |

**Task 6.3.1 — free delivery becomes a percentage.** This is a model change, not
a number change. Today `membershipService.ts` carries `freeDeliveryMinOrder` and
the pricing engine does:

```
if (input.isGold && itemsTotal >= freeDeliveryFloor) deliveryFee = 0.00;
```

That whole branch is replaced by a percentage discount off the delivery fee. Add
`deliveryDiscountPercent` to the plan, keep `freeDeliveryMinOrder` as the order
value at which the discount starts applying (0 = always), and delete the zeroing.

**The regression to guard:** every existing Gold member currently gets free
delivery above their floor. After this they get a percentage. Any test asserting
`deliveryFee === 0` for a Gold member will fail, and **that failure is correct** —
do not edit the assertion to match. Change it to assert the new discount, and
check the number by hand once.

**Task 6.3.2 — all three plans editable from admin, and the edit must take.** The
Gold tab in `RatesScreen.tsx:457` already has `PlanField` inputs for price,
duration and discount. Add delivery discount percent, and confirm each field is
in the server's allowlist.

This exact bug has already been found once on this project: the editor silently
dropped a rate from its allowlist, the screen confirmed a change that never
happened, and the owner would have set weekly and been paying daily. **Test by
changing each field and reading it back from a fresh request** — not from the
screen's own state, which shows what you typed whatever the server did.

**Task 6.3.3 — the benefit lines must read from the plan.** `planBenefits` at
`membershipService.ts:135` builds "Free delivery on orders over Rs X". That
sentence becomes false the moment 6.3.1 lands, and a plan that promises free
delivery and then charges 60% of it is a refund and a complaint. The line is
derived from the fields, never written out separately.

### 6.3a A Gold member with no plan id — policy, confirmed

Found by Session A building §6.3. The seeded customer is `isGold` with no
`goldPlanId`, and so is anybody the owner grants Gold by hand. Under the old
rule the engine checked `isGold` alone, so those members had free delivery.
Reading the benefit off a plan they do not have would have removed it silently —
no error, no screen, just a delivery fee that used to be lower, discovered by
paying it.

**The fallback is the cheapest ACTIVE plan, and that is the right call.**
Cheapest rather than best, because inventing the most generous benefit for a
record that is already anomalous is how a data problem becomes a bill nobody can
explain. It is the smallest thing that keeps a promise already made, and
withdrawing a benefit somebody was told they had is the worse error.

Verified: `listPlans()` defaults to active-only (`membershipService.ts:132`), so
the comment and the code agree.

**Task 6.3a.1 — the anomaly must be countable.** A silent fallback that works
forever means the underlying data problem is never fixed, and every future
change to plans has to remember this branch exists. Surface a count where the
owner already looks — the Gold tab in Inflation: *"3 members have Gold with no
plan. They are getting the ₹99 benefits."*

A fallback nobody can see is a fallback that becomes permanent.

**Task 6.3a.2 — the all-inactive edge undoes the whole branch.** If every plan
is deactivated at once, `listPlans()` returns `[]`, `cheapest` is `undefined`,
and the benefit silently disappears — **which is exactly the failure this
fallback exists to prevent**, arriving through the fallback itself.

Not hypothetical: the owner has just restructured all three plans, and hiding
the old ones while setting up the new ones is the obvious way to do that.

Floor it. When no plan is active, hand-granted members keep the last known
benefit rather than dropping to zero, and the count from 6.3a.1 says so.

> Note the asymmetry, which is correct and worth keeping: a member **with** a
> plan id keeps their benefit even after that plan is retired, because
> `findPlan` uses `listPlans(true)` — they bought it. Only the plan-less
> fallback is exposed to this.

### 6.4 What the customer sees

**Task 6.4.1** — the customer sees only the final price. Never the restaurant's
price, never the markup, never a struck-through "was". The owner's standing
instruction: *"for inflated only customers sees it and pays the bill etc"*.

**Task 6.4.2** — the partner sees only their own prices. The partner menu screen
shows what the kitchen set; the earnings screen shows what the kitchen is paid.
Our markup must not be derivable from any partner-facing response — including
from a field the screen does not render. Check the JSON, not the UI.

---

## 7. Rider app

The owner: *"in the rider everything is working"*. Three bounded changes.

**Task 7.1 — remove settle-trip-by-trip, keep the view.** `SettlementScreen.tsx`
keeps every read-only block — pending settlement, trips in it, settled so far.
The request/settle control goes.

**Task 7.2 — cash in bag reads from and is cleared by admin.** After §4, the
rider's cash-in-hand must reflect an admin cash return within one refresh. Same
number from the same source; the rider's screen must not compute its own.

**Task 7.3 — bank section connects to admin's.** The submit path already exists
(`api.ts:366–391`). What is missing is the rider seeing its state: submitted and
waiting, connected on a date, or replaced. A rider whose account is sitting
unverified should be able to see that, because otherwise the first they learn of
it is an unpaid payday.

---

## 8. Partner app

**Task 8.1 — new-order push. The real one. DONE, `23ceaa0`.**
`notifyRestaurantNewOrder` / `OrderCancelled` / `RiderArrived` / `RiderWaiting`,
wired at the three placement sites and the cancel through one helper, targeting
the restaurant's **owner user id** — not `restaurantId`, because
`deviceTokenRepository` keys on `userId`.

**A second defect sat underneath this one.** Three spellings of one contract:
the server sent `new_orders`, the rider app creates `new-orders`
(`delivery-mobile/src/lib/orderAlert.ts:20`) and the partner app creates
`kitchen-orders` (`restaurant-mobile/src/lib/orderAlert.ts:39`). The server
matched neither. On Android 8+ a message naming a channel the app never created
is **dropped**, so the MAX-importance channel carrying `new_order.wav`, built
specifically to wake a kitchen, was addressed to a channel that has never
existed on any phone. The rider's no-show warning was going nowhere for the same
reason.

The channel was also chosen from `data.type`, which cannot be right in
principle: a channel belongs to the **recipient's** app, and a customer's
`ORDER_PLACED` and a kitchen's new order are the same moment in two different
apps. Each method now declares its own channel.

**This reaches the owner without a new APK, and that is verified rather than
assumed.** The shipped artifacts were unzipped and their bundles read:
`QuickBites-Partner.apk` contains `kitchen-orders`, `QuickBites-Rider.apk`
contains `new-orders`. Both already create their channel after sign-in and
already register a token, and live `/health` reports
`pushNotifications: configured`. So the fix is server-side only and starts
working on the next Railway deploy, on phones already installed. It is the first
thing on this list that reaches the owner without waiting for a build.

**No money in a kitchen push.** The only total on an order is the customer's,
which includes our markup; printing it to a lock screen makes the markup
derivable by subtracting their own menu prices. Item count only. This is §6.4.2
arriving at step 2 instead of step 8, and it is correct — a rule about what
partners can derive is cheaper to hold from the first push than to retrofit
after.

**Task 8.2 — do not touch the in-app alarm.** The owner has said twice: *"dont
break the sound when the portals receive ordars"*. The sound is the socket path
and it works. Push is a second, independent channel for when the app is closed.
Adding one must not modify the other. Test the sound after this change, with the
app open, before reporting it done.

**Task 8.3 — prove the push arrives on a closed app.** Not a unit test. A real
phone, app force-stopped, order placed. This is the only check that would have
failed today, and it is the only one that counts.

**Task 8.3a — WITHDRAWN as written, 23 Sep. The finding was wrong; half of it
was worth doing anyway.**

> **What was claimed.** That `fcmTransport.ts` makes two bare `fetch()` calls
> with no timeout — true, at `:124` and `:199`, with undici's five-minute
> default — and that both are **awaited inside `placeOrder`**, so a blackholed
> connection to Google would leave a customer on a spinner for minutes on an
> order that had in fact been placed, inviting a second tap.
>
> **Why it is wrong.** `sendPushNotification` does `void this.deliver(record)`
> at `fcmDispatcher.ts:74` and returns the record immediately. Every fetch
> lives inside `deliver`, behind that `void`. So `await notifyOrderPlaced(...)`
> in `placeOrder` awaits building a history record and writing a log line, not
> the network. The comment directly above the `void` says so, and says why.
>
> **How the review reached the wrong conclusion.** Two files were read
> carefully — `fcmTransport.ts` and the call sites in `orderService.ts` — and
> the one line joining them was not. The `await` at the call site was taken as
> evidence about what it awaited.

**Session A settled it with a check rather than a reading**, which is the part
worth keeping. `kitchenPush.test.ts` replaces `deliver` with a promise that
never settles — what a blackholed connection actually looks like — and asserts
the order is placed and the response returns inside two seconds. It passes in
4ms with delivery hung, and mutating `void` to `await` fails it with
*"placing the order took 4019ms with delivery hung"*. So the defect described
above is now impossible to reintroduce silently, which is a better outcome than
the finding being right would have been.

**The timeouts went in anyway, and should have.** 5s on both calls. A hang does
not stall an order, but an un-timed request holds a socket and its buffers for
five minutes, once per device token, on every order. The trigger is a slow
outage — precisely when a platform can least afford a resource leak.

### Two failure shapes this produced, both new

**A test that HANGS is worse than a test that fails.** Session A's first version
of the check did not fail under the `await` mutation — it stopped, and the
runner killed it with no output and no failing line. A failure you can read is
evidence; silence is nothing. The check now carries its own deadline and fails
in four seconds with the elapsed time in the message.

**A suite can print every check passing and exit non-zero.** `kitchenPush`
printed `ALL CHECKS PASSED` and exited **127** — `process.exit()` racing
libuv's teardown on Windows while the deliberately-hung promise was still open.
The runner reads exit codes, so a suite where everything passed would have been
reported as a failure, with a log saying the opposite.

Any suite that leaves a handle open can do this, and **grepping the output would
never show it**. It is the mirror of the `| tail` mistake from earlier in this
project: there, a failure was read as success; here, a success would have been
read as failure. Both come from trusting text over the exit code. Defer the exit
by a tick, as the other suites here already do.
**Task 8.4 — remove ask-to-be-paid, keep the statement.** `SettlementsScreen.tsx`
(nav at `App.tsx:425`) keeps everything read-only. The request control goes.

**Task 8.5 — bank section connects to admin's.** As §7.3, via
`partnerApi.ts:431–451`.

**Task 8.6 — orders appear correctly.** The owner asked that orders "apper
perfectly". This is unspecific, and the order flow was rebuilt this week. Do not
speculate — after §8.1, place a real order and report what the kitchen actually
sees, then ask.

---

## 8B. Customer app — the live map

Asked for on 23 Sep: *"when its too far it shows outside and it dosnt fit in the
box… when partner accepts the order then also customer should be able to see the
map and distance between him and the restaurant, and when driver is on its way
after taking otp and verifying from the partner then the map will start showing
the location of the driver in real time instead of partner. its like zomato."*

Two separate pieces: a fit bug, and a second map phase that does not exist.

### 8B.1 Why the rider falls outside the box

`NativeRiderMap` (`LiveRiderMap.tsx:136–143`) picks a centre and a span:

```
centre     = midpoint of rider and destination
spanMetres = max(400, straightLineDistance * 1.6)
```

and `MapCanvas` turns that into a zoom with `zoomForSpan`
(`nativeMap.ts:173`): `log2(40075016.686 / span)`.

**That formula has no idea how big the map is.** 40075016.686 m is the
equatorial circumference, so the result is the zoom at which the span fills one
256-pixel tile. The actual view is neither 256 pixels nor square — the tracking
map is roughly 190px tall and full-screen wide. Four errors compound, and all
four grow with distance, which is exactly the owner's symptom:

1. **No viewport size.** The fitted span is wrong by the ratio of the real
   width to 256px.
2. **No aspect ratio.** The span is applied as though the box were square. Two
   points separated north–south need to fit the *short* side, and the box is
   much wider than it is tall, so a north–south separation overflows long
   before an east–west one of the same distance.
3. **No latitude correction.** Mercator metres-per-pixel scales with
   `cos(latitude)`. Small in India, not zero.
4. **`* 1.6` is a guess** standing in for padding, applied to a straight line
   regardless of its bearing.

**The drawn fallback map already does this correctly.** `fitZoom(rider,
destination, W, H)` at `LiveRiderMap.tsx:197` takes the width and height. So the
fallback fits and the real map does not — which is why this survived: whoever
tested it on a machine without the native module saw correct behaviour.

#### The fix

**Stop computing a zoom. Let the map fit bounds.** `@rnmapbox/maps`'s `Camera`
takes `bounds: { ne: [lon, lat], sw: [lon, lat], paddingTop/Bottom/Left/Right }`
and handles viewport, aspect ratio and latitude itself.

**Task 8B.1.1 — add fitting to the seam, not to the screen.** `MapCanvas` gains
`fit?: LatLng[]`. Given two or more points it computes the bounding box and
passes `bounds`; `centre`/`spanMetres` stay for callers that want a fixed view,
such as the address picker. The provider stays behind `nativeMap.ts`, which is
the whole point of that file.

A single point in `fit` is a centre, not a box. A zero-area box (two identical
coordinates) must not be passed as bounds — Mapbox zooms to maximum and the map
appears blank. Fall back to `centre` + a floor span.

**Task 8B.1.2 — padding is in pixels and must clear the pin art.** A pin drawn
40px tall anchored at its point still clips at the top edge when its coordinate
is exactly on the boundary. Pad by more than the tallest marker, not by a
percentage of the span.

**Task 8B.1.3 — the check that fails.** Place the two points 8 km apart
**north–south** and assert both are inside the viewport. East–west passes today
and north–south does not, so a test using an arbitrary pair proves nothing.
Assert the projected pixel positions, not that a map rendered.

### 8B.2 The second phase: the restaurant, before the rider has it

Today there is one map and it needs a rider (`LiveRiderMap.tsx:169`). With no
rider it renders a line of text: *"Live location starts once your rider picks
the order up."* The owner wants a map there instead.

| Phase | From | Shows |
| --- | --- | --- |
| **A** | the partner accepts | customer pin + **restaurant** pin, and the distance between them |
| **B** | the rider has collected | customer pin + **rider**, live |

Before the partner accepts, nothing changes. The map appears on acceptance.

**Task 8B.2.1 — the switch key is `pickedUpAt`, not the order status.** It is
already in the tracking payload (`orderRouter.ts:254`), and `isCarrying` in
`riderTrip.ts` uses the same field server-side, so the screen and the server
cannot disagree about which phase an order is in.

Do **not** key it on `OUT_FOR_DELIVERY`. The two-track model exists because
rider progress and food status are different things, and keying a screen on the
food's status is the coupling that produced the original "everything marks
itself done" bug. That is §11.6 — the two-track model is on the do-not-touch
list, and this is what touching it would look like.

**Task 8B.2.2 — BACKEND: the payload has no restaurant location.** The tracking
response (`orderRouter.ts:235–256`) carries `riderCoordinates` and
`destinationCoordinates` and nothing for the restaurant. Restaurants do have
`coordinates` (`shared-types:141`). Add `restaurantCoordinates`.

Phase A cannot be built without this, and it is the only backend change the
whole of §8B needs.

**Task 8B.2.3 — the server stops sending the rider's position before pickup.**
Right now `riderCoordinates` goes out whenever it exists, including while the
rider is still riding to the restaurant on a trip the customer's food is not
part of yet.

Hiding it in the screen is not hiding it: the coordinates are in the JSON that
any customer can read. `pickedUpAt` is the gate the owner described, so apply it
where it is enforceable — `riderCoordinates: order.pickedUpAt ? ... : null`.

The rider's *stage* keeps showing as words ("Your rider is at the restaurant"),
which is what the customer actually needs and discloses nothing precise.

**Task 8B.2.4 — one distance helper, and say which kind it is.** Phase A shows
customer-to-restaurant. Use the same function the rest of the app uses, and
label it — a straight line and a road distance differ by about the 1.3 factor
the deployment is configured with, and a screen saying "2.1 km" next to one
saying "2.7 km" for the same pair is a support ticket.

**Task 8B.2.5 — the component is about to outgrow its name.** It is
`LiveRiderMap` and it will render a map with no rider in it. Rename to
`LiveOrderMap` in the same commit.

This plan already cost twenty minutes to a file called `RatesScreen.tsx` behind
a section called Inflation. A name that lies is cheap to fix on the day it
starts lying and expensive later.

### 8B.3 What must not regress

- **No ETA changes.** Not asked for, and `estimateArrival` is recomputed per
  poll on purpose (`orderRouter.ts:250`).
- **The socket path stays.** Rider pings arrive over the socket and merge into
  tracking state (`OrderTrackingScreen.tsx:131–142`), including the comment
  about a ping arriving before the first fetch. Phase A must not break that
  merge.
- **The drawn fallback keeps working.** Every map in this app degrades to a
  drawn OpenStreetMap view with no token and no native module
  (`nativeMap.ts:15–32`). Phase A needs the same fallback, not a blank card.
- **The map is not the tracker.** The step list above it is driven by the
  order's own status. Nothing in §8B may write to it.

---

## 9. Policies

**Task 9.1 — the promise must match the system.** The owner's wording: money
arrives within 1–2 weeks, and everything owed is paid without asking.

`paymentPolicies.ts` already derives its text from `payoutCadenceDays` through
one helper, which is right. Two edits:

- Line 375 says *"You can raise a request from your statement"*. After §7.1 and
  §8.4 there is no such control. The sentence becomes: everything owed is paid on
  the weekly run, and there is nothing to ask for.
- State the window as the partner experiences it — up to 1–2 weeks between
  earning and receiving, because a weekly run plus a hold period is not the same
  as seven days, and a partner counting days will notice.

Keep it derived. A hardcoded sentence passes its own test and goes stale the
first time a number changes — that is how the daily/weekly mismatch got in.

---

## 10. Order of work

Each step is verifiable before the next depends on it.

| # | Work | Why here |
| --- | --- | --- |
| 1 | §2.1 reproduce Bank; §5.1 reproduce Pay | Two reported defects whose cause is unconfirmed. Everything else is known. |
| 2 | §8.1–8.3 partner push | Smallest well-understood fix. Nothing else depends on it, so it can ship alone. |
| 3 | §2.2–2.4 Bank sections, verify, appears in People and Pay | Nobody can be paid until this works. |
| 4 | §4 COD return | Needs §2 only for where the button sits. |
| 5 | §3 rider settlements back in Money | Reads the accounts §2 connected. |
| 6 | §6.2 rider percentage | Smallest pricing change. Proves the pricing path still holds before the big one. |
| 7 | §6.3 Gold plans | Second pricing change, self-contained. |
| 8 | §6.1 per-item pricing | Largest. Touches the customer's bill and the partner's payout. Last, on a tree where everything else is green. |
| 8b | **§4.4a the two delivery paths** | Promoted. It is the most serious defect open, it makes §3's Settlements read zero, and it makes every ledger figure understate. Do it before §6.1 adds a second price to reason about. |
| 9 | §7 rider app, §8.4–8.6 partner app, §8B customer map, §9 policies | Removals, read-only, and the map. Safe once the money is right. |
| 10 | Gate, verify, **and stop** | See below. |

### Step 10 is held. The owner decides when an APK is built.

Instruction, 23 Sep: *"dont make the apk till i say — after you done making
ill ask question if its verified then make the apk."*

So the sequence is: finish the work, run the gate, report what is done and what
is proved, **answer the owner's questions**, and build only when they say to.
`road-to-launch.md` §3 step 5 still describes how to build; it no longer
describes when.

This is the right way round. The last three builds were made on a belief that
everything was fixed, and one of them shipped a stale screen, one shipped a
secret token, and one was reported successful while having failed. A round of
questions before the build costs an hour; a bad APK costs a reinstall on every
phone the owner has handed out.

Two things worth having ready for that conversation, because they are what the
owner will ask:

- **What reaches them without a new APK.** The kitchen push (§8.1) is
  server-side only and is already verified against the installed artifacts. The
  Railway URL correction affects the web portals only. Anything in admin, rider
  or partner UI needs a build.
- **What is proved versus what is merely written.** Per §11.2, name the check
  that would fail for each claim. "It is built" is not the answer to "is it
  verified".

---

## 11. How not to break what works

Every rule below exists because the thing it prevents happened on this project.

### 11.1 Push before believing

`git log --oneline origin/main..HEAD` must be empty. Nine commits once sat
unpushed while both sessions reported everything fixed and the owner tested a
build containing none of it. A clean `git status` is exactly what that looks
like.

### 11.2a A check must be able to say it failed, in the channel the runner reads

Session A's wording, 23 Sep, and it sits above the list below rather than in it.
The shapes in §11.2 are ways a check can **pass when it should fail**. This is
the case where the check's verdict never reaches the thing deciding.

Two instances on one afternoon, both found by accident:

- **A test that hangs.** Under a mutation it did not fail — it stopped, and the
  runner killed it with no output and no failing line. A failure you can read is
  evidence; silence is nothing. Every deliberately-hung fixture needs its own
  deadline and must print the elapsed time.
- **A suite that printed `ALL CHECKS PASSED` and exited 127.** `process.exit()`
  racing libuv's teardown on Windows with a hung promise still open. The runner
  reads exit codes, so a suite where everything passed would have been reported
  as a failure with a log saying the opposite.

- **A precondition that is merely asserted.** Session A's cash suite drove an
  order to DELIVERED by a path that credits no cash, so the rider held nothing
  and eleven checks passed by comparing zero with zero — including *"the office
  is now holding it"*. Three failed, twenty-three passed, and the suite read as
  mostly fine. A second run had the seeded restaurant on zero commission, so
  every "revenue did not move" check compared nothing with nothing.

  A precondition that fails as an ordinary check lets every dependent check pass
  **vacuously**. It has to **halt the suite**, not add a line to the tally.

Both are the same root: **a channel that cannot express failure.** They are also
the mirror of the `| tail` mistake earlier in this project, where a failed build
was reported as success — there the text was trusted over the exit code, here
the exit code would have been trusted over correct text. The rule covers both
directions: the verdict must travel in the channel the decider actually reads,
and grepping output will not tell you when it did not.

**The sweep was done on 24 Sep, across all 40 suites. It came back clean, and
the clean result is worth recording so nobody repeats it:**

- **Every suite on disk is registered in the runner.** 40 files, 40 entries,
  no orphans. An unregistered suite is the largest false pass available — a
  whole file of assertions that never runs — and there are none. The runner
  also prints `[MISSING]` when it names a suite that is not there, so the
  failure is loud in the other direction too.
- **Exit hygiene is clean.** Every suite that exits on the *success* path
  defers it, and every suite holding a server or socket closes it first —
  including all three that hold listening handles (`sockets`,
  `sockets.security`, `resilience`). The many suites calling `process.exit(1)`
  inside a `.catch()` are not this shape: that is a failure path, and an
  immediate exit there is correct.

> **A false alarm on the way, recorded because the correction is the lesson.**
> `sockets.test.ts` was first flagged here as exiting immediately with an open
> server. It does neither — it disconnects every client, awaits
> `closeSocketServer()`, closes the HTTP server and defers the exit by 100ms.
> The grep that flagged it had truncated the `setTimeout` wrapper out of its
> context window. Same shape as §11.2b in miniature: a tool's output was read
> as a fact about the code without opening the file.

### 11.2 A passing check is not evidence

Six shapes of false pass have been found on this project, all in checks written
by whoever wrote the code:

- A guard that refuses everything passes every refusal assertion.
- A fixture that cannot reach the case — "the rider is not offered a trip" passed
  because the rider was busy and the list was empty for another reason.
- An assertion comparing an object with itself.
- A branch no test touches in either direction.
- An assertion on the wording rather than the value behind it.
- **A stale artifact.** Metro's transform cache survives `expo prebuild --clean`,
  and an APK was built containing a current `App.tsx` beside a stale screen from
  the same commit. `scripts/build-apks.sh` now clears it. Do not remove that.
- **An assertion skipped by its own safety guard.** Found by Session A on 23 Sep
  in a check it had just written:

  ```
  check('addressed to the owner too', !cancelToKitchen || cancelToKitchen.userId === owner?.ownerId)
  ```

  It passed on the first run while the cancellation was returning 404 and no
  notification existed at all. `!x ||` makes the assertion true **precisely
  when the thing it exists to detect is happening**. The idiom reads as
  defensive, which is why it survives review. Assert the value is present, then
  assert what it equals — two statements, not one.

  > **The nuance, from sweeping all 40 suites on 24 Sep.** `!x || ...` is not
  > wrong by itself. It is wrong when **absence is the failure**. When absence
  > is the *success state* it is correct — `regression.test.ts:664` asks
  > whether a restaurant still has pending menu requests, and a restaurant that
  > has dropped out of the pending list entirely is the pass, so `!settled ||`
  > says what it means.
  >
  > **But that line still has a hole**, and it is the one to look for whenever
  > this idiom appears: nothing asserts the request succeeded. `afterBulk.status`
  > is never checked, so a 500 from `/admin/menu-requests/grouped` also produces
  > an absent `settled` and also passes. The sibling check two lines above does
  > assert `bulk.status === 200`.
  >
  > **Rule:** where absence is the success state, assert the *response* before
  > reasoning about the absence. Where absence is the failure, do not use the
  > idiom at all. A blanket ban would cause churn and remove correct code; the
  > question is always which of the two it is.

The check that survives all six is one where the value **moves**. For this plan
specifically:

- Per-item price: assert the customer's total **rose** and the restaurant's
  payout **did not**, in the same test, from the same order.
- Rider percentage: assert the delivery fee rose and rider pay is identical.
- Gold: assert the delivery fee is the discounted number — not that it is zero,
  and not that it is "a number".
- Bank verify: assert an account that was not payable **became** payable, and
  that the previously-connected one **stopped** being payable.

### 11.2b A comment that asserts something checkable gets checked in the same edit

A standing rule, earned by four incidents in one day. It covers any comment
claiming something a grep would settle: a call site, a caller count, a
frequency, a route path, a schema value, an "only place that".

| Claim | Reality | Cost |
| --- | --- | --- |
| `decision: 'APPLY'` | schema is `z.enum(['APPROVE','REJECT'])` | would have 400'd on every tap |
| the pushes are awaited in `placeOrder` | `void this.deliver(record)` | a withdrawn finding and a wrong report to the owner |
| `backfillEarnings()` sweeps at boot | one caller, an admin route | repeated by both sessions from the comment, then committed |
| cash is credited "nowhere else" | true when written, false after the next commit | caught before commit — the first time the loop closed |

All four were checkable in under a minute. None was checked before being
written. The rule is not "write fewer comments" — these comments are why this
codebase is navigable. It is that **prose asserting a fact about code is code
that nothing type-checks**, so the author checks it by hand, at the moment of
writing, or does not make the claim.

A comment that goes stale is worse than no comment, because it is read as
current by everyone who arrives later — which is exactly what happened here,
twice, to people who were being careful.

**A rule is not a mechanism.** Session A wrote *"a check asserting exact rupees
must own every number it depends on"* in one commit message and broke it in the
next, because the new checks set a percentage the old ones had been inheriting.
The rule was right both times. Stating a rule does nothing; the check that
enforces it has to be written. Assume every rule in this section will be broken
by whoever wrote it, and put the guard in the code.

**The rule extends to tool output, not only to prose.** A fifth incident on
24 Sep: `sockets.test.ts` was flagged as exiting with an open handle on the
strength of a grep whose context window had truncated the `setTimeout` wrapper
out of the result. There was no wrong comment to blame — only a window.

That makes it a sharper example than the four above, because it shows what the
rule is actually about: **any secondhand account of the code is not the code.**
A comment, a plan section, a grep result, a test name, another session's
summary. Open the file.

### 11.3 The three numbers that must never converge

Per-item pricing introduces a second price for the same dish. Three totals now
exist, and confusing any two is invisible because the bill still adds up:

1. What the customer is charged — the typed prices.
2. What the restaurant is paid — `partnerItemsTotal`.
3. What we keep — the difference.

Commission and TDS compute on (2). Settlement pays (2). Finance reports (3). Any
place that computes a restaurant's money from what the customer paid is a bug
even when the arithmetic is right.

### 11.4 Two sessions, one tree

- Stage by explicit path. Read `git diff --cached --stat` before committing.
  `git add -A` means "commit whatever the other session is mid-edit in", and it
  has happened.
- Never `git stash` while the other session has uncommitted work.
- Announce before a gate run that matters. Two suites have already failed on
  files changing underneath them.
- Shared files stay additive and announced: `shared-types`, `adminRouter`,
  `pricingConfig`, `pricing-engine`, `App.tsx` in admin.

### 11.5 Do not run the flow suite against the live deployment

It places orders, raises tickets and publishes a grievance officer. The owner's
database is days from real customers. Suites run locally; the live system gets
read-only probes.

### 11.6 Deliberately not being changed

Touching any of these is out of scope and needs the owner to ask first:

- `settlementEvidence` — the guard that stops an unproven order becoming money.
- `dailyPayoutCap` — a fraud control, not a scheduling setting.
- The partner's in-app order sound.
- The rider's two-track trip model (`riderStage` separate from order status).
- `check-apk-secrets.mjs` and the Metro cache clearing in `build-apks.sh`.

---

## 12. What the owner still has to do

Nothing in this plan can substitute for these.

- **Live Razorpay and RazorpayX keys.** Until they exist, no real money can move
  and no Gold plan can be bought. Everything built here is correct and inert
  without them.
- **Rotate the Mapbox `sk.` download token.** It was shipped in three APKs.
- **Seed real data.** One restaurant with a real menu, one rider, one customer,
  registered through the apps. Every "verified" on this project so far was
  observed against local fixtures.
- **Place one real order end to end**, with both sessions watching.
