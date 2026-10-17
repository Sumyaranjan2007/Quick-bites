# Review log — code reviews of every commit on main, and design reviews of the plan

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

Kept by the code-reviewer session (staff-engineer role) for `docs/plans/master-plan-2026-10-18.md`.
Each entry: commit, verdict, findings with `file:line`, the fix. Every finding was checked in the
code before it was written. Status column is updated when the builder answers.

---

## 18 Oct 2026 — `09ff351` fix(server): K1, K2, K3 (+ docs `bd5ca2b`)

**Verdict: approve with follow-ups.** The three fixes are correct; nothing leaks to riders on open
offers (fixed before commit), sockets send only shaped or minimal payloads (`emitOrderCreated`
shapes per viewer, `emitOrderAvailableForPickup` sends id/number/restaurant only), and the new
collection is saved and loaded by Postgres generically (`postgresStore.ts:224`, `:163`), so K3 holds
on live, not only in the file-based test. The follow-ups below are real, none blocks the deploy.

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| R1 | Medium | `modules/payments/refunds.ts:234` | K1 silently enables **automatic refund payout links**: the `!input.customerPhone` branch always failed before ("no phone number"), so non-source refunds stopped for an admin to settle by hand; now, where RazorpayX is configured, money leaves through a payout link. Untested money-path change, not in the commit message or CHANGELOG. | Owner decides whether refunds by link should now go automatically. Either way add a `refunds` check that pays the same customer twice through the link path, and say it in CHANGELOG. If not wanted yet, gate the link route behind a setting. | open |
| R2 | Medium | `db/repositories/userRepository.ts:120`, `:153` | Account deletion strips `customerPhone` from orders but **not from `refundRequests`**, which now copy the real phone (`orderService.ts:235`, `supportRouter.ts:203`, `modules/payments/duplicateCapture.ts:98`, `:120`). | In both deletion paths also clear `customerPhone` (and `customerName`) on that customer's `refundRequests`; one check in the deletion suite. | open |
| R3 | Medium-low | `routes/authRouter.ts:750` | `pendingRoleConfirmations` rows (bcrypt `passwordHash` + sign-up details) are pruned only when the same flow runs again or the token is opened. Now persisted, an unopened link stays in Postgres forever (before K3 it vanished on the next deploy). | Prune expired rows in `orderSweeper` (it already runs every `ORDER_SWEEP_INTERVAL_SECONDS`) or once on boot. | open |
| R4 | Low | `routes/authRouter.ts:777` | No check fails if `await persistDurably()` before the email is removed: the K3 restart test uses `saveStoreToFile()`, which writes every collection regardless. | Assert the row is durable before the email is captured (e.g. `peekDirty('pendingRoleConfirmations', key) === false` in the email stub), then mutation-check. | open |
| R5 | Low | `routes/riderRouter.ts:231` | Old-order phone fallback lives only in `shapeTripForRider`; the kitchen (`contactVisibility.shapeOrderForViewer`) and the call route (`orderRouter.ts:772`) still see no phone on pre-K1 orders, and every assigned-trip read costs a user lookup. | One-time backfill in `db/normaliseStore.ts` (orders with no `customerPhone`, `customerId !== 'deleted_user'`), then drop the per-request fallback. | open |
| R6 | Low | `middlewares/errorHandler.ts:15` | K2 fixed the status but every refused origin is still logged at `ERROR`; the "noisy error logs" cost in the old K2 entry remains. | Log 4xx `AppError`s at `WARN`. | open |
| R7 | Low | `CHANGELOG.md:9` | The fix's CHANGELOG entry and docs landed in `bd5ca2b`, not in `09ff351` (plan Rules: docs "in the same commit"). Reverting the fix alone leaves a CHANGELOG that claims it. | Going forward, one commit per step including its docs. | open |

---

## 18 Oct 2026 — Design review of Stage B (before it is built)

| # | Sev | Plan step | Finding | Fix |
|---|---|---|---|---|
| D1 | High (cost) | B11 + B2 "Roads API Snap to Roads … batched every ~30 s" | Roads Route Traveled bills per request (~$10 per 1,000 globally). Two calls a minute for a 30-minute trip = 60 calls ≈ $0.60 per order; at 50 orders a day ≈ $900 a month, only to draw the bike on the road. | Drop live Snap to Roads. B2 already fetches the route polyline (`computeRoutes`); project each GPS fix onto that polyline on the server (free, a few lines) and derive heading from it. Keep Snap to Roads out until measured need. |
| D2 | High (cost) | B3 "Recomputed on each status change and every rider GPS update while carrying" | Every 4 s fix × Routes API call = ~900 calls an hour per trip. | Recompute with Routes only on status changes and when the rider leaves the planned route; between those, ETA = route duration × remaining fraction along the polyline (D1's projection). |
| D3 | High | B4 "The sweeper checks expiries every few seconds" | `ORDER_SWEEP_INTERVAL_SECONDS` defaults to **30** (`config/env.ts:411`), so a 108 s offer can run to 138 s, and 5 riders add up to 2.5 extra minutes. | A `setTimeout` per offer for the exact expiry, with the sweeper as the restart backstop (state already durable on the order). |
| D4 | High | B4 one-at-a-time | Plan does not say a rider holds **one** pending offer at a time. Without it the nearest rider gets offers for several orders at once and each blocks 108 s while other riders sit idle. | Exclude riders with a live pending offer from "best free rider"; one offer per rider, one offer per order. |
| D5 | High (compat) | B4 "the old 'wake 6 at once' path is retired" | Rider apps on phones (v33 in Play review) poll `/riders/orders/broadcast` and claim with `/riders/orders/:id/claim` (`delivery-mobile/src/lib/api.ts:167`, `:175`). Plan Rules require old apps keep working. | Keep both routes: `broadcast` returns only the order currently offered to *this* rider (with `offerExpiresAt`), `claim` accepts only the offered rider before expiry. Old app works, cannot jump the queue. |
| D6 | Medium | B6 Block "email, phone and document numbers … stored hashed" | Hashing raw values is bypassed by formatting: `+91 98765 43210` vs `9876543210`, `A@x.com` vs `a@x.com`, GSTIN with spaces. | Canonicalise before hashing (one function used by every check): phone → last 10 digits, email → lowercase trimmed (Gmail dots stay), IDs → uppercase alphanumerics only. Unit-check each form. |
| D7 | Medium | B1 "default kitchen radius raised so 35 km is real" | Silently changes delivery area for every existing kitchen. At 35 km, rider pay is about ₹420 per trip at ₹12/km and delivery takes over an hour. | Raise only the global ceiling to 35 km; keep each kitchen's own `serviceRadiusKm` and let admins raise it per kitchen. Show the delivery fee for 35 km to the owner before the change. |
| D8 | Medium | B6 forgot password | Plan does not say the "code sent" answer is the same for unknown emails. A different reply tells an attacker which emails are partners/riders. | Same reply and same timing for known and unknown addresses; rate limit per IP and per email (existing `rateLimiter`). |
| D9 | Low | B5 "back at" time on a menu section | Needs something to switch the section back on at that time. | Reuse `orderSweeper` (no new timer service), plus the server treating a past "back at" as on when reading, so a late sweep never keeps food hidden. |
