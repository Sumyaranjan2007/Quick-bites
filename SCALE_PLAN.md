# Quick Bites — Scale & Feature Plan

**Version:** 1.0.0
**Date:** 20 September 2026
**Input:** A reference architecture describing Zomato at peak — 8,400 orders/minute,
80.92 million requests/minute, 300+ microservices, ~11,000 EC2 instances, 5.5 PB.

---

## 0. The honest gap, stated once

That reference document describes a platform serving 300,000 restaurants across
800 cities. Quick Bites today is **one Node process** with an in-memory store
hydrated from Postgres, on a Railway trial with **$4.86 and two days left**, with
**zero restaurants** on it.

Building Kafka, Cassandra, DynamoDB, Flink, an H3 hexagonal index, a
mixed-integer dispatch solver and a Bi-LSTM preparation-time model *now* would
not make this platform better. It would make it unfinishable.

**The reference document says so itself**, in its own Phase 1 and 2:

> *"Do not start with 300 services. Start with one deployable, but with clean
> module boundaries... The two things to get right from day one, because they're
> expensive to retrofit: the order state machine, and idempotency on every
> mutating endpoint."*

Both of those are **already done here**. That is the correct place to be. This
plan is about what comes next, ranked by whether it fixes something *broken*
rather than something *small*.

---

## 1. What the reference describes that you already have

Worth stating, because it changes what is left to do.

| Reference requirement | Status here |
|---|---|
| Order state machine with enforced legal transitions | ✅ `orderStateMachine.ts`, every transition validated |
| Idempotency key on order creation | ✅ Proven under 6 simultaneous requests → 1 order |
| Server-side re-validation of cart at checkout | ✅ `quoteOrder` / `createOrder` price from the live menu |
| Commission and tax snapshotted into the order | ✅ The whole bill is stored on the order record |
| Modular monolith with clean seams | ✅ `modules/{orders,payments,auth,riders,search}` |
| Payment webhook as source of truth | ✅ Signature-verified, idempotent by event id |
| Refund on cancellation, automatic | ✅ Opens a case even when the gateway settles instantly |
| Delivery OTP handover | ✅ 4-digit, refused on mismatch |
| Rider location gated until pickup | ✅ `TRACKABLE_STATUSES`, fails closed |
| Socket authorization per room | ✅ 22 checks; five holes closed |
| Audit log on admin actions | ✅ Actor, reason, before/after |
| Two riders claiming one trip | ✅ Exactly one wins, proven |
| ETA from real distance, not a constant | ✅ Counts the kitchen's promise down; switches to rider position after pickup |

That is most of the reference's *correctness* layer. What follows is what is
genuinely absent.

---

## 2. What is missing and actually matters — ranked

### P0 — An ignored order sits forever

**The single worst gap.** Verified: nothing in the codebase expires an
unaccepted order. If a kitchen never taps Accept, the customer waits
indefinitely, the money is held, and no rider is ever dispatched. There is no
timer, no poll, no auto-resolution.

The reference calls this "Order Inaction" and describes the exact pattern:
push → poll → **auto-reject on a timer** → notify the customer → refund.
Deliveroo hard-rejects at 10 minutes.

**Build:** a sweeper that runs every 30 seconds over orders in `ORDER_PLACED`,
and after a configurable window (`ORDER_ACCEPT_TIMEOUT_MINUTES`, default 8):
cancels with reason `RESTAURANT_DID_NOT_RESPOND`, refunds through the existing
cancellation path, notifies the customer, and records it against the
restaurant's acceptance rate.

This is one file plus a config value. It is the highest-value thing on this list
by a wide margin.

### P0 — A rider offer never expires

`markOfferedToRider` and `declineByRider` exist, but nothing expires an offer.
A rider who opens the app and walks away holds the order in limbo.

**Build:** per-offer timeout (25s), re-offer to the next candidate, an overall
assignment SLA after which operations is alerted, and a `no_rider_found`
escalation. Same sweeper as above.

### P0 — Delivery fraud is undetectable

A rider can mark an order delivered from anywhere. The OTP helps, but a
colluding customer defeats it.

**Build:** at the `DELIVERED` transition, compare the rider's last known
position against the delivery coordinates. Beyond ~200 m, flag into a review
queue rather than blocking — a false block on a real delivery is worse than a
flag. The data is already on the order; this is a comparison and a flag.

### P1 — The wallet is a balance, not a ledger

`walletRepository` mutates `wallet.balance` directly. The reference is explicit:
*"maintain a double-entry ledger, not a balance column."* A balance that is
edited cannot be audited, reconciled or disputed — and when it disagrees with
reality, there is no way to find out why.

**Build:** an append-only `ledger_entries` table; balance becomes a derived sum,
cached. Every credit and debit is two entries. Nothing ever updates a row.

### P1 — No circuit breaker on Razorpay

Every Razorpay call is a raw `fetch`. If Razorpay is slow, order creation and
refunds block behind it. (Order creation was already decoupled — payment is
started explicitly — but refunds still call it inline.)

**Build:** a small breaker: N failures in a window opens it, fallback is "queue
the refund for the operations queue", half-open probe to recover.

### P1 — No kill switches, no feature flags

Nothing can be turned off without a redeploy. The reference treats this as core
operational discipline: *"a switch that drops ETA to a cheap distance-based
heuristic... a switch that stops accepting new orders in one city."*

**Build:** a `settings`-backed flag service, read at request time, with an admin
screen. Minimum flags: `ORDERING_ENABLED`, `ONLINE_PAYMENTS_ENABLED`,
`SEARCH_ENABLED` (falls back to the plain restaurant list), `ETA_MODE`
(`measured` | `flat`), `NEW_REGISTRATIONS_ENABLED`.

### P1 — Real maps and address precision

There is **no map**. `LiveRiderMap.tsx` draws an SVG schematic — a diagram of a
route, not a map. Addresses are typed into a free-text form with no coordinate
capture, which is why every restaurant defaults to the centre of Bengaluru.

The reference spends its longest section on exactly this, because GPS is
accurate to 60–150 m at best and 2–3 km at worst, and last-mile delivery dies on
that error. See §3.

### P2 — Preparation time is a guess typed by the kitchen

The partner types a number. The reference builds a Bi-LSTM for this. The
sensible intermediate: **the restaurant's own historical median for that hour of
day**, falling back to the typed value. No ML, no training data needed, and it
improves the moment the platform has any order history.

### P2 — No payment reconciliation job

Webhooks are verified and idempotent, but nothing sweeps for the case where a
webhook never arrived. The reference: *"build a reconciliation job that runs
continuously against gateway settlement files."*

**Build:** a daily job that fetches Razorpay payments for the period and
compares against local orders, flagging disagreements.

### P2 — Every screen state

Asked for directly. The design system has the components; not every screen uses
all four states. A screen needs **loading / empty / error / success**, and
"error" needs a retry that actually retries.

**Build:** an audit of all screens across the four apps against a checklist, and
fill the gaps. Mechanical, not hard, and it is what makes an app feel finished.

### P2 — Server settings are visible to everyone

Asked for directly. Every app shows a "Server settings" field on its sign-in
screen. A customer should never see it — but it must not be *deleted*, because
it is how any of this gets tested against a local backend.

**Build:** hide it behind a deliberate gesture (long-press the logo for 2
seconds), keep it always visible when `__DEV__`. Hidden from users, one gesture
away for you.

---

## 3. Maps — what it costs and what to build

### Do you need a Google API key? Yes.

There is no map in the apps at all today, so this is new work rather than a fix.

**What is free:** rendering a map with a marker on Android and iOS. The Maps SDK
for Android — which is what `react-native-maps` uses — does not bill for
displaying a dynamic map in a mobile app. A rider dot moving on a real map, with
the route drawn, costs nothing.

**What is billed:** the *data* APIs, each with a monthly free allowance before
charges begin.

| API | What you would use it for | Verdict |
|---|---|---|
| Maps SDK for Android | The map itself, markers, the moving rider | **Free** — build on this |
| Places Autocomplete | The address picker: type "Haroh…", pick a real building | **Billed per session.** Worth paying for — highest impact |
| Geocoding | Address text → coordinates | Billed; mostly avoidable if Places returns coordinates |
| Directions | Road route for the rider line | Billed; optional — a straight line is honest enough at first |
| Distance Matrix | ETA | **Do not use.** You already have an ETA model that costs nothing |

Google requires a billing account with a card **even to use the free tier**.
At your volume you would very likely pay nothing, but the card must be attached.

> Pricing and free-tier structure change; treat this table as the shape of the
> decision and confirm the current numbers in the Google Cloud console before
> relying on them.

### How to get the key

1. **console.cloud.google.com** → create a project, e.g. `quick-bites`.
2. **Billing** → link a billing account (card required; free tier still applies).
3. **APIs & Services → Library** → enable **Maps SDK for Android**, and
   **Places API** if you want the address picker.
4. **APIs & Services → Credentials** → **Create credentials → API key**.
5. **Restrict the key immediately** — this is not optional. Application
   restriction → **Android apps**, and add each package with its SHA-1:
   `com.quickbite.app`, `com.quickbite.partner`, `com.quickbite.rider`,
   `com.quickbite.admin`. API restriction → only the APIs you enabled.
   An unrestricted key on a public repo is somebody else's bill.
6. Get each SHA-1 from the signing keystores:
   `keytool -list -v -keystore C:\Users\priya\quickbites-keystores\quickbites-customer.jks`

The key goes in `app.json` per app as `android.config.googleMaps.apiKey`, read
from an environment variable at build time — never committed. `check-secrets.mjs`
will enforce that.

### What to build with it

- **Customer** — a real tracking map; an address picker with Places autocomplete
  that captures true coordinates instead of a typed line.
- **Partner** — pin the kitchen on a map at registration. This alone fixes the
  "every restaurant is at the centre of Bengaluru" defect.
- **Rider** — the pickup and drop pins, and a "Navigate" button handing off to
  Google Maps (free, and better than anything we would draw).
- **Admin** — the live ops map the reference describes: orders by state, riders
  by status.

---

## 4. Deliberately not building yet — and why

Being explicit so nobody mistakes absence for oversight.

| Not building | Why not |
|---|---|
| Kafka / Cassandra / DynamoDB / Flink | They solve throughput problems you do not have. You have zero restaurants and a $4.86 balance. Postgres will carry you to thousands of orders a day |
| 300 microservices | The reference explicitly says not to start here |
| Bi-LSTM prep-time model | Needs tens of thousands of historical orders. You have none. The historical-median approach in P2 is the honest first step |
| LightGBM ETA model | Same. The current ETA is already derived from real distance and a live prep countdown |
| MIP dispatch with batching | Needs many concurrent orders and riders to have anything to optimise |
| H3 / geohash sharding | Redis GEO or a simple distance filter is correct until a single city has thousands of live riders |
| Multi-region, pre-scaling, chaos testing | Meaningful once there is traffic to protect |

**The trigger to revisit:** sustained 50+ orders/day, or a single restaurant
with 10+ concurrent orders. Until then this list is a distraction.

---

## 5. Security pass

Beyond what already exists (socket authorization, rate limits, OTP hardening,
webhook signature verification, secret scanning of source *and* built binaries):

- **Masked phone numbers.** Today a rider sees the customer's real number and
  vice versa. The reference uses masked numbers via a telephony proxy. Interim:
  show the number only while the order is live, and stop showing it at all once
  delivered.
- **Rate-limit registration**, not just sign-in. Partner and rider registration
  are open endpoints that write to the database.
- **PII in logs.** Audit what is written. Phone numbers are already masked in
  OTP logs; addresses and names are not.
- **Restrict the Maps API key** (§3) — an unrestricted key is a direct bill.
- **Document upload limits.** Confirm size and type are enforced server-side,
  not only in the app.
- **Account deletion** — a Play Store requirement and a legal one under Indian
  data rules. There is an in-app path; a web path is still needed.

---

## 6. Sequencing

Ordered so each phase is independently shippable and testable.

**Phase A — Correctness (no new dependencies, ~1 session)**
Order inaction timeout · rider offer expiry · delivery GPS fraud flag ·
registration rate limit. These are bugs, not features.

**Phase B — Operability (~1 session)**
Kill switches and feature flags · admin flag screen · circuit breaker on
Razorpay · reconciliation job.

**Phase C — Maps (~1–2 sessions, needs the Google key)**
Address picker with real coordinates · customer tracking map · partner kitchen
pin · rider navigation handoff · admin live ops map.

**Phase D — Polish (~1 session)**
Every screen's four states · hide server settings · prep-time from history ·
masked contact numbers.

**Phase E — Ledger (~1 session)**
Double-entry ledger, balance derived. Isolated deliberately, because touching
money deserves its own change and its own tests.

**Then:** rebuild all four APKs, re-run the full gate, launch-verify, and
redistribute.

---

## 7. What this needs from you

| Thing | Needed for | Notes |
|---|---|---|
| Google Cloud billing account + Maps API key | Phase C | Card required even for free tier |
| A decision on the Railway trial | Everything | $4.86 / 2 days left. Postgres draws from it too |
| Masked-calling provider (optional) | Security | Exotel/Knowlarity in India. Or defer with the interim measure |
| SMS provider + TRAI DLT | Real OTP | Long pole, unchanged from `OWNER_ACTIONS.md` |

---

## 8. What does not change

Every item above is additive. The order state machine, idempotency, the pricing
engine, socket authorization and the 728-check verification gate stay exactly as
they are — and every phase above ends by running that gate, with new checks
added and each one deliberately broken first to prove it can fail.
