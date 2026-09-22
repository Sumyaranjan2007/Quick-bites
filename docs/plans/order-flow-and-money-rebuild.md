# Quick Bites — order flow, banks, payouts and inflation

Owner decisions captured 2026-09-22. Two sessions, one tree.
**Session A = money.  Session B = experience.**
Neither session edits the other's files. Shared files are additive-only and named in §6.

---

## 0. The three confirmed defects

| # | Symptom the owner sees | Actual cause |
|---|---|---|
| 1 | Rider accepts and the order marks itself done; kitchen cannot tap anything; OTP says "not prepared" | `orderRepository.assignRider()` sets `order.status = 'RIDER_ASSIGNED'` unconditionally. `VALID_TRANSITIONS.RIDER_ASSIGNED` allows only `OUT_FOR_DELIVERY` or `CANCELLED`, so `PREPARING` and `READY_FOR_PICKUP` become unreachable. Rider assignment is modelled as a stage of the food, when it is a parallel track. |
| 2 | "Ask to be paid" goes nowhere | `listRequests` is served at `payoutRoutes.ts:508`. **No admin screen calls it.** The request is stored and never surfaced. |
| 3 | Submitted bank accounts never appear in admin | `payeeAccounts.reviewQueue()` filters to `NAME_MISMATCH` or `UNVERIFIED` only. An account that passes the automatic check is never listed, and no admin action exists that "applies" an account. |

---

## 1. Order flow — one track becomes two

### 1.1 The food track (`order.status`)

```
PAYMENT_PENDING -> ORDER_PLACED -> ACCEPTED -> PREPARING
  -> READY_FOR_PICKUP -> HANDED_TO_RIDER -> OUT_FOR_DELIVERY -> DELIVERED
```

- `RIDER_ASSIGNED` is **removed** from `OrderStatus`.
- `HANDED_TO_RIDER` is **added**.
- Kitchen taps, in order: **Accept -> Start preparing -> Ready -> Handed to rider** (owner's choice).
- `OUT_FOR_DELIVERY` is set by the **rider** confirming pickup, only after the kitchen tapped `HANDED_TO_RIDER`. Both sides confirm the handover, which is what settles "he never collected it" disputes.
- Delivery OTP continues to require `OUT_FOR_DELIVERY` — now genuinely reachable.

**Migration (mandatory).** Persisted orders already carry `status: 'RIDER_ASSIGNED'` in the JSON snapshot. On load, map `RIDER_ASSIGNED -> READY_FOR_PICKUP` and keep `riderId` / `riderStage`. Without this, every in-flight order breaks on the first boot after deploy.

### 1.2 The rider track (`order.riderStage`)

```
UNASSIGNED -> OFFERED -> HEADING_TO_RESTAURANT -> AT_RESTAURANT
  -> PICKED_UP -> AT_DOORSTEP -> DELIVERED
```

- `assignRider()` **must not touch `order.status`**. It sets `riderId`, `riderName`, `riderPhone`, `riderPayout`, `riderStage`, `riderAssignedAt` and nothing else.
- A rider accepting shows in the customer app as a **separate line**: "Rider assigned — Imran is on the way to the restaurant." It does not advance the food.

### 1.3 Dispatch

- Riders are offered the trip when the food reaches **READY_FOR_PICKUP** (owner's choice).
- Editable per restaurant: `riderOfferAtStatus` in {`ACCEPTED`, `PREPARING`, `READY_FOR_PICKUP`}, default `READY_FOR_PICKUP`. No lead-time countdown — you cannot know when "ready" will happen, so the trigger is a status, not a timer.
- Offer to the nearest N free riders. On decline, or on `riderOfferTimeoutSeconds` (editable, default 45), widen the radius and offer the next set. A decline never returns that trip to that rider.
- **Never auto-cancel.** The search widens indefinitely.
- After `noRiderEscalateMinutes` (editable, default 10) the order raises an admin attention flag.
- Customer copy while unassigned: *"It's a little busy right now — we're finding you a rider."*

### 1.4 What the customer sees

Two strips, not one list. The food track with four ticks, and the rider track alongside it showing assigned / at restaurant / picked up / near you. Order-history buttons must sit inside the safe area (existing complaint).

---

## 2. Banks — review and apply

New admin section **Banks**, replacing the review-only screen.

- Lists **every** submitted account from riders and restaurants, in any state — never only the failures.
- Row shows: who, role, partner code, method (bank / UPI), masked detail, and the automatic name-check result **as advice**.
- Two actions: **Apply** and **Reject** (reason mandatory, shown to the partner).
- New fields on `PayeeAccount`: `appliedByAdminId`, `appliedAt`.
- **The gate:** every payout execution path refuses an account without `appliedAt`. Passing the automatic check never makes an account payable on its own.
- Applying an account makes it that payee's receiving account; applying a second one moves it.

---

## 3. Getting paid

### 3.1 Rider earnings — three things only

Collapse today's seven screens to:

1. **Cash in hand** — `sum(cash collected) - sum(their cut on those orders) - sum(deposits marked received)`. Tapping it shows what they are carrying and what to hand over.
2. **Statement, trip by trip** — every trip, what it paid, whether it is settled.
3. **Ask to be paid** — pre-filled with everything still unpaid.

Retire `SettlementScreen` and `WeeklyTripsScreen`; hide the incentive screen while no incentive is live (all five are `enabled: false`).

### 3.2 Cash netting — OWNER DECISION, WITH A FLAG

Owner chose: **the rider keeps their cut out of the cash they collected and owes the rest.**

- "Ask to be paid" therefore covers **only online-paid orders where their cut has not reached them.** Cash orders are already settled in the rider's hand.
- **This contradicts the existing rider policy document**, which promises earnings are never netted against cash owed. That policy text must be rewritten to describe what the code actually does, in the same commit. A policy describing a different system from the one running is worse than no policy — it is the document a partner would quote in a dispute.

### 3.3 Admin: Payments to make

New admin section listing every open payout request: who, role, amount, which applied account will receive it, method, when asked.
Pay -> RazorpayX -> ledger entries -> receipt to the partner naming the bank or UPI that received it.
Restaurants use the identical flow.

---

## 4. Inflation — replaces Rates

Per restaurant:

| Lever | Restaurant receives | We keep |
|---|---|---|
| Food markup % | their menu price | the markup |
| Packaging | their declared fee | our added amount |
| Delivery | — | customer delivery price minus rider cost |
| Platform charge | — | all of it |
| Restaurant GST % | passes through to them | nothing |
| Platform GST % | — | ours, **toggle, default OFF** |

Global tabs inside Inflation: **Rider pay** (the ~25 platform rates — the cost side of delivery margin), **Gold plans**, **Bonuses**.

Every restaurant row shows a live worked example: what the customer pays, what the restaurant gets, what we keep.

### 4.1 GST — the one hard line

Platform GST stays **off and unsettable** until a GSTIN is stored, and the bill line then carries that GSTIN. A bill showing "GST" on money not remitted to the government is invoice fraud, and the exposure is criminal rather than civil. The restaurant's own GST is a genuine pass-through and is unaffected.

Commission and TDS continue to be computed on the **restaurant's own price**, never the inflated one.

---

## 5. Admin attention badges

Every section reports a count, not just some. Session B builds the mechanism; Session A supplies the money counts (banks awaiting apply, payout requests open, cash deposits awaiting receipt).

---

## 6. Division of work

### Session B — experience
- `OrderStatus` change, `orderStateMachine.ts`, snapshot migration
- `assignRider()` stops writing `status`
- Restaurant portal: four steps
- Customer tracking: two parallel strips, busy message, order-history safe area
- Dispatch engine: offer-at-status, widening, timeout, no-rider escalation
- Admin badge mechanism
- Partner profile fields, address map picker, support flow

### Session A — money
- Banks: list-all, apply / reject, `appliedAt` gate on every payout path
- Payments-to-make admin section wired to `listRequests`
- RazorpayX execution and receipts
- Rider earnings collapsed to three; cash-in-hand maths; cash-excluded "ask to be paid"
- Rider policy rewrite for netting
- Inflation section: per-restaurant levers plus rider pay / Gold / bonuses tabs
- GST split (partner pass-through vs platform charge, GSTIN gate)
- Per-restaurant customer delivery price and margin

### Shared files — additive only, announce before touching
- `packages/shared-types/src/index.ts` (B adds statuses; A adds payee and charge fields)
- `apps/admin-mobile/App.tsx` (nav entries)
- `apps/backend-api/src/routes/adminRouter.ts` (mounts)

---

## 7. Gate before any APK

Both sessions independently: `turbo run typecheck --force`, the full backend suite, the contract test, and mutation spot-checks on the new payout gate and the state machine. Each session reads its own output. Then four APKs as **updates** — same package names, same signing keys.

---

## 8. What was actually built, as of 02ed894

Recorded because a plan nobody updates becomes a description of a system that
does not exist, and this one is the only written record of the owner's
decisions.

### Built and live on Railway
- Settlement gate: an order becomes money owed only with evidence the food
  moved (`pickedUpAt`) **and** the money arrived. Refusals appear as a blocker
  on `/payments/overview`, with a release path that records who decided and why.
- Two-track order flow, kitchen's four taps, dispatch offer point per
  restaurant, migration across both hydration paths (Session B).
- Food, packaging and delivery markup. Restaurants are paid on their own
  prices; commission and TDS are never computed on inflated figures.
- Rider pay driven by the configurable rates. Bonuses off by default.

### Known gaps, named to the owner rather than hidden
- **Banks review-and-apply** — accounts still surface only when the automatic
  check fails, and there is no Apply action.
- **"Ask to be paid" has no admin screen.** `GET /api/admin/payouts/requests`
  exists; nothing calls it.
- **Payout-deduction ledger bug**, `financeRoutes.ts:703`. A payout with
  deductions reduces the rider's stored cash figure and posts nothing to the
  ledger, so the books overstate cash the rider has already returned. Nobody is
  over- or underpaid; the cash-in-hand total drifts. Fixing it and building the
  owner's netting model are the same commit.
- Rider earnings not collapsed to three sections; Inflation section not built;
  GST split not built.

### Owner actions no amount of code replaces
RazorpayX live keys; Firebase project and the four `google-services.json`
files; Maps billing with Places and Distance Matrix enabled; removing
`ALLOW_PLATFORM_RESET` from Railway.

### Two process rules this round cost us
1. **Verify against the deployed system, not the tree.** Nine commits sat
   unpushed while both sessions reported work "green and verified". `git
   status` says nothing is wrong, because nothing is wrong locally.
2. **A green suite is not evidence a rule is tested.** Four distinct shapes of
   this appeared in one day: a guard that refuses everything, a fixture that
   cannot reach the case, an assertion comparing an object with itself, and a
   branch no test touched in either direction. Only mutation testing caught any
   of them.
