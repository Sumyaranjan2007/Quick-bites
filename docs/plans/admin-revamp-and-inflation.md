# Admin revamp, per-item inflation, and the three apps

Written 23 Sep 2026 against commit `c953bd0`, from the owner's list of 23 Sep.
**Session B wrote this and will not implement it. Session A implements.**

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

So the overwhelmingly likely cause is that **the live database is empty** — no
rider or restaurant has ever submitted an account — and the screen renders an
empty state that looks identical to a failure.

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

Each pending row shows holder name, account last 4, IFSC or VPA, the owner's
name and city, when it was submitted, and the advice string the route already
returns — shown as advice, never as a decision.

Each segment label carries its own count. A single badge on the nav item hides
which queue is full.

### 2.3 Verify

One button, `Verify & connect`. It calls the existing
`POST /admin/payee-accounts/:id/review` with `decision: 'APPLY'`.

**Task 2.3.1 — check `APPLY` does not require RazorpayX.** Read
`payeeAccounts.ts` around lines 490–560. If applying is gated on
`isRazorpayXConfigured()` or on `validationStatus === 'VERIFIED'`, that gate must
be removed for the manual path, because there are no live keys and the owner's
tap is now the verification. If it is already ungated, change nothing.

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

Add a fifth Money item, `Settlements`, with two segments — Riders and
Restaurants — because the restaurant half already has routes
(`financeRoutes.ts:622–800`), and splitting them across two nav entries is what
made one of them easy to lose.

Each rider row: name and phone, trips not yet settled, amount owed, cash still in
hand, the connected bank account (§2.4), and when they were last paid. A rider
holding cash is shown but not payable, with the existing reason text.

**Do not touch `settlementEvidence`.** It is the guard that stops an order
becoming money owed without proof it happened, and it was written to replace a
scan for `DELIVERED` that paid for orders that had not been collected.

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
changes *location*, not *ownership*.

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

**Task 6.1.6 — a restaurant changing its own price clears the typed price on
that item.** The owner's rule, decided 23 Sep: *"whenever price changed by the
restaurant the inflation over that item will be removed and we can again apply
on them"*.

This is the right rule and it is safer than flagging. A typed price is
absolute, so a kitchen raising ₹200 to ₹260 against a typed ₹240 means paying
out more than we collect — and it stays wrong until somebody notices. Clearing
the override makes that state unreachable rather than merely visible.

After clearing, resolution falls through §6.1.2 normally: the restaurant's own
`foodMarkupPercent` if one is set, otherwise their raw price. **The percentage
is deliberately left alone.** It is relative, so it can never go stale against a
new price the way an absolute figure can — 20% of ₹260 is still 20%. Only the
typed number is the thing that rots.

**Task 6.1.6a — the removal goes in `menuRepository.updateItem`, not in a
route.** Five call sites can change an item's price today:
`restaurantRouter.ts:506`, `catalogRoutes.ts:133`, `:378` and `:510`, plus the
`addItem` paths. A rule written into one route leaves four ways to keep a stale
override, and the whole point of 6.1.6 is that the dangerous state is
unreachable. One choke point, or this is not done.

**Task 6.1.6b — clear on a price CHANGE, not on any edit.** `MenuItemSchema` is
`.partial()`, so the body may carry `price` or not, and may carry the same price
it already had. Compare the stored value to the incoming one. Renaming a dish,
editing a description, swapping a photo or toggling availability must not wipe
a markup — a partner fixing a typo should not cost the platform its margin on
that dish.

**Task 6.1.6c — the owner must be TOLD, every time.** This is the cost of the
rule and it has to be paid. A partner repricing at 11pm silently removes the
platform's margin on that dish, and every order after that earns commission
only. Nothing anywhere would say so.

Raise it where the owner already looks: a count on the Inflation nav item, and a
list at the top of the section — *"4 items lost their markup because the
restaurant changed the price."* Each row shows the dish, what the customer used
to pay, what the platform used to keep, and the restaurant's new price.

**Task 6.1.6d — re-applying must be one tap, with the arithmetic already done.**
Each row offers a suggested new customer price that preserves what the platform
was keeping — same margin in rupees, and same margin as a percentage, both
offered — plus a free field. Re-pricing sixty dishes by hand with a calculator
is a job nobody does, and markups that are never re-applied are the same as
markups that were deleted.

**Task 6.1.6e — record every removal, because there is an incentive here.** A
partner who works out that nudging a price by ₹1 removes the platform's markup
has a direct financial reason to keep nudging. Not a hypothetical: the rule is
public to anyone who compares two bills.

Write an audit entry on every clearing — dish, old price, new price, who
changed it, when. Then surface a restaurant whose items repeatedly lose their
markup. A pattern is obvious in a list and invisible one notification at a time.

**Note on orders already placed.** None are affected. The customer's price is
computed at placement (`orderService.ts:154`) and stored on the order, so a
price change mid-delivery cannot alter a bill that has already been agreed. A
cart not yet checked out re-prices at checkout, which is existing behaviour and
correct — the customer pays what the menu says when they pay.

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

**Task 8.1 — new-order push. The real one.** Write `notifyRestaurantNewOrder` on
`fcmDispatcher` and call it where the order is created (`orderService.ts:561`),
targeting the restaurant's **owner user id** — not `restaurantId`, because
`deviceTokenRepository` keys on `userId`.

Then the rest of what a kitchen needs to be told: cancelled by the customer,
rider arrived, rider waiting. Each one targets the owner user id.

**Task 8.2 — do not touch the in-app alarm.** The owner has said twice: *"dont
break the sound when the portals receive ordars"*. The sound is the socket path
and it works. Push is a second, independent channel for when the app is closed.
Adding one must not modify the other. Test the sound after this change, with the
app open, before reporting it done.

**Task 8.3 — prove the push arrives on a closed app.** Not a unit test. A real
phone, app force-stopped, order placed. This is the only check that would have
failed today, and it is the only one that counts.

**Task 8.4 — remove ask-to-be-paid, keep the statement.** `SettlementsScreen.tsx`
(nav at `App.tsx:425`) keeps everything read-only. The request control goes.

**Task 8.5 — bank section connects to admin's.** As §7.3, via
`partnerApi.ts:431–451`.

**Task 8.6 — orders appear correctly.** The owner asked that orders "apper
perfectly". This is unspecific, and the order flow was rebuilt this week. Do not
speculate — after §8.1, place a real order and report what the kitchen actually
sees, then ask.

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
| 9 | §7 rider app, §8.4–8.6 partner app, §9 policies | Removals and read-only. Safe once the money is right. |
| 10 | Gate, build, verify, deliver | `road-to-launch.md` §3 step 5, unchanged. |

---

## 11. How not to break what works

Every rule below exists because the thing it prevents happened on this project.

### 11.1 Push before believing

`git log --oneline origin/main..HEAD` must be empty. Nine commits once sat
unpushed while both sessions reported everything fixed and the owner tested a
build containing none of it. A clean `git status` is exactly what that looks
like.

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

The check that survives all six is one where the value **moves**. For this plan
specifically:

- Per-item price: assert the customer's total **rose** and the restaurant's
  payout **did not**, in the same test, from the same order.
- Rider percentage: assert the delivery fee rose and rider pay is identical.
- Gold: assert the delivery fee is the discounted number — not that it is zero,
  and not that it is "a number".
- Bank verify: assert an account that was not payable **became** payable, and
  that the previously-connected one **stopped** being payable.

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
