# Launch readiness — load, safe updates after launch, attacks and payments (22 Oct 2026)

> **Where files live:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md). Hosting facts: [`docs/ops/OPS_GUIDE.md`](../ops/OPS_GUIDE.md).
> Companion to the feature plan [`round6-help-chat-notifications-location-2026-10-22.md`](round6-help-chat-notifications-location-2026-10-22.md).

**Status:** research and discussion, **nothing built**. Every number below was measured on 22 Oct 2026 on this PC
(commit `bf86b17`) by running the real server code, or read from the code at the line given. Railway's machines
are roughly comparable per core; treat the numbers as ±50 %, the trend as exact.

---

## For the owner, in one screen

| Question | Short answer |
|---|---|
| **1. Can it take launch day (10,000+ accounts) and 1,000+ orders a day, 500 at once?** | **Launch day: yes.** 10,000 accounts is about 3 MB. Restaurant lists answered in ~60 ms with 100 people asking at once. **The problem is time, not day one:** the server keeps every order ever placed in memory and re-checks *all* of them on every money action. At 1,000 orders a day it is slow after about **1 month**, and it **chokes at lunch/dinner peaks after about 2–3 months** (each money action freezes the whole server for 1.6 s at 90,000 orders; at 6 months 3.9 s). This must be fixed **before launch**: ~1–2 weeks of work, plan in Part 1.4. Railway's bigger plan does **not** fix it: the server uses one CPU core no matter how many Railway gives it. |
| **2. How do we update safely once real customers are on it?** | Today every push to `main` goes straight to live, there is no test copy of the live system, and no way to force old apps to update. After launch we need: a **staging** copy on Railway (own database), changes go there first; apps released to testers, then **5 % → 20 % → 50 % → 100 %** of users with a halt button; old apps keep working (already our rule) plus an **"update required"** switch for when they cannot; deploy outside meal hours; a database restore point before every release. Part 2. |
| **3. Are we ready for competitors attacking, overloading or abusing it, and for every payment state?** | **Partly.** Strong today: payment webhooks are signature-checked and never applied twice; a lost payment message is recovered by asking Razorpay every 3 min; double charges are refunded; sign-in guessing is limited per account and per network address; private data rules held up in review. **Missing:** no shield in front of the server (one process takes every flood itself), no second factor on Operations accounts, nothing stops fake cash-on-delivery orders or first-order-coupon farming from throw-away email accounts, sign-in emails can be burnt by bots, refunds are marked "done" before Razorpay confirms (a failed refund is never noticed), chargebacks are not tracked, Razorpay is still on **test** keys. Part 3. |
| **Launch blockers found today (outside the code)** | **Brevo's free plan sends 300 emails a day** ([Brevo pricing, 2026](https://www.sender.net/reviews/brevo/pricing/free-plan)); sign-in codes go by email (`OTP_PROVIDER=email`). 10,000 sign-ups on day one stop after the first 300. Check which Brevo plan is on the account; Starter (~$9/month, no daily cap) or SMS before launch. **Razorpay live keys** are still not set. |

---

## 1. Load: launch day and the months after

### 1.1 How the server works (why this matters)

One Node.js process on Railway holds **the whole database in memory** (`apps/backend-api/src/db/client.ts`) and copies
changes into one Postgres table (`db/postgresStore.ts`, `store_documents`). That design is fast while small and is why
the app feels instant today. Its limits:
- It can never run as two copies (`docs/ops/OPS_GUIDE.md` §1): growth only by a bigger single machine.
- JavaScript runs on **one CPU core**. Railway Pro offers up to 24 vCPU / 24 GB per replica
  ([Railway docs](https://docs.railway.com/pricing/plans)); the extra cores sit idle for us. Memory does help.
- Every money action (order placed online, each kitchen status, each rider offer, pickup, delivery, every Operations
  write — `middlewares/durable.ts`, 12 `persistDurably()` sites) runs a **"full re-check"**: it turns **every stored
  document** into text and compares it with the saved copy (`postgresStore.ts:256-288`), and nothing else runs meanwhile.
- Other code also reads every order or every money line each time: the cooking-time estimate on every price quote
  (`modules/orders/eta.ts:62-74`), the coupon checks (`couponService.ts`), the money balances (`ledger.ts:251-276`:
  each balance copies the whole ledger; "who is owed" does that once per partner/rider), and the duplicate check on every
  money line (`ledger.ts:117`).

### 1.2 What was measured (22 Oct, real server code, one real order cloned into history)

One delivered cash order stores **6.2 KB**: the order (2.4 KB) + 8 money-ledger lines (3.7 KB). Audit lines, chats and
help tickets come on top, so real growth is a bit faster.

| Orders stored | At 1,000/day | Freeze per money action | Server time per order, placed → delivered | 50 price quotes at once (each) | 100 restaurant lists at once | Memory |
|---|---|---|---|---|---|---|
| 10,000 | ~10 days | 0.16 s | 0.8 s | 0.34 s | 0.06 s | 0.35 GB |
| 30,000 | ~1 month | 0.50 s | 2.6 s | 0.9 s | 0.06 s | 0.8 GB |
| 90,000 | ~3 months | 1.6 s | 7.5 s | 2.9 s | 0.07 s | 2.0 GB |
| 180,000 | ~6 months | 3.9 s | 15 s | 5.8 s | 0.05 s | 4.0 GB |

What that means at a dinner peak (say 250 orders in an hour, ~0.07 orders a second):
- **Month 1:** 2.6 s × 0.07 ≈ 18 % of the one core on order handling alone. Fine, but quotes already feel slow.
- **Month 3:** 7.5 s × 0.07 ≈ 52 % on orders, plus every quote 3 s, plus balances screens → screens hang, live tracking
  stutters (every freeze stops the sockets too), riders' position updates queue up.
- **Month 6:** more than one core's worth of work at peak: the server falls behind and stays behind until the rush ends.

"500 orders at a time" on its own (500 live orders, ~500 riders sending a position every 3 s ≈ 170 small requests a
second, plus customers watching) is within what one process serves **if the freezes above are gone** — position updates
are cheap and not behind the full re-check. Not yet measured with a real 500-rider simulation: part of 1.5.

### 1.3 Other launch-day limits found

| Limit | Today | Risk | Fix |
|---|---|---|---|
| Sign-in emails (Brevo) | free plan 300/day if that is the plan | launch-day sign-ups stop | owner: Brevo Starter or SMS (MSG91 DLT) before launch |
| Requests per network address | 1,500/min per IP (`rateLimiter.ts:150-155`), 100/min per signed-in account | Jio/Airtel put many phones behind one address (CGNAT); a busy tower at lunch could hit 1,500 | raise to ~6,000/min per IP (per-account limit stays the real guard); revisit with Cloudflare (3.2) |
| Database connections | pool of 5 (`postgresStore.ts:165`) | fine: saves are batched | none |
| Push notifications (Firebase) | free, no practical cap | none | none |
| Google Maps | ~₹0.85 per motorbike route, 1–3 per order, cached 6 h (round 5) | **cost**, not capacity: ~₹1,700/day at 1,000 orders before list distances | owner: set a Google Cloud budget alert; check the monthly free usage per API in the billing console |
| Push history kept in memory | every push ever sent (`fcmDispatcher.ts:95,103`) | slow memory leak until restart | keep the last 500 only |

### 1.4 What to build before launch (capacity)

| # | Change | Effect | Size |
|---|---|---|---|
| C1 | Money actions save **only what changed** (the change tracking already exists, `client.ts:203-302`); the full re-check stays as a safety net on the 10-minute timer, run in small slices so it never freezes the server | removes the growing freeze from every order; the measured 0.16–3.9 s becomes a few ms | small, careful (money durability) |
| C2 | **Indexes kept beside the data**: ledger balance per account and ledger lines by key (updated on each post), last 20 cooking times per kitchen (updated on READY), each customer's orders (for coupons and history) | quotes, coupons, balances stop scanning everything | medium |
| C3 | **Old orders leave memory**: delivered/cancelled orders older than 30 days (and their chat) stay in Postgres only; the few screens that show old orders (history, statements, invoices, admin search) read them from Postgres by page | memory and every remaining scan stay flat however long the platform runs | medium–large; do after C1–C2 |
| C4 | Cap the in-memory push history (500) | no leak | tiny |
| C5 | `/health` reports **event-loop delay** (Node's `monitorEventLoopDelay`) and Operations gets an alert above 200 ms | you see slowness before customers do | tiny |
| C6 | Raise the per-IP limit (1.3) | no false "too many requests" on busy towers | tiny |

C1, C2, C4–C6 before launch; C3 within the first month after.

### 1.5 Prove it before launch: a load test

On a **staging** copy (2.1), never live: load 150,000 synthetic orders, then a script (k6 or a Node script like the one
used for 1.2) simulating a dinner rush — 2,000 customers browsing and quoting, 300 orders an hour placed and delivered,
500 riders sending positions every 3 s, 30 kitchens, 3 Operations screens open — for 30 minutes. **Pass:** p95 under
500 ms for lists, quotes and order actions; event-loop delay under 100 ms; no errors; memory flat. Repeat before every
big release.

---

## 2. Updating safely after launch

### 2.1 What exists and what is missing

| | Today | Needed after launch |
|---|---|---|
| Server releases | push `main` → live at once | **staging first**, live only after checks |
| Test copy of live | private QA server on this PC only | Railway **staging environment** (own Postgres, own keys in test mode) |
| App releases | closed test on Play | internal test → closed test → **staged rollout** with halt |
| Old apps | server only adds fields (rule, CLAUDE.md §8) | plus a **minimum version** switch and an "Update required" screen |
| Database safety | daily/weekly/monthly backups + point-in-time restore (OPS_GUIDE §2) | a restore point noted before each release; restore test every 3 months |
| Switching a feature off | kill switches exist (`middlewares/featureGate.ts`, `featureFlags.ts`) | use them for every risky new feature (off by default, on after checks) |
| Release timing | any time | never 12:00–14:30 or 19:00–22:30 IST (OPS_GUIDE §3) |

### 2.2 The release recipe (after launch)

1. **Build on a branch**, gate green (`node scripts/run-backend-tests.mjs`, typecheck, secrets).
2. **Merge into `staging`** → Railway staging deploys it (own database with copied *settings* and synthetic orders —
   never real customers' personal data). Run the load test (1.5) for big changes.
3. **Apps for staging**: the same release APK pointed at staging through the hidden Server settings (6 taps on the
   logo; already in all apps) — testers use it on their phones; or the Play **internal testing** track.
4. **Checklist on staging**: the end-to-end flows (order online + cash, cancel, refund, payout, help chat, notifications,
   tracking) — the Tester list in `docs/TESTING.md`.
5. **Server to live** (outside meal hours): merge `staging` → `main`. Note the time first (point-in-time restore).
   `/health` new uptime; 5 minutes of logs; one real check that only the new code answers.
   **Rollback:** Railway → Deployments → previous → Redeploy (kept 5 days), then `git revert`.
6. **Apps to live**: Play production **staged rollout** 5 % → (24 h, check crashes in Play Console → Android vitals)
   20 % → 50 % → 100 %. A bad build: **Halt rollout** ([Google Play help](https://support.google.com/googleplay/android-developer/answer/6346149)) —
   halting stops new installs but does **not** undo phones that already updated, so the server must keep serving that
   version until the fix ships. iPhone: TestFlight, then App Store phased release (7 days).
7. **Old app versions**: the server must keep answering the last two app versions. When it truly cannot, raise the
   minimum version (new switch, 2.3) and those phones show "Please update" with a button to the store.

### 2.3 To build for this

| # | Change | Size |
|---|---|---|
| U1 | Railway: a `staging` environment (owner clicks; ~₹1–2k/month for a small server + Postgres), deploying from a `staging` branch; production from `main` only | owner + 1 h |
| U2 | `GET /api/app/config` → `{ minVersion: { customer, partner, rider, admin } }` (admin-editable in Settings) and an "Update required" screen in each app (checked at start and on resume) | small |
| U3 | A seed for staging: copy of rates/settings + 150,000 synthetic orders, no personal data | small |
| U4 | Load-test script in `scripts/load/` | small |
| U5 | GitHub: protect `main` (no direct pushes once launched; merges from `staging` only) | owner, 10 min |

---

## 3. Attacks, overload, abuse and every payment state

### 3.1 What is already strong (checked in code)

- Webhooks from Razorpay are checked against the raw body's signature and each event applied once (`routes/paymentRouter.ts:139-255`).
- Payment taken but message lost → a job asks Razorpay every 3 minutes and completes the order; never cancels a paid one (`modules/payments/reconciliation.ts`).
- Charged twice → the second capture is refunded automatically (`modules/payments/duplicateCapture.ts`).
- Payouts never retried blind: an uncertain payout is resolved by asking the gateway (`modules/payments/paymentsHealth.ts`).
- Money only acknowledged once it is in the database (`middlewares/durable.ts`).
- Sign-in guessing limited per account **and** per address; password-reset codes limited per account per day; sessions revocable; blocked accounts cut off at once on HTTP and sockets.
- Live-update sockets need a valid sign-in; order/kitchen/admin rooms each check ownership.
- Customer phone shown to the rider only during the live trip; documents photo-only; kitchen ticket page escapes everything.
- Every Operations action audit-logged; permissions per role; payouts need approval.

### 3.2 Gaps and what to do

| # | Threat | Today | Fix | Who |
|---|---|---|---|---|
| S1 | **Flood / DDoS** (a competitor rents a botnet) | requests reach the one Node process directly; the in-process limiter itself costs CPU per request | **Cloudflare in front**: a custom domain (e.g. `api.quickbitesresturants.in`) proxied by Cloudflare (free plan has unmetered DDoS protection; add rate-limit rules and Bot Fight Mode). Server: read the real client address from `CF-Connecting-IP`, and refuse requests that do not carry a secret header Cloudflare adds (so nobody bypasses it through the Railway address). Apps: new build pointing at the custom domain. | owner (domain, Cloudflare) + small code + app build |
| S2 | **Take-over of an Operations account** (phishing, leaked password) — it can pay out money | password only | **second step for staff**: a 6-digit code by email on a new device or every 7 days; required for anyone with payout/refund/rates permissions | medium |
| S3 | **Fake cash-on-delivery orders** to waste kitchens and riders | only "late cash cancels" (no longer reachable since customers cannot cancel after accept); no limit on new accounts | cash only after the account has **one delivered order paid online** (or a verified phone); at most **one live cash order** per account; an undelivered cash order (customer not there) blocks cash for that account; Operations can block cash per customer | medium |
| S4 | **Coupon farming** (new email = new "first order" discount) | `newCustomersOnly` is per account (`couponService.ts:61-64`) | first-order offers only for an account with a verified phone, and one per phone; Operations report of repeated delivery addresses | medium |
| S5 | **Sign-in email bombing** (bots ask codes for random emails → your Brevo quota gone, nobody can sign in) | 10 per 5 min per address and per account | a **daily cap on codes sent** with an Operations alert at 70 %; per-address cap per day; later **Play Integrity** check on the sign-in request (already an owner item, `OWNER_ACTIONS.md` 00.8) | small (+ owner) |
| S6 | **Refund marked done before Razorpay confirms** | `refunds.ts:219-227` treats "refund created" as settled; no `refund.processed` / `refund.failed` handling | subscribe to `refund.processed` and `refund.failed` ([Razorpay webhooks](https://razorpay.com/docs/payments/refunds/subscribe-to-webhooks)); store the refund id; on failure reopen the case, alert Operations, tell the customer; a refund call that timed out is checked with Razorpay before any retry (no blind second refund) | small–medium |
| S7 | **Chargebacks** | not tracked | handle `payment.dispute.created/won/lost/closed` ([Razorpay webhook list](https://razorpay.com/docs/webhooks/all)): alert Operations with the deadline, mark the order, book a lost dispute in the ledger | small |
| S8 | **Live keys and secrets** | Razorpay on `rzp_test_`; Groq key, admin password, MSG91 widget token shared in chat; Firebase service-account file in Downloads | owner, before launch (`OWNER_ACTIONS.md` Part 0) | owner |
| S9 | **Socket floods** | sign-in required, no per-address connection cap | cap open sockets per account (e.g. 5) and per address | small |
| S10 | **Library vulnerabilities** | not checked regularly | `npm audit --omit=dev` before each release; GitHub Dependabot alerts on (owner, one click) | owner + routine |
| S11 | **The real security scan** | could not run (no Workflow tool in this session) | owner: enable Dynamic workflows if `/config` offers it, then `/claude-security` → whole repository, medium | owner |
| S12 | Round-6 findings | attachments accept any text, `/kyc/submit` ban check, temporary passwords, chat flood | already planned in round 6, Part F | — |

### 3.3 Every payment state, checked

| State | What happens today | OK? |
|---|---|---|
| Customer opens Razorpay and leaves | order stays "payment pending"; after the window Razorpay is asked; nothing captured → cancelled | ✅ |
| Paid, app killed / network lost before the app confirms | webhook completes it; if the webhook is lost too, the 3-minute check does | ✅ |
| Paid twice (double tap, retry) | second capture refunded automatically | ✅ |
| Payment failed (wrong OTP, bank declined) | logged; order left pending, then cancelled by the check; customer can retry | ✅ (customer message could be clearer) |
| Authorised but not captured | auto-capture is on (`razorpayAdapter.ts:130`) | ✅ |
| Webhook sent twice / forged | applied once / refused | ✅ |
| Razorpay down | circuit breaker; quotes and orders keep working for cash | ✅ (check online checkout tells the customer plainly) |
| Refund created | marked refunded at once | ⚠️ S6 |
| Refund failed later (card closed) | never noticed; customer told "refunded" | ❌ S6 |
| Refund call timed out but went through | Operations may retry → second partial refund possible | ❌ S6 |
| Chargeback / dispute | not tracked | ❌ S7 |
| Cash collected, rider keeps it | cash ceiling stops offers; ageing alerts | ✅ |
| Payout sent, answer lost | resolved by asking the gateway, never re-sent | ✅ |
| Live keys | still test keys | ❌ S8 (owner) |

---

## 4. Order of work (proposal for today's discussion)

**Before launch — must:**
1. Capacity C1, C2, C4, C5, C6 (1–2 weeks) and the load test 1.5 on staging (needs U1).
2. Payments S6, S7; abuse S3, S5; Operations second step S2.
3. Round 6 (help chat, notifications, location guide, zoom, round-6 security).
4. Owner: Brevo plan / SMS, Razorpay live keys, rotate the exposed keys, Railway staging + backups/PITR on, Cloudflare + domain (S1), `ALLOW_PLATFORM_RESET=false`, Railway settings before 15 Nov.

**First month after launch:** C3 (old orders out of memory), S4 coupon rule, S9 sockets, U2 minimum version, staged-rollout routine.

**Every release after launch:** recipe 2.2; load test for big ones; `npm audit`; deploy outside meal hours.

## Sources

- Railway plan limits: https://docs.railway.com/pricing/plans , scaling: https://docs.railway.com/deployments/scaling
- Brevo free plan 300 emails/day: https://www.sender.net/reviews/brevo/pricing/free-plan , https://www.omnisend.com/blog/brevo-pricing/
- Razorpay refund webhooks: https://razorpay.com/docs/payments/refunds/subscribe-to-webhooks , all events: https://razorpay.com/docs/webhooks/all
- Google Play staged rollouts and halting: https://support.google.com/googleplay/android-developer/answer/6346149
- Measurement script (not in the repo): one real order through the API, cloned to N, timed with the real `computeChanges('full')`, quotes and lists.
