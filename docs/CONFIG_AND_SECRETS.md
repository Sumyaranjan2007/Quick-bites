# Configuration and secrets — every variable, by NAME only

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. **No values here, ever** (the repo is public).
Production values: Railway → backend service → Variables (changing one + Deploy restarts the
server). Local values: root `.env` (gitignored); names in `.env.example`. Most are read in
`apps/backend-api/src/config/env.ts` (line given). Live state of each (set / to rotate):
`CLAUDE.md` §3 and `OWNER_ACTIONS.md` Part 0.

## Server (Railway)

| Variable | Read at | What breaks without it |
|---|---|---|
| `NODE_ENV` | `config/env.ts:28` | `production` turns on every production guard |
| `PORT` | `config/env.ts:73` | default 5000 |
| `DATABASE_URL`, `PGSSLMODE` | `controllers/healthController.ts:42`, `db/postgresStore.ts:103` | **production refuses to start** (`server.ts:51`) |
| `ALLOW_FILE_PERSISTENCE` | `server.ts:51` | tests only: lets production start without a database |
| `JWT_SECRET` | `config/env.ts:75` (`requireSecret`) | **production refuses to start** |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `config/env.ts:199-200` | no super admin; re-applied on every boot (≥10 chars). Password was shared in a chat: owner must change it |
| `ALLOW_PLATFORM_RESET` | `config/env.ts:254` | enables the guarded wipe (`scripts/reset-live.mjs`); **must be false/absent at launch** |
| `SEED_DEMO_DATA`, `DEMO_MODE`, `SEED_DEFAULT_PASSWORD` | `config/env.ts:208`, `:53`, `db/seed.ts:42` | must be off in production |
| `OTP_PROVIDER` | `config/env.ts:165` | `email` on live; `msg91`, `2factor`, `fixed`, `twilio` (stub) |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | `modules/auth/otpDrivers.ts:137-145` | no sign-in codes, no confirm links |
| `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS` | `config/env.ts:188-190` | defaults (TTL 5; live uses 10) |
| `OTP_REVIEW_PHONE`, `OTP_REVIEW_CODE` | `config/env.ts:184-185` | store reviewers cannot sign in |
| `OTP_FIXED_CODE`, `OTP_ALLOW_FIXED_IN_PRODUCTION` | `config/env.ts:166`, `:176` | fallback shared code; production refuses an obvious code |
| `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | `otpDrivers.ts:91-92` | SMS codes. Today only when no email is involved (old app versions); `otpService.ts:163-198` sends email first. Template ID to use: `6ac278e24b79348aee059012` (MSG91 OTP template QUICK_BITES, sender QKBTES, Airtel DLT; not secret). Switch planned once the DLT template is approved (CLAUDE.md §7 item 5) |
| `TWOFACTOR_API_KEY`, `TWOFACTOR_TEMPLATE` | `otpDrivers.ts:209-212` | unused; remove from Railway |
| `PUBLIC_BASE_URL`, `RAILWAY_PUBLIC_DOMAIN` | `routes/authRouter.ts:721-722` | confirm-link host falls back to the live URL |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | `config/env.ts:103-112` | no online payment; **live still on test keys (2 Oct)** |
| `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, `RAZORPAYX_WEBHOOK_SECRET` | `config/env.ts:132-137` | no automatic payouts (pay by hand still works) |
| `PAYEE_ACCOUNT_KEY` | `modules/payments/payeeAccountNumbers.ts:27` | full bank numbers cannot be encrypted/stored |
| `GOOGLE_MAPS_SERVER_KEY` | `config/env.ts` (master plan B2, 18 Oct) | road distance/time from Google's Routes API when set (two-wheeler, traffic); without it Mapbox (if its token is set), else the estimate. Owner creates it in Google Cloud (`docs/ops/OPS_GUIDE.md`) |
| `MAPBOX_ACCESS_TOKEN`, `ROAD_DISTANCE_FACTOR`, `PLACES_REGION` | `config/env.ts:349`, `:234`, `:362` | straight-line distance fallback; address search off (Mapbox stays until the Google key is set and the apps move in Stage C) |
| `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` | `config/env.ts:90-91` | built-in search used instead |
| `FCM_SERVICE_ACCOUNT_JSON` | `config/env.ts:378` | no Android push |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_HOST` | `config/env.ts:386-390` | no iPhone push (set 13 Oct) |
| `GROQ_API_KEY`, `GROQ_MODEL` | `config/env.ts:355-356` | no menu-from-photo; key was shared in a chat: rotate |
| `GEMINI_API_KEYS` (comma-separated; `GEMINI_API_KEY` also read), `GEMINI_IMAGE_MODEL` | `config/env.ts` | no AI dish pictures in Operations ("not set up"); a key at its limit is skipped for an hour and the next is used |
| `ADMIN_WEB_PATH` | `config/env.ts`, `routes/webApps.ts` | unset: the Operations website is at `/admin`; set: only at `/<value>`, and `/admin` is a 404. Keep it long and random, never in git |
| `EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID` | `config/env.ts:404-408` | no masked calling (optional) |
| `TEST_RIDER_EMAIL`, `TEST_RIDER_PASSWORD`, `TEST_RIDER_NAME`, `TEST_RIDER_PHONE` | `db/ensureTestRider.ts:27-47` | opt-in: no test rider provisioned |
| `QB_DATA_DIR`, `QB_WEB_DIR` | `db/client.ts:28`, `routes/webApps.ts:18` | local data folder / websites folder overrides |
| Timing knobs: `ORDER_ACCEPT_TIMEOUT_MINUTES` :295, `ORDER_SWEEP_INTERVAL_SECONDS` :411, `RIDER_NOSHOW_WARN_MINUTES` :263, `RIDER_NOSHOW_RELEASE_MINUTES` :272, `RIDER_ASSIGN_ALERT_MINUTES` :304, `PAYMENT_RECONCILE_AFTER_MINUTES` :314, `PAYMENT_ABANDON_AFTER_MINUTES` :320, `DEFAULT_PREP_MINUTES` :284, `DELIVERY_SPEED_KMPH` :220, `DELIVERY_HANDLING_MINUTES` :278, `DELIVERY_PROXIMITY_METRES` :421, `MAX_TIP_AMOUNT` :429 | `config/env.ts` | defaults apply |
| Dead (read, never used): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` :78-80, `MONGODB_URI` :87, `PASSWORD_RESET_ECHO` :149; `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` :83-84 (only a label on `/health`, `healthController.ts:47`; the rate limiter is in memory) | `config/env.ts` | nothing (`docs/OPTIMIZATION_BACKLOG.md`) |

## Build time (root `.env` on this PC; baked into APKs on purpose)

| Variable | Used by | Protection |
|---|---|---|
| `MAPBOX_PUBLIC_TOKEN` | `apps/*/app.config.js`, `withMapboxToken.js` | restricted by package + SHA-1 |
| `MAPBOX_DOWNLOAD_TOKEN` (secret `sk.`) | Gradle via `scripts/build-apks.sh:294-301`; iPhone via Expo env + `scripts/eas-mapbox-netrc.mjs` | never in the APK |
| `GOOGLE_MAPS_ANDROID_KEY` | no app reads it since the Mapbox move; still listed in `.env.example` and checked for by `scripts/check-apk-secrets.mjs:70` | – |
| Razorpay **test** keys | QA server | test only |

`node scripts/check-apk-secrets.mjs` fails a build whose bundle contains a server key.

## Files that are secrets (never in the repo)

| What | Where |
|---|---|
| Android upload keys + passwords | `D:\dev-data\quickbites-keystores\` (`SIGNING_KEYS.md`) |
| `apps/*/google-services.json` | gitignored; recreate from Firebase console |
| Firebase service-account JSON | Railway `FCM_SERVICE_ACCOUNT_JSON`; owner's password manager (a copy sits in Downloads: move it) |
| Apple `.p8` push key, App Store Connect API key | outside the repo (`~/.appstoreconnect/private_keys/` on the Mac) |
| Testers list, DLT drafts | `build/play-store/` (gitignored) |

## Rotating a key

Create the new key at the provider → paste on Railway → Deploy → check `/health` → delete the old
key at the provider. **Keys to rotate now** (shared in chats): Groq key, `ADMIN_PASSWORD`,
the MSG91 OTP-widget token. Never test a key someone pastes in chat.
