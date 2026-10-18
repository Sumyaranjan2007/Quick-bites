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
| R6 | Low | `middlewares/errorHandler.ts:15` | K2 fixed the status but every refused origin is still logged at `ERROR`; the "noisy error logs" cost in the old K2 entry remains. | Log 4xx `AppError`s at `WARN`. | fixed 18 Oct (4xx at WARN via `console.warn`, 5xx at ERROR; check in `anonymousAccess`) |
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

**Builder's answers (18 Oct, B1 commit):** D7: the owner decided one admin-set radius of 35 km for every kitchen (kitchens no longer choose; `CLAUDE.md` §4, `docs/DECISIONS.md`), and at the same time a rider rate that slides from ₹12/km (to 4 km) to ₹8/km (at 35 km), so a 35 km trip pays ₹280, not ₹420. The owner sees worked examples (2/5/10/20/35 km) on Admin → Rates before changing any number. D1–D6, D8, D9 apply to later steps and stay open.

---

## Builder's notes for the commits below (all reviewed 18 Oct — verdicts in the next sections)

- **`1078afb`** (18 Oct) master plan B1: one 35 km radius (`deliveryRadiusKm`), rider per-km slide ₹12→₹8 (`riderPerKmAt`), cash only up to 15 road km (`COD_TOO_FAR`, quote `cashUnavailableReason`), closed kitchens after open ones in every sort. Money path: rider pay. Gate green (only Windows `fssaiBadge`), 8 mutations caught. Pushed 18 Oct with the owner's go-ahead (numbers confirmed); live since the deploy at ~02:05 IST. Full notes: `CHANGELOG.md` top, master plan "Built" under Stage B.
- **B5** (18 Oct, commit below in `git log`): kitchen type + admin-only Pure Veg seal, menu section switch (`menuSections.ts`, read by menu/quote/checkout/reorder/search), recommended restaurants + no-location list. Review D9 applied (read-time rule + sweeper). 15 mutations caught. Pushed with the owner's standing go-ahead for gated work.
- **B8** (18 Oct, commit below in `git log`): help chat, server half. `GET /api/support/help`, `/help/:topic` (fixed answers from live data, `modules/support/helpChat.ts`, no AI per Q3); "Talk to us" extends `POST /api/support/tickets` (server-rebuilt `helpChat`, double-tap = one ticket, 5 per hour). Look hardest at: `isPartyTo` (now also used by ticket creation: riders/partners could not attach their own orders before), the reply status change in `supportRepository.reply` (raiser vs staff, not customer vs others), and the new `SUPPORT_REPLY` push. 13 mutations caught. **Not pushed** (left for the session that pushes).
- **B10** (18 Oct, commit below in `git log`): kitchen ticket PDF `GET /api/orders/:id/kitchen-ticket` (`modules/orders/kitchenTicket.ts`). Look hardest at: who may print (`orderRouter.ts`, kitchen by `roles` + owner, staff by `orders.detail.view`), that nothing private or priced reaches the page, and the `SimplePdf` page-size change (statement PDFs still A4). 9 mutations caught. **Not pushed.**
- **B7** (18 Oct, commit below in `git log`): one record per person, `routes/admin/recordRoutes.ts`. Look hardest at: the per-part permissions (`can(...)` → `null`), that a document is only served through the person who owns it, the 302 to a stored link (links were validated `https?:` at upload, `kycRouter.ts`), and that downloads are audit-logged. 11 mutations caught. **Not pushed.**
- **Stage F (L2, L4, R6)** (18 Oct, commit below in `git log`): socket tokens pinned to HS256, CORS only the same host or `CORS_WHITELIST` (no more `*.vercel.app` / `*.railway.app`), 4xx logged at WARN. Look hardest at: whether any real site of ours relied on a `*.railway.app` origin other than the API's own host. 3 mutations caught. **Not pushed.**
- **B4 + B3** (18 Oct, main session): one-rider dispatch and honest ETA. Review D2 (no Routes call per GPS tick: straight line between status changes), D3 (timer per offer, sweeper backstop), D4 (one offer per rider), D5 (old Rider apps: list shows only own offer, claim gated) applied. D1 (no live Snap to Roads) is for B11/B2. 19 mutations caught.

---

## 18 Oct 2026 — second round: `1078afb` B1, `5638b6c` B5, `a4b19c9` B8, `ec41f10` B10, `420d2b3` B7, `c449965` Stage F, `251372a` B4+B3 (+ docs `a9a131d`)

| Commit | Verdict |
|---|---|
| `1078afb` B1 radius, sliding rider pay, cash ≤ 15 km | **Approve** (2 low) |
| `5638b6c` B5 kitchen type, Pure Veg seal, section switch, recommended | **Approve** |
| `a4b19c9` B8 help chat | **Approve** |
| `ec41f10` B10 kitchen ticket | **Approve** |
| `420d2b3` B7 person record | **Approve** (2 efficiency) |
| `c449965` Stage F L2/L4/R6 | **Approve** (also closes R6) |
| `251372a` B4+B3 dispatch + ETA | **Changes needed** (S1) |

Checked and fine (no finding): every cash-on-delivery refusal is in one place (`orderService.ts:606`, `:748`) and `COD_TOO_FAR` throws before any side effect (coupon redemption is later); rider pay has one formula (`riderPayFor`/`riderPerKmAt`), the old base+km formula in `tripPayout.ts:28-34` only prices orders frozen before 1 Oct; the section switch is read by menu, quote, checkout, reorder and both search paths, and the search index refreshes on every menu change (`syncService.ts:161`); partner sign-up can no longer set the seal (`authRouter.ts:855`); a customer-scope session holds only `customer` (`middlewares/auth.ts:217`), so `isPartyTo` and the kitchen-ticket owner check cannot be reached by a Customer-app session; documents in B7 are served only through their own person; the stricter CORS rule still allows our business site, because `www.quickbitesresturants.in` is served by this same server (`webApps.ts:48`, same host); D3/D4/D5 are applied as designed (timer per offer, `ridersHoldingAnOffer`, broadcast filtered to the rider's own live offer, claim gated by `OFFER_NOT_YOURS`/`OFFER_EXPIRED`); D2 holds (ETA on each GPS tick is straight-line, no paid call).

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| S1 | **Medium-high** | `modules/orders/tripOffers.ts:151-170` | **Race: one trip offered twice, or one rider offered two trips.** `offerTripToNearbyRiders` checks `liveOffer(order)` and builds `ridersHoldingAnOffer` *before* `await eligibleRidersFor(...)`, which yields once per rider (`await orderRepository.listByRiderId`, `tripOffers.ts:~70`). Nothing re-checks after the await. Five callers run it without coordination (`orderService.ts:1386` ready, `orderSweeper.ts:209` every 30 s, expiry timer `:136`, decline `:245`, `opsRescue.ts:112`, `riderRouter.ts:1310`). Example: a decline at second 29 and the sweep at second 30 both pass the check; the first offers rider A and pushes, the second overwrites `riderOffer` with rider B: A's tap then gets `OFFER_NOT_YOURS`, `round` jumps by 2 (operations alerted after fewer real riders). Two kitchens marking food ready at the same moment can both pick the same nearest rider, breaking one-offer-per-rider (D4). | After the await and before writing `riderOffer`, in one synchronous block: re-check `liveOffer(order)` and recompute `ridersHoldingAnOffer` and drop the chosen rider if now holding (take the next). Or a module-level `Set` of order ids in flight. One check: call it twice concurrently (`Promise.all`) and assert one push and `round === 1`; mutation-check. | open |
| S2 | Low | `tripOffers.ts` (round counter) + alert detail | `round` counts offers, not riders: with one rider online the same rider is re-offered every 108 s and after 5 cycles operations reads "5 riders asked". | Alert on `offeredToRiderIds.length >= limit` (distinct riders) or reword the detail to "offered 5 times". | open |
| S3 | Low | `tripOffers.ts` `tripsToday` | "Today" starts at server midnight; Railway runs UTC, so the tie-break resets at 05:30 IST. | Midnight in `Asia/Kolkata`. | open |
| S4 | Low (efficiency) | `tripOffers.ts` `ridersHoldingAnOffer`, `tripsToday`; `eta.ts` `kitchenPrepMinutes` | Each scans every order ever stored; dispatch runs per pending order every sweep, and every quote calls `kitchenPrepMinutes`. Fine today, grows with `orders` (OPTIMIZATION O14). | Scan only non-terminal orders for offers; keep a per-kitchen rolling prep list updated on READY (the `seniordev:` note already names it). | open |
| S5 | Low | `orderService.ts:~855` | `promisedArrivalAt` is frozen at checkout while an online order is still `PAYMENT_PENDING`; a customer who pays minutes later gets a promise that is already stale, so "ahead of time" rarely shows. | Freeze (or re-freeze) the promise when payment is confirmed / the order becomes `ORDER_PLACED`. | open |
| B1-1 | Low | `packages/pricing-engine/src/index.ts:47-56` | The slide is admin-editable; values like 12 → 2 between 4 and 10 km make a longer trip pay less in total (4 km ₹48, 10 km ₹20). The comment says "with the defaults". | Refuse a rate version where `km × riderPerKmAt(km)` falls between `riderFullRateKm` and `riderFarRateKm` (check the end points; the curve is a parabola), or show the warning in the Rates examples. | open |
| B1-2 | Low | `db/repositories/restaurantRepository.ts:47` | `findNearby` still caps at 15 km, but nothing outside `test/db.test.ts` calls it: dead code edited by B1. | Remove it with its test, or leave a note; not a live bug. | open |
| B7-1 | Low (efficiency) | `routes/admin/recordRoutes.ts` `personFor` (restaurant photos) | Every dish photo is returned inline; dish `imageUrl` may be a data URL up to 200 000 chars (`catalogRoutes.ts:908`), so a 100-dish kitchen's record can be ~20 MB of JSON on a phone. | Return dish photos as count + paths (like documents' `downloadPath`), not the data. | open |
| B7-2 | Low (efficiency) | `recordRoutes.ts` history | `auditRepository.list({ limit: MAX_SAFE_INTEGER })` loads the whole audit log on each record view, then filters. | Filter by entity ids inside the repository, newest first, stop at 200. | open |

R6 (first round) is fixed by `c449965` (4xx logged at WARN). R1–R5, R7 and D1, D6, D8 stay open.

---

## 18 Oct 2026 — `0a33e95` fix(security): M1, L7, L1 + review R2, R3

**Verdict: approve** (2 low, 1 note). R2 and R3 are fixed: `anonymiseCustomerHistory` (`userRepository.ts:35`) is the one place both deletion paths call, and it now clears refund cases too (check in `launchRound`); `pruneExpiredConfirmLinks` runs every sweep (check in `customerAddsRole`). M1 matches numbers through `normalizeIndianPhone` (`userRepository.ts:85`), so `+91 98765 43210` cannot take `9876543210`. L7: `measured` is the `roadDistance` result, which falls back to a straight-line estimate instead of `undefined` (`routingService.ts:54`), so a map outage does not block cash for a pinned address. No import cycle (`authRouter.ts` imports nothing from `modules/orders`).

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| T1 | Low | `modules/orders/orderService.ts:748`, `pricingConfig.ts:268` | `measured` is also `undefined` when the **kitchen** has no real location (`hasRealLocation(restaurant)` false): cash is then refused with `COD_NEEDS_PIN` and "Pin your delivery address", although the customer's address is pinned. The customer cannot fix it. | Pass why it is unmeasured: kitchen not pinned → say "this restaurant's location is being confirmed, please pay online" (or allow cash, as before L7, since the trip distance is unknown for everyone). | open |
| T2 | Low | `modules/orders/orderSweeper.ts:37` | A module now imports from a router (`routes/authRouter.ts`) to reach the confirm-link store. Works, but the next router import can create a cycle. | Move `pendingRoles` / `pruneExpiredConfirmLinks` into a small `modules/auth/confirmLinks.ts` used by both. | open |
| T3 | Note | `db/repositories/userRepository.ts` `anonymiseCustomerHistory` | Support tickets raised by a deleted customer keep `raisedByName` and their messages (same class as R2, older than K1). | Add `supportTickets` (by `raisedByUserId`) to the same function when B6 touches deletion. | open |

R2, R3 closed. R1 waits on the owner. Still open: R4, R5, R7, S1 (offer race, blocking for B4), S2–S5, B1-1, B1-2, B7-1, B7-2, D1, D6, D8.

---

## 18 Oct 2026 — re-review `251372a` + `5bddb01` (B4 offer race)

**Verdict: approve.** S1 is closed: after the awaited ranking, `offerTripToNearbyRiders` re-checks `order.riderId` and `liveOffer`, rebuilds `ridersHoldingAnOffer` and skips a now-holding rider, with no await before `riderOffer` is written (`tripOffers.ts:~168-185`). Order updates mutate the stored object in place (`orderRepository.ts`), so the function's `order` is current and its write-back loses nothing. `riderTripPush` 35/35 on this machine, incl. "Two offers for one trip at the same instant: one rider asked, once". S2 (alert counts distinct riders) and S3 (India midnight) closed. B1-1 moved to the owner (plan F-12).

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| S6 | Low | `modules/orders/tripOffers.ts` (the S1 re-check) | The re-check after the await repeats `riderId` and `liveOffer` but not `offerableNow(order)`: an order cancelled (or otherwise moved on) while riders were being ranked still gets an offer and a push; the claim gate then refuses it, so no money moves, but a rider is woken for nothing. | Add `|| !offerableNow(order)` to the same line. | open |

Still open: R4, R5, R7, S4, S5, S6, B1-2, B7-1, B7-2, T1, T2, T3, D1, D6, D8; R1 and B1-1 with the owner.

---

## 18 Oct 2026 — `55d62d5` B6 step 1 (forgot password), `08e0cfe` S6, `5e93f1b` M1 round 2 + T1 + T2

| Commit | Verdict |
|---|---|
| `55d62d5` forgot password by email code | **Changes needed** (P1) |
| `08e0cfe` S6 | **Approve** (S6 closed: `offerableNow` in the post-await re-check) |
| `5e93f1b` M1 round 2, T1, T2 | **Approve** (T1, T2 closed; 1 low) |

Checked and fine: the reset code is stored only as a hash and every response that returned a user record now drops `passwordReset` too (`authRouter.ts:249`, `:301`, `peopleRoutes.ts:176`, `:272`, `rbacRoutes.ts:159`, `:222`, `:277`); `/api/auth/me` in `apiRouter.ts` returns `req.user`, which never carries it. Tries cannot be raced past 5: `userRepository.update` replaces the record synchronously (`userRepository.ts:106-111`), so a parallel guess reads the decremented count. Customer-only, blocked and the boot super-admin accounts are excluded; success bumps `tokenVersion`, signing out every device. T1: an unpinned kitchen is treated as measured, so cash works as before L7 with the nominal distance.

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| P1 | **Medium** | `routes/authRouter.ts` `/password/forgot` + `/password/reset` | **Codes are unlimited over time.** Each forgot request after 60 s issues a fresh code with 5 fresh tries, and the only other limit is per IP (`authRateLimiterMiddleware`). From several IPs that is up to 5 guesses a minute, ~7,200 a day at 1-in-a-million each: about 0.7 % a day, ~20 % a month, to take over a chosen partner, rider or staff account. | Per account: at most 5 codes and 10 wrong tries per 24 h (kept on `passwordReset`), then the same reply but no new code until the next day (admin reset still works). One check: 11 wrong tries across 3 codes → no 4th code. | open |
| P2 | Low-medium | `/password/forgot` | Same text for every email (D8), but **not the same time**: a real account awaits `persistDurably` and the Brevo send (hundreds of ms), an unknown one answers at once, so timing still tells which emails are partners/riders/staff. | Answer first and send in the background (`void`), or never `await` the email on this route. | open |
| P3 | Low | `/password/reset` | No "your password was changed" email after a reset; the owner of a taken-over account is not told. | One `sendEmail` after the update (fire and forget). | open |
| PH1 | Low | `routes/riderRouter.ts:307` (`PATCH /riders/me`) | M1 rounds 1–2 guard the **account** phone, but the rider **record** phone (the number customers and kitchens call, copied onto orders as `riderPhone`) is still changed freely: no code, no duplicate check, and it drifts from the account phone. Same state, second copy (`CLAUDE.md` §8). | Apply the same rule there (refuse a change until B6's code-to-new-number exists), or keep one phone: copy the account's. | open |

Still open: R4, R5, R7, S4, S5, B1-2, B7-1, B7-2, T3, D1, D6, P1, P2, P3, PH1; R1 and B1-1 with the owner (owner instruction 18 Oct: no questions to him; design points are settled between sessions, live money rules stay).

---

## 18 Oct 2026 — `146c41d` B6 step 2: Remove + Block

**Verdict: changes needed** (G1 is small). The design is sound: identifiers are stored only as hashes of a canonical form (review D6 applied: phone via `normalizeIndianPhone`, Gmail dots/`+tag`, IDs uppercase alphanumerics), one reply whatever matched, every route that creates an account checks it (`resolveIdentity` → `/register`, partner and rider sign-up, emailed confirm; the Customer-app code sign-in at `authRouter.ts:1317`; FSSAI/GSTIN at `:951`, licence at `:1007`), Remove refuses while an order is in progress (`LIVE` in `staffDeletion.ts:21` holds the *finished* statuses, so `!LIVE.includes` is right, only the name misleads), revokes sessions through `isBlocked`, takes the rider off the offer pool and closes the kitchens, and nothing enforces FSSAI/licence uniqueness, so a removed person really can register again. Per-kind manage permissions and the type-the-name confirm are checked server-side; admin accounts are refused.

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| G1 | **Medium** | `modules/platform/blockedIdentifiers.ts` `banAccount` | **Block after Remove does not ban the person.** Remove moves the real email and phone to `removedIdentity` and sets a placeholder email and no phone (`staffDeletion.ts` `removeAccount`). If the owner later Blocks that account, `banAccount` reads `user.email`/`user.phone`, i.e. the placeholder and nothing, so the real email and mobile stay free: exactly the "can't use that email and mobile again" the owner asked for. | Also push `user.removedIdentity?.email` / `?.phone` into `found`. One check in `removeAndBlock`: remove, then block, then sign-up with the original email → `IDENTITY_BLOCKED`. | open |
| G2 | Low-medium | `routes/riderRouter.ts:307-309` (`PATCH /riders/me`), restaurant profile edit `phone` (`EDITABLE_PROFILE_FIELDS`), KYC document numbers | The ban is checked only when an account is **created**. A blocked person can sign up with clean details and then type the banned driving-licence number or phone into their rider profile, or a kitchen phone through a profile edit, unchecked. | `assertNotBanned` on those writes too (rider PATCH: `license`, `phone`; profile edit submit/approve: `phone`; KYC upload: the number by document type). | open |
| G3 | Low | `blockedIdentifiers.ts` `canonical` (email) | `+tag` is stripped for every domain, not only Gmail (the comment says Gmail), so `john+shop@company.in` and `john@company.in`, possibly different inboxes, count as one person. | Strip `+tag` only for Gmail (and other providers you list), or accept the over-match knowingly in the comment. | open |

Note: the misleading name `LIVE` (finished statuses) predates this commit; rename to `FINISHED` when that file is next touched.

---

## 18 Oct 2026 — `68c101f` B6 step 3 (deletion requests, owner Q2) and `c8a7850` B6 step 4 (admin Create)

**Verdicts: both approve.**

`68c101f`: with the account no longer locked during a request, every way to get new work is still closed: the request sets each kitchen `CLOSED` and the partner's open switch refuses anything not `ACTIVE` (`restaurantRouter.ts:~712`); the rider is set offline, taken off the offer pool, refused at "go online" (`DELETION_PENDING`, `riderRouter.ts:515`), and `claim` needs `isOnline` (`riderRouter.ts:~850`). A request is refused while an order is in progress. Completing a request lifts only the old-style deletion lock (`blockReason === REASON`), never a separate admin block. The review row (kitchens, rider, orders in progress/total, documents approved, last active) is computed from the store, nothing trusted from the app.

`c8a7850`: reuses the sign-up schemas and record builders (`openRestaurant`, `openRiderRecord`), so a created kitchen/rider is the same record as a self-registered one (pending approval). The ban list, email and phone duplicates are checked first; per-kind manage permission is checked server-side; the temporary password is 12 characters from crypto randomness (≈ 69 bits), emailed, never returned, logged only off production; the write is durable (admin router) and audit-logged.

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| C1 | Low | `routes/admin/peopleRoutes.ts` `/accounts/create` (and the existing admin reset at `:1150`) | "Change it after signing in" is only advice: nothing forces it, and the temporary password stays valid for ever in the person's mailbox. | Mark the account `passwordTemporaryUntil` (e.g. 7 days); sign-in with an expired temporary password answers "use Forgot password", and the apps prompt for a new one when the flag is set (Stage E). | open |

Still open from earlier rounds and not yet fixed in a commit: **P1** (unlimited reset codes, `55d62d5`) and **G1** (Block after Remove, `146c41d`); plus P2, P3, PH1, G2, G3, R4, R5, R7, S4, S5, B1-2, B7-1, B7-2, T3, D1.

---

## 18 Oct 2026 — re-review `12bbc0c` (P1, P2, P3, C1), `0bed223` (G1, G2, G3), `b5043a4` (PH1, item 18)

**Verdicts: all three approve.** Closed: P1 (5 codes and 10 wrong tries per account per 24 h, so at most 10 guesses a day ≈ 1 in 100,000), P2 (`/password/forgot` answers before any lookup), P3 (change notice), C1 (no password is ever set or emailed; a created account gets a 24-hour set-password code through the same reset flow), G1 (`removedIdentity` banned too), G3 (`+tag`/dots folded for Gmail only), PH1 (rider phone changed by support until SMS; approved licence/RC locked). Quota updates cannot be raced (`userRepository.update` replaces synchronously). `sendEmail` never rejects (`otpDrivers.ts`, try/catch → `{accepted:false}`), so the fire-and-forget calls are safe. The email change needs proof of the account (current password, or a code to the old inbox for password-less customer accounts) and of the new inbox, then signs out every other session.

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| Q1 | Low-medium | `routes/authRouter.ts` `/contact/request` + `/contact/confirm` | The email-change codes have the P1 shape again: one request a minute, 5 tries each, no daily cap. For a password-less customer account the only barrier against a stolen session is the 6-digit code to the old inbox, so ~7,200 guesses a day would move the account to the thief's email within weeks (the victim does get flooded with notices). | Reuse `resetQuota` (same 5 codes / 10 wrong per 24 h) for contact changes. | open |
| Q2 | Low (altitude) | 8 response sites (`authRouter.ts:250`, `:302`, `:1710`; `peopleRoutes.ts:182`, `:281`; `rbacRoutes.ts:159`, `:222`, `:277`) | Private user fields are dropped by hand at each site; this round added a third (`contactChange`), and the new `resetQuota` (counts and window) is already missed: it shows in `/auth/me` and the admin user views. | One `publicUser(user)` in `userRepository` (drop `passwordHash`, `passwordReset`, `resetQuota`, `contactChange`, `removedIdentity`) used at all 8 sites; a check that no response carries those keys. | open |
| G4 | Low-medium | `routes/kycRouter.ts:93` (`POST /api/kyc/submit`) | The ban check now runs on the rider and partner upload routes, but not on `/api/kyc/submit`, which a partner or rider may call for their own record (ownership check at `:75`). No app calls it, but the ban is enforced server-side only, so `curl` brings a banned FSSAI/PAN/licence back. | Same `kindForDocument` + `assertNotBanned(…, ownerUserId)` there. | open |
| G2b | Low | restaurant profile edit `phone` (`EDITABLE_PROFILE_FIELDS`) | Still not checked against the ban list. Admin-reviewed, so a human sees it, but nothing flags it. | `assertNotBanned({ phone })` when the edit is submitted. | open |

Still open from earlier: R4, R5, R7, S4, S5, B1-2, B7-1, B7-2, T3, D1; R1, B1-1 with the owner (decided between sessions where possible).

---

## 18 Oct 2026 — B2: `495437a` (Google Routes) and `02f88e9` (Google Places (New) + Geocoding)

**Verdicts: both approve** (one cost point worth doing before the key goes on Railway). Checked: the key travels in `X-Goog-Api-Key` (Geocoding only takes it in the URL; that URL is never logged); field masks are set (`routes.distanceMeters,routes.duration`; matrix `originIndex,destinationIndex,distanceMeters,duration,condition`; details `formattedAddress,location,addressComponents`); the matrix is chunked at 9 destinations, well under the 100-element cap for traffic-aware matrices; nothing is called per GPS fix (the only callers are quote and checkout, `orderService.ts:454`, `:742`); every failure (5xx, 4xx, timeout, no route, a zero distance Google omits from JSON) returns `null` and the pair falls back to the straight-line estimate, so an order never fails on maps; results are cached 6 h at ~11 m (`routingService.ts:124-138`), refusals are not cached as answers; Places autocomplete uses the app's session token (the Customer app sends one per entry, `AddressSearchField.tsx:121`, `:153`; it is the only app calling `/places`); `routingService` no longer imports `placesService` (no cycle).

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| B2-1 | Medium (cost) | `modules/places/routingService.ts` `callGoogleRoute`/`callGoogleMatrix` | `routingPreference: 'TRAFFIC_AWARE'` (and, per Google's SKU list, `TWO_WHEELER`) bill at the Routes **Pro** rate, roughly double Essentials. What they buy is the traffic-aware duration, and **nothing reads `durationMinutes`** outside this module: pricing and the ETA use the distance (`eta.ts` uses `DELIVERY_SPEED_KMPH`). | Until B3/B11 actually use the duration: `TRAFFIC_UNAWARE` + `DRIVE` (Essentials), or keep two-wheeler for road distance only if its distances differ materially (check a few local pairs). Confirm on the Cloud pricing page for India. | open |
| B2-2 | Low | `modules/places/placesService.ts` (autocomplete, details, reverse) | `if (!body \|\| lastRefusal?.at !== refusals)` is redundant (`callGoogle` already returns `null` on any refusal) and racy: a refusal on another, concurrent request discards a good result here. | Rely on `body === null` only. | open |
| B2-3 | Low | `routingService.ts` `googlePost`, `placesService.ts` `callGoogle` | 4xx refusals (wrong key, API not enabled, 429 quota) neither trip the breaker nor back off, so a misconfigured key makes every quote and keystroke call Google and log an ERROR. | Count 403/429 as breaker failures (it opens for its cool-down, quotes use the estimate meanwhile). | open |
| B2-4 | Low (cost) | `placesService.ts:488` | Reverse-geocode cache key uses 5 decimals (~1 m), so almost every drag of the map pin is a new Geocoding call. | 4 decimals (~11 m, the routing cache's precision). | open |

---

## 18 Oct 2026 — `7542edf` B11 live tracking (server)

**Verdict: approve.** One recorder (`modules/riders/liveLocation.ts` `recordRiderFix`) now serves both the socket and the REST fallback, so a fix sent over the socket is kept, not only relayed. Both paths stay gated the same way: only the assigned rider, only after pickup (socket: `canStreamRiderLocation` → `TRACKABLE_STATUSES`, `socketAuth.ts:174-185`, plus `isPlottableCoordinate`; REST: `NOT_YOUR_DELIVERY` and `status === 'OUT_FOR_DELIVERY'`, with lat/lng/speed now bounded by the schema). Speed is the phone's, else distance over time from the previous fix within 2 minutes, dropped above 100 m/s. The ETA in the relay is computed from the stored order after the update (`orderRepository` mutates in place). The tracking route fix is real and important: `isRider` used to compare a user id with the rider record id, and **any rider account counted as staff, so every rider could read every order's live position**; now only the assigned rider record and admins. Speed and the stale flag are withheld before pickup. No Snap to Roads (D1 respected; the polyline projection is noted for B2 in the module header).

| # | Sev | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| L1 | Low (efficiency) | `liveLocation.ts` `recordRiderFix` | Every fix (every ~4 s per active trip) marks the whole order document and the rider document dirty, so each autosave flush re-writes the full order JSON (items, bill, timeline) to Postgres for every live trip. Bounded by the debounce, fine today. | Keep the live position in memory every fix and mark it dirty at most every ~15–30 s (or on status change); a restart then loses at most that much of a trail it never needed. | open |

Open list unchanged otherwise: R4, R5, R7, S4, S5, B1-2, B7-1, B7-2, T3, D1 (for B2 polyline), Q1, Q2, G4, G2b, B2-1…B2-4; R1, B1-1 with the owner.
