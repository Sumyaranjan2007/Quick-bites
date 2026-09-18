# Quick Bites — Master Fix Plan

**Version:** 1.0.0
**Date:** 2026-09-17
**Author:** Claude Opus 5 (Session 23)
**Status:** Complete. Every phase executed; Phase 6 finished 19 September 2026.
**Baseline commit:** `ced1fc0` (working tree clean, 415/415 backend checks passing)

This plan is the agreed scope for one continuous body of work. It was produced
after a five-batch interrogation and a full read of the codebase. Every item is
either something the owner asked for or something the audit found. Nothing here
is speculative.

---

## 1. What the owner decided

| Question | Decision |
|---|---|
| Scope | Every open known issue, plus everything the audit turns up |
| Release split (1.3.0 declared / 1.2.1 built) | Resolve by building and publishing 1.3.0 |
| Build environment | Install whatever is needed on this machine |
| Railway variables | Owner can set them |
| Payments | **Real Razorpay test-mode integration** (test keys supplied), full security |
| APK storage | Stop tracking in git; GitHub Releases only |
| Email | **Remove the email system.** Replace with phone + OTP, Zomato-style |
| OTP now | Fixed code, swappable to a real provider by configuration alone |
| SMS provider | Undecided — build provider-agnostic, document for the next session |
| OTP scope | Customer app only. Partner/rider/admin keep credentials (Zomato's own model) |
| Rider location | Visible only after pickup, exactly like Zomato, at that level of security |
| Distribution | Testers now (sideload APK), Play Store later |
| Seed data | **Production platform starts empty.** Seed retained for tests and local dev |
| First admin | Bootstrap admin created from Railway environment variables |
| Partner/rider accounts | Self-register in their own app → KYC → admin approves |
| Timeline | No limit. Do it properly, nothing left open |
| Order of work | Workflow + working APK first; UI/design is a later body of work |
| Features | Apply the best features, chosen by engineering judgement |
| Legal | Comply with what the law actually requires |
| Branding | Logo already applied; each downloaded app must identify which app it is |
| Languages | EN / HI / KN must work properly |

**Hard constraint stated by the owner:** *nothing hardcoded.* Every value that
differs between environments, or that will change when the platform goes live,
must come from configuration.

---

## 2. What the audit found

### 2.1 Critical — WebSocket authorization

`apps/backend-api/src/sockets/socketServer.ts` authenticates the connection and
then authorizes nothing. The REST layer, by contrast, is well built: role-scoped
`authMiddleware`, Zod validation, and ownership assertions on every mutating
route. The asymmetry is the vulnerability.

| Event | Line | Hole |
|---|---|---|
| `join:order` | 93 | Any authenticated user joins any order room by id — a stranger's order status and live rider coordinates |
| `join:restaurant` | 112 | Any authenticated user joins any kitchen room. The code's own comment states this room carries whole order objects — names, addresses, phones, bills. Mass PII disclosure |
| `join:admin` | 146 | **No role check.** Any authenticated user joins `admin:control_tower` |
| `join:riders` | 152 | Any authenticated user receives rider broadcast offers |
| `rider:location` | 169 | Any socket, any `orderId`, any coordinates — location spoofing into a stranger's tracking screen |
| handshake | 36–38 | `userId` and `role` are read from client-supplied handshake fields when no token is present |

Mitigating facts confirmed: production hard-forces `DEMO_MODE=false` regardless
of what the host sets (`config/env.ts:38`), verified against the live deployment
(`demoMode:false`). So the token-less handshake path is closed in production.
The five room-join holes are **open in production today**.

### 2.2 Other findings

| # | Finding | Evidence |
|---|---|---|
| A | Production Railway URL hardcoded in 4 files | `admin-mobile/src/lib/session.tsx:13`, `admin-web/src/api.ts:4`, `admin-web/src/lib/adminApi.ts:6`, `customer-mobile/src/screens/CartAndCheckoutScreen.tsx:252` |
| B | Razorpay adapter is a mock — fabricates order ids locally, never calls Razorpay | `modules/payments/razorpayAdapter.ts:16` |
| C | Phone is a profile field, not an identity; no uniqueness, no OTP endpoints | `authRouter.ts`, `userRepository.ts:122` |
| D | No partner/rider self-registration. `/auth/register` correctly hardcodes CUSTOMER | `authRouter.ts:54` |
| E | `build-apks.sh` defaults to macOS paths; this machine has JRE 1.8, no JDK 17 | `scripts/build-apks.sh:30` |
| F | 4 APKs × ~55 MB tracked in git | `git ls-files build/apk` |
| G | `app.json` declares 1.3.0/versionCode 7; only 1.2.1 binaries exist | `apps/*/app.json` vs `build/apk` |
| H | Backend is single-instance-only; boot hydrates every order ever written | `db/postgresStore.ts:24–37` (documented, accepted) |
| I | Every `.md` is stale against the code | — |

### 2.3 What is already correct — do not "fix" these

- REST authorization, validation, rate limiting, ownership assertions.
- Postgres-backed durable persistence with in-memory hydration.
- Customer order cancellation, correctly refused once the kitchen has started
  (`orderRouter.ts:288`).
- KYC approve/reject with audit logging (`admin/peopleRoutes.ts:490`).
- Forgot-password uniform response (no account oracle) — though the whole email
  path is being removed.
- Zero TODO/FIXME/HACK markers in any source file.
- 415 backend checks passing across 10 suites.

---

## 3. Execution phases

Each phase ends with verification. A phase that fails verification is fixed
before the next begins. `CHANGELOG.md` and `build/MANIFEST.md` are updated as
each phase completes, not at the end.

### Phase 0 — Groundwork and safety net

No behaviour change. Makes the rest of the work safe and buildable.

- **0.1** Create `.env` from `.env.example` with the supplied Razorpay test keys.
  Confirm `.gitignore` excludes it. `.env.example` gets placeholders only.
- **0.2** Add `scripts/check-secrets.js` — fails if a Razorpay secret, JWT
  secret, or any `rzp_live_`/private key pattern appears in a **tracked** file.
  Wire into `npm test` and the GitHub workflow.
- **0.3** Install **JDK 17** (Temurin) so Gradle can run on this machine.
- **0.4** Make `scripts/build-apks.sh` cross-platform: detect `JAVA_HOME` and
  `ANDROID_HOME` on Windows (Git Bash), macOS and Linux instead of hardcoding
  macOS paths. Fail with a readable message naming what is missing.
- **0.5** Stop tracking `build/apk/`: `git rm --cached`, add to `.gitignore`.
  Existing blobs stay in history; no new ones are added. `DOWNLOAD.md` already
  points at Releases.

**Verify:** `java -version` reports 17 · `node scripts/check-secrets.js` passes ·
`node scripts/diagnostics.js` 34/34 · `npm test` 415/415 · `git status` clean of
APK paths.

### Phase 1 — WebSocket authorization

Closes §2.1 entirely. This is the highest-value work in the plan.

- **1.1** Identity comes only from the verified JWT. Delete the
  `auth.userId` / `auth.role` fallbacks. A socket with no valid token is
  refused in every mode.
- **1.2** `join:order` — permitted only for the order's customer, its assigned
  rider, the owning restaurant, or an admin. Otherwise refuse and log.
- **1.3** `join:restaurant` — the owning partner or an admin only.
- **1.4** `join:admin` — `ADMIN` role only.
- **1.5** `join:riders` — `DELIVERY_PARTNER` role only, and only while on shift.
- **1.6** `rider:location` — accepted only from the order's **assigned rider**,
  only while the order is `OUT_FOR_DELIVERY` (i.e. after pickup), with
  coordinates validated as finite and in range. This delivers the Zomato
  behaviour the owner asked for and closes the spoofing hole in one change.
- **1.7** Every refusal is logged with `userId`, event and reason.
- **1.8** New suite `src/test/sockets.security.test.ts`: one check per hole,
  each proving the unauthorized case is refused **and** the authorized case
  still works.

**Verify:** new suite passes · existing `sockets.test.ts` still passes · full
suite green.

### Phase 2 — Identity: phone + OTP for customers

Zomato's model. Customer app only; partner, rider and admin keep credentials.

- **2.1** Phone becomes a unique identity. Normalise to E.164 (`+91…`) on write
  and lookup so one human cannot become two accounts by typing spaces.
- **2.2** `modules/auth/otpService.ts` — provider-agnostic. A driver interface
  (`send(phone, code)`), selected by `OTP_PROVIDER`. Ships with the `fixed`
  driver. MSG91 and Twilio driver stubs included and documented so the next
  session adds one file and changes nothing else.
- **2.3** The fixed code comes from `OTP_FIXED_CODE` — not a literal in source.
  It is **refused in production** unless `OTP_ALLOW_FIXED_IN_PRODUCTION=true` is
  explicitly set. The owner sets it for the tester phase and removes it at
  launch; removing it is the entire "switch to real OTP" action.
- **2.4** Endpoints: `POST /auth/otp/request`, `POST /auth/otp/verify`,
  `POST /auth/otp/resend`.
- **2.5** Security on those endpoints: code hashed at rest (never stored or
  logged in clear), single use, 5-minute expiry, max 5 verify attempts before
  invalidation, per-phone and per-IP rate limits with a resend cooldown, and an
  identical response whether or not the number is known — no enumeration oracle.
  The account is created on first successful verification, as Zomato does.
- **2.6** Customer app: phone → code → (first time only) name. Email/password
  login removed from that app.
- **2.7** Remove the email subsystem: `notifications/emailSender.ts`, the
  forgot-password endpoints, and the `EMAIL_*` configuration.
- **2.8** Tests: happy path, wrong code, expired code, reused code, attempt
  cap, rate limit, enumeration parity, and fixed-code refusal in production.

### Phase 3 — Onboarding: self-registration and approval

Removes the `SEED_DEFAULT_PASSWORD` blocker permanently.

- **3.1** `POST /auth/register/partner` and `POST /auth/register/rider` create
  accounts in a `PENDING_VERIFICATION` state.
- **3.2** Gating: a pending partner receives no orders; a pending rider cannot
  start a shift. Enforced in the service layer, not the screen.
- **3.3** Partner app: sign-up, document upload, and an "awaiting approval"
  state that tells the person exactly where they stand.
- **3.4** Rider app: the same.
- **3.5** Admin: the existing approval queue drives the new pending accounts;
  every approval and rejection is audit-logged (that machinery exists).
- **3.6** Bootstrap admin created at boot from `ADMIN_EMAIL` and
  `ADMIN_PASSWORD`. If they are unset in production the service refuses to
  start rather than running with no way in. No admin is ever seeded.
- **3.7** Tests covering each gate and the full onboarding journey.

### Phase 4 — Production starts empty

- **4.1** Seeding runs only when `SEED_DEMO_DATA=true`. Default: true for local
  and test, **false in production**.
- **4.2** Production boot creates the bootstrap admin and nothing else.
- **4.3** Verify the customer app's empty states read correctly with a genuinely
  empty catalogue (the four-state rule is already implemented).
- **4.4** Test suites seed their fixtures explicitly rather than inheriting
  whatever the seed left behind.

### Phase 5 — Payments: real Razorpay (test mode)

- **5.1** Replace the mock adapter with real Razorpay Orders API calls, keys
  from configuration.
- **5.2** Customer checkout offers online payment alongside cash on delivery.
- **5.3** Signature verification server-side (HMAC-SHA256). The client is never
  believed about payment success.
- **5.4** Webhook endpoint: signature verified, timestamp checked (replays
  older than 5 minutes refused), processing idempotent by event id.
- **5.5** Idempotency keys on order creation and payment capture; a payment
  transaction log with status, so a double charge is impossible and detectable.
- **5.6** Refunds credit the customer wallet through the existing ledger.
- **5.7** Tests including a tampered signature, a replayed webhook, and a
  duplicated payment attempt.

### Phase 6 — Feature pass — **DONE (19 September 2026)**

All five built, with 62 automated checks and a UI in the customer app for each.
The partner app also gained a rejection-reason picker, because the server now
refuses a cancellation with no reason and "Reject" would otherwise have broken.

Chosen by judgement, as instructed. Confirmed present and working, so not
rebuilt: cancellation, ratings, coupons, wallet, favourites, address book,
order chat, settlements, rider incentives, SOS, support tickets, refund
requests, admin RBAC and audit log.

To add:

- **6.1** Reorder from order history — one tap rebuilds the basket.
- **6.2** Tip the rider at checkout, carried through to rider earnings.
- **6.3** Live ETA on the tracking screen, derived from real distance rather
  than a fixed number.
- **6.4** Search and filter on the discovery feed: veg-only, rating, price band,
  delivery time.
- **6.5** Cancellation reasons captured, and a refund raised automatically when
  a paid order is cancelled.

Deliberately deferred, with reasons recorded: scheduled orders (needs a job
scheduler the single-instance backend cannot yet guarantee), multi-restaurant
cart (changes the pricing and settlement model), loyalty tiers (no business
rules defined).

**What the work turned up beyond the five features**, recorded here because the
plan is the record of what was actually done:

- Both web portals were broken by an unbound `API_BASE` re-export, and the
  verification gate typechecked 3 of 10 workspaces so it could not see them.
- Production started with no database, reported itself healthy, and wrote orders
  to a filesystem the next deploy destroys.
- Neither the client/server contract nor the completeness of the three languages
  had ever been checked by anything. Both are now checked on every run.

See `TEST_PLAN.md` for the eleven test layers and the six environments, and
`CHANGELOG.md` 2026-09-19 for the detail.

### Phase 7 — Nothing hardcoded

- **7.1** One config module per app. `API_URL` resolves from build-time
  configuration with the production URL as its default value — defined once,
  never inside a screen. Removes all four occurrences in §2.2 A.
- **7.2** Business constants (commission, GST, delivery fee, free-delivery
  threshold, delivery radius, OTP TTL, offer countdown, shift timings) move to
  one configuration surface with documented defaults.
- **7.3** `scripts/check-hardcoded.js` fails the build on a literal http(s) URL
  or IP address inside app screen code, so this cannot silently return.

### Phase 8 — Languages

- **8.1** Every string added in phases 2–6 gets EN, HI and KN translations.
- **8.2** A check that fails if any key is missing from any locale.
- **8.3** Verify switching at runtime across all four apps.

### Phase 9 — Legal and compliance

What the law and the platforms actually require:

- **9.1** Privacy policy and terms rewritten for phone-number identity and
  payment processing. A public URL is mandatory for both Razorpay activation
  and Play submission.
- **9.2** Refund and cancellation policy — required by Razorpay before live
  keys are issued.
- **9.3** **TRAI DLT** documented in `legal/COMPLIANCE.md`: entity registration,
  header (sender id), and template approval must all exist before any Indian
  OTP SMS will be delivered. This is law, not a provider rule, and it is the
  long-pole item for real OTP.
- **9.4** GST: invoice fields and the 5% rate the pricing engine already
  applies, documented and shown on the customer's bill.
- **9.5** Play Data Safety declaration prepared: what is collected (phone,
  location, payment), why, and that account deletion exists — `DELETE /me` is
  already implemented, which Play requires.
- **9.6** Location disclosure: a foreground-location prominent-disclosure prompt
  in the rider app, which Play requires before the permission is requested.

### Phase 10 — App identity and the APK build

- **10.1** Each app gets a distinct launcher label, so a downloaded app says
  which one it is: **Quick Bites**, **Quick Bites Partner**, **Quick Bites
  Rider**, **Quick Bites Admin**. Same logo, as instructed. Distinct package
  ids and distinct APK filenames.
- **10.2** Build all four at **1.3.0 / versionCode 7**, universal, signed with
  each app's own upload key.
- **10.3** Verify every APK with `apksigner` and confirm each is signed by its
  own key — never another app's.
- **10.4** Install each on a device or emulator and confirm it launches. A build
  that passes static checks and dies at launch has happened in this project
  before; static verification alone is not accepted.
- **10.5** Publish the release; update `DOWNLOAD.md` with full `https://` URLs
  in visible text (a bare filename becomes a search query on a phone — this
  already cost one tester cycle).

### Phase 11 — Documentation

Every `.md` brought up to the code, and forward-looking where the owner has
decided a direction but not yet a vendor.

`README.md` · `PRD.md` · `TAD.md` · `DATABASE_SPEC.md` · `APP_FLOW.md` ·
`MENTAL_MODEL.md` · `IMPLEMENTATION_PLAN.md` · `SECURITY_ACCESS.md` ·
`TESTING_STRATEGY.md` · `FRONTEND_SPEC.md` · `OBSERVABILITY.md` ·
`SEO_PERFORMANCE.md` · `COMMANDS.md` · `AI_RECOVERY.md` · `TEAMMATE_GUIDE.md` ·
`FEATURE_TICKETS.md` · `DOWNLOAD.md` · `STORE_RELEASE.md` · `legal/*` ·
`build/MANIFEST.md` · `CHANGELOG.md`

Stale content is removed rather than left to mislead. The SMS-provider decision
is recorded as open, with the DLT dependency stated, so the next session
understands what is deliberately unfinished.

### Phase 12 — Final verification

- Full backend suite, diagnostics, typecheck, secret scan, hardcoded scan.
- The four-role journey run against the **hosted** API through the real apps on
  real phones: customer orders → partner accepts → rider claims, collects with
  the pickup code, delivers with the doorstep OTP → admin sees it all.
- Clean-install check: download each APK exactly as a tester would.

---

## 4. What the owner must do

Nothing in this list can be done from this machine.

### Before testing (required)

Set on Railway, then redeploy:

| Variable | Value | Why |
|---|---|---|
| `ADMIN_EMAIL` | your address | The one bootstrap admin |
| `ADMIN_PASSWORD` | a strong password you choose | Admin access; the service refuses to start in production without it |
| `RAZORPAY_KEY_ID` | `rzp_test_…` | Test-mode payments |
| `RAZORPAY_KEY_SECRET` | the test secret | Signature verification |
| `OTP_PROVIDER` | `fixed` | Until a real SMS provider is chosen |
| `OTP_FIXED_CODE` | a 6-digit code you choose | The test OTP. Not in source |
| `OTP_ALLOW_FIXED_IN_PRODUCTION` | `true` | Temporary. **Removing this is the switch to real OTP** |
| `SEED_DEMO_DATA` | `false` | Production starts empty |
| `JWT_SECRET` | a long random string, if not already set | Token signing |

`SEED_DEFAULT_PASSWORD` becomes obsolete and should be deleted.

### Before real OTP (later)

1. TRAI DLT entity registration.
2. Sender id (header) registration.
3. OTP template registration and approval.
4. Choose a provider (MSG91 recommended for India), then add its driver and set
   `OTP_PROVIDER`, and remove `OTP_ALLOW_FIXED_IN_PRODUCTION`.

### Before live payments (later)

Razorpay business KYC, then swap the two test keys for live keys. The
integration does not change.

### Before Play submission (later)

Play requires an AAB rather than an APK, a public privacy-policy URL, the data
safety form, content rating, and custody of the upload keys — losing an upload
key means the app can never be updated under that package id again.

---

## 5. Risks

| Risk | Handling |
|---|---|
| Phone identity migration touches auth across the platform | Customer app only; staff auth untouched; every gate covered by a test |
| An empty production platform means an empty customer app until a partner is onboarded | Expected and intended; onboarding is Phase 3 and is verified end to end |
| A universal fixed OTP on a public deployment is an open door | Refused in production unless one explicit variable is set; removing it is a one-line launch action |
| Razorpay test keys are in this session's chat | Stored only in gitignored `.env`; a secret scanner fails the build if one reaches a tracked file; rotate if ever exposed |
| Single-instance backend | Documented ceiling; do not raise replica count without versioned upserts (`postgresStore.ts:24`) |
| An APK that passes checks and dies on launch | Has happened here before. Every APK is installed and launched before publication |

---

## 6. Definition of done

- All 12 phases verified.
- Backend suite green, including the new socket-security, OTP, onboarding and
  payment checks.
- No hardcoded URL, secret or environment value in any app screen.
- Four signed 1.3.0 APKs, each identifying itself by name, each launch-tested.
- The four-role journey completed against the hosted API on real phones.
- Every `.md` accurate against the code, `CHANGELOG.md` updated per phase.
