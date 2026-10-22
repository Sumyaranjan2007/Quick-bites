# Quick Bites — start here (handoff for any AI or developer)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](docs/README.md).

**Last updated:** 22 October 2026 (round 6 BUILT and live, build 47 for the owner to test: help chat stays open until solved (WhatsApp-like, Operations chat screen), notifications fixed in Partner/Rider + a "Phone permissions" card in every app, one-time location guide for new customers, Android zoom fix on the live map — `docs/plans/round6-help-chat-notifications-location-2026-10-22.md`; **launch readiness** (load measured: the store re-checks every document on each money write and chokes ~2–3 months after launch; safe updates; attacks; every payment state) — `docs/plans/launch-readiness-2026-10-22.md`, first server fixes live (refund failed/processed + chargeback webhooks, per-IP 6,000/min, event-loop delay on /health), the rest waits for the owner's discussion; **SMS sign-in codes**: MSG91 + Airtel DLT nearly ready, see §7 item 5 · earlier, 21 Oct: round 5: shortest Google motorbike route for fee/pay/time/map, honest arrival time, kitchen ticket printed like a POS bill — `docs/plans/round5-route-time-ticket-2026-10-21.md`; the owner is the tester now · **A new session starts at `docs/plans/master-plan-2026-10-18.md` → START HERE** (newest block first) · earlier, 20 Oct: everything built through Stage H; the Tester ↔ builder loop is on round 2 (build 39, findings R2-1…R2-22, part 1 fixed in `080437a`); APK + AAB are built from the short-path worktree `D:\qbx`; dev tools live in `D:\dev-data`; owner 20 Oct: do not act on a Tester report until the owner says so · earlier, 19 Oct: Owner uploaded/tested Build 36 AABs to Play Console Closed Testing; instructions for Claude: keep building and working without stopping · earlier: Jury round 1 build 36 reviews, APK build 36, dev tools moved to D:\dev-data · earlier: 18 October 2026 B4 one-rider dispatch + B3 honest ETA; B8 help chat, B10 kitchen ticket, B7 person record and Stage F L2/L4/R6) · **Last release:** versionCode 47 (1.4.0), all four apps, built 22 Oct (round 6; earlier: 46 on 21 Oct, 36 on 19 Oct) (Customer `in.quickbites.app`, Partner `com.quickbite.partner`, Rider `in.quickbite.rider`, Operations `com.quickbite.admin`) · **Live:** whatever is on `main` (every push deploys; check `/health` uptime after a push)

This file is the single starting point. Claude Code loads it automatically. Read it, then
`OWNER_ACTIONS.md` Part 0 (what is waiting on the owner) and the top three entries of
`CHANGELOG.md`. Everything else is reference.

> **This repository is PUBLIC on GitHub** (`github.com/Sumyaranjan2007/Quick-bites`).
> No key, password, token, phone code or personal ID goes into any tracked file — ever.
> This file says *where* each secret lives, never its value. `node scripts/check-secrets.mjs`
> is part of the gate and fails on a committed secret.

> **Where everything is (17 Oct 2026).** Before creating, moving or saving any file, read
> **`docs/FOLDER_MAP.md`**: every Quick Bites folder on this PC and in the repo, how they
> connect, and where each kind of new file goes. **`docs/README.md`** lists the maps (system,
> backend endpoints, apps screen by screen, data, sign-in and roles, money, notifications,
> config, testing, releases, runbook, known issues, decisions, optimisation backlog), each with
> `file:line` pointers. This file keeps the owner, the money rules (§4) and the working rules (§8).

---

## 1. What this is

Quick Bites is a food-delivery platform for Harohalli / Ramanagara, Karnataka, India, run by
the business **QUICK BITES** (MSME Udyam `UDYAM-KR-29-0052148`, contact
`officalquickbites@gmail.com`, +91 7899415741). Four Android apps talk to one backend:

| App | Folder | Android package | Who uses it | Play Store |
| --- | --- | --- | --- | --- |
| Quick Bites | `apps/customer-mobile` | `in.quickbites.app` on Android and iPhone (Android was `com.quickbite.app` until 16 Oct: that name is another developer's app on Play) | customers | public · **also iPhone** (App Store, being prepared — §7b) |
| Quick Bites Partner | `apps/restaurant-mobile` | `com.quickbite.partner` | restaurants | public |
| Quick Bites Rider | `apps/delivery-mobile` | `in.quickbite.rider` (no "s": the Play Console app was created with this name; was `com.quickbite.rider`, then `in.quickbites.rider` in build 32) | delivery riders | public |
| Quick Bites Operations (the admin app) | `apps/admin-mobile` | `com.quickbite.admin` | the owner / operations | **private** (APK only) |

**Websites (6 Oct):** the Partner and Admin apps also run in a web browser at
`/partner` and `/admin` on the live server — the apps' own code built for the web
(`scripts/build-web.mjs`, run by the Dockerfile on every deploy; served by
`apps/backend-api/src/routes/webApps.ts`), with the "Glass Kitchen" web look
(`packages/design-system/src/web/glassShell.ts`). Every app feature is on the web
automatically. The old separate Vite consoles (`apps/admin-web`, `apps/restaurant-web`)
were deleted on 6 Oct at the owner's request.

### The owner

The owner is **not a developer**. Lead with what something costs, earns or risks, then the
mechanism. Their bug reports describe real symptoms accurately; their guess at the cause may
be wrong. They want to be told plainly when a request is a bad idea. Keep "things only you
can do" short and at the top. Say "deployed" and "observed working" as different claims.
They write quickly with typos; read for intent. When they ask a question, **answer it
clearly first, then do the work** (they complained when an answer was buried).

---

## 2. Stack and where things run

- **Monorepo**, npm workspaces + Turborepo. Node ≥ 22.6 (Node 24 on this machine).
  `packages/`: `config` (Expo config plugins), `design-system` (since 6 Oct only the web
  shell, `src/web/glassShell.ts`), `pricing-engine`, `shared-types`.
- **Apps:** Expo SDK 54 / React Native 0.81 / React 19.1 (since 16 Oct; target API 36, 16 KB-aligned native libraries — both required by Google Play), **New Architecture since 18 Oct** (`newArchEnabled: true` in all four apps, emulator-checked; phone checks of payment, background GPS and push in the final test round), bare Android builds (`android/` is generated by
  `expo prebuild` and gitignored). No OTA updates (owner decision).
- **Backend:** Express + Socket.IO, TypeScript run directly with
  `node --experimental-strip-types src/server.ts`. In-memory document store
  (`apps/backend-api/src/db/client.ts`) persisted to **PostgreSQL** in production
  (`DATABASE_URL`) and to `apps/backend-api/data/store.json` locally (`QB_DATA_DIR`
  overrides). Repositories in `src/db/repositories/` hold most writes, but several routes and
  modules write the store directly: `docs/DATA_MODEL.md` lists every writer per collection.
- **Hosting:** Railway, project **endearing-ambition**, environment **production**: the
  backend service (Dockerfile) + a Postgres service. Pushing `main` deploys.
  **Live URL:** `https://quick-bites-production.up.railway.app` = the **server address** for the apps (`/api/...`),
  Razorpay's webhook, `/health`, and the Operations website (secret `ADMIN_WEB_PATH`; never on the public domain).
  **Public website:** `https://www.quickbitesresturants.in` (same server): home, `/privacy`, `/terms`,
  `/delete-account`, Partner website `/partner`. Since 22 Oct a browser opening those pages on the Railway address is
  sent there with a 301 (`routes/webApps.ts` `isRailwayHost`); never move the apps' API off the Railway address
  without a new app build (it is baked into every app's `src/config.ts`).
- **Services:** Razorpay (payments) + RazorpayX (payouts); **Google Maps** (since 18 Oct: in-app maps via
  `react-native-maps`, server road distance/address search via `GOOGLE_MAPS_SERVER_KEY`; Mapbox remains only
  as the server's fallback while its token is set); Meilisearch (search); Firebase Cloud Messaging (push);
  Groq vision (reads printed menus from photos — server-side key only); SMS sign-in codes
  through **MSG91** (2Factor also supported).

---

## 3. Every setting and secret — where it lives (values are never in git)

| Where | What |
| --- | --- |
| **Railway → backend service → Variables** | All production secrets and settings (names: `docs/CONFIG_AND_SECRETS.md`). Changing one and clicking **Deploy** restarts the server. |
| **`.env` at the repo root** (gitignored, this PC only) | Local build/test values: Mapbox public + download tokens, Google Maps Android key, Razorpay **test** keys, etc. `.env.example` lists the names. |
| **`D:\dev-data\quickbites-keystores\`** (outside the repo) | The four Android signing keystores and their `*.keystore.properties` (passwords). Losing these = the app can never be updated. See `SIGNING_KEYS.md`. |
| **`D:\dev-data\`** (19 Oct 2026, C: was full) | Android SDK, emulators, Gradle and npm caches, temp, and the keystore vault. User environment variables `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_AVD_HOME`, `GRADLE_USER_HOME`, `QB_KEYSTORE_VAULT` point here. **Build APKs from the short-path worktree `D:\qbx`** (New Architecture paths pass 260 characters in the project folder): `docs/FOLDER_MAP.md`. Keep nothing new on C:. |
| **`D:\my all projects\quick-bites-release-archive\`** | Archived signed APKs per release. |
| **Expo (expo.dev) → project → Environment variables** | `MAPBOX_PUBLIC_TOKEN`, `MAPBOX_DOWNLOAD_TOKEN` (secret) for iPhone cloud builds (EAS). Not needed for Android. |
| **The owner's own accounts** | Railway, GitHub, MSG91, the DLT portal (**Airtel** DLT, used since Oct; Jio TrueConnect drafts are old), Razorpay, Google Play Console, Firebase, Mapbox, Groq, Apple Developer / App Store Connect, Expo. Only the owner signs in to these. |

### Production variables

Every variable by **name**, where the code reads it and what breaks without it:
**`docs/CONFIG_AND_SECRETS.md`**. Live state to remember: `OTP_PROVIDER=email` (Brevo) since
11 Oct (Brevo's free plan: 300 emails a day, a launch-day limit; codes are moving to SMS, §7 item 5); `OTP_TTL_MINUTES=10`; Razorpay live still on `rzp_test_` keys (2 Oct); APNs set 13 Oct;
`ALLOW_PLATFORM_RESET` must be false/absent at launch; `TWOFACTOR_*` unused (remove).

Build-time (local `.env`, baked into APKs on purpose, protected by package + SHA-1
restriction, not secrecy): `GOOGLE_MAPS_ANDROID_KEY`, `GOOGLE_MAPS_IOS_KEY` (read by each app's
`app.config.js`; the Mapbox tokens are no longer used by the apps). `node scripts/check-apk-secrets.mjs` fails a build whose bundle
contains a server key.

**Keys exposed in chat that must be rotated:** the Groq key, the admin password, and the
MSG91 OTP-widget token. The MSG91 Authkey now on Railway was never posted in chat.

---

## 4. Money rules (owner decisions — settled, do not re-ask)

- **Rider pay** (owner, 18 Oct 2026) = road km (restaurant → customer) × a per-km rate that
  **falls with distance**: **₹12/km up to 4 km**, then sliding in a straight line to **₹8/km at
  35 km** (flat after), never below **₹30** per trip, frozen on the bill. One function:
  `riderPayFor` / `riderPerKmAt` (`packages/pricing-engine`). All four numbers editable (Admin →
  Money → Inflation → Rider pay & defaults); the ₹12 is also settable **per city**; minimum and
  markup stay global.
- **Pickup pay** (owner, 20 Oct 2026): a rider more than **7 km** (road) from the restaurant when
  they take the trip gets **all** that pickup distance × **₹6** (10 km = ₹60), paid by Quick Bites,
  never on the customer's bill; frozen on the order. Restaurant → customer pay stays as above.
- **Order clock** (owner, 20 Oct; cancel rule changed 21 Oct): the customer may cancel in the app **only until the
  kitchen accepts** (the 2-minute window after accept is gone), then only through support. The late-cancel fee and
  the "late cash cancels" limit therefore never apply to customers any more (settings kept, inactive); no time shown before accept, then cook time + ride time
  (restaurant → customer), "+N min" when late; riders are offered the trip at **10 min** of cooking left.
- **Delivery radius** (18 Oct): one circle on the map, **35 km** by default, set by admins
  (`maxDeliveryKm`); kitchens no longer choose their own. The restaurant list and checkout use
  the same rule. Closed kitchens stay listed as "Not delivering currently".
- **Cash on delivery only up to 15 road km** (18 Oct, `codMaxDistanceKm`, admin-editable): the
  quote hides cash and says why; checkout refuses it (`COD_TOO_FAR`).
- **Delivery fee** = rider pay + delivery markup %. **Platform fee** shows GST only with a
  GSTIN (the business has none yet, so no GST is charged on the platform's own fees).
- **Payouts:** no hold period (0 days for partners and riders), **₹100 minimum**. Admin pays
  whenever: by hand (UPI/bank + UTR) or RazorpayX. A super admin may approve their own
  large payout. The tip goes 100% to the rider, counted once.
- **Cash on delivery** is switched **per restaurant, by admins only** (People → restaurant →
  Payments). Checkout hides it and the server refuses (`COD_NOT_ACCEPTED`).
- **Menus:** partners request changes; admins approve. Admins can also edit live dishes,
  add dishes and upload a whole menu from the restaurant's profile; the partner gets a push
  and a "Recent decisions" entry. Menus can be read from photos (Groq), as a draft only.
- **Account deletion:** customers delete at once (password or a fresh phone code).
  Partners and riders *request* deletion; an admin completes it after dues are settled
  (People → Deletion requests).
- **Receipts and invoices (owner, 19 Oct; was "restaurant invoices" 6 Oct):** partners download
  **receipts only**: Partner → Money → Statement → *Download receipts (ZIP)* for a period and
  *Download receipt* per order (their own share). **Operations** keeps the invoices: per order,
  *Download full invoice (PDF)* (`/api/admin/orders/:id/invoice.pdf`, `finance.revenue.view`: what the
  customer paid and who earned what, from `splitForOrder`/`contributionPaise`, adds up to the total);
  per payee, Admin → Money → Pay → Owed → Statement (period statement + each order's invoice, ZIP).
  One PDF builder (`modules/payments/statementPdf.ts`) on top of `statementFor`, dishes at
  the kitchen's prices, labelled "Not a GST tax invoice" (no GSTIN yet). Each order notes
  the 5% food GST the customer paid, which Quick Bites collects and keeps to pay (it is booked
  to `TAX_GST_PAYABLE`, never the kitchen's payout — the section 9(5) model). **The business
  collects this GST with no GSTIN yet: flagged to the owner to take to a CA.**
- **Sign-ins last 7 days** (`authRouter.ts` `expiresIn: '7d'`, no refresh). Since 6 Oct all four
  apps return to the sign-in screen with one message on `INVALID_TOKEN` / `SESSION_REVOKED`
  (before, they sat on screens that failed every call). How long a sign-in should last is an
  open owner question.
- **Open owner question:** the partner policy text still promises payment "automatically
  on the weekly run", which contradicts paying whenever. Waiting for the owner's wording.

---

## 5. Daily commands

```bash
node scripts/run-backend-tests.mjs                 # THE gate: 112 backend suites, ~4 min, takes a machine-wide lock
node scripts/check-secrets.mjs                     # no secrets in tracked files
npx turbo typecheck                                # all workspaces
node scripts/check-i18n.mjs ; node scripts/check-apk-secrets.mjs
npm run verify        /  npm run verify:full       # everything, stops at first failure
bash scripts/build-apks.sh                         # all four signed APKs  -> build/apk/
bash scripts/build-apks.sh --aab                   # + Play bundles        -> build/aab/
bash scripts/build-apks.sh --only admin-mobile     # one app (exact folder name)
node scripts/build-web.mjs                         # /partner and /admin websites -> apps/backend-api/web (Railway builds them itself)
cd apps/customer-mobile && npx eas-cli build -p ios --profile production   # iPhone, in Expo's cloud (never EAS for Android)
node scripts/reset-live.mjs                        # OWNER ONLY: wipes live data (needs ALLOW_PLATFORM_RESET)
python scripts/play-store/make-graphics.py         # 512 icons + 1024x500 feature graphics -> build/play-store/
python scripts/play-store/compose-screenshots.py <captures-dir>   # 1080x1920 screenshots
```

`node scripts/docs/route-inventory.mjs` regenerates `docs/generated/ROUTES.md` and `APP_CALLS.md`
after a route changes.

Everything else about testing — one suite alone, the two known Windows failures (`fssaiBadge`
exit crash, `onboarding` port 5040), the **private QA server** recipe (port 7071, fixed code),
the emulator facts and testing on the owner's phone (its Customer and Operations apps are
signed in to LIVE accounts: never order or change anything with them) — is in
**`docs/TESTING.md`**.

---

## 6. Releases and signing

- Every APK must **install as an update** over the one on phones: same package, same
  keystore, rising versionCode. `scripts/build-apks.sh` enforces all three, pins the
  certificate fingerprints, restores `keystore.properties` from the vault, and refuses the
  debug key. After a build, **commit `release/version.json` and the four `app.json` files**.
- Never edit app files while a build runs. Never run two APK builds at once. Before
  building, `cd apps/<app>/android && ./gradlew --stop` if a previous build left a lock
  (`EBUSY` on `classes.dex`).
- "Make APK" from the owner triggers **only** the build; all agreed work is finished first.
- Release history, packages and store state: `docs/RELEASE_AND_STORES.md`. Archive each release
  in `quick-bites-release-archive/vNN-<what>-YYYY-MM-DD/` (`docs/FOLDER_MAP.md` §2).
- **Play App Signing (16 Oct, decided):** Google-managed app signing key (the default). The apps are
  distributed only through Play, so no PEPK export. Our keystores are the **upload keys**; a lost upload
  key can be reset by Google. Phones with sideloaded APKs uninstall them once before installing from Play.
---

## 7. Play Store launch — status on 17 Oct 2026

**Plan (11 Oct, owner):** launch from an **individual** Play account first (closed test: 12+ testers opted in for 14 days per app, then "Apply for production"), and change the same account to Organization once the D-U-N-S number arrives (Google requires a verified business website for that switch).

**Where each app stands (19 Oct 2026):**

| App | Package (final) | Bundle | Play Console |
|---|---|---|---|
| Customer | `in.quickbites.app` | versionCode 36 | Closed test updated by owner 19 Oct (in review / active test) |
| Partner | `com.quickbite.partner` | versionCode 36 | Closed test updated by owner 19 Oct |
| Rider | `in.quickbite.rider` | versionCode 36 | Closed test updated by owner 19 Oct |

> **IMPORTANT NOTICE FOR CLAUDE / ALL AI SESSIONS (19 Oct 2026):**
> The owner uploaded Build 36 `.aab` bundles to Google Play Console Closed Testing to test the self-upload and update process.
> **DO NOT STOP BUILDING, UPDATING, OR WORKING.**
> Claude and all AI sessions must continue working at full speed on remaining Jury Round 1 fixes, ongoing feature enhancements, code optimizations, and version code bumps. The owner testing an upload is never a reason to halt progress.

All bundles are in `build/aab/` and archived in `quick-bites-release-archive/v36-maps-security-2026-10-19/`. Signing is Google-managed (see §6).
Closed test: India, email list "Quick Bites testers" (15 people, CSV in `build/play-store/testers.csv`,
gitignored). Managed publishing off until production.

Ready in the repo / on this PC:
- Listings: `docs/play-store/listings.md`. Graphics + screenshots in `build/play-store/<app>/`.
- Public pages: `/privacy`, `/terms`, `/delete-account` on the Railway URL and on the business
  website `https://www.quickbitesresturants.in` (set as the store listing website).
- Launch guide (2026 Console menus, every form answer, Data safety table):
  https://claude.ai/artifact/JPXk1ZvcLnQC9xgyiXRy9F · Staff guide for all four apps:
  https://claude.ai/artifact/7WMWotXGyeB3RquM9kU5zR (both private to the owner's account).
- **Play gotcha:** the Advertising ID declaration (App content → Advertising ID → No) is not on
  the Dashboard list but blocks "Send changes for review".

Waiting on the owner (details in `OWNER_ACTIONS.md` Part 0, item 00):
1. **Before Google's reviewers look (now):** `OTP_REVIEW_PHONE` / `OTP_REVIEW_CODE` on Railway and
   one sign-in with them; "Quick Bites Test Kitchen" and the test rider created and approved on
   live (kitchen: dishes, Cash on delivery, Online); Business phone in Operations → Settings →
   Business registration (live pages still show `6666666666`).
2. Testers: send the opt-in link once each app is approved; 12+ must stay 14 consecutive days.
3. Razorpay live keys before production; `ALLOW_PLATFORM_RESET=false`; new `ADMIN_PASSWORD`;
   rotate the Groq key; back up the keystore folder off this PC.
4. **D-U-N-S number**, then switch the account to Organization.
5. **SMS sign-in codes (22 Oct, in progress, owner):** Airtel DLT: entity (PE) ID `1001628927790259595`, header
   `QKBTES` registered (non-promotional, permanent), PE-TM chain ACTIVE with MSG91's TM ID `1302157225275643280`.
   MSG91: sender ID `QKBTES` mapped to that PE ID; OTP template `QUICK_BITES` (MSG91 template ID
   `6ac278e24b79348aee059012`, not secret) text "Your OTP for signing in to [QUICK BITES] is ##OTP##. It is valid for 10
   minutes. Do not share this OTP with anyone." The DLT content template (Service Implicit, Food and Beverages, same text
   with `{#numeric#}`, name "QUICK BITES LOGIN OTP") was **submitted 22 Oct, awaiting approval**. Next: paste its 1007…
   ID into MSG91 → OTP → Templates → QUICK_BITES → Test DLT; then **code change (not built yet, owner to confirm)**:
   today the server sends codes by EMAIL whenever the account/app has an email (`modules/auth/otpService.ts:163-198`),
   so `OTP_PROVIDER=msg91` alone keeps current apps on email; send phone codes by SMS when MSG91 is configured, email as
   fallback; then Railway `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `OTP_PROVIDER=msg91`. Owner said: no daily email cap.
8. **Razorpay dashboard → Webhooks:** tick `refund.processed`, `refund.failed`, `payment.dispute.*` on the existing
   webhook (server handles them since 22 Oct, `modules/payments/gatewayEvents.ts`).
9. **Launch readiness decisions** (`docs/plans/launch-readiness-2026-10-22.md` §4): capacity fixes C1–C3 before launch,
   staging environment, Cloudflare, staff second factor, fake-COD rules. Claude Security's real scan needs the Workflow
   tool (not available in the 22 Oct session; enable "Dynamic workflows" in `/config` if offered).
6. A CA: GST collected without a GSTIN, and record retention (5 years in the Privacy Policy vs
   72 months under GST).
7. Firebase: keep the old `com.quickbite.app` / `com.quickbite.rider` / `in.quickbites.rider`
   entries until no phone has those builds.

---

## 7b. App Store (iPhone, customer app only) — status on 14 Oct 2026

Full guide for the owner: **`docs/app-store/IOS.md`**. Built on this Mac with Xcode 26 (not EAS):
bundle id `in.quickbites.app`, app "Quick Bites: Food Delivery" (Apple ID 6822422503), version
1.4.0, **build 10** uploaded (maps fixed, location purpose string, iPhone "Choose on map" fix).
Listing, App Privacy (published 14 Oct), age rating, price (Free, India), review contact and
manual release are filled in through the App Store Connect API (key in
`~/.appstoreconnect/private_keys/`, never in git). TestFlight internal group "Internal team".
**Waiting on:** a real, admin-approved partner restaurant (for the store screenshots, the review
notes' restaurant name and the reviewer's test order), the owner typing the reviewer code into
App Review → Password, and the owner pressing Add for Review / Submit.
Lessons: Xcode's app.config step passes an unresolved `ios/Pods/../..` path (config plugins
must `path.resolve` it); iOS cannot open a Modal while another is closing (use `onDismiss`);
full-screen Modals need the safe-area insets on iPhone.
**Build 10 was built on Expo SDK 52.** The next iPhone build is on SDK 54 (16 Oct): build and retest
before submitting; `withFmtCxx17` / `withRazorpayXcode26` may no longer be needed on SDK 54.

## 8. Working rules (each was learned the hard way)

- **Git:** never `git add -A` / `git add .` / `git commit -a`; stage by explicit path. Never
  `git stash`, `git checkout -- .`, `git reset --hard`, `git clean`. Pushing `main` deploys
  live — the owner has authorized pushing finished, gated work. End commit messages with the
  attribution line the session's system prompt gives.
- **Secrets:** never in the repo or an APK. Never sign in to the live system with the
  owner's password, even when offered — the owner runs `scripts/reset-live.mjs` themselves.
  Never test a key the owner pastes in chat; tell them to put it on Railway and rotate it.
- **Verify against what is deployed**, not just a green suite. A 401 or a green gate has
  proved nothing before; mutate a guard and watch the check fail before believing it.
- **Money paths have copies.** Before accepting a money/notification fix, grep every site
  that sets the same state and check which route the app actually calls.
- In payout checks, **pay the same payee twice** and run with a real hold period; assert
  `payable + held === outstanding`.
- A check that greps source must **strip comments first**. A check must not hardcode a date
  its fixtures compare against. A mutation harness must read stdout **and** stderr.
- **Check what the app reads:** the admin api client already returns `payload.data`; a
  second `.data` reads `undefined` and renders an empty screen.
- **Check the feature exists first** — the owner knows the product; grep the route before
  designing around its absence.
- Scope: four phone apps only, no extra features, no OTA, finish before build.
- A worktree with junctioned `node_modules` runs main's `@quick-bites/*` packages.
- **One account, several roles.** A partner or rider may also be a customer (17 Oct): the
  Customer app's phone-code sign-in grants `customer` and issues a `scope: 'customer'` token
  that `middlewares/auth.ts` limits to customer features. Any new staff route that checks
  ownership instead of `authMiddleware('<role>')` must be added to the mount list there, or a
  customer session could reach it. Pushes pick the app by channel (`forApp`).
  The other way (17 Oct): Partner/Rider sign-up on a Customer-app email (no password) emails a
  confirm link (`askToConfirmByEmail`, `/api/auth/confirm/:token`); only its POST changes anything.
  Customer app on a NEW phone with an existing account's email: the emailed code signs in to that
  account (`emailProven`; never with the shared `fixed` code). The account keeps its own phone.
- **A page with a form must not send `Referrer-Policy: no-referrer`.** Browsers then send
  `Origin: null`, and production's origin check (`cors.ts`, off in dev/QA) answers 500. Test a
  browser POST under production rules (`config.IS_PRODUCTION = true`), not only on the QA server.
- **Maps go through `src/lib/nativeMap.ts`** (Google via `react-native-maps` since 18 Oct; the Partner
  website uses `nativeMap.web.ts`, no native map). The Android key accepts only the release/upload
  signatures, so a debug build shows grey tiles ("Authorization failure"): test maps on a release build.
  (History: @rnmapbox `UserLocation` crashed v30 on the old architecture; Mapbox is gone from the apps.)
- **Modals come from `src/components/Modal`, never straight from `react-native`.** Since SDK 54
  every Android modal is drawn under the status and navigation bars; the wrapper pads them
  (Android only). A bottom sheet built on RN's Modal puts its last button behind the back key.
- **Web-only code lives in `*.web.ts` files** (Metro picks them for the web build):
  `src/webSetup.web.ts`, `config.web.ts`, `download.web.ts`, `invoice.web.ts`. React Native's
  `Alert.alert` is a silent no-op in a browser; the web shell replaces it with a real dialog.
  Size from a component's own layout, not `useWindowDimensions` (the window is wider than
  the 1180 px web panel).
- **Every Expo plugin in an `app.json` must be a declared dependency of that app.** The
  Admin and Partner apps used `expo-build-properties` without declaring it; it only worked
  because the customer app installs it. A clean install (Railway) fails on that.
- **iPhone-only behaviour is fenced with `Platform.OS === 'ios'`** (never `Platform.select`:
  react-native-web ignores a forced OS, so browser checks lie). The Android customer app must
  not change unless the owner asks; check with `npx expo config --type introspect` that the
  `android` section is identical before and after a config change.

## 9. Map of the other documents

**`docs/README.md`** answers "where do I find X" and **`docs/FOLDER_MAP.md`** "which folder holds
what, where does a new file go". Living documents: this file, `AGENTS.md`, `README.md`,
`CHANGELOG.md`, `OWNER_ACTIONS.md`, `COMMANDS.md`, `SIGNING_KEYS.md`, `SESSION_COORDINATION.md`
(rules), everything in `docs/` except `docs/history/`, `docs/plans/` older than October, and
`docs/prompts/`; `legal/*` (served live). **Historical** (true when written, not current, each
with a HISTORICAL banner): `docs/history/*` and the 15 September files kept at the root because
`scripts/diagnostics.js` requires them there (list in `docs/FOLDER_MAP.md` §3), plus
`security/`, `design/`, `build/MANIFEST.md`, `build/chunk-*.md`. Several describe a Cloudflare
tunnel, seeded `pass123` accounts, wallets and Google Maps — all since removed or replaced.

## 10. Claude skills installed on the owner's PC (user level, not in this repo)

**Main skills (owner, 18 Oct 2026): every coding session on this project invokes `seniordev` and
`cleancode` first** (Skill tool) and follows them: shortest working diff, reuse before writing,
surgical changes, one runnable check per non-trivial logic. **Since 22 Oct also
`agent-skills:using-agent-skills`** (addyosmani). Added 22 Oct (user level): plugins `humanizer`,
`hyperframes` (video), `nateherk-design` (Scrollcraft), `claude-security`, the
`claude-plugins-official` marketplace (for new projects); 44 `gws-*` Google Workspace skills +
`gws` CLI; `playwright-cli` skill + CLI; Apify MCP (`https://mcp.apify.com`, sign in once via /mcp).

In `C:\Users\priya\.claude\skills\`: `seniordev` (minimal-code "lazy senior dev", from
Ponytail), `ui-ux-designer` (design library + React Native UI rules, from UI/UX Pro Max),
`less-token` (terse replies, from Caveman), `cleancode` (Karpathy guidelines). Use
`less-token` sparingly with this owner: decisions about money, launch or settings need
plain full sentences.

Added 17 Oct 2026 (user level, so every session on this PC has them):
- Skills: `vercel-react-native-skills` (in the skills folder); plugins `expo` (official Expo skills:
  animation, native UI, design system, upgrade, store submission; its `eas-update` skill does not
  apply, no OTA) and `building-react-native-apps` (Callstack: RN best practices, navigation, upgrades).
- MCP servers (in `~/.claude.json`): **mobile-mcp** (drives the emulator or a USB phone: taps,
  screenshots, crash logs; `ANDROID_HOME` set in its entry), **context7** (current library docs),
  **rea** (reverse-engineer-anything; reads APKs with JADX, the pinned JAR at
  `~/.local/share/rea/android/jadx-headless-mcp-0.7.1-all.jar`, JDK 17), and the Expo plugin's remote
  MCP (needs an Expo sign-in the first time). New servers load in a new session.
- APK study rule: learn behaviour and patterns, rebuild in our own code. Never copy decompiled code,
  images, animations or branding from another app (copyright, and Google Play's impersonation policy).
  The apps run the old React Native architecture, so Reanimated 4 is out; Reanimated 3.x works on SDK 54.
- Also installed 17 Oct: plugins `testing-react-native-apps` (Callstack), `superpowers`, `frontend-design`,
  `skills@swmansion` (Software Mansion, Reanimated authors); **hermes-dec** (reads a React Native app's
  compiled JS bundle; `C:\Users\priya\AppData\Roaming\Python\Python312\Scripts\hbc-decompiler.exe`).
- **Modern animations / New Architecture:** fully planned, not started:
  `docs/plans/new-architecture-and-animations-2026-10-17.md` (audit, versions, steps, phone checklist).
