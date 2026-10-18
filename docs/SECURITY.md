# Security — audit findings, rules for every change, pre-release checklist

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Owner of this file: the security review session (master plan Stage A3 and Stage F,
`docs/plans/master-plan-2026-10-18.md`). The repo is **public**: no key, password, token,
phone code or personal data in this file or any tracked file.

---

## 1. Audit, round 1 — 18 Oct 2026, server at commit `bd5ca2b`

**For the owner.** No serious hole was found: nobody can sign in as someone else, reach admin
pages without permission, read another customer's orders or addresses, or fake a payment.
One medium problem: a signed-in customer can put any phone number on their own account
without proving it, which can lock the real owner of that number out. A few small clean-ups.
The server's own libraries have no known vulnerabilities.

Method: read every router against `docs/generated/ROUTES.md` and `middlewares/auth.ts`, then
**ran** each suspected flaw against a local server (seed data, throwaway `QB_DATA_DIR`) before
writing it down. Findings marked "proven" were reproduced; the rest were confirmed by reading
the exact code path.

### Findings

| # | Severity | Where | What an attacker can do | Fix | Status |
|---|---|---|---|---|---|
| M1 | **Medium** | `apps/backend-api/src/routes/authRouter.ts:270` (`PATCH /api/auth/me`, schema `:258`) → `db/repositories/userRepository.ts:242` | Any signed-in customer sets **any** phone on their account: no code, no check that another account holds it. **Proven:** a seeded customer took an unused number; when the real owner then asked for a sign-in code, the pending code was addressed to the attacker's email, so the owner cannot sign up with their own number. Riders and kitchens would also call whatever number was set (K1 now stores it on orders). | Now: refuse a phone already held by another account (`findByPhone` → 409 `PHONE_IN_USE`). Master plan B6: a code to the new number before it is saved. | **fixed** `0a33e95` + `5e93f1b` (deployed 18 Oct): a number held by another account → 409 `PHONE_IN_USE`; any *different* number → 409 `PHONE_CHANGE_NEEDS_CODE` for customers, partners and riders (proven: unused number refused; re-saving one's own number in `+91` form still 200); staff admins may still change their own number (trusted, Customer app refuses staff numbers). `identity` 56/56. B6 adds the code-to-new-number flow |
| L1 | Low | `routes/authRouter.ts:170, :226, :252`; `routes/restaurantRouter.ts:380, :407, :428, :447`; `routes/walletRouter.ts:80` | On an unexpected error these answer `500` with the raw `error.message`, bypassing the production masking in `middlewares/errorHandler.ts`; internal details (library or database messages) reach the caller. | `next(err)` instead of answering in place. | **partly fixed** `0a33e95`: the three `authRouter` routes use `next(err)`. Still open: `restaurantRouter.ts` ×4, `walletRouter.ts` ×1 (parallel session) |
| L2 | Low | `sockets/socketServer.ts:83` | Socket tokens are verified without pinning the algorithm (`middlewares/auth.ts` pins `HS256`). jsonwebtoken 9 already refuses `none`, so not exploitable today; one library change away from being so. | `jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] })`. | fixed 18 Oct (algorithm pinned; check in `sockets.security`) |
| L3 | Low | `routes/restaurantRouter.ts:385` (`GET /api/restaurants/owner/:ownerId`) | A **Customer-app** session of a restaurant owner (phone + emailed code) reads the kitchen's full record, while kitchen money (`/earnings`) is correctly refused. **Proven:** 200 with the full record vs 403 on `/earnings/statement`. Needs the owner's inbox, so impact is small, but it breaks the rule "kitchen data stays behind the Partner password" (`CLAUDE.md` §8). | Refuse customer-scope tokens here (role guard `restaurant_owner` + staff, or add the mount to the scope check in `middlewares/auth.ts`). | open |
| L4 | Low | `middlewares/cors.ts:37` | Any `https://*.vercel.app` or `*.railway.app` site (anyone can create one) is an allowed browser origin. The API uses bearer tokens, not cookies, so another site still cannot act as a signed-in user; it is unnecessary width. | Allow only our exact hosts (`CORS_WHITELIST`, same-host rule already covers our own pages). | fixed 18 Oct (only the same host or `CORS_WHITELIST`; checks in `anonymousAccess`) |
| L5 | Low | `routes/kycRouter.ts:50`, `routes/restaurantRouter.ts:1015`, `routes/riderRouter.ts:417` | Document "photos" accept any `https://` link and `data:image/svg+xml`. An admin opening/saving the document makes their phone or browser fetch a stranger's server (reveals the admin's IP, can serve any file). Downloads are saved as files and never sent the admin's sign-in, so no takeover. | Accept only `data:image/(jpeg|png|webp)` (and our own host if files move to storage). | open |
| L6 | Low | `routes/restaurantRouter.ts:537` | Dish `imageUrl` is checked with `z.string().url()`, which accepts `javascript:` and `data:` schemes. Rendered only as images today (no script runs), but any future link use would be a script injection. | `https://` only. | open |

### Checked and holding (no action)

| Area | Evidence |
|---|---|
| Token checks | HS256 pinned; block, deleted account, password-change revocation (`tv`) and role demotion all apply on every request from the store (`middlewares/auth.ts`). Demo tokens impossible in production (`config/env.ts:53`). Secrets refuse to default in production (`config/env.ts:38`). |
| Admin | Every admin route behind `authMiddleware('admin')` + `attachAdminAccess` + `requirePermission`/super-admin checks; reset guarded by role, deployment switch, then phrase (`routes/admin/platformRoutes.ts:152`). |
| Customer-app scope | Customer-scope tokens act only as customer; `/earnings`, `/payee-accounts`, `/kyc` refused (proven 403); order status changes use the forced role (`routes/orderRouter.ts:453`). |
| Ownership | Orders, messages, tracking, ratings, addresses (`addressRepository.update/remove` take the caller id), devices, support replies, KYC (`assertControlsEntity`), rider profile, `/auth/me/:userId`, order delivery address (`orderService.ts:436, :629`). |
| Rider contact privacy | Customer phone only to the rider holding the trip, only while live (`riderRouter.ts` `shapeTripForRider`, `contactVisibility.ts`); open offers carry none (`pipeline` check, 18 Oct). |
| Rate limits | Sign-in, registration and codes limited per IP **and** per account (email/phone), 10 per 5 min (`middlewares/rateLimiter.ts`); global 100/min; `trust proxy` = 1 (Railway). Codes compared in constant time, attempts capped (`modules/auth/otpService.ts:255`). |
| Payments | Amount from the stored bill (`routes/paymentRouter.ts:84-108`); Razorpay/RazorpayX signatures HMAC + `timingSafeEqual`; double charges refunded (`duplicateCapture` suite). |
| Sockets | Identity only from the signed token; blocked/revoked refused; room joins checked (`sockets/socketAuth.ts`, `sockets.security` suite). |
| Uploads | Size-capped (KYC 700 KB, avatar ~650 KB, JSON 1 MB, menu photo route 8 MB), image-prefix checked; nothing uploaded is served back from our domain; admin downloads use `a.download` and send no sign-in (`admin-mobile/src/lib/download.web.ts`). |
| Pages and emails | User text escaped (`routes/publicPages.ts:24` `escape`) in confirm pages and emails. |
| Dependencies | `npm audit --workspace @quick-bites/backend-api --omit=dev`: **0** vulnerabilities. Whole monorepo: 40 (14 moderate, 25 high, 1 critical) all in app build tooling (Expo CLI, Metro, Jest, `shell-quote` in the React Native CLI); none ship in the server or run on phones' data. Cleared by the next Expo SDK upgrade (master plan Stage C). |

---

## 1b. Audit, round 2 — 18 Oct 2026, commits `1078afb`…`251372a`

**For the owner.** The new features (35 km radius, Pure Veg seal, menu sections, recommended
list, help chat, kitchen ticket, person records, one-rider dispatch, honest ETA) add no
serious hole. A rider cannot take or pass on a trip offered to someone else; only the kitchen
that has an order can print its ticket; a person's documents need the right staff permission.
Two small items below.

Reviewed: `1078afb` (B1), `5638b6c` (B5), `a4b19c9` (B8), `ec41f10` (B10), `420d2b3` (B7),
`c449965` (Stage F fixes), `251372a` (B4 + B3). Uncommitted B11 files skipped.

| # | Severity | Where | What an attacker can do | Fix | Status |
|---|---|---|---|---|---|
| L7 | Low | `apps/backend-api/src/modules/orders/orderService.ts:737-748` (`tripDistanceFrom`, `assertDeliverable`, `cashTooFarReason`) | While the `unpinned_addresses` switch is on (default), an address with no map pin has no measured distance: the 35 km radius is not checked and the **15 km cash limit uses the nominal 3.5 km**, so cash on delivery is accepted for a trip of any length. The app cannot lower the distance below 3.5 km, so fees and rider pay cannot be pushed down. | Refuse cash when the distance was not measured (no pin), or require a pin for cash; or switch `unpinned_addresses` off once the location-first screen (D3) ships. | **fixed** `0a33e95` (deployed 18 Oct): no pin + a cash limit set → cash hidden in the quote and refused with `COD_NEEDS_PIN` (`pricingConfig.ts` `cashTooFarReason`); check in `deliveryRadius`, mutation caught |
| L8 | Low | `routes/admin/recordRoutes.ts` (document file route, `kind === 'link'` → `res.redirect(302, doc.fileUrl)`; ZIP `index.txt` lists the link) | Same root as **L5**: a partner/rider can store any `https://` link as a document; the admin's download is redirected to that stranger's server (the admin's sign-in is not forwarded: browsers and OkHttp drop `Authorization` on a cross-host redirect). | Fixed by L5 (accept only image data); until then do not redirect, return the link as text with a warning. | open |

Checked and holding in this round:

| Area | Evidence |
|---|---|
| B4 claim | An unassigned trip can be claimed only by the rider holding its **live** offer (`OFFER_NOT_YOURS`, `OFFER_EXPIRED`, `riderRouter.ts` claim route); `assignRider` refuses a second taker. The offer list shows a rider only their own offer. |
| B4 decline / expiry | `moveOfferOnAfterDecline` moves the offer only when the decliner holds it (`tripOffers.ts:240`); expiry is time-based (`liveOffer`), saved durably. A claim racing the sweeper ends with exactly one rider assigned. |
| B3 ETA | Computed on the server from stored data; sent only to the order room and admins; straight line, no paid map call per GPS point. |
| B5 | Pure Veg seal changeable only with `catalog.restaurants.pureVegSeal` or super admin (`peopleRoutes.ts:650`); partner sign-up and profile edits set `cuisineType` only. Section switch: `authMiddleware('restaurant_owner')` + `assertOwnsRestaurant`. Recommended list: `catalog.restaurants.recommend`. |
| B8 | Help answers and tickets refuse anyone else's order (`helpChat.ts` `isPartyTo`, rider matched by rider record); customer-scope sessions see only customer orders; answers carry no phone/address/bank data; 5 tickets/hour and double-tap guard. |
| B10 | Ticket only for the owning kitchen (`roles` from the store, so a Customer-app session of a partner is refused) or staff with `orders.detail.view`; only after Accept; no prices, customer first name only; PDF text escaped (`utils/simplePdf.ts:44`). |
| B7 | Record needs the per-kind view permission; documents need `documents.view`, tickets `support.tickets.view`, history `admin.audit.view`; Aadhaar masked; downloads audited. No ZIP-slip: every upload route restricts `documentType` to a fixed list and names are sanitised. Files served as `attachment` with `no-store`. |
| B1 | Radius and cash limit computed on the server from stored coordinates (L7 is the unpinned gap). |
| Stage F fixes | L2 (socket `HS256`) and L4 (CORS exact host) verified in code and by their checks. **Still open from round 1: M1 (fix in progress), L1, L3, L5, L6.** |

Note on B4 (cross-check with `docs/reviews/REVIEW_LOG.md` S1): the code review found a race in
`offerTripToNearbyRiders` (an offer can be replaced, or one rider offered two trips). That is a
correctness defect, not an access hole: accepting still requires holding the **current** live offer
and `assignRider` refuses a second taker, so no rider can take a trip that is not theirs.

## 1c. Audit, round 3 — 18 Oct 2026, `55d62d5` (forgot / reset password by email code)

**For the owner.** The new "forgot password" flow is sound: the code is random, stored only as a
fingerprint, expires in 10 minutes, allows 5 tries, signs out every other device, and the super
admin is excluded. Two small improvements: answer every request equally fast, so nobody can tell
which emails belong to partners; and cap how many codes one account can get per day.

| # | Severity | Where | What an attacker can do | Fix | Status |
|---|---|---|---|---|---|
| L9 | Low | `apps/backend-api/src/routes/authRouter.ts` `POST /auth/password/forgot` | The reply text is identical (proven), but for an email **with** a password the server first writes to the database and waits for Brevo (up to 10 s) before answering; an unknown email answers at once. On live that is a gap of hundreds of milliseconds, enough to tell which emails are partners, riders or staff by timing. Locally (no real email) 3.5 ms vs 1.9 ms. | Answer first, then do the work: `res.json(...)` and run the code creation + `sendEmail` in a detached `void (async () => {...})()` with its own `try/catch` and log. | **fixed** `12bbc0c` (deployed 18 Oct): the reply goes out before any lookup or email; the work runs in the background |
| L10 | Low | same route, `/auth/password/reset` | Guessing is bounded only by the shared per-account sign-in limit (10 requests / 5 min across forgot + reset): five wrong tries clear the code, after which a new one can be asked for at once. Worst case ≈ 2,500 guesses a day on one account (≈ 0.25 % chance a day of hitting a 6-digit code), while the victim's inbox fills with codes. No email tells the person their password was changed. | Count wrong guesses per account per 24 h (e.g. 10, then no new code for 24 h), cap codes per day (e.g. 5), and email "your password was changed" after a reset. | **fixed** `12bbc0c`: per account 5 codes and 10 wrong guesses per 24 h; a reset emails "password changed" (check in `passwordReset`, mutation caught) |

Checked and holding: same reply text for every email; code `crypto.randomInt` (6 digits),
stored only as `sha256(userId:code)`, compared with `timingSafeEqual`, 10 min expiry, 5 tries, one
email a minute, `persistDurably` before the email; refused for blocked accounts, password-less
(customer-only) accounts and `ADMIN_EMAIL`; success bumps `tokenVersion` (every other session
signed out) and clears the code; both routes behind `authRateLimiterMiddleware`; the code is never
in a response or a production log. `passwordReset` is stripped wherever a user record is spread
(`authRouter.ts:250, :302`, `peopleRoutes.ts:180, :279`, `rbacRoutes.ts:159, :222, :277`); every other
response that includes a person (login, sign-up, admin customers/riders/restaurants, order detail
`routes/admin/shared.ts`, person record) builds an explicit field list, so the new field cannot leak.

## 1d. Audit, round 4 — 18 Oct 2026, `146c41d` (Block ban list, Remove account)

**For the owner.** Remove works as you asked: the account is closed everywhere at once, admins
cannot be removed this way, it waits for live orders to finish, and a person who registers again
gets a brand-new empty account (nothing of the old one). Block has one real gap: it bans the
email, phone and the licence numbers typed **at sign-up**, but a blocked person who signs up
again with a new email and phone can add their old FSSAI/licence number **afterwards** as a
document, and that is not checked.

| # | Severity | Where | What an attacker can do | Fix | Status |
|---|---|---|---|---|---|
| M2 | **Medium** | `apps/backend-api/src/routes/restaurantRouter.ts:1074` (`POST /restaurants/:id/documents`), `routes/riderRouter.ts:424` (`POST /riders/documents`); `modules/platform/blockedIdentifiers.ts` `banAccount` | A blocked person registers again with a new email and phone and no FSSAI (it is optional at sign-up, `authRouter.ts:505`), then uploads their banned FSSAI (or, as a rider, their banned driving-licence number) as a document. **Proven:** an unbanned partner uploaded a blocked partner's FSSAI number → `201` accepted. Also, `banAccount` takes numbers only from the restaurant/rider records, never from the person's KYC documents, so a PAN, or an FSSAI/licence that exists only on a document, is never banned. | (1) `banAccount`: also ban every `documentNumber` on the person's KYC documents (FSSAI, GSTIN, PAN, DRIVING_LICENSE → kinds fssai/gstin/pan/license; add `pan`). (2) Call `assertNotBanned` in both document upload routes (by `documentType`) and when an admin approves a document. (3) Repeat `assertNotBanned` on the confirm-link POST (`authRouter.ts` `/confirm/:token`) for `pending.body` (phone, email, FSSAI, GSTIN, licence): today a ban applied during the 30-minute window is not re-checked. | **fixed** `0bed223` (deployed 18 Oct): both upload routes, the rider licence edit and the confirm-link POST check the ban; `banAccount` also bans KYC document numbers (new kind `pan`) and a removed account's real email/phone. **Proven:** the same upload now → 403 `IDENTITY_BLOCKED`; turning the check off fails 6 checks in `removeAndBlock`. Approval is ban-checked too since `1094edb` (for a number uploaded *before* its owner was banned) |

Checked and holding:

| Area | Evidence |
|---|---|
| Ban check on sign-up | `resolveIdentity` (customer `/auth/register`, partner and rider sign-up), partner FSSAI/GSTIN and rider licence at sign-up, and the first phone-code sign-in all call `assertNotBanned`; phone changes are refused anyway (M1). Profile edits cannot change FSSAI (`INVALID_PROFILE_CHANGES`, proven). Canonical forms: Indian phone normalised, email lower-cased with `+tag` dropped and Gmail dots removed, numbers upper-cased alphanumeric; stored as `sha256(kind:value)`. |
| Remove | Needs the manage permission for **every** kind of account the person has; admin accounts refused; typed name; refused while any order of theirs (as customer, kitchen or rider) is unfinished; sets `isBlocked`, which ends HTTP sessions and closes open sockets at once (`userRepository.update` → `revokeLiveAccess`); kitchens closed, rider off shift; email/phone freed. |
| Freed identity → no takeover | A new sign-up with the freed email/phone creates a new user id; orders, kitchens, rider record, payee accounts, tickets and confirm links are keyed by the old user id; the customer email-code path looks up by the (now changed) email; the old confirm links refuse a blocked account. |
| Staff accounts | Created only by a super admin (`rbacRoutes.ts` `POST /admins`), not ban-checked: trusted, by design. |

Note, no action needed: if an admin later **un-blocks** a removed account, it works again under its
placeholder email (`removed-<id>@removed.quickbite.app`) with its old password. Treat un-block of a
removed account as restoring it.

## 1e. Audit, round 5 — 18 Oct 2026, `68c101f` (deletion requests), `c8a7850` (admin creates accounts), item 18 design

**For the owner.** A partner or rider who asks to delete can still sign in to see their money but
gets no new orders or trips, and cancelling a request never un-blocks someone you blocked. Accounts
created by Operations are protected by the ban list and duplicate checks; the only improvement is
to email a "set your password" code instead of a temporary password.

| # | Severity | Where | What an attacker can do | Fix | Status |
|---|---|---|---|---|---|
| L11 | Low | `apps/backend-api/src/routes/admin/peopleRoutes.ts` `POST /admin/accounts/create` | The 12-character temporary password is sent in the email body and never expires; nothing forces a change. Anyone who later reads that inbox (or a mistyped address's owner) holds a working partner/rider password. | Create the account with no password and a `passwordReset` code (24 h), emailing "set your password with this code" through `/auth/password/reset` (allow `resettable` for a password-less account that carries an admin-issued code). No password travels by email. | **fixed** `12bbc0c`: no password is set or emailed; a 24 h set-password code instead (`issuePasswordCode`) |

Checked and holding:

| Area | Evidence |
|---|---|
| Deletion request (`68c101f`) | Sign-in kept (owner Q2); kitchens set `CLOSED` (`kitchen-status` refuses going online unless `ACTIVE`, order creation refuses non-active kitchens); rider set offline and removed from the offer pool; `POST /riders/shift` online refused `DELETION_PENDING`, and a trip cannot be claimed offline; refused while an order is in progress; cancel lifts only the legacy deletion lock, never a separate block (check in the suite). |
| Admin create (`c8a7850`) | Needs `users.restaurants.manage` or `users.drivers.manage` for the kind created; `assertNotBanned` on email, phone, FSSAI, GSTIN, licence; email and phone duplicates refused; password from `crypto.randomBytes` (≈69 bits); never in the response; logged only off production; audited. |

**Item 18 (contact change) design, before build** — sent to the main session:
- Phone change by a code to the account's *current email* would re-open M1 (an account owner
  claims an unused number and captures its real owner's sign-in codes). Keep phone changes
  support-only until SMS codes are live, or mark email-proven numbers `phoneVerified: false` and
  never let an unverified number capture another person's sign-in.
- Email change must prove the current owner as well as the new inbox (current password, or a code
  to the old email), then sign out other sessions (`tokenVersion`) and notify the old address.

## 1f. Verification, 18 Oct 2026 — `b5043a4` (item 18), `12bbc0c` (L9, L10, L11), `0bed223` (M2)

Item 18 is built as advised: mobile numbers change through support until SMS codes are live
(`PHONE_CHANGE_VIA_SUPPORT`; `PATCH /auth/me` and `/riders/me` refuse a different number); an email
change needs the current password (or, for an account without one, a code to the **old** email)
plus a code to the new email, signs out other devices and notifies the old address. Suites:
`contactChange` 24/24, `passwordReset` 27/27, `adminCreate` 18/18, `removeAndBlock` 29/29,
`identity` 56/56. Deployed (uptime reset); not exercised on live.

| # | Severity | Where | What an attacker can do | Fix | Status |
|---|---|---|---|---|---|
| L12 | Low | `apps/backend-api/src/routes/authRouter.ts` `/auth/contact/confirm` (`generateToken(updated, req.user!.role)`), and the change-password route's `generateToken(refreshed)` | The fresh token loses `scope: 'customer'`. **Proven:** a Customer-app session of a partner (403 on `/earnings`) changed its email (with the partner's password) and the new token read `/earnings` (200). Needs the partner password, so no outsider gains, but it breaks "kitchen data only behind the Partner app". | Expose the scope in `middlewares/auth.ts` (`req.user.scope = payload.scope`) and pass it on: `generateToken(updated, role, req.user.scope)` in both routes. | open |
| L13 | Low | `/auth/contact/request` with `currentPassword` | The sign-in rate limit keys on `email`/`phone` in the body; this body has neither, so the current-password check is limited per IP only. Someone holding a stolen session can try that account's password from many IPs. | In `authRateLimiterMiddleware`, when `req.user` is set, key the account bucket on `req.user.id`. | open |

## 1g. Review, 18 Oct 2026 — `495437a`, `02f88e9` (B2 Google Maps on the server: key exposure)

**For the owner.** The Google server key stays on the server: it is sent to Google in a request
header (Routes, Places) or, for the address-from-pin lookup, in the address Google requires, and
no log, error or page shows it. The key restrictions in `docs/ops/OPS_GUIDE.md` §5 match what the
code calls. One small clean-up on the public health page.

| # | Severity | Where | What an attacker can do | Fix | Status |
|---|---|---|---|---|---|
| L14 | Low | `apps/backend-api/src/modules/places/placesService.ts` `callGoogle` (`lastRefusal.detail`) and `routingService.ts` (`lastRefusal.detail`), shown by the **public** `/health` | Google's refusal text is published on `/health`. It never contains the key, but some messages name the calling server's IP address and the exact misconfiguration, which helps someone probing the setup. | Show only `status` and `at` on `/health`; keep `detail` in the server log. | open |

Checked and holding: Routes (`computeRoutes`, `computeRouteMatrix`) and Places (New) send the key
only as `X-Goog-Api-Key`; the Geocoding web service puts `key=` in the URL (Google requires it),
server to Google over HTTPS only. That URL is never logged: refusal logs carry `api` and `status`
only, the circuit breaker records `error.message` of a failed fetch (a generic "fetch failed" or a
timeout, no URL), and responses to apps carry addresses, never the request. `/health` shows the
provider name, not the key. `GOOGLE_MAPS_SERVER_KEY` is read only by the server (`config/env.ts`),
named in `.env.example` with no value, and `scripts/check-apk-secrets.mjs` treats every root `.env`
value not on its publishable list as secret and refuses any `AIza…` key in an app's JS bundle.
`docs/ops/OPS_GUIDE.md` §5: separate server project, key `qb-server` IP-restricted to Railway's static
IPs (shared with other Railway customers, as the guide says) and API-restricted to Places (New),
Geocoding, Routes, Roads; budgets and per-API daily caps; app keys restricted by package + both
SHA-1s. Matches the APIs the code calls (Roads is for B11).

## 1h. Review, 18 Oct 2026 — `7542edf` (B11 live tracking: who sees positions, how long we keep them)

**For the owner.** The hole is closed: until this change any rider could read the live position on
any order; now only the customer, the rider on that trip and staff can. Positions are not stored as
a trail: only the latest one is kept. Two clean-ups: someone taken off an order should stop
receiving its live updates at once, and the last position should be cleared when a delivery ends.

| # | Severity | Where | What an attacker can do | Fix | Status |
|---|---|---|---|---|---|
| L15 | Low | `apps/backend-api/src/sockets/socketServer.ts` (order room `order:<id>`; joined once via `canJoinOrder`, never re-checked) | Room membership outlives access. A rider taken off a trip (released, reassigned by operations) keeps receiving that order's status changes, the **new** rider's live position and the customer–rider chat (`emitOrderMessage` → `order:<id>`) for as long as their app stays connected. Same for a kitchen after a cancellation. | When `riderId` changes or the order ends, remove the old sockets: `io.in('user:<oldRiderUserId>').socketsLeave('order:<id>')` in the assign/release paths (one helper next to `emitRiderLocation`). | open |
| L16 | Low (privacy) | `db/repositories/orderRepository.ts` `updateRiderLocation` (order keeps `riderCoordinates`, `riderSpeed`, `riderLocationUpdatedAt`); `db/repositories/riderRepository.ts:80` (`currentCoordinates`) | No trail is kept (each fix overwrites the last), but the last position stays on every delivered order and on the rider record **for ever**, including where a rider goes offline (often home). Readable only by staff and the order's parties today; the privacy policy (`legal/PRIVACY_POLICY.md` §2) promises no retention period. | Clear `riderCoordinates`/`riderSpeed` when the order is delivered or cancelled (the proof of handover is already kept separately, `handoverPosition`); clear `currentCoordinates` when the rider goes offline. Add one retention line to the privacy policy (owner's wording). | open |

Checked and holding: `GET /api/orders/:id/tracking` now allows only the customer, the rider whose
**rider record** holds the trip, and admins (riders are no longer treated as staff); position,
speed and the stale flag only after pickup. `POST /api/riders/location` accepts a fix only from the
assigned rider, on shift, while `OUT_FOR_DELIVERY`; latitude, longitude and speed are bounded
(speed 0–100 m/s, a computed speed above that is dropped). The socket path (`rider:location`) uses
`canStreamRiderLocation` (assigned rider by rider record, trackable status only) with the same
bounds. `canJoinOrder`: customer by id, kitchen by owner, rider by rider record (the HTTP bug's
twin is not present here), admins. Positions are stored as the latest fix only, never a history.

## 1i. Review, 18 Oct 2026 — `1094edb` (any document can be replaced and re-verified)

Holding: an approved document keeps standing until its replacement is approved, so replacing never
un-verifies a trading kitchen or rider and never puts an unreviewed number on the profile; the
number reaches the kitchen/rider record only on approval (`copyApprovedNumber`); the FSSAI badge
reads the standing document's number; uploads (`restaurantRouter.ts:1083`, `riderRouter.ts:447`),
the rider licence edit (`:339`), profile edits (`restaurantRouter.ts:1359`), admin Create and now
**approval** (`peopleRoutes.ts:844`) all check the ban list. `removeAndBlock` 33/33.
Note only: a waiting upload that a newer one replaces is deleted (`kycRepository.dropUnreviewed`); it
was never reviewed, but the upload itself leaves no record. If uploads must be kept as evidence,
mark them `SUPERSEDED` instead.

### Open for the review round (owner's order of work, 18 Oct: build first, one jury round, then fix)

No live hole is open. Logged for the round: **L1** (restaurantRouter ×4, walletRouter ×1), **L3**,
**L5**, **L6**, **L8**, **L12**, **L13**, **L14**, **L15**, **L16**.

---

## 2. Rules every change must follow

### Server
1. Every new route: a guard at the mount or the route (`authMiddleware('<role>')`), input through
   `validate({ body|query|params: zod })`, and an **ownership check on every id** in the path or body.
   A staff route that checks ownership instead of a role goes into the customer-scope list in
   `middlewares/auth.ts` (`CLAUDE.md` §8).
2. Every new admin power gets its **own permission** (`modules/admin/permissions.ts`) and an audit line.
   Destructive actions (Remove/Block, payouts over threshold, reset) need a second confirmation.
3. Errors: throw `AppError(message, status, code)` and pass others to `next(err)`. Never answer
   `res.status(500).json({ error: err.message })`.
4. Never trust the client for money, role, price, distance, time or identity. The server recomputes.
5. Anything sensitive in a response (phone, address, OTP, bank, documents) is shaped per viewer
   (`contactVisibility.ts`), and only while needed.
6. Codes, links and tokens: random (`crypto.randomBytes`), stored as hashes, short expiry, single use,
   rate-limited, compared in constant time. Sign-in and code routes use `authRateLimiterMiddleware`.
7. Contact changes (phone, email) only after a code to the **new** address; sessions revoked on
   password or contact change (`tokenVersion`).
8. URLs from users: allow-list schemes (`https:` only, or `data:image/(jpeg|png|webp)`), size caps.
   HTML built on the server always goes through `escape`.
9. Outbound calls (Google Maps, Exotel, Brevo, Razorpay, Groq): host fixed in code, timeouts, circuit
   breaker, no user input in the host.
10. One server instance (in-memory store, sockets, timers). No replicas without the redesign.

### Accounts and data
11. Blocked identifiers (email, phone, FSSAI, GSTIN, PAN, licence) stored hashed and checked on
    every sign-up, sign-in, contact change and admin Create (master plan B6).
12. Personal data never in logs (phones masked as today: `90005*****`), never in URLs.
13. Bank numbers stay encrypted apart (`PAYEE_ACCOUNT_KEY`); never returned in full.

### Apps
14. No key in an app except the restricted map keys; `node scripts/check-apk-secrets.mjs` must pass.
15. Tokens in secure storage (`expo-secure-store`) once Stage F lands; HTTPS only; release builds
    with R8/ProGuard (`enableProguardInReleaseBuilds`, already on) and Hermes bytecode.
16. Never `UserLocation` (crash), never log tokens or codes on the device.

### Every commit
17. `node scripts/check-secrets.mjs` and the gate. A security fix leaves one check behind that fails
    when the guard is removed (mutate and watch it fail, reading stdout **and** stderr).

---

## 3. Pre-release checklist (run before every "make APK")

| Area | Check |
|---|---|
| Server | All findings in §1 marked fixed or accepted by the owner; `docs/generated/ROUTES.md` regenerated and every new row has a guard; gate green; `npm audit --workspace @quick-bites/backend-api --omit=dev` = 0 high/critical. |
| Railway | `NODE_ENV=production`; `ALLOW_PLATFORM_RESET` false/absent; `SEED_DEMO_DATA`, `DEMO_MODE`, `OTP_ALLOW_FIXED_IN_PRODUCTION` absent; `JWT_SECRET` long random; keys shared in chat rotated (Groq, `ADMIN_PASSWORD`, MSG91 widget token); Postgres backups on and one restore tested. |
| Accounts | Super-admin password changed; staff roles least-privilege; reviewer number/code set only for the review window. |
| Google Maps keys | Android key restricted to the four packages, each with **both** SHA-1s: our upload key **and** Play's app-signing key (Play Console → Test and release → App integrity); iOS key to `in.quickbites.app`; server key limited to Places (New), Geocoding, Routes, Roads (+ Railway static IP if available); budget alerts and daily quotas set. |
| Apps | `check-apk-secrets.mjs` passes on the built AAB/APK; release signing with the upload key; ProGuard on; no debug server address baked in; Data safety form matches what the app collects (location, phone, email, photos). |
| Play Integrity (Stage F) | Server verifies the Integrity token on sign-in and order placement; failures logged, then enforced once false positives are known. |
| Data | Logs sampled for phones/emails/tokens; old personal data handled per the privacy policy. |

### What cannot be prevented, and what we do instead

Anyone can download an Android app and read it (we did exactly that to study another app). So:
nothing secret ever ships in the app; every rule is enforced on the server; map keys are
locked to our packages and certificates; Play Integrity makes scripted fake clients expensive;
rate limits and audit logs make abuse visible. Code shrinking (R8) and Hermes bytecode make the
app harder to read, not unreadable: never rely on them for security.
