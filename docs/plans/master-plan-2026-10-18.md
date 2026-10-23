# Master plan — features, maps, live tracking, security and the new feel (18 Oct 2026)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

## START HERE — any new session (AI or developer) continues from this file

> ### ▶▶▶▶▶ ROUND 7 — 23 Oct 2026 (newest; BUILT, build 48)
>
> The owner's build-47 findings: an 800 m home billed as ~5 km (Google's shortest *legal* route U-turns on Harohalli's
> divided roads → fair-distance cap, 1.25 × straight line, owner), new-kitchen rates (10 % markup, ₹5, 2 %, 5 % GST), the kitchen alarm (every minute while unaccepted, alarm volume from build 48), Help's "That order could not be found" (topic id sent as the
> order id since 20 Oct), the keyboard covering the help-chat box in all apps, and "Change password" in the Customer app.
> Standalone plan with evidence and checks: **[`round7-fair-distance-help-chat-password-2026-10-23.md`](round7-fair-distance-help-chat-password-2026-10-23.md)**.
> Next build: **48**.
>
> ### ▶▶▶▶ ROUND 6 — 22 Oct 2026 (BUILT 22 Oct, build 47)
>
> Live help chat that stays open until solved (WhatsApp-like, Operations chat screen), notifications fixed in Partner/Rider
> and a "Phone permissions" card in every app, a one-time location guide for new customers, the Android zoom snap-back on
> the live tracking map, bugs, a manual security review (the Claude Security scan could not run: no Workflow tool), and the
> old leftovers re-checked against the code. Standalone plan: **[`round6-help-chat-notifications-location-2026-10-22.md`](round6-help-chat-notifications-location-2026-10-22.md)**.
> **Build 47** (APK + AAB, all four apps, 22 Oct) archived in `quick-bites-release-archive/v47-live-help-permissions-location-2026-10-22/`, for the owner to test. Launch readiness (load, updates, attacks, payments): [`launch-readiness-2026-10-22.md`](launch-readiness-2026-10-22.md), first safe server fixes built; the rest waits for the owner's discussion.
>
> ### ▶▶▶ ROUND 5 — 21 Oct 2026 (overrides the blocks below where they differ)
>
> **The owner is the tester now** (the Tester session was deleted 21 Oct). Round 5 fixed three things the owner found
> on a live order: the route (shortest Google motorbike route for fee, pay, time and map), the customer's arrival time
> (kitchen time + ride, still, red "+N min" when late) and the kitchen ticket (prints like a POS bill and stops);
> and (D) the customer cancels only before the kitchen accepts again (2-minute window removed).
> Standalone plan with root causes and checks: **[`round5-route-time-ticket-2026-10-21.md`](round5-route-time-ticket-2026-10-21.md)**.
> Built, pushed, and in **build 46** (APK + AAB, all four apps; 45 was a stopped build, never released), archived in `quick-bites-release-archive/v46-route-time-ticket-cancel-2026-10-21/`, for the owner to test. Next: whatever the owner reports.
>
> ### ▶▶ ROUND 3 — 20 Oct 2026 evening (overrides the block below where they differ)
>
> The owner gave 11 new items and restarted the loop: **work list = [`round3-owner-items-2026-10-20.md`](round3-owner-items-2026-10-20.md)**
> (phases A–H, tracker at its end; round-2 leftovers are its phase H). Build number for this round: **40**.
> Owner rules 20 Oct: act on each Tester report at once (replaces "wait for the owner"); the loop runs until
> the Tester's VERDICT is ALL GOOD; new money rule (pickup pay ₹6/km beyond 7 km) is in that file and CLAUDE.md §4.
> Builder = the session that wrote that file; Tester = the session it started named `tester`.
> **State 20 Oct:** round 3 (build 42) tested: 26 findings, all handled in round 4 (`6c653b1`, see the round-3 plan,
> "Round 4"). **Build 43** (APK + AAB) archived in `quick-bites-release-archive/v43-round4-fixes-2026-10-20/`; handed to
> the Tester for round 4.
>
> ### ▶ CURRENT STATE — 20 Oct 2026 (read this first; it overrides older status lines below)
>
> **Everything in Stages A–H is built and on `main`** (last commit `080437a`, gate green apart from the
> two known local failures `health` and `fssaiBadge`). Only B9 masked calls (owner: later; plain calling
> is used) and phone change by SMS code are not built.
>
> **The work now is a loop (owner, 19–20 Oct):** this session builds; ONE session named **Tester**
> (`local_70a4d56b-f4cb-4c9a-8565-ee5330fd9bdb`) tests all four apps on the emulator against the
> private QA server in every case (end-to-end flows across the apps, cancellations by each party,
> help chat, refunds, payouts, money maths by hand, notifications in all 4 apps) and writes one report
> `docs/qa/TEST_REPORT-<date>-build<N>.md`. The builder then researches each finding, plans, fixes with
> a check, rebuilds APK + AAB, and sends the Tester back. Repeat until the Tester's VERDICT is ALL GOOD.
> The jury sessions are dropped. Only one session runs at a time.
> **Owner, 20 Oct: when the Tester sends a report, do NOT act on it until the owner says so.**
>
> **Where the loop stands:**
> | Round | Build | Report | Status |
> |---|---|---|---|
> | 1 | 36 | `docs/qa/TEST_REPORT-2026-10-19-build36.md` (T-1…T-19) + code review `docs/reviews/REVIEW_LOG.md` (J-C1…J-C18) | fixed in `ed4886a` (Stage H) |
> | 2 | 39 | `docs/qa/TEST_REPORT-2026-10-19-build39.md` (R2-1…R2-22, VERDICT ISSUES FOUND) | part 1 fixed in `080437a` (R2-1, R2-2, R2-3*, R2-4, R2-5, R2-6, R2-7, R2-15, R2-16 part, R2-21); *R2-3 needs a phone check |
>
> **Next steps, in order:**
> 1. Fix the rest of round 2 (each: read the report entry, find the root cause, fix, add a check, mutate it):
>    - R2-8 customer offline shows "No saved addresses" → `customer-mobile/src/screens/DiscoveryFeedScreen.tsx`: tell
>      a network failure from "none", show an offline note + retry, reload on reconnect.
>    - R2-9 Operations "Forgot password?" still shows the old "ADMIN_PASSWORD" text → `admin-mobile/src/screens/LoginScreen.tsx:121-131`:
>      use the same email-code flow as Partner/Rider (`/auth/password/forgot`, `/auth/password/reset`).
>    - R2-10 Create-with-password dialog says "email sent" → `admin-mobile/src/components/AccountTools.tsx:56`: the api client
>      returns only `payload.data`, so `result.message` is undefined; word the alert from whether a password was typed.
>    - R2-11 rider in-trip chat keyboard covers the box → `delivery-mobile/src/components/TripChat.tsx` (KeyboardAvoidingView "padding").
>    - R2-12 Partner header stays "Awaiting verification" after approval → refresh the kitchen on pull-to-refresh / app focus (`restaurant-mobile/App.tsx` loadProfile).
>    - R2-13 Kitchen Location: Ops-created kitchen starts at the Bengaluru placeholder; no "no results" text; `maps.app.goo.gl` share
>      links cannot be read (explain: open the link, copy the coordinates); no "Saved" confirmation → `admin-mobile/src/components/KitchenLocation.tsx`.
>    - R2-14 new kitchen card shows "Non-Veg" with only veg dishes, and a default "₹400 for two" → card uses `cuisineType`/defaults; show nothing when unset.
>    - R2-17 Partner dish request error shown far from the button → show the form error next to "Send for approval".
>    - R2-18 customer Home active-order strip only after restart → `customer-mobile/src/lib/useActiveOrders.ts`: refresh on focus/socket.
>    - R2-19 customer app never asks notification permission on Android 14 → `customer-mobile/src/lib/pushRegistration.ts:31-44`: create the
>      `order-updates` channel BEFORE `requestPermissionsAsync`.
>    - R2-20 fully refunded delivered order counted as "cancelled" on the Partner dashboard (completion rate) → server dashboard stats.
>    - R2-22 one owner, two kitchens: payee account is per kitchen → say so in the Partner bank screen.
>    - R2-16 rest: server texts still "Rs" (formatPaise in `modules/payments/money.ts`, ~100 uses, 29 test files); PDFs must keep "Rs" (font).
> 2. Gate, push, then build APK + AAB (rules below), copy back, archive, commit `release/version.json` + 4 `app.json`.
> 3. Message the Tester for round 3 (same brief as round 2: see its session), then STOP and wait for the owner.
>
> **How to build APK + AAB (19 Oct, Windows 260-char limit, C: is full):** never build in the project folder.
> Use the git worktree `D:\qbx` (`D:\qb` is a junction to the project — do not use). Steps:
> `git -C D:/qbx checkout -- release/version.json apps/*/app.json` → `git -C D:/qbx checkout --detach main` →
> copy `release/version.json` from the project → in `D:/qbx`: `export TEMP=D:/dev-data/temp TMP=D:/dev-data/temp
> GRADLE_USER_HOME=D:/dev-data/gradle ANDROID_HOME=D:/dev-data/android-sdk QB_KEYSTORE_VAULT=D:/dev-data/quickbites-keystores`
> → `npm ci` → `bash scripts/build-apks.sh --aab` (run in the background, ~25 min) → copy `D:/qbx/build/apk/*.apk`,
> `D:/qbx/build/aab/*.aab`, `release/version.json` and the four `app.json` back → archive in
> `D:\my all projects\quick-bites-release-archive\vNN-<what>-YYYY-MM-DD\` → `node scripts/check-apk-secrets.mjs` → commit.
> **Owner rule: every build updates the AABs together with the APKs** (same versionCode; Operations has no AAB).
> Builds so far: 36 (19 Oct), 39 (19 Oct, current APKs/AABs; 37/38 were refused builds). Next build gets 40+.
>
> **Machine facts (19 Oct):** all dev tools are in `D:\dev-data` (android-sdk, android-avd, gradle, npm-cache,
> temp, quickbites-keystores); user env vars point there. `C:\qb` is a dead 5 GB build copy the tool may not delete
> (owner deletes it). Emulator `qb34` (`D:/dev-data/android-avd`), driven with mobile-mcp. QA server: `docs/TESTING.md`.
>
> **iPhone (customer app):** code lines up with Android build 39 (`ios.buildNumber` 39, Google Maps via Expo's built-in
> maps step when `GOOGLE_MAPS_IOS_KEY` is set, no Face ID text). Not built. Owner must add `GOOGLE_MAPS_IOS_KEY` to
> expo.dev → Environment variables first (`docs/app-store/IOS.md` §2.3), then build per §3.
>
> **Waiting on the owner:** archive the sessions held by "Keep computer awake" (Code reviewer, Security reviewer,
> Senior dev skills setup); delete `C:\qb`; Play Integrity link (`OWNER_ACTIONS.md` 00.8); privacy-policy line on
> rider location; Expo `GOOGLE_MAPS_IOS_KEY`; everything in `OWNER_ACTIONS.md` Part 0.


The owner may open a fresh session and paste only this file's path. Do this, in order:

1. **Load the main skills first** (Skill tool): `seniordev`, then `cleancode`. Follow them on every
   change: read the code first, reuse what exists, shortest correct diff, one runnable check per
   non-trivial rule, mutation-check it (break the guard, watch the check fail, put it back).
   Also available when a step needs them: `security-review`, `superpowers:verification-before-completion`,
   `expo:*` (Stages C–E), `vercel-react-native-skills`, `skills:react-native-best-practices`,
   `ui-ux-designer`, context7 (library docs), mobile-mcp (phone/emulator).
2. **Read**: `CLAUDE.md` (owner, money rules §4, working rules §8), `docs/FOLDER_MAP.md`, then this
   file's **Owner decisions**, **Who builds what**, **Tracker** and **Findings** tables, then the top
   3 entries of `CHANGELOG.md`.
3. **See where work stopped**: `git log --oneline -15`, `git status --short`. Uncommitted files that
   are NOT yours may be another session's work in progress (check "Who builds what" and file times):
   never edit, stage, stash or revert them. The next step is the first Tracker row not ✅ in the
   current stage, in your own column of "Who builds what".
4. **Each step**: server change + one suite (listed in `SUITES` in `scripts/run-backend-tests.mjs`)
   + docs in the same commit (`CHANGELOG.md` top entry "For the owner" first, this Tracker row,
   the stage's **Built:** line, the maps in `docs/`). Gate: `node scripts/run-backend-tests.mjs`
   (if it refuses because another session's new suite is not listed yet, run a scratch copy of the
   runner with only `assertEverySuiteIsListed()` removed, never edit their file). Typecheck. Stage by
   explicit path only. Push `main` (deploys live), then ask devops-sre to confirm `/health`.
5. **Team sessions** (started 18 Oct, may still exist): security-reviewer, code-reviewer, qa-engineer,
   devops-sre, product-designer. They write only their own files (`docs/SECURITY.md`,
   `docs/reviews/REVIEW_LOG.md`, `docs/qa/QA_PLAN.md`, `docs/ops/OPS_GUIDE.md`, `design/`) and send
   findings; fix theirs that fall in your files, then reply with the commit.
6. **Never**: money rules changed without the owner; secrets in any tracked file (repo is PUBLIC);
   competitor names or assets in the repo; `git add -A` / stash / reset / clean; APK builds unless the
   owner says "make APK"; signing in to live with the owner's password.
8. **Order of work (owner, 18 Oct 2026, replaces "review after each step"):**
   (a) **Build everything first**: every remaining stage (B, C, D, E, F), each step complete with
   all its cases, its suite and mutation checks, pushed as it is finished.
   (b) **Then the jury reviews everything** (code-reviewer, security-reviewer, qa-engineer,
   devops-sre, product-designer), and their findings are applied in one round.
   (c) **Then the main session tests everything itself, end to end, in all four apps and both
   websites**: every feature from Admin to Customer (sign-up, documents upload/re-upload/verify,
   menus, ordering, dispatch, tracking, delivery, money, payouts, deletion, help chat), on the
   emulator/phone (mobile-mcp) and on the live `/partner` and `/admin` pages (built-in browser),
   never with the owner's live Customer/Operations accounts. Stage G (APK build) only after (c),
   and only on the owner's "make APK".
   Reviewers may still send findings while building; they are logged, and fixed in (b) unless a
   finding is a live security hole (fix at once).
   **Exception, done first (owner, 18 Oct):** document re-upload and re-verify for partners and
   riders (FSSAI number editable), arranged per person in Admin, live on the websites. ✅ built 18 Oct.
7. **Owner decisions still open** are marked ⏳ in the Findings table: build around them with
   today's behaviour, never decide them yourself.

## Status

**Build complete (19 Oct 2026): stages A–F are on `main` and live.** Not built: B9 masked calls (on hold,
owner) and phone change by SMS code (waits for SMS). Next, per the owner's order (START HERE item 8): one jury
review round of everything, fixes, then the end-to-end test of all four apps and both websites; Stage G only on
"make APK". This is the one plan to follow.
It takes in, and replaces as the order of work:
[`k1-k3-fixes-2026-10-17.md`](k1-k3-fixes-2026-10-17.md),
[`new-architecture-and-animations-2026-10-17.md`](new-architecture-and-animations-2026-10-17.md) (its steps stay the recipe for Stage C),
[`customer-app-feel-2026-10-17.md`](customer-app-feel-2026-10-17.md) (its phases stay the recipe for Stage D), and
the motion spec in [`design/motion/`](../../design/motion/README.md).

**How to keep it current:** when a step is built, change its row in the **Tracker** (status, commit,
date) and add one line under "Built" at the end of its stage. Never delete a row.

---

## For the owner, in one screen

| | |
|---|---|
| **What you get** | 23 changes you asked for on 17–18 Oct, Google Maps everywhere with a moving bike on the customer's map, the polished feel and motion, and a full security pass. Every app and both websites stay in step. |
| **Order** | Server first (no app build needed, goes live on push), then the app engine, then the screens, then security, then one build of all four apps. Nothing later can break something earlier, because each stage only builds on finished, tested stages. |
| **Time** | About 6–8 weeks of AI work plus your phone tests (estimates per stage below). |
| **What only you can do** | Google Cloud billing + 3 keys, Exotel account (masked calls), photos/illustrations, Play Console declarations, answers to the 6 questions below. List: §"Owner's list". |
| **Cost to run** | Google Maps: maps inside the apps are free; address search, road distance and snap-to-road are metered with monthly free amounts (check the India price list in the Cloud console). Exotel: per-minute call charges + a virtual number. Railway Pro: already paid. |

### Owner decisions (18 Oct 2026, "make" given)

| # | Decision |
|---|---|
| Q1 | **No permanent delete.** Two admin actions instead: **Remove** (account closed: cannot sign in anywhere; may register again fresh) and **Block** (closed AND its email, phone, FSSAI/GSTIN/PAN/licence numbers can never be used again on any of our apps). Data kept. |
| Q2 | A rider/partner who asked to delete: can sign in to see money and settle dues, gets no new orders/trips until an admin approves or rejects. |
| Q3 | Help chat answers itself with **fixed answers** from our policies + live order/refund status; then a person. No AI writing replies. |
| Q4 | Login top: our own animated Quick Bites illustration (default, not yet confirmed). |
| Q5 | Illustrations: AI-drafted, hand-finished in our colours; food photos stay real (default, confirm before Stage D). |
| Q6 | Dispatch: one rider at a time, 108 s each; after **5** riders operations is alerted, offers keep cycling. |
| – | **Masked calls (B9) on hold** by the owner; today's behaviour stays (number shown only during the live trip). |
| – | Everything fully secured, optimised, nothing existing disturbed (Rules section). |

---

## Who builds what (owner, 18 Oct 2026: two sessions in parallel, same folder)

| Session | Steps | Files it owns (the other never edits them) |
|---|---|---|
| **Senior dev clean code skills** (main; the only one that pushes) | done: B1, B5, B4, B3 · now: B6, security L1 (authRouter part), R2, R3 · then C–G with the owner | `routes/{authRouter,restaurantRouter-B5 parts}.ts`, `routes/admin/{peopleRoutes,catalogRoutes}.ts`, `db/repositories/userRepository.ts`, `modules/orders/{orderService,orderSweeper,tripOffers,eta,opsRescue}.ts`, `modules/{restaurants,search,places}/*` |
| **b8-help-chat** (parallel; **no longer running as of 18 Oct ~03:00**; its B11 work was finished by main) | done: B8, B10, B7, Stage F L2/L4/R6 · now: B11 live tracking data, security L1 (restaurantRouter/walletRouter), L3, L5, L6, review R5 | `routes/riderRouter.ts` (telemetry parts; B4 claim/list/decline stay as built), `sockets/{socketServer,socketAuth}.ts` (location handling; B3 `eta` field stays), `db/repositories/riderRepository.ts`, `routes/kycRouter.ts`, `routes/walletRouter.ts`, `db/normaliseStore.ts`, the L1/L3/L5/L6 lines in `routes/restaurantRouter.ts` |

Shared files (`CHANGELOG.md`, this plan, `docs/TESTING.md`, `scripts/run-backend-tests.mjs`, `shared-types`, `CLAUDE.md`, `REVIEW_LOG.md`): re-read right before a small additive edit. Stage by path only.

## Tracker (one row per item; update as we build)

Status: ⬜ not started · 🟨 exists partly today · ✅ built in this plan.

| # | Item (owner's words, short) | Today in the code | Stage | Status |
|---|---|---|---|---|
| K1 | Rider "Call customer" has no number | fix written, uncommitted (`orderService.ts`, `riderRouter.ts`) | A1 | ✅ 18 Oct |
| K2 | Bad `Origin` → 500 | fix written, uncommitted (`cors.ts`) | A1 | ✅ 18 Oct |
| K3 | Confirm links lost on deploy | fix written, uncommitted (`authRouter.ts`, `client.ts`) | A1 | ✅ 18 Oct |
| 1a | Restaurants within **35 km** | one admin radius `maxDeliveryKm` = 35 (owner, 18 Oct: kitchens no longer choose), list and checkout same circle (`deliveryRadiusKm`, `pricingConfig.ts`) | B1 | ✅ 18 Oct |
| 1b | Offer trip to **one** rider at a time, nearest free online first, **108 s** to accept, then next | server ✅: `order.riderOffer` + `modules/orders/tripOffers.ts` (one offer per trip and per rider, timer per offer + sweeper backstop, decline moves on at once, alert after 5, keeps cycling); claim only by the offered rider in time; Rider-app countdown screen in Stage E | B4 | ✅ 18 Oct (app E) |
| 2 | Kitchen ticket (receipt) to print, no prices, after Accept | server ✅: `GET /api/orders/:id/kitchen-ticket?width=80|58` (`modules/orders/kitchenTicket.ts`, PDF one page as long as the order); Print button in Partner app + website in Stage E | B10 | ✅ 18 Oct (app E) |
| 3 | Offline kitchen shows "Not delivering currently"; list by customer's location | server ✅: closed kitchens listed, after open ones in every sort; Customer app label changed (reaches phones with the next build) | B1 | ✅ 18 Oct (app at G) |
| 4 | Admin: **Remove** or **Block** a restaurant/rider (Q1), by role permission | server ✅: Block bans email (canonical), phone, FSSAI, GSTIN, licence (`modules/platform/blockedIdentifiers.ts`); Remove `POST /api/admin/accounts/:userId/remove` (typed name, reason, per-kind permission, data kept, may re-register); suite `removeAndBlock`; screens in Stage E | B6 | ✅ 18 Oct (app E) |
| 5 | Kitchen type veg / non-veg / both on profile; **Pure Veg seal** only admins give | server ✅: `cuisineType` (partner, reviewed edit), `isPureVeg` = the seal (permission `catalog.restaurants.pureVegSeal`), seal outranks the type for customers; badge look in Stage D | B5 | ✅ 18 Oct (apps D/E) |
| 6 | Rider calls customer without seeing the number | **built but switched off**: Exotel masked call (`modules/orders/callMasking.ts`, route in `orderRouter.ts:~780`); Rider app still dials the number. **On hold (owner, 18 Oct)** | B9 | ⏸ |
| 7 | Customer: choose location / save address **first**, then restaurants; without address → our recommended list | server ✅ (B5): no location → `listKind: 'recommended'`, `needsLocation: true`; the location-first screen is D3 | B5 + D3 | ✅ 19 Oct (D3 sheet, recommended banner) |
| 8 | Admin "Create": build a whole restaurant / rider / partner account, verify and upload for them | server ✅: `POST /api/admin/accounts/create` (sign-up's own builders, temporary password emailed, per-kind permission); documents via existing `/api/kyc/submit`, approval via existing review; suite `adminCreate`; screen in Stage E | B6 | ✅ 18 Oct (app E) |
| 9 | Partner switches off a **whole menu section** (e.g. dosa after 7 pm) | server ✅: section switch with optional "back at" time, partner + admin routes, `modules/restaurants/menuSections.ts`; switches in the apps in Stage E | B5 | ✅ 18 Oct (apps E) |
| 10 | Every Admin/Partner app feature also on the websites | **automatic**: the websites are the same app code (`scripts/build-web.mjs`); each stage checks the web build | all | ✅ (by design) |
| 11 | KYC and uploads arranged **per person** (restaurant, rider, customer), view and download | server ✅: `GET /api/admin/records/:kind/:id` (documents grouped, photos, tickets, history, each by permission), one file or all as ZIP (`routes/admin/recordRoutes.ts`); **Admin screens ✅ 18 Oct**: People sheets and KYC names show each person's uploads grouped, in force/earlier, photo, download, re-verify; every document replaceable by partners and riders (owner's "do first") | B7 | ✅ 18 Oct (app E) |
| 12 | Forgot password with email code; admin can reset for partner/rider | server ✅: forgot/reset by email code (`/api/auth/password/forgot`, `/reset`, suite `passwordReset`); admin reset for partner/rider already existed (`/admin/staff/:id/reset-password`, per-kind permission, audit, sessions cut); app screens in Stage E | B6 | ✅ 18 Oct (app E) |
| 13 | Customer: liked restaurants in a **Favourites** section | favourites saved (`/customers/favourites`), heart on cards; no section | D3 | ✅ 19 Oct (Favourites row) |
| 14 | Rider delete = request; admin approves after seeing everything | server ✅: request keeps sign-in (Q2), no new trips (`DELETION_PENDING`), admin list carries dues, cash, orders, documents, last activity; review screen in Stage E | B6 | ✅ 18 Oct (app E) |
| 15 | Same for restaurants | server ✅ same flow (kitchen closed while pending) | B6 | ✅ 18 Oct (app E) |
| 16 | Help chat: answers itself first, then a person with all the info | server ✅: `GET /api/support/help` (topics per app) and `/help/:topic` (fixed answers from live data, `modules/support/helpChat.ts`); "Talk to us" = the existing ticket with the chat rebuilt by the server; staff reply pushed; screens in Stage D/E | B8 | ✅ 18 Oct (apps D/E) |
| 17 | Admin picks **recommended** restaurants shown first | server ✅: `GET/PUT /api/admin/recommended-restaurants` (permission `catalog.restaurants.recommend`), first on the home in admins' order; Operations screen in Stage E | B5 | ✅ 18 Oct (app E) |
| 18 | More profile fields; phone/email change only with a code | server ✅ email change with two proofs; **phone change by support until SMS** (settled with security, M1); more profile fields with #20; screens in Stage E | B6 | 🟨 (email ✅, phone at SMS) |
| 19 | Real delivery time from cooking + distance; "We're ahead of time!" | server ✅: kitchen's measured cooking time (median of last 20 by cart size), rider's ride to the kitchen, promise frozen at checkout (`promisedArrivalAt`), `eta.ahead`; ETA on status and rider-position sockets; quote `estimatedDeliveryMinutes`. Road time with B2; card in Stage D | B3 + D | ✅ 18 Oct (server) |
| 20 | Proper edit options in every profile | server: customer name/language + contact change ✅; rider profile (phone by code, approved licence/RC locked) ✅; partner profile edits reviewed, incl. GSTIN/FSSAI (F-13 ✅); screens in Stage E | B6 + E | ✅ 19 Oct (screens in E; phone by support until SMS, #18) |
| 21 | **Google Maps** everywhere + moving bike on the customer map | server routing ✅ Google Routes API (two-wheeler, traffic) when `GOOGLE_MAPS_SERVER_KEY` is set, Mapbox until then; Places (New) + Geocoding ✅; apps in C2 + D5 | B2 + C2 + D | ✅ 19 Oct (server B2, apps C2, bike D5) |
| 22 | Rider: clear consent for live tracking, reliable updates | server ✅ B11: every fix kept with heading/speed (socket and REST, `recordRiderFix`), "updating…" after 30 s, tracking readable only by customer, trip rider, staff; consent screen + 4 s sending in Stage E | B11 + E | ✅ 19 Oct (consent, GPS chip, telemetry) |
| 23 | Full security pass + harden against reverse-engineering + a security guideline | parts exist (secrets checks, ProGuard on, server checks) | F | ✅ 19 Oct (Stage F, `docs/SECURITY.md` §1j) |
| F1 | The leader's feel: Lexend Deca, press feel, soft haptics, images, motion | spec written (`design/motion/`) | C + D + E | ✅ 19 Oct (C + D + E) |

---

## Stage A — Make the ground solid (server only, no app build) · ~2 days

| Step | What | Done when |
|---|---|---|
| A1 | ✅ Finish K1–K3 exactly as `k1-k3-fixes-2026-10-17.md` "Still to do" (checks, mutation, gate, docs) | gate green, pushed, `/health` uptime reset |
| A2 | **Railway Pro used properly**: raise the backend service's memory/CPU (the whole store lives in memory, `db/client.ts`); turn on Postgres backups and check one restore on a copy; static outbound IP if Railway offers it on Pro (lets the Google server key be locked to our IP); usage alerts. **One instance only** (no replicas: data, sockets, timers live in one process) | owner screenshot of settings; restore tested |
| A3 | Security baseline (read-only audit before features add more surface): every route's guard (`docs/generated/ROUTES.md`), rate limits on sign-in/codes, file-upload checks, `npm audit`; findings go to Stage F, urgent ones fixed here | audit table in `docs/SECURITY.md` (new, Stage F owns it) |

**Built:** A1 (18 Oct): K1 customer phone on orders + old-order fallback; K2 refused origin → 403; K3 confirm links in the store. Checks in `platform`, `customerAddsRole`, `anonymousAccess`, 4 mutations caught.

## Stage B — Server features, in dependency order (each step: server + its suite + docs, pushed alone) · ~3 weeks

Every step: Zod validation on input, permission per admin role, `durable` writes for anything money or account, one suite in `src/test/`, `node scripts/docs/route-inventory.mjs`, websites build. Apps change in Stage D/E, except where a step says "app".

### B1 — Where a customer is, and what they see (#1a, #3, #7 server)
- Global setting **max distance 35 km** (Admin → Rates, editable); a kitchen is shown when the customer is within the **smaller** of 35 km and the kitchen's own radius; default kitchen radius raised so 35 km is real (owner may lower per kitchen). Distance by road from B2 when cached, straight line for listing speed.
- Closed or offline kitchens **stay in the list**, greyed, labelled **"Not delivering currently"** (and "Opens at 11:00" when hours say so), sorted after open ones; cannot be ordered (server already refuses).
- List endpoint takes the delivery address/coordinates; no coordinates → returns `recommended` list (B5) and a flag the app uses to ask for location first (D3).

### B2 — Google Maps on the server (#21 server half)
Same seam as the 22 Sep move, in reverse (`modules/places/placesService.ts`, `routingService.ts`; every caller unchanged):

| Need | Google API |
|---|---|
| address search | Places API (New) Autocomplete + Place Details (session tokens, so one search = one charge) |
| pin → address | Geocoding API (reverse) |
| one restaurant → door distance + time with traffic | Routes API `computeRoutes` (TRAFFIC_AWARE) |
| many pairs (dispatch, listing) | Routes API `computeRouteMatrix` |
| rider trail on roads | Roads API Snap to Roads (only while a trip is live, batched every ~30 s, up to 100 points per call) |

Keep the cache, the circuit breaker and the straight-line fallback (a failed map call must never fail an order). New variable `GOOGLE_MAPS_SERVER_KEY` (Railway); `MAPBOX_ACCESS_TOKEN` removed only after Stage D ships. `/health` shows `services.maps.provider`.

### B3 — Honest delivery time (#19 server)
ETA = kitchen's **own measured** cooking time (median of its last 20 orders for the cart size; default `DEFAULT_PREP_MINUTES` until it has 20) + rider to kitchen (B4's chosen rider, Routes API) + kitchen to door with traffic + handover. Recomputed on each status change and every rider GPS update while carrying; sent on the order socket. The promise shown at checkout is frozen on the order; tracking shows live ETA and **"ahead"** when live ETA < promise by ≥ 3 min.

### B4 — Rider dispatch, one at a time (#1b)
- When food is near ready (prep remaining ≤ rider's travel time to the kitchen) the server picks **the best free rider**: online, approved, no active trip, cash under ceiling, not declined this order, location fresh (< 2 min), shortest **road time** to the kitchen (Routes matrix), ties → fewer trips today.
- That rider gets a full-screen offer + push (existing channel `new-orders`) with a **108 s** countdown. State on the order (`offer: { riderId, expiresAt, round }`), saved durably, so a deploy mid-offer continues.
- Accept → assigned. Decline or 108 s pass → next rider by the same rule. The sweeper (`orderSweeper.ts`) checks expiries every few seconds; the old "wake 6 at once" path is retired in the same commit (one dispatcher, no duplicates).
- After Q6's limit, operations is alerted and cycling continues; operations can assign by hand (exists).
- Rider app (Stage E): the offer screen shows the countdown; the trip disappears when it moves on.

### B5 — Restaurant profile, menu sections, recommended (#5, #9, #17)
- `cuisineType: 'VEG' | 'NON_VEG' | 'BOTH'` chosen by the partner (profile edit, reviewed as today). `pureVegSeal: { by, at }` set **only** by admins with permission `restaurants.pureVegSeal`; the seal overrides the partner's choice in what customers see; filtering by Pure Veg uses the seal.
- **Section switch**: each menu category gets `isAvailable` + optional "back at" time; switching a section off hides/greys all its dishes for customers at once and the server refuses them in carts; switching on restores each dish's own setting (dish switches are not overwritten). Partner app and admin both.
- **Recommended**: admin list (permission `restaurants.recommend`) with order; shown first on the home feed and as the list when no address is set (B1).

### B6 — Accounts (#4, #8, #12, #14, #15, #18, #20 server)
- **Forgot password (partner, rider, admin)**: code to the account's email (Brevo, 10 min, 5 tries, rate-limited), then new password; every session signed out (`SESSION_REVOKED` exists). Later, phone code by SMS when MSG91 is live (same flow, other driver).
- **Admin resets a password** for a partner/rider (exists for staff: extend to both, audit-logged, the person gets an email).
- **Change phone/email**: code to the **new** address/number (email today, SMS later) before it is saved; old email told.
- **More editable fields** per profile (partner: phone, email, GSTIN/FSSAI with document, address+pin, cuisine type, hours, packaging fee request, bank via payee flow; rider: phone, email, vehicle, emergency contact; customer: name, email, phone with code). One list per role in `shared-types`.
- **Admin "Create"** (permission `accounts.create`): one form builds a partner account + restaurant (or a rider), uploads their documents, approves KYC, sets a temporary password emailed to them with "change on first sign-in". Uses the same repositories as self-sign-up (no second path).
- **Deletion requests** (rider and partner): request → account off duty (Q2) → admin page shows everything needed: dues and cash in hand (from `payouts.ts`/`cashDeposits.ts`), open orders, documents, trip/order counts, last activity → Approve (only when dues are zero or settled) or Reject with a reason. Exists in part; the review page is the new work.
- **Remove / Block** (Q1; permissions `accounts.remove`, `accounts.block`; super admin by default; type-the-name confirm; audit-logged): only with no open orders. **Remove** closes the account on every app (sessions revoked, kitchen hidden, rider off dispatch), keeps all data; they may register again as a new account. **Block** does the same and adds the email, phone and document numbers (FSSAI, GSTIN, PAN, licence) to a `blockedIdentifiers` list (stored hashed) that every sign-up, sign-in, contact change and admin Create checks, on all four apps and both websites. Unblock possible by permission. Extends the existing blocking (`accountBlocking` suite) rather than adding a second one.

**B6 built (18 Oct, main):** forgot password by email code with daily caps (`55d62d5`, `12bbc0c`);
Remove + Block with identifier ban incl. documents (`146c41d`, `0bed223`); deletion requests per Q2 with
review data (`68c101f`); admin Create with a set-password code (`c8a7850`, `12bbc0c`); email change with two
proofs, phone by support until SMS (`60a8188`, `b5043a4`); rider profile locks. Open in B6: partner
GSTIN/FSSAI self-edit (F-13) ✅ 18 Oct. Suites: `passwordReset`, `removeAndBlock`, `adminCreate`, `contactChange`.

### B7 — One record per person (#11)
Admin → People → (restaurant | rider | customer) → **Record**: profile, every document grouped by type with status and date, every photo, bank (masked), orders/trips, money, tickets, audit history; each file opens and downloads; "Download all" as one ZIP. The KYC queue stays for approvals and links into the record.

### B8 — Help chat (#16)
In-app chat (customer, partner, rider): first a guided menu from **our** policies (order late, missing item, refund status, payment, account, payouts) that answers from live data (order status, refund state); "Talk to us" opens a ticket with the order, the chat so far and the person's info attached, and staff reply in the same thread (existing tickets). Q3 decides any AI.

### B9 — Calls without showing numbers (#6) — ON HOLD (owner, 18 Oct)
How the big apps do it (researched): the platform rents a **virtual number** from a telephony provider; the rider taps Call, the server asks the provider to call the rider and the customer and bridge them; neither sees the other's number ([Exotel number masking](https://exotel.com/use-cases/number-masking/), Swiggy is a published Exotel customer: [case study](https://exotel.com/case-study/swiggy-streamlined-its-operations-with-exotel-heres-how/)). We already have this for Exotel (`callMasking.ts`). Work: owner opens an Exotel account + number; Rider app's Call button uses the masked route; customer can call the rider the same way; calls only allowed while the trip is live; fallback when Exotel is down: the real number, shown only during the live trip (today's behaviour, `contactVisibility.ts`).

### B10 — Kitchen ticket to print (#2)
Server makes a **thermal receipt PDF** (80 mm wide; 58 mm option in partner settings) with: our logo, kitchen name, **order number** big, time placed, "Delivery" + customer first name only, item lines with **quantity** and options/notes, item count, cutlery/instructions, pickup code, QR of the order number; **no prices**. Download/print button on the order card right after **Accept** in Live orders, and in order history; same on the website. Phone prints through Android's print dialog (`expo-print`, SDK pin 15.0.8) to any printer it can see, or the PDF can be shared to a Bluetooth printer app.

### B11 — Live tracking data path (#21, #22 server)
Rider position every ~4 s while carrying (8 s while going to the kitchen), sent over the socket with REST fallback (exists); server keeps the last fix + heading + speed, snaps a batch to roads (B2), relays to the order room; stale (> 30 s) is shown as "updating…". Only riders on a live trip are relayed (exists, `contactVisibility.ts`).

**Built:** B1 (18 Oct, `1078afb`, live and observed on production): one delivery radius on the map, 35 km, admin-set (`maxDeliveryKm`; kitchens' own `serviceRadiusKm` is now ignored, still accepted from old Partner apps), same circle for the list and checkout (`deliveryRadiusKm`); applied once to live rates (`applyOwnerDecisions20261018`, flag `rates:radius-35-2026-10-18`). Owner's extra decisions the same day: rider ₹/km slides ₹12 (to 4 km) → ₹8 (at 35 km) (`riderPerKmAt`), cash on delivery only up to 15 road km (`codMaxDistanceKm`, `COD_TOO_FAR`, quote `cashUnavailableReason`; `acceptsCash` folds it in for old apps). Closed kitchens stay listed, after open ones in every sort. Admin Rates shows all new knobs and worked examples from `riderPayFor`. Partner sign-up no longer asks a radius. Suite `deliveryRadius` (20 checks); `charges`, `ledger`, `membership`, `regression` updated to the new rule; 8 mutations caught. **Moved to B5:** no-location → recommended list + flag. Review D7 answered by the owner's decision (one radius; the sliding rate makes 35 km cost ₹280, not ₹420).
B5 (18 Oct): kitchen type `cuisineType` VEG/NON_VEG/BOTH (partner, reviewed profile edit; sign-up tick sets it); `isPureVeg` is now the admin-only **seal** (permission `catalog.restaurants.pureVegSeal`; the admin app may still send the unchanged value), it outranks the type in what customers see and drives the Pure Veg filter (no live kitchen had it on, so nothing changed for customers). **Section switch**: `POST /api/restaurants/:id/menu/sections/:categoryId/availability` (owner) and `/api/admin/menus/:restaurantId/sections/:categoryId/availability` (`catalog.menus.edit`, audit-logged), optional `backAt` (≤ 7 days); one rule `menuSections.ts` read by the menu, quote, checkout, reorder and search; dishes keep their own switches; a passed `backAt` counts as on at once and the sweeper clears it (review D9). **Recommended**: `GET/PUT /api/admin/recommended-restaurants` (`catalog.restaurants.recommend`, audit-logged, stored in `settings`), first on the home (after the open/closed split), the whole list when no location and no search text (`listKind: 'recommended'`, `needsLocation`); empty list = old behaviour. Both new permissions: super admin only by default (Roles can share them). Suite `catalogueCuration` (37); 15 mutations caught. Apps (seal badge, section switches, recommended screen, location-first) in Stage D/E.
B8 (18 Oct): help chat, server half (#16, Q3: fixed answers, no AI). `GET /api/support/help?orderId=` gives the app's topics (customer: late, item missing/wrong, refund status, payment, change address, cancel, account, other; partner: payouts, menu changes, orders, documents, account, other; rider: payouts, cash deposit, trip, documents, account, other), a greeting and the order card; `GET /api/support/help/:topic?orderId=` answers in fixed sentences from our policies filled with live data (order status + arrival from `eta.ts`, refund case state, `duesFor` owed/blockers + last payment, `cashStanding`, KYC state, menu requests). A topic from another app is 404 `TOPIC_NOT_FOUND`; orders only your own (`isPartyTo`: customer by account, rider by rider record, partner by owned kitchen; a customer-app session of a partner is a customer only). "Talk to us" is `POST /api/support/tickets` with new optional `helpTopics`, `appVersion`, `platform`: the server rebuilds `helpChat` (never copies the app's text), attaches the order in question, returns the same ticket on a double tap (2 min) and refuses a 6th ticket in an hour (429 `TOO_MANY_TICKETS`). Fixed on the way: riders and partners could not attach their own trip/kitchen order to a ticket (rider id compared with the user id); a rider's/partner's own reply marked their ticket as staff-handled and could not reopen a solved one; staff replies now push the person (`SUPPORT_REPLY`, no reply text on the lock screen). Old apps unchanged (only optional fields added). Suite `helpChat` (46); 13 mutations caught. Screens (chips, bubbles, composer) in Stage D (customer) and E (partner, rider); admin Support showing `helpChat` with the ticket is a small Stage E item.
B10 (18 Oct): kitchen ticket, server half (#2). `GET /api/orders/:id/kitchen-ticket?width=80|58` (default 80) returns an inline PDF (`QuickBites-ticket-<order>.pdf`) one page exactly as tall as the order (no page break for the printer to cut): kitchen name, order number big, CANCELLED line when cancelled, placed time/date, customer first name, `qty x dish` with chosen options (names frozen on the order at checkout by `dishOptions.ts`), item count, pickup code. Never on it: price, total, payment method, phone, address, delivery code. Allowed: the kitchen that owns the order (by `roles`, so a customer-app session of the partner is refused) once accepted (409 `NOT_ACCEPTED` before), and staff with `orders.detail.view`. Built on `utils/simplePdf.ts` (now takes a page size; A4 default unchanged). Not built (seniordev): logo image, QR code, Lexend font (Helvetica only, no new dependency); cutlery/note lines (no such order fields). Suite `kitchenTicket` (22); 9 mutations caught. Partner app button (after Accept, in history, 80/58 setting) and the website button in Stage E.
B7 (18 Oct): one record per person, server half (#11). New `routes/admin/recordRoutes.ts` (mounted in `adminRouter.ts`): `GET /api/admin/records/:kind/:id` (kind `restaurant` | `rider` | `customer`; permission `users.restaurants.view` / `users.drivers.view` / `users.customers.view`) returns name, account (`userId`), photos (cover, gallery, dish photos / profile photo), documents grouped Licences / Tax / Identity / Bank / Other with status, dates, `file` = image | link | missing and a download path (no file bodies; Aadhaar masked to the last 4), support tickets, and the audit history about that person (their record, account, documents, tickets). Documents need `documents.view`, tickets `support.tickets.view`, history `admin.audit.view`; without one, that part is `null`. `.../documents/:docId/file` (only through its own person; link → 302; no file → 404 `FILE_MISSING`) and `.../documents.zip` (every stored file + `index.txt` listing links and missing ones) need `documents.view` and are audit-logged (`DOCUMENT_DOWNLOADED`, `DOCUMENTS_DOWNLOADED_ALL`). Profile, orders/trips and money stay on the People detail routes (`detailPath` in the answer); no new permission. Not built: the phone/email "reveal" with a History line (spec), photo replace/reject (D4). Suite `personRecord` (28); 11 mutations caught. Record screen (tabs, web left column) in Stage E.

B4 (18 Oct): **one rider at a time** (owner Q6). `offerTripToNearbyRiders` keeps its name (all 5 callers unchanged) and now offers to the single best rider: online, not passed on it, not holding another offer (review D4), no active trip, under the cash ceiling; ranked by not-yet-asked, fresh position (< 2 min), nearest the kitchen, fewer trips today. State `order.riderOffer {riderId, offeredAt, expiresAt, round}` saved durably before the push; a timer per offer for the exact 108 s (review D3) and the sweeper as restart backstop; expiry tells the previous rider (data-only withdrawal) and moves on; decline moves on at once (`moveOfferOnAfterDecline`); after `riderOffersBeforeAlert` (5) riders one NO_RIDER_FOUND alert, offers keep cycling; the time-based alert remains for "nobody to ask". Claim (`/riders/orders/:id/claim`) refuses `OFFER_NOT_YOURS` / `OFFER_EXPIRED`; the offer list returns only the rider's own offer with `offerExpiresAt`, so Rider apps on phones keep working and cannot jump the queue (review D5); accept or a hand assignment clears the offer. Rates `riderOfferSeconds` 108 and `riderOffersBeforeAlert` 5 (Admin → Rates); `riderOfferWaveMinutes` retired. **Deliberate difference:** a stale position ranks a rider lower instead of excluding them, because today's Rider app reports a position only after moving 50 m; make it strict once the Stage E app sends a heartbeat. Suite `riderTripPush` rewritten (33 checks), `flows`/`opsRescue`/`pipeline`/`regression` use the test helper `offerTo`; 11 mutations caught.
B3 (18 Oct): **honest delivery time.** `eta.ts`: `kitchenPrepMinutes` = median of the kitchen's last 20 orders of the same cart size (accepted → ready; default until 20); while cooking the wait is max(cooking left, chosen rider's ride to the kitchen); food ready → the rider's ride; `promisedArrivalAt` frozen at checkout; `eta.ahead` when the live estimate beats it by ≥ 3 min. Sent on `order:status_update` and `rider:location_update` (straight line, never a paid map call per tick: review D2). Quote adds `estimatedDeliveryMinutes`. Road time via Routes API arrives with B2. Suite `honestEta` (13); 8 mutations caught.

## Stage C — App engine (all four apps) · ~1 week
1. New Architecture + Reanimated 4 + Gesture Handler + expo-image + FlashList + Lottie + expo-haptics, exactly as `new-architecture-and-animations-2026-10-17.md` steps 1–5 (phone checklist must pass).
2. **Mapbox → Google Maps in the apps**: remove `@rnmapbox/maps` and its build tokens; add `react-native-maps` at the SDK pin (1.20.1) with `android.config.googleMaps.apiKey` in each `app.config.js` (Android always uses Google with react-native-maps; iPhone uses `provider="google"`, which needs the iOS key). Rewrite only the seam `src/lib/nativeMap.ts` (Customer, Partner, Rider) so screens keep their imports. Address search keeps going through our server.
3. `expo-print` (Partner) for B10.

**Built (C1, 18 Oct):** New Architecture on in all four apps, Razorpay 3.0.0, emulator-checked (QA server)
per app; Reanimated/gesture/expo-image are added in D1 when the first screen uses them. Phone-only checks
(payment, background GPS, push) wait for the final test round. **C2 ✅ 18 Oct:** Google Maps in the
three apps (react-native-maps 1.20.1, same seam), Mapbox removed; tiles/drag to check on a release build
(debug signature refused by the key restriction). **C3 ✅ 18 Oct:** kitchen ticket prints from the Partner app (expo-print), emulator-checked. **Next: D1** (base feel).

## Stage D — Customer app (the leader's feel, our brand) · ~2 weeks
Recipe: `customer-app-feel-2026-10-17.md` phases 1–4 and `design/motion/`.

| Step | What |
|---|---|
| D1 | Base: tokens, Lexend Deca (✅ 19 Oct), `PressableScale` (✅ 19 Oct), soft haptics (Android + iPhone, ✅ 19 Oct, Profile switch), `FoodImage` ✅, skeletons ✅, screen change ✅ |
| D2 | ✅ 19 Oct Sign-in screen (partner-photo slideshow) + 6-box code screen |
| D3 | **Location first** (#7): after sign-in, a full-screen "Where should we deliver?" (use my location / search / saved addresses / save this exact pin with house, floor, landmark); skipping shows "Recommended by Quick Bites" (B5) with a banner "Set your location to see every restaurant near you". Home → Favourites section (#13) above the main list when you have any. |
| D4 | ✅ 19 Oct (motion: card entrance, ADD count roll, cart bar slide/bump; features earlier) Home, search, restaurant page (section switch greys a whole section, "Not delivering currently", Pure Veg seal badge), add to cart, dish sheet, checkout |
| D5 | ✅ 19 Oct (our bike icon glides between fixes and turns to the heading; stale fades) **Tracking with the moving bike** (#21): Google map, our own bike icon (top-down, maroon, flat, rotates to heading); each GPS fix → marker glides from the last point to the new one over the time between fixes (Android `animateMarkerToCoordinate`, iPhone `AnimatedRegion` timing, both documented by react-native-maps), heading from the last two snapped points; camera fits kitchen + bike + home and eases, stops following while the customer drags; route line from Routes API polyline; "We're ahead of time!" card (B3) |
| D6 | Profile edits with codes (#18, #20), help chat (#16), orders, addresses |

**Built (features, 18 Oct, before C):** D3 location first (sheet opens for a signed-in customer with no
address), "Recommended by Quick Bites" banner, Favourites row (#13); D4 off sections greyed with "back at",
Pure Veg seal on the restaurant page; D6 help chat, email change with two proofs (phone by support).
The look and motion of D1–D5 (Lexend, haptics, skeletons, moving bike) wait for Stage C.

## Stage E — Partner, Rider, Operations apps + websites · ~1.5 weeks

| App | Work |
|---|---|
| Partner | kitchen ticket print (B10), section switch (B5), cuisine type + seal shown (B5), more profile fields with codes (B6), forgot password (B6), deletion request status (B6), help chat (B8), Google map (C2), base feel (D1 pieces) |
| Rider | **tracking consent** (#22): before the first "Go online", a full screen in plain words: "Quick Bites uses your location while you are online, even when the app is closed or the screen is off, to give you nearby orders and show customers where their food is. It stops when you go offline." → then the system permission (foreground, then "Allow all the time"); a persistent notification while online (foreground service, exists); a status chip online/updating/GPS off with a fix button; 108 s offer countdown (B4); masked Call (B9); forgot password; deletion status; help chat; Google map; base feel |
| Operations | Create (B6), Record per person (B7), deletion review (B6), delete restaurant (B6), Pure Veg seal + recommended list (B5), max distance setting (B1), help chat shown on the Support ticket (B8 `helpChat`, app version), Record per person screen on `/admin/records` (B7), dispatch monitor (B4), roles for the new permissions, base feel |
| Websites | nothing separate: built from the Partner/Operations code; each step runs `node scripts/build-web.mjs` and checks the feature in a browser; the web keeps its simple Glass Kitchen look |

**Order note (18 Oct):** Stage E's feature screens were built before Stage C (they need no engine
change and reach the websites at once); the base feel (D1 pieces) and Google maps in E wait for C.

**Built (part 1, 18 Oct):** Operations: Create (B6), Remove (B6), Listing card with Pure Veg seal + recommended (B5),
deletion rows with kitchen/trips/last active/documents (B6), help chat on tickets (B8), Record per person
(B7, `PersonDocuments`). Partner: forgot password (B6), kitchen ticket print 80/58 (B10), section switch (B5),
kitchen type + seal shown (B5), help chat (B8), deletion status (B6). Rider: forgot password, help chat,
108 s countdown from the server (B4), location consent (#22), deletion status. **Left in E:** masked Call (B9 on hold), base feel in the other apps.
**Built (part 2, 19 Oct):** dispatch monitor line in Operations Live; rider GPS status chip.
Decision: no "Allow all the time" location: the shift's foreground service already covers background use.

## Stage F — Security (#23) · ~1 week, plus checks inside every stage

Truth first: **no app can be made impossible to reverse-engineer** (we read the leader's app this week). The protection that works is: nothing secret inside the app, and the server checking everything.

| Area | Work |
|---|---|
| Server | every route's guard re-checked (mount list in `middlewares/auth.ts`), ownership checks on every id, rate limits on sign-in/codes/search/uploads, upload type/size sniffing, no stack traces to clients, audit log on every admin write (exists), dependency audit, secrets only on Railway |
| Accounts | password rules, code lockouts, sessions revoked on password/contact change, admin 2-step for destructive actions (delete, payouts over threshold exists) |
| Apps | Play Integrity API check on sign-in and order placement (server verifies the token), R8/ProGuard on (already `enableProguardInReleaseBuilds`), Hermes bytecode (already), no keys except restricted map keys (`check-apk-secrets.mjs`), tokens in secure storage (`expo-secure-store`), HTTPS only, certificate pinning only if Railway's certificate chain is stable (decide in F) |
| Map/phone keys | Android key restricted to package + **both** SHA-1s (upload key and Play app-signing key); iOS key to bundle id; server key to the APIs it uses (+ Railway static IP if available) |
| Data | Postgres backups (A2), payee numbers encrypted (exists), anonymised deletions (B6), logs without phone/email |
| Deliverable | `docs/SECURITY.md`: the rules every change must follow + the checklist run before each release |

**Built:** findings outside the main session's files (18 Oct): L2 socket tokens pinned to HS256 (`sockets/socketServer.ts`, one line), L4 browser origins only our exact hosts (`middlewares/cors.ts`: the `*.vercel.app` / `*.railway.app` allowance removed; our pages are the same host), review R6 refusals (4xx) logged at WARN, failures (5xx) at ERROR (`middlewares/errorHandler.ts`). Checks added to `sockets.security` and `anonymousAccess`; 3 mutations caught. L1, L3, L5, L6, R2, R3 are in the main session's files and stay with it.

**Built (19 Oct, main session) ✅:** part 1 `ac9d24c`: L1, L3, L5 (documents are photos only), L6 (dish photos photo/https), L8 (no redirect to a link document). Part 2: L13 (password checks limited per account), L14 (no provider text on `/health`), L15 (sockets leave an order's room when taken off it or at the end), L16 (no rider position kept after a trip or while offline), sign-in tokens in `expo-secure-store` in all four apps (old tokens moved, nobody signed out; needs the next APK), admin email out of the boot log, `npm audit` (server 0; build-tool findings wait for the next Expo SDK). Decisions: no certificate pinning; Play Integrity waits for the owner's Play Console link (`OWNER_ACTIONS.md` 00.8). Rules and pre-release checklist: `docs/SECURITY.md` §2–§3, §1j. New suite `securityInputs`; every guard mutated and caught.

## Stage H — Owner's round after build 36 (19 Oct 2026) · do FIRST, then APK, Tester, jury loop

Owner's words, short. Each row: build, check, push; then one APK build, the Tester tests everything (whole plan +
these), the jury reviews one at a time, fix, rebuild, repeat until every juror says ALL GOOD.

| # | Item | Status |
|---|---|---|
| H1 | **Help chat is a real chat**: the person types; a matching ready answer is sent back; still stuck → "Talk to a person" connects them to Operations in the SAME chat, and both keep writing (customer, partner, rider; Operations replies from Support) | ✅ 19 Oct: `SupportChat` in Customer/Partner/Rider, `/support/help/match`, `GET /support/tickets/:id` (polled 6 s) |
| H2 | **Notifications work properly in all 4 apps** for every notification they receive (channels, shown in foreground, tap opens the right screen, permission asked) | ✅ 19 Oct: shown in foreground in all 4; taps open the order/Help/Payouts (`notificationTaps.ts`) |
| H3 | **Rider gets every permission it needs** (location while using + background, notifications, camera for documents, battery optimisation off), asked clearly | ✅ 19 Oct: Rider Home "Set up your phone" card (`RiderPermissions.tsx`); GPS chip re-checks on return |
| H4 | **Customer cart**: ADD bounces far too much → a calm press; the dish card gets − count + in the same place (remove where you add) | ✅ 19 Oct: no pop on each add; − count + on the dish card |
| H5 | **Forgot password on every sign-in page** (all 4 apps): email → code by email → new password, as everyone does | ✅ 19 Oct: "Forgot password?" on Partner/Rider/Operations sign-in (Customer signs in by emailed code, no password) |
| H6 | **Admin can do everything for a person**: set their password when creating an account, menus, and the exact location on a map | ✅ 19 Oct: optional password on Create; Location card (address search, pasted Google Maps pin, View on map) |
| H7 | Tester build 36 findings T-1…T-19 and code-reviewer J-C1…J-C18 (`docs/reviews/REVIEW_LOG.md`) | ✅ 19 Oct: T-2..T-17 and J-C2..J-C17 fixed; T-1/T-18 seed data left (J-C1); see CHANGELOG |
| H8 | Tester round 2 (build 39) findings R2-1…R2-22 | 🟨 20 Oct: part 1 fixed (`080437a`); rest listed in START HERE ▶ CURRENT STATE |

## Stage G — Test, build, release · ~3–4 days
Gate + all checks (`docs/TESTING.md`); phone tests of every stage's checklist (motion on and off); web check; then **only on "make APK"**: one build of all four apps (versionCode 34+), archive, Play upload, new reviews, update Play Console: Data safety (location, calls), background-location declaration + video, App access (reviewer code), Advertising ID.

---

## Owner's list (only you can do these)

| When | What |
|---|---|
| Before B2 | **Google Maps keys** (steps below) and put the server key on Railway as `GOOGLE_MAPS_SERVER_KEY`, the app keys in the root `.env` |
| Before B9 | Exotel account (business KYC), one virtual number; put `EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID` on Railway |
| Before A2 | Railway: memory/CPU, Postgres backups, static IP (if offered), usage alerts |
| Before D2 | Answer Q1–Q6; tagline; artwork decision (Q5) |
| Before G | Play Console: background-location declaration + a short video of the consent screen and a delivery; Data safety update |
| Any time | Brevo sending domain (codes into inbox, not spam); MSG91 DLT for SMS codes |

### Getting the Google Maps keys (Google Cloud console, ~20 minutes)
Sources: Google's setup and key-security guides ([get an API key](https://developers.google.cn/maps/documentation/android-sdk/get-api-key), [security best practices](https://developers.google.com/maps/api-key-best-practices)).
1. console.cloud.google.com → create project **Quick Bites Maps** → Billing → link your billing account (card required).
2. APIs & Services → Library → enable: **Maps SDK for Android**, **Maps SDK for iOS**, **Places API (New)**, **Geocoding API**, **Routes API**, **Roads API**.
3. Credentials → Create API key ×3 and name them:
   - **qb-android**: Application restriction *Android apps* → add each package (`in.quickbites.app`, `com.quickbite.partner`, `in.quickbite.rider`, `com.quickbite.admin`) with **two** SHA-1s each: the upload key's (ours) and the **app-signing key's from Play Console → Test and release → App integrity → App signing**. API restriction: Maps SDK for Android only.
   - **qb-ios**: *iOS apps* → bundle `in.quickbites.app`; API restriction: Maps SDK for iOS.
   - **qb-server**: *IP addresses* (Railway static IP if you have one, else none); API restriction: Places (New), Geocoding, Routes, Roads.
4. Billing → Budgets & alerts → a monthly budget with alerts at 50/90/100%.
5. Quotas: set a daily cap on Places, Routes, Roads so a bug cannot run up a bill.
6. Put the values on Railway / in `.env` yourself and tell me only "keys are set" (never paste a key in chat).

---

## Findings from the role sessions that change this plan (18 Oct 2026)

Each line: who found it, what changes, status. Full detail in the role's own file.

| # | From | Finding → change | Status |
|---|---|---|---|
| F-1 | security (`docs/SECURITY.md`) | M1: a profile edit could take another account's phone → refused (`PHONE_IN_USE`) | ✅ 18 Oct (main) |
| F-1b | security round 2 | L7: pinless address could pay cash for any trip → cash needs a pin (`COD_NEEDS_PIN`); L1 (sign-in routes) raw errors → error handler; L8 (record link redirect) goes with L5 | ✅ L7, L1-auth 18 Oct (main); L8 with L5 (parallel) |
| F-1c | review round 2 | S1 race in B4 offers (two riders, or one rider two trips) → fixed; S2 alert counts riders; S3 "today" in India time | ✅ 18 Oct (main) |
| F-12 | review B1-1 | With "one rate for the whole trip", a short-trip rate above about ₹15/km (₹8 at 35 km) makes a 28 km trip pay more than a 35 km one (₹20/km: 28 km ₹300, 35 km ₹280). **Owner decision**: (a) keep it and the Rates screen refuses such settings, or (b) pay each km at its own rate (₹12 for the first 4 km, then each further km a little less, down to ₹8): longer always pays more, any rate allowed; 35 km would pay about ₹358 instead of ₹280 | ⏳ owner |
| F-13 | main | Partner GSTIN/FSSAI as reviewed profile edits; ban-checked at submit and approval | ✅ 18 Oct (main) |
| F-2 | review R2, R3 | deletion now also strips refund cases; expired confirm links pruned by the sweeper | ✅ 18 Oct (main) |
| F-3 | review R1 | K1 made **automatic RazorpayX refund payout links** reachable (`refunds.ts:234`; before, no phone meant the manual queue). **Owner decision**: keep automatic links, or keep refunds manual until RazorpayX is live | ⏳ owner |
| F-4 | review D1, D2 | No Roads/Routes call per GPS fix: B11 projects the rider onto the `computeRoutes` polyline on our server (snap only if off-route); B3 recomputes road time only on status change/off-route | rule for B2/B11 |
| F-5 | devops (`docs/ops/OPS_GUIDE.md`) | Railway stops reading `railway.json` after **1 Dec 2026**: owner copies its settings (+ draining 30 s, overlap 0) to the dashboard **before 15 Nov**, then we delete the file and its mentions in one commit | ⏳ owner, then main |
| F-6 | devops | Deploy overlap: writes on the old server during a deploy were invisible to the new one → A4 built: the new server re-reads rows written after its load (10 s, 30 s, 60 s, 2 min), adopts untouched documents, keeps its own on conflict (logged) | ✅ 18 Oct (main) |
| F-7 | designer (`design/system/`) | Lexend Deca has no Hindi/Kannada letters: Stage D1 also bundles **Noto Sans Devanagari + Noto Sans Kannada** (OFL) and picks by language | rule for D1 |
| F-8 | designer | Colour contrast fails accessibility on muted text, veg/non-veg, rating, gold: new values in `design/system/README.md`, applied in D1 | rule for D1 |
| F-9 | designer | Partner/Rider/Operations use a different maroon and cream than Customer: **owner decision** one shared colour set (Stage E) | ⏳ owner |
| F-10 | designer | Kitchen ticket cannot print option names ("Extra cheese"): orders store option ids only → store option names at checkout; there is no order cooking note field. Ticket width setting 80/58 mm; CANCELLED line | B10 follow-up |
| F-11 | designer | Rider offer shows the drop **area** only before accept; customer sees an honest "running late, new time" card, not only "ahead" | rule for E/D |

## Rules for every step (so nothing breaks)
- Check the feature exists first; extend it, never a second copy (seniordev ladder). Money/account state: grep every writer first (`CLAUDE.md` §8).
- Server steps ship alone, behind the gate, and stay compatible with the apps on phones today (old app versions keep working).
- Each new admin power has its own permission, so roles can share it out (#4).
- Each step updates its docs (`docs/*` maps, `CHANGELOG.md`, this Tracker) in the same commit.
- No file from the private competitor study enters the repo.
