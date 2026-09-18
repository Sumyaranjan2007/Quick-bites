# Quick Bites — Testing Strategy

**Version:** 4.0.0
**Date:** 19 September 2026

---

## 1. One command

```bash
npm run verify
```

Secrets → hardcoded URLs → translations → diagnostics → typecheck (all ten
workspaces) → tests, stopping at the first failure. Nothing ships without it
passing.

```bash
npm run verify:full
```

The same, plus the production-configuration checks, which boot real servers in
real child processes. Slower, because starting eight servers takes a couple of
minutes. Run it before a release.

**728 checks, 0 failures** as of 19 September 2026.

`TEST_PLAN.md` describes every layer, every environment, and the mutation that
must turn each check red.

---

## 2. What is tested, and why in that shape

**17 backend suites.** They run as real HTTP and WebSocket calls against a real
Express app on an ephemeral port, not as mocked units. The things that have
broken on this project were never a pure function returning the wrong number;
they were a route that forgot an ownership check, a socket room anyone could
join, a signature verified against the wrong value. Those only appear when the
whole stack is wired together.

| Suite | Guards |
|---|---|
| `health` | Uptime, correlation ids, service probes |
| `db` | Spatial distance, transactions, persistence |
| `orders` | Pricing, idempotency, the status state machine |
| `search` | Fuzzy search, category filtering, cache |
| `sockets` | Real-time delivery to the right rooms |
| `sockets.security` | Who may subscribe to what — 22 checks |
| `otp` | Phone sign-in, guessing, replay, enumeration — 23 checks |
| `onboarding` | Registration and the approval gates — 22 checks |
| `payments` | Signatures, webhooks, replay, tampering — 17 checks |
| `security` | Headers, rate limits, injection, production hardening |
| `pipeline` | One order through all four portals end to end |
| `admin` | The console and role-scoped permissions |
| `partner` | The kitchen's own view |
| `features` | Reorder, tipping, live ETA, filters, cancellation refunds |
| `contract` | **Every URL the four apps call exists on the server** |
| `resilience` | Bills that balance, simultaneous requests, surviving a restart |
| `regression` | One check per defect a user ever reported |

### The contract suite is the one to understand

Every other suite tests one side against itself. The backend can be perfectly
correct and the app can be perfectly correct while the app calls an endpoint the
server has never heard of — and nothing notices until a tester taps Sign In.

That is not hypothetical. Four APKs were built, signed and launch-verified
against a deployment that answered `404 Route POST /api/auth/otp/request not
found`. Every check was green. Nobody could have signed in.

The suite reads all four apps' source, extracts the 97 distinct URLs they build,
and asks a running server whether a handler exists behind each one. It also
guards itself: an app that appears to call nothing fails the suite, because that
means the extractor is broken rather than the app being self-contained. That
guard fired on its first run and caught three apps it had not read.

---

## 3. Rules that keep these tests honest

**Every refusal is paired with the matching success.** A server that denied
everything would pass a suite made only of refusals and deliver nothing. The
socket suite asserts both that a stranger is refused *and* that the rightful
subscriber still receives the event.

**A scanner must be shown to fail.** Both scanners written this session passed
on first run while the thing they hunted was present — one because an empty
regex alternative matched every string, the other because `https://` contains
`//` and the comment-stripper truncated every line at the scheme. A green check
that has never gone red is not evidence. Prove it by breaking something.

**Tests do not depend on a third party.** `orderService` briefly called
Razorpay's live API during order creation, which made the suite fail whenever
Razorpay was slow. Payment is started explicitly now, and the payment suite
verifies signatures and webhooks with locally generated HMACs — everything this
platform decides on its own.

**Rate limits are cleared, not relaxed.** Suites call `resetAuthRateLimit()`
rather than loosening the limit under `NODE_ENV=test`, so the path under test is
the path production runs.

**A throttled request proves nothing.** The contract suite treats a 429 as
inconclusive and retries after clearing the limiter. Counting it as success
would have turned the suite green the moment it sent enough requests to throttle
itself — an entire app's contract could be missing and every check would pass.

**A test must not read the developer's leftovers.** The production-boot check
first reported four restaurants in an empty production deployment, because it
was reading this machine's `data/store.json`. Each boot now gets its own empty
`QB_DATA_DIR`. A check that passes or fails depending on what is lying around
locally is not testing the product.

**A tolerance can hide the thing being measured.** The bill-conservation check
compares to the paisa, and a platform fee of `5.907` still balances against a
total computed from it — the tolerance absorbs the difference. Catching that
needed a separate assertion that every figure is a whole number of paise.

**The suite must be repeatable.** Running one twice in a row must pass twice.
This caught a real defect: an unawaited promise in order creation surfaced only
on the second run against a persisted store.

---

## 4. What automation cannot tell you

**An APK that passes every static check can still die at launch.** It has
happened here — a duplicate native library fails only when the process starts.
Signature verification proves who signed a file, not that it runs.

```bash
bash scripts/launch-test.sh
```

Installs each APK on an attached device or emulator, launches it, waits, and
asks whether the process is still alive — printing the crash buffer when it is
not.

Two AVDs exist on this machine. **Use `qb34`.**

```bash
"$ANDROID_HOME/emulator/emulator.exe" -avd qb34 -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect
```

`qb-test` runs the API 36.1 Play Store image, which crash-loops `surfaceflinger`
under software rendering here. When it dies it tears down everything on screen,
including the app processes — so the launch test reported all four apps failing
twice while **zero** `com.quickbite.*` crash entries existed in the buffer. The
APKs were fine; the emulator was not. `qb34` (`android-34;google_apis;x86_64`)
boots in about a minute and is stable.

The lesson is worth more than the workaround: **read the crash buffer before
believing a failure.** A red result that names someone else's process is not
your result.

**React Native modals are invisible to `uiautomator dump`.** A previous session
spent hours on a rider offer that appeared absent from text-based polling while
being plainly on screen. Verify modals with a screenshot.

---

## 5. The manual journey, on real phones

No amount of API testing replaces four people holding four phones. Run this
before any release:

1. Customer signs in by phone and orders.
2. Partner hears the chime, accepts with a prep time, marks ready.
3. Rider (on shift) receives the offer, claims it, collects with the **pickup
   code**.
4. **The customer's map begins to move only now.** If it moved earlier, the
   post-pickup gate has regressed.
5. Rider delivers with the customer's **4-digit OTP**.
6. Operations sees it live; the settlement ledger updates.

Also worth checking by hand, because they are cheap to break and invisible to a
test: a wrong pickup code is refused, a wrong doorstep OTP is refused, the app
survives losing signal mid-order, and a pending restaurant is genuinely absent
from the customer's feed.

And the Phase 6 features, which are now covered by 62 automated checks but whose
**feel** only a person can judge:

- Order again on a past order — does the sheet make the price change obvious
  enough that nobody is surprised at checkout?
- The tip chips — is "No tip" a comfortable thing to press, or does the screen
  make declining feel like an accusation?
- The arrival time — does it move at a believable rate, and does it stop lying
  when the kitchen is late?
- The filters — with one real restaurant on the platform, do they empty the
  screen in a way that reads as broken?
- Cancelling — is the refund message reassuring enough that nobody phones
  support to ask where their money is?

---

## 6. What is still not proven

Honesty about the edges of all of the above:

- **Nothing has run against the hosted deployment.** Every layer runs locally.
  The production-configuration checks boot a real production server, which is
  the closest thing available, but they do not cross the network, do not touch
  Railway's Postgres, and say nothing about latency.
- **The three staff apps are English-only.** The customer app has all three
  languages and is checked for completeness; the partner, rider and admin apps
  have no translation layer at all. That is a decision to confirm, not a fact to
  rely on.
- **Load beyond six concurrent requests is untested.** The races that are
  checked are the ones that actually happen — a double-tap, two riders on one
  trip. Sustained throughput is not measured, and the backend is documented as
  single-instance.
- **The customer app cannot present a Razorpay checkout.** The server side is
  complete and verified against Razorpay's live test API; the app has no native
  module to show the sheet, so only cash on delivery completes end to end.
