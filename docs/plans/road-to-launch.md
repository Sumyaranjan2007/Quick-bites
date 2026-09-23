# Quick Bites — the road to real customers

Written 23 Sep 2026, against commit `d3a2e64`, after the owner asked for a
plan that finishes the work without breaking what already works.

Two sessions, one tree. **Session A = money. Session B = experience.**

---

## 0. Where we actually are

Verified, not remembered. Each line was checked against the running system or
the repository at the time of writing.

| | State |
| --- | --- |
| Backend | **HEALTHY** on `quick-bites-production.up.railway.app`, real Postgres |
| Mapbox (server) | configured, `lastRefusal: null` |
| Mapbox (apps) | in all three map apps, secret token no longer shipped |
| Push notifications | `configured: true` on the deployment |
| Database contents | **EMPTY** — bootstrap admin only |
| Backend suites | 36 passing |
| Workspaces typechecking | 9 of 9 |
| Unpushed work | none |

**The database being empty is the single most important fact in this
document.** Every "it works" either of us has reported was observed against
seeded local fixtures. Nothing has been observed against this deployment with
real data in it, because there is no real data in it yet.

---

## 1. What is genuinely done

Not "written" — done, with a check that fails when the code is broken.

**Order flow.** The rider's trip is a separate track from the food's status.
The kitchen's four taps work. Delivery cannot be marked without a collection
that actually happened. Every refusal says which refusal it was, so "the
kitchen has not tapped Ready" no longer arrives as "invalid code".

**Money integrity.** An order becomes money owed only with evidence it
happened. Settlement selectors ask for that evidence rather than scanning for
DELIVERED. The second payout system that credited a wallet and adjusted a cash
counter without a ledger entry is removed, not patched.

**Pricing.** Food markup, packaging and delivery reach customers; partners see
their own figures and never ours. Commission and TDS compute on the
restaurant's own price. GST is gated on actually being registered.

**Admin.** Two-tier navigation with attention badges that are proved to move,
not merely to exist. Banks list every account with apply and reject. Payout
requests have a screen. The legal compliance gap has a screen.

**Platform.** Mapbox behind one seam in the apps and one interface on the
server. Notifications wired end to end. Signing keys restore themselves from a
vault outside the repository.

---

## 2. What is NOT done

Stated plainly, because the owner asked to build only if everything is fixed,
and this is the list that answers whether that is true.

### 2.1 Blocking the build

| Item | Owner | Why it blocks |
| --- | --- | --- |
| Weekly payout cadence | A | Policy copy promises partners "payments run daily" in three places. The owner decided weekly. A policy describing a different system from the one running is the document a partner quotes back at you. |

### 2.2 Not blocking, but the owner must be told

| Item | Owner | Consequence of shipping without it |
| --- | --- | --- |
| Gold membership customer screen | B | Exists and is tested; the purchase path needs live Razorpay keys before anybody can buy. |
| Rider search radius widening | B | Dispatch offers all eligible trips nearest-first and never auto-cancels. Functionally adequate; the plan's progressive widening is not built. |
| Five badge counts unproved | B | `pendingKyc`, `openRefunds`, `openSos`, `pendingProfileEdits`, `pendingMenuRequests` are asserted present but never proved to move. They are correct only because nobody guessed their status values wrong. That is luck, not a check. |
| Payout statements, financial reports, staff password reset | A | Routes exist, no screen calls them. An administrator cannot reset a locked-out colleague's password. |

### 2.3 Owner actions nobody else can do

- Rotate the Mapbox `sk.` download token.
- Live Razorpay and RazorpayX keys before any real money moves.
- Confirm `ALLOW_PLATFORM_RESET` is absent from the new Railway project.
- A Mapbox Studio brand style, if the default colours are not wanted.

---

## 3. The plan

Ordered so that each step is verifiable before the next one depends on it.

### Step 1 — Finish the cadence (Session A)

One bounded change: `payoutCadenceDays` read by the policy text, the payout
path, and the scheduler.

**The trap, already identified:** `dailyPayoutCap` is ₹2,00,000 per 24 hours,
enforced at execution. A weekly cycle pushes seven days of payouts through a
daily ceiling, so the first busy payday stops partway with
`DAILY_PAYOUT_CAP_REACHED` and half the partners go unpaid with no obvious
cause.

**Do not raise the cap.** It is a fraud blast-radius control, and weakening a
safety limit to solve a scheduling problem is the trade that looks free until
the day it is not. Surface it as a blocker before payday instead.

`codCashCeiling` stays as it is. It is an amount, not a period. Cash arrives
continuously, money leaves weekly; conflating the two cycles is exactly the
collision already removed once.

### Step 2 — Gate on the merged tree (Session B)

36 suites, 9 workspaces, on the tree that contains both halves. Not on either
half alone, and not on a tree either of us is mid-edit in.

`git log --oneline origin/main..HEAD` must be empty for both sessions before
this counts. A clean `git status` is what nine unpushed commits look like.

### Step 3 — Seed the live system with REAL data (owner)

Not demo data. The owner registers one restaurant, one rider and one customer
through the apps and approves them in admin.

**This is the step that turns every previous "verified" into something that
means anything.** Everything so far has been observed against local fixtures.

### Step 4 — One real order, end to end (owner, both sessions watching)

Place it, cook it, collect it, deliver it, and watch what happens to the money.

Specifically worth watching:
- Does the customer's tracker show the rider's line without ticking the food
  forward?
- Does the kitchen's fourth tap appear, and does the collection record say
  `BOTH` rather than `RIDER_ONLY`?
- Does the doorstep code work, and does the order reach DELIVERED?
- Does that order appear in dues, or go quiet? If it goes quiet, does the
  held-earnings blocker say why?
- Does a notification arrive on a phone with the app fully closed?

### Step 5 — Build, verify, deliver (Session B)

The verification that has caught something real every time:

1. Record hashes **before**.
2. Build **unpiped**, and read the real exit code. `| tail` reports the status
   of `tail`, which is how a failed build was reported as success.
3. All four hashes must change. An unchanged hash is a stale artifact that no
   exit code can tell you about.
4. Signing certificate on each: `CN=Quick Bites`, correct `OU`. A missing
   keystore produces a complete, installable, debug-signed APK and reports
   success.
5. Fingerprints must match the previous build, or every user must uninstall.
6. `check-apk-secrets.mjs` clean.
7. Firebase config present in all four, each with **its own** app id.
8. Order alarm packaged in Partner and Rider.

---

## 4. How not to break what works

The rules below are not general advice. Each one is written because the thing
it prevents happened on this project, usually today.

### 4.1 Verify against the running system, not the tree

Nine commits sat unpushed while both sessions reported everything fixed and
the owner tested a build containing none of it. `git status` was clean the
whole time, because a clean tree is exactly what unpushed work looks like.

`git log --oneline origin/main..HEAD` is the command that answers "will the
running system have this". Neither session's gate included it.

### 4.2 A passing check is not evidence

Four distinct shapes of this, all found today, all in checks written by the
person who also wrote the code:

- **A guard that refuses everything** passes every refusal assertion. Killed by
  asserting the allowed case still works.
- **A fixture that cannot reach the case** — "rider is not offered a trip"
  passed because the rider was busy and the list was empty for an unrelated
  reason.
- **An assertion comparing an object with itself** — the repository returns the
  same object it stores, so `fetched.status === handle.status` passed against
  any mutation whatsoever.
- **A branch no test touches in either direction** — 35 suites passed before
  and after a wallet change that was wrong.

The check that survives all four is one where the value **moves**. "Is a
number" passed against a badge hardcoded to zero.

### 4.3 Test the code in the file, not the code you typed

A regex was written into a file with a literal backspace byte. The test passed
because it tested a pattern retyped in the test rather than the one running.
Read the rule out of the file.

### 4.4 Two sessions, one tree

- Stage by explicit path and read `git diff --cached --stat` before committing.
  `git add -A` means "commit whatever the other session is doing right now",
  and it happened.
- Never `git stash` while the other session has uncommitted work.
- A gate result describes the tree it ran against. In a shared tree, announce
  before a run that matters — two suites have already failed on files changing
  underneath them.

### 4.5 A shared type must be shared

The rider app declared its own copy of a status union rather than importing
it. Renaming the shared value broke the app silently: a private type cannot
disagree with a server it does not reference, so nothing failed to compile and
a rider stood at a door unable to finish a delivery.

Import the type. Key label maps by the full union so the compiler demands every
case.

### 4.6 Degrade loudly, or not at all

Every optional dependency here degrades visibly: no Mapbox token gives a drawn
map, no Firebase file gives no push. One does not, deliberately — a missing
Mapbox **download** token produces no app at all, so it fails loudly with a
message naming the real cause instead of Gradle's confusing one.

The rule: degrade when the product still works worse; fail when it does not
work at all.

### 4.7 Do not write test data into production

The flow suite places orders, raises tickets and publishes a grievance officer.
Running it against the owner's deployment would put test rows in a database
days from real customers — the same class of mistake as a suite writing to the
developer store, which also happened.

Suites run locally. The live system gets read-only probes.

---

## 5. Division

| Session A — money | Session B — experience |
| --- | --- |
| Weekly cadence and the cap blocker | The gate on the merged tree |
| Payout statements screen | Five unproved badge counts |
| Financial reports screen | The build and its verification |
| Staff password reset | Reporting gaps to the owner honestly |

Shared files stay additive and announced. `shared-types`, `adminRouter`,
`dashboardRoutes`.
