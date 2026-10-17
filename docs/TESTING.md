# Testing — the gate, every suite, how to QA

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. Commands: `COMMANDS.md`, `CLAUDE.md` §5.

## The gate (run before every push)

```bash
node scripts/run-backend-tests.mjs   # all backend suites, ~2-4 min, machine-wide lock
npx turbo typecheck
node scripts/check-secrets.mjs ; node scripts/check-i18n.mjs ; node scripts/check-apk-secrets.mjs
node scripts/check-hardcoded.mjs ; node scripts/diagnostics.js     # also run by CI
node scripts/build-web.mjs           # the /partner and /admin websites build
```

| Fact | Where |
|---|---|
| Each suite runs in its own process with its own throwaway data folder (`QB_DATA_DIR`) | `scripts/run-backend-tests.mjs:3` |
| A suite on disk but missing from the `SUITES` list fails the run | `assertEverySuiteIsListed`, `scripts/run-backend-tests.mjs:143` |
| The lock stops two gates running at once; its own check runs first | `scripts/test-gate-lock.mjs` (`run-backend-tests.mjs:169-177`) |
| Running one suite alone | `QB_DATA_DIR=$(mktemp -d) npx tsx apps/backend-api/src/test/<name>.test.ts` (refuses without `QB_DATA_DIR`, `db/client.ts:52`) |
| Shared helpers | `apps/backend-api/src/test/helpers/`, `connectionProbe.ts` |
| CI on GitHub | `.github/workflows/ci.yml`: secrets, hardcoded URLs, diagnostics, `npm run build`, `npm run test`, `docker compose config` |
| Release guards' own test | `node scripts/test-release-guards.mjs` (reads `quick-bites-release-archive/2026-09-23`) |
| Pricing engine unit test | `packages/pricing-engine/src/index.test.ts` |

**Baseline on 17 Oct 2026 (`c25685c` and `3caa076`):** 1344 checks passed, 0 failed; the run
reports `1 SUITE(S) FAILED: fssaiBadge` only because of the known Windows exit crash below.

**Code vs `CLAUDE.md`:** `CLAUDE.md` said 84 suites; there are **89** on disk (all listed in the runner; `deliveryRadius` and `catalogueCuration` added 18 Oct).

## Known environmental failures (Windows, not defects)

| Suite | Symptom | Status |
|---|---|---|
| `fssaiBadge` | every check passes, then `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` on exit | same on the code before the SDK 54 upgrade |
| `onboarding` | can fail in the full gate with `EACCES` on port 5040 (Windows-reserved) | passes alone |

## How we test (rules learned the hard way)

- Mutate the guard and watch the check fail before believing a green check; a mutation harness reads stdout **and** stderr.
- A check that greps source strips comments first; never hardcode a date its fixtures compare against.
- Money: pay the same payee twice; run with a real hold period; assert `payable + held === outstanding`.
- Test a browser POST under production rules (`config.IS_PRODUCTION = true`): the QA server allows every origin.
- Verify against what is deployed (`/health` uptime after a push), not only a green suite.

## Private QA server (every QA round)

From `apps/backend-api`: `NODE_ENV=development PORT=7071 DEMO_MODE=true SEED_DEMO_DATA=true`, a
throwaway `QB_DATA_DIR`, local `JWT_SECRET`/`ADMIN_EMAIL`/`ADMIN_PASSWORD`, `OTP_PROVIDER=fixed
OTP_FIXED_CODE=123456`, every live service variable blank, `DATABASE_URL` unset, Razorpay
**test** keys from `.env`. Apps reach it via the hidden Server settings (6 taps on the sign-in logo).

- **Emulator:** AVD `qb34` (Android 14, x86_64), boot with `-gpu swiftshader_indirect` (the host GPU
  leaves the device "offline"), API at `http://10.0.2.2:7071/api`. Drive it with `adb`
  (`uiautomator dump` fails during continuous animations: use `screencap`). The Android 16 AVD
  `qb-test` never comes online; leftover `emulator`/`qemu` processes and `*.lock` files in
  `~/.android/avd/*.avd` block the next boot; Mapbox renders black in software mode (fine on phones);
  Razorpay's payment page crashes the emulator; **the emulator never feeds Mapbox a GPS fix**, so
  GPS-dependent crashes only show on a phone.
- **Owner's phone (Vivo V2312, Android 15):** `adb reverse tcp:7071 tcp:7071` → `http://localhost:7071/api`.
  Cleartext is allowed for localhost. Saved crashes: `adb shell dumpsys dropbox --print data_app_crash`
  (native: `data_app_native_crash`). Vivo asks to confirm USB installs and may drop authorisation mid-install. The phone's Customer and Operations
  apps are signed in to LIVE accounts: never order or change anything with them; afterwards `pm clear`
  only the apps pointed at QA and `adb reverse --remove-all`.

## Every suite (`apps/backend-api/src/test/<name>.test.ts`)

Description = the suite's own header line.

| Suite | Protects |
|---|---|
| `abuseGuards` | The ways an order could be walked backwards, sideways or for free. |
| `accessRevoked` | Losing access ends the connections already open (S11), and a password |
| `accountBlocking` | Blocking an account, and stopping an unverified kitchen going online. |
| `addressPin` | A new address needs a map pin once the owner switches unpinned addresses off (U3). |
| `admin` | The admin console, end to end, over HTTP. |
| `adminErrorStates` | Every admin screen shows its failures, and cannot quietly stop. |
| `adminEverything` | WHAT THIS IS ABOUT |
| `adminPush` | TELLING AN ADMINISTRATOR, AND TELLING ONLY THE RIGHT ONE. |
| `adminReads` | The admin app reads what the server actually sends (QA #1, 26 Sep). |
| `adminSections` | Every admin section loads, and a change made in it sticks and is recorded. |
| `adminTools` | The admin phone app's remaining tools, through the routes it calls: |
| `anonymousAccess` | Anonymous access: every route, called with no sign-in. |
| `apnsPush` | IPHONE PUSH: Apple's service carries iPhone tokens, FCM keeps Android's. |
| `appMaths` | The app-side maths behind three of the owner's 1 Oct 2026 requests, loaded |
| `bankChain` | The bank chain, end to end, over HTTP: a partner adds an account, an |
| `bodyContract` | Every request body the four phone apps send matches what its route accepts. |
| `carryingWatch` | THE RIDER WHO HAS THE FOOD, WHICH NOTHING WATCHED. |
| `cash` | Cash a rider is carrying: the ceiling, the deposit, and the two numbers. |
| `cashLocations` | Cash has four locations, and money must never appear between two of them. |
| `changeTracking` | A save writes what changed, and nothing changes without being marked (S1). |
| `charges` | What each restaurant costs, and who gets which part of it. |
| `contract` | Do the apps and the server agree about what exists? |
| `customerAddsRole` | A customer becomes a partner or rider with the SAME email (owner, 17 Oct 2026). |
| `db` | TEST 8: DELIVERY DOES NOT INVENT A PAYMENT. |
| `deliveryMarkup` | The platform charges more for delivery than it pays for it, and the rider |
| `dishOptions` | Dish options, end to end (F05), and checked on every order (S10). |
| `duplicateCapture` | A customer charged twice for one order gets the second payment back. |
| `durableMoney` | A money route answers only once its write is in the database (N19 / S2). |
| `features` | The Phase 6 features: reorder, tipping, live ETA, discovery filters, and |
| `flows` | CAN AN ORDER GET STUCK? |
| `fssaiBadge` | The "FSSAI verified" badge: only for a licence an administrator approved. |
| `gatewaySettlements` | Money in: what the gateway holds, what it keeps, and when it is really ours. |
| `handoverPosition` | Where the rider was when a delivery was confirmed, checked on EVERY delivery path. |
| `health` | (no header comment) |
| `identity` | One phone number is one PERSON, and a person can be more than one thing. |
| `itemPricing` | Typing a customer's price on one dish, and the three totals that must never |
| `kitchenPush` | The kitchen gets told, on a phone that is not open. |
| `launchRound` | The 2 Oct 2026 round, end to end (docs/plans/cod-menus-payouts-playstore-2026-10-02.md). |
| `ledger` | The ledger, and the rates that feed it. |
| `lifecycleMoney` | Whole order lifecycles, over HTTP, with the books checked after every step. |
| `marginGuard` | The platform's margin per order: a floor at checkout, and a report of losses |
| `membership` | Quick Bites Gold: does it start, does it stop, and does it stack correctly? |
| `menuBuilder` | A whole menu at once, and a menu read from photos (owner, 1 Oct 2026). |
| `moneyPaths` | Two ways money was promised and never moved, and the reason neither showed up. |
| `moneyReached` | Telling people their money arrived, and telling a customer what is happening. |
| `multiRoleCustomer` | One person, several apps (owner, 17 Oct 2026): a restaurant owner or rider |
| `notifications` | Notifications that can actually reach a phone. |
| `offers` | The offer badge and the home-screen banner: derived, or absent. |
| `onboarding` | Getting onto the platform. |
| `opsRescue` | Operations can rescue a trip that went wrong on the road (A1, A2, A3). |
| `optionGroups` | The choices on a dish, seen from the customer's side: quote and checkout agree. |
| `orderMap` | THE MAP FITS, AND THE RIDER'S POSITION IS NOT HANDED OUT EARLY. |
| `orders` | A Gold member now pays a DISCOUNTED delivery fee, not a free one. |
| `otp` | Phone sign-in. |
| `ownPricesAndSearch` | The owner's QA pass on v8 (26 Sep), server half: #4 #5 #6 #7 #8. |
| `partner` | The restaurant partner's whole journey, driven over HTTP the way the app does. |
| `payees` | Payout accounts: whose account is it, and can the platform prove it? |
| `payments` | Payments. |
| `payoutPromise` | WHAT WE PROMISE ABOUT MONEY ARRIVING, AND THE CONTROL THAT USED TO IMPLY |
| `payouts` | Paying people: what is owed, who may authorise it, and what stops it. |
| `persistenceAlert` | A write the backstop had to save reaches the owner, once, by name. |
| `pipeline` | End-to-end order pipeline across all four portals. |
| `platform` | The machinery that runs when nobody is pressing anything. |
| `platformReset` | Emptying the platform: every guard, and what survives. |
| `policies` | Payment policies, and the sweep that goes looking for money gone wrong. |
| `profileEdits` | The restaurant profile: two versions of one restaurant, and the review that |
| `profitGuards` | Money the platform used to give back, and the controls that stop it. |
| `catalogueCuration` | B5: kitchen type is the partner's (reviewed edit), Pure Veg seal staff-only and outranks it, section switch everywhere (menu, quote, checkout, search, back-at time), recommended list first and as the no-location list. |
| `deliveryRadius` | One 35 km radius on the map (list and checkout), closed kitchens listed after open ones, rider pay sliding with distance, cash only up to 15 road km, the 35 km applied once (master plan B1). |
| `qaAppText` | The owner's QA pass on v8 (26 Sep), app half: #9 to #15. |
| `qaRound1` | v9 QA round 1 (26 Sep), server fixes: V9-16, V9-8, V9-2, V9-3. |
| `rateLimitPerUser` | The request limit is per account, not per address (N15 / S4). |
| `ratesAndSwitches` | Every rate and every switch controls the thing it is named after. |
| `refunds` | Refunds: every case in PAYMENTS_PLAN §5.7, and the defect they replace. |
| `regression` | The reported defects, each driven through the layer that actually caused it. |
| `resetPasswordCard` | The admin app shows the reset-password card only to people the route lets use it. |
| `resilience` | Money, concurrency and survival. |
| `riderPerKm` | Rs 10 a road km, and one figure from quote to payout (owner, 1 Oct 2026). |
| `riderTripPush` | THE RIDER GETS TOLD A TRIP IS WAITING. |
| `routeContract` | Every route the apps call exists on the server, with the method they use. |
| `routes` | NO ROUTE MAY BE SHADOWED BY ANOTHER. |
| `routing` | Road distance: what it returns, and what it returns when Google will not. |
| `search` | (no header comment) |
| `security` | And the number cannot be taken twice. |
| `settlementsAgree` | Pay and Settlements are one system, and used to be two. |
| `sockets.security` | WebSocket authorization. |
| `sockets` | A signed token for a seeded account. |
| `statements` | Statements, and asking to be paid. |
| `webApps` | THE /partner AND /admin WEBSITES, as the server hands them out. |
