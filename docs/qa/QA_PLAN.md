# QA plan — acceptance checks for the master plan

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

Owner of this file: the QA session. Plan it checks: [`docs/plans/master-plan-2026-10-18.md`](../plans/master-plan-2026-10-18.md)
(item numbers match its Tracker). How tests run: [`docs/TESTING.md`](../TESTING.md).
Written 18 Oct 2026 at commit `bd5ca2b`.

## How an item is accepted

An item is done only when all four hold, with evidence in the commit or the QA log below:

1. **Server check**: a suite in `apps/backend-api/src/test/` asserts the behaviour (listed in the
   runner's `SUITES`), and **each guard was mutated** (line removed or inverted) and the check
   seen to fail, reading stdout **and** stderr, with absolute paths (a harness that cannot find
   the file reports "0 failures" for every mutation: seen 18 Oct).
2. **No regression**: the full gate (`node scripts/run-backend-tests.mjs`) shows only the known
   Windows `fssaiBadge` exit crash; plus `npx turbo typecheck`, `check-secrets`, `check-i18n`,
   `check-apk-secrets`, `check-hardcoded`, `diagnostics.js`, `build-web.mjs`.
3. **Old apps still work**: an app version already on phones keeps working against the new server
   (`bodyContract`, `routeContract`, `contract` suites green; new fields optional; no route removed
   while a released app calls it, see `docs/generated/APP_CALLS.md`).
4. **Device check** (Stages C–E): the phone script below run on the emulator `qb34` and the owner's
   Vivo against the **private QA server** (`docs/TESTING.md`: port 7071, fixed code, Razorpay test
   keys, `adb reverse tcp:7071 tcp:7071`). Never on live, never with the phone's live-signed-in apps
   (`pm clear` only the apps pointed at QA afterwards; `adb reverse --remove-all`).

Shared rule for every item: **privacy at each stage of an order** (who sees phone, address, OTP)
is guarded by `platform`, `pipeline`, `contract`/`contactVisibility` checks; a new field that
carries personal data needs its own "not before / not after" checks (the K1 offer leak of 18 Oct
was caught only because `pipeline` searched the whole offer body).

---

## Stage A

| # | Server checks (suite: assertion → mutation) | Regression guards | Status |
|---|---|---|---|
| K1 | `platform`: new order `customerPhone` = account phone → drop `customerPhone: customer.phone`; trip rider sees it, older order falls back → drop fallback. `pipeline`: open offer has **no** phone/masked phone → `order.riderId ?` removed | `platform`, `pipeline`, `refunds`, `moneyPaths`, `gatewaySettlements` | ✅ 18 Oct (main session: 5 mutations caught) |
| K2 | `anonymousAccess`: malformed and foreign origin → status 403; `customerAddsRole`: `Origin: null` API call → 403 → `refuse` returns plain `Error` | `anonymousAccess`, `customerAddsRole`, `webApps` | ✅ |
| K3 | `customerAddsRole`: link stored by hash only; survives save → clear → load; works once → in-memory Map | `customerAddsRole`, `platformReset` | ✅ |
| A2 | Ops only: `/health` after resize shows `database.UP`; restore of a Postgres backup onto a copy returns the same order count | `health`, `resilience`, `persistenceAlert` | ⬜ owner + devops |
| A3 | Audit table in `docs/SECURITY.md` (security session) | – | ⬜ |

## Stage B — server (each step its own commit; old apps keep working)

| # | Must assert (and the mutation that must break it) | Edge cases to include | Regression guards |
|---|---|---|---|
| **1a** 35 km | customer at 34 km sees a kitchen whose radius allows it; at 36 km does not → change the 35 constant/setting read; kitchen radius smaller than 35 wins → use `max` instead of `min`; admin can lower the global value and the list follows on the next request | kitchen with no `serviceRadiusKm` (old data); customer exactly at the edge; no coordinates sent | `features`, `flows`, `db`, `onboarding`, `profileEdits`, `addressPin`, `search`, `ownPricesAndSearch` |
| **3** Not delivering | closed/offline kitchen **is in the list**, flagged not orderable, sorted after open ones, label text "Not delivering currently" (and "Opens at HH:MM" when hours say so) → drop the flag; ordering from it still refused (existing) → remove the server refusal | kitchen closed by hours vs switched off vs blocked (blocked must stay **hidden**) vs not approved (hidden) | `accountBlocking`, `adminTools`, `partner`, `regression`, `features` |
| **7** server | list without coordinates returns recommended list + `needsLocation` flag → drop flag | recommended list empty | `features` |
| **21** server maps | each seam export returns the same shape as today (`suggestAddresses`, `resolvePlace`, `reverseGeocode`, `roadDistance`, `roadDistanceMatrix`) with Google responses stubbed at `fetch`; Places session token reused across a search; failure → straight-line estimate, order still placed → remove the fallback | quota error, timeout, zero results, one pair vs many (the 1 Oct Matrix bug) | `routing`, `platform`, `riderPerKm`, `deliveryMarkup`, `charges`, `orderMap` |
| **19** ETA | ETA = measured prep (median of last 20, default until 20) + rider→kitchen + kitchen→door + handover; checkout promise frozen on the order; `ahead: true` only when live ETA ≤ promise − 3 min → change 3 to 0, use mean instead of median | kitchen with 0/19/20 orders; rider not yet assigned; GPS stale | `features`, `carryingWatch`, `qaAppText` |
| **1b** dispatch | exactly **one** rider offered at a time; the nearest by road among: online, approved, no active trip, under cash ceiling, not declined, fix < 2 min → drop each filter one at a time; offer expires at **108 s** and moves to the next → change to 0/never; decline moves on at once; after **5** riders ops alert fires once (not every cycle); accept after expiry refused (409); offer survives save→clear→load mid-offer; old "wake 6" path gone (`MAX_RIDERS_WOKEN` unused) | two riders equal distance (tie rule); rider goes offline during the offer; order cancelled during the offer; only one rider in town declines → cycling continues without duplicate pushes | `riderTripPush`, `abuseGuards`, `opsRescue`, `handoverPosition`, `lifecycleMoney`, `flows`, `pipeline`, `regression`, `riderPerKm`, `carryingWatch`, `cash`, `changeTracking` |
| **5** veg type + seal | partner sets `VEG/NON_VEG/BOTH` through a profile edit (admin approves); only a role with `restaurants.pureVegSeal` can set the seal (others 403) → remove `requirePermission`; customer view shows seal over the partner's choice; Pure Veg filter uses the seal | seal removed later; kitchen `BOTH` with seal (seal wins) | `features`, `profileEdits`, `fssaiBadge` (badge-by-admin pattern), `admin` |
| **9** section switch | section off → every dish in it unavailable to customers and refused in a cart/quote → drop the cart check; section on → each dish back to **its own** state (a dish switched off alone stays off) → overwrite dish state; partner can only switch own kitchen (other kitchen 403) | section with 0 dishes; "back at" time passes | `menuBuilder`, `optionGroups`, `dishOptions`, `offers`, `ownPricesAndSearch`, `kitchenPush` |
| **17** recommended | only `restaurants.recommend` can edit; order kept; recommended first on the feed and as the no-location list; a recommended kitchen that is blocked/unapproved is not shown → drop the status filter | | `features`, `admin` |
| **12** forgot password | code emailed (Brevo stubbed), 10 min, 5 tries then locked, rate-limited, single use; new password works, old fails, **every session revoked** (`SESSION_REVOKED`) → skip revocation; unknown email answers the same as known (no account discovery) | admin account; partner who is also a customer; code reuse after success | `otp`, `resetPasswordCard`, `accessRevoked`, `abuseGuards`, `identity` |
| **12** admin reset | partner/rider reset by admin with permission, audit line, email sent; without permission 403 | | `resetPasswordCard`, `admin` |
| **18/20** contact change | phone/email saved only after a code sent to the **new** address → save without code; old email notified; taken email/phone refused (`EMAIL_IN_USE`/`PHONE_IN_USE`); blocked identifier refused | change to own current value | `identity`, `customerAddsRole`, `multiRoleCustomer`, `profileEdits`, `otp` |
| **8** admin Create | builds the same records as self-sign-up (compare field-by-field with a self-registered one) → skip one field; permission `accounts.create`; temp password emailed, must change on first sign-in; blocked identifiers refused | create when the email is already a customer (multi-role path) | `onboarding`, `customerAddsRole`, `identity`, `kyc` via `adminEverything` |
| **4** Remove / Block | Remove: no sign-in on any app, sessions closed, kitchen hidden, rider off dispatch, data kept, can register again; Block: same + email/phone/document numbers refused at sign-up, sign-in, contact change and Create on all roles → skip one of those four checks; stored hashed; unblock by permission; refused with open orders | remove a partner who is also a customer (customer side?) — decide and assert | `accountBlocking`, `accessRevoked`, `identity`, `onboarding`, `sockets.security` |
| **14/15** deletion requests | request → off duty, still signs in, sees money, gets **no** offers/orders (Q2) → let offers through; approve refused while dues ≠ 0 → drop the dues check; review data includes dues, cash in hand, open orders, documents | partner with pending payout; rider with COD cash | `launchRound`, `multiRoleCustomer`, `accessRevoked`, `payouts`, `cash` |
| **11** person record | every document/photo for a person appears under them and **no one else's** → mix ids; ZIP has every file; only `people.read`-type permission | person with 0 files; file deleted from storage | `adminEverything`, `onboarding`, `fssaiBadge` |
| **16** help chat | menu answers come from our policy text and live order/refund state; "Talk to us" creates one ticket with the order and transcript attached → duplicate tickets on double tap; customer sees only own tickets | | `contract`, `partner`, `opsRescue`, `admin` |
| **2** kitchen ticket | PDF 80 mm (and 58 mm) wide; contains order number, kitchen, time, item names + quantities + options; **no ₹ and no amount anywhere** (text-extract the PDF) → add a price line; only the order's own kitchen can download (others 403); available after Accept only | 30-item order (page length), long dish names, Hindi/Kannada names | `statements`, `ownPricesAndSearch` |
| **22/21** tracking data | rider fix relayed to the order room only during a live trip; stale > 30 s flagged; snapped batch replaces raw points; other riders/customers cannot join the room | | `sockets`, `sockets.security`, `orderMap`, `carryingWatch`, `pipeline` |
| **6** masked call | on hold (owner) | – | `platform` (visibility) |

## Stage C — app engine (all four apps)

| Check | Expected |
|---|---|
| `npx expo-doctor` in each app | passes |
| `npx expo config --type introspect` before/after | only the intended `android` changes (New Architecture, maps key, removed Mapbox) — owner asked |
| Customer phone script steps 1–9 below | all pass on emulator **and** Vivo |
| Razorpay | payment page opens; success and failure both return to the app (emulator crashes on Razorpay: phone only) |
| Push with app closed | arrives on each app's own channel |
| Rider background GPS | keeps sending with screen off for 10 min |
| Websites | `node scripts/build-web.mjs` builds; `/partner`, `/admin` sign in and load |

## Stage D/E — phone scripts (QA server, emulator `qb34` then Vivo)

**Customer**
1. Fresh install → sign in with email code `123456` (QA fixed code) → lands on **"Where should we deliver?"** first (#7).
2. Skip → sees "Recommended by Quick Bites" + banner; set location → full list within 35 km; a closed kitchen shows **"Not delivering currently"** greyed, cannot be added (#1a, #3).
3. Save an exact pin with house/floor/landmark → it is the default next launch.
4. Heart a restaurant → **Favourites** section appears at the top (#13); unheart → disappears.
5. Restaurant page: a section switched off by the partner shows greyed with its time (#9); Pure Veg seal badge visible where set (#5).
6. Add to cart → stepper roll, soft haptic, cart bar bump; dish sheet opens/closes by swipe (motion spec).
7. Checkout cash order (test kitchen with COD on) → placed animation → tracking.
8. Tracking: as the rider moves (QA rider app on emulator), the **bike glides** and turns, never jumps; camera eases; "ahead of time" card when early (#19, #21).
9. Settings → Remove animations ON → every screen still works, no waiting on animations.
10. Change email/phone → code to the new address required (#18).
11. Help → guided answers → "Talk to us" → one ticket appears in Operations (#16).

**Partner**
1. Forgot password → emailed code → new password → old sessions signed out (#12).
2. New order → Accept → **Print ticket** → 80 mm PDF, no prices (#2); print dialog opens.
3. Switch a whole section off → customer sees it greyed within one refresh (#9).
4. Profile: cuisine type change goes to review; seal shows only if admin set it (#5).
5. Request account deletion → still signs in, no new orders (#15).

**Rider**
1. First "Go online" → full-screen tracking explanation **before** the system prompt, then "Allow all the time" (#22); persistent notification while online.
2. Offer arrives with a **108 s** countdown; let it expire → it disappears and the second QA rider gets it (#1b); decline → moves at once.
3. Accept → trip map (Google), call button behaves as today (masked calls on hold).
4. Screen off 10 min while carrying → customer map keeps moving.
5. Request deletion → signs in, sees money, gets no offers (#14).

**Operations (app and `/admin` website — same steps on both, #10)**
1. Create a restaurant + owner with documents; the owner signs in with the emailed temporary password and must change it (#8).
2. Record page for that restaurant shows every document grouped, each downloads, ZIP has all (#11).
3. Set Pure Veg seal, add to Recommended, change max distance (#5, #17, #1a).
4. Remove one test account, Block another; the blocked email/phone cannot register on any app (#4).
5. Deletion request review shows dues/cash/open orders; approve refused while dues remain (#14/#15).
6. A role without the new permissions sees those buttons refused (403) — website too.

## Gaps already visible (sent to the main session)

| Gap | Why it matters |
|---|---|
| `docs/TESTING.md` says the emulator never feeds a GPS fix to **Mapbox**; with Google Maps (C2) re-check whether `adb emu geo fix` now moves the bike on the emulator — if yes, add it to the script | lets #21 be tested without a phone |
| No suite reads a generated PDF's text today (`statements` has no PDF assertion; checked 18 Oct) — #2 needs a text-extract assertion for "no price" | a ₹ sneaking in is the failure that matters |
| Dispatch (#1b): `sweepStaleOrders(now)` already takes the clock (`modules/orders/orderSweeper.ts:106`); the new offer-expiry step must use that same `now`, not `Date.now()`, or the suite waits 108 s per hop | a 5-rider cycle would take 9 minutes per run |
| #4 Remove for a partner who is also a customer: the plan does not say whether the customer side survives — owner decision | otherwise the test cannot be written |

## QA log (newest first)

| Date | Commit | Result |
|---|---|---|
| 18 Oct | `bd5ca2b` (code; HEAD `a390bdd` adds review docs only) | **green**: gate 3088 passed / 0 failed, only `fssaiBadge` Windows exit crash (`UV_HANDLE_CLOSING`); typecheck 7/7; secrets, i18n (en/hi/kn 102 keys), APK secrets, hardcoded URLs, diagnostics, web build all pass |
