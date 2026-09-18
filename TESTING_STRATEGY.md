# Quick Bites — Testing Strategy

**Version:** 3.0.0
**Date:** 18 September 2026

---

## 1. One command

```bash
npm run verify
```

Secrets → hardcoded URLs → diagnostics → typecheck → tests, stopping at the
first failure. Nothing ships without it passing.

---

## 2. What is tested, and why in that shape

**497 checks across 14 backend suites.** They run as real HTTP and WebSocket
calls against a real Express app on an ephemeral port, not as mocked units. The
things that have broken on this project were never a pure function returning the
wrong number; they were a route that forgot an ownership check, a socket room
anyone could join, a signature verified against the wrong value. Those only
appear when the whole stack is wired together.

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
| `regression` | One check per defect a user ever reported |

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

An emulator AVD named `qb-test` exists on this machine for exactly this:

```bash
"$ANDROID_HOME/emulator/emulator.exe" -avd qb-test -gpu swiftshader_indirect
```

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
