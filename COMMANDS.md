# Quick Bites — Commands

**Version:** 4.1.0
**Date:** 5 October 2026

Copy-paste commands for humans. Everything here is run from the repository root
unless stated otherwise. The full handoff is `CLAUDE.md`.

## The ones used every day (October 2026)

```bash
node scripts/run-backend-tests.mjs
```

The gate: **81 backend suites**, about 100 seconds. It takes a machine-wide lock,
so a second run waits instead of colliding. On Windows the `onboarding` suite can
fail inside the full run with `EACCES` on port 5040 (a port Windows reserves); it
passes on its own.

```bash
QB_DATA_DIR=$(mktemp -d) npx tsx apps/backend-api/src/test/otp.test.ts
```

One suite on its own. Without a throwaway `QB_DATA_DIR` a suite refuses to run,
because it would write into the developer store.

```bash
bash scripts/build-apks.sh --aab
```

All four signed APKs (`build/apk/`) plus Play bundles for Customer, Partner and
Rider (`build/aab/`). Then commit `release/version.json` and the four
`apps/*/app.json`.

```bash
node scripts/reset-live.mjs
```

**Owner only.** Wipes the live platform's data through the guarded reset (keeps
admins, rates and the audit log). Needs `ALLOW_PLATFORM_RESET=true` on Railway and
the super admin's own email and password, typed by the owner. An AI never runs
this with the owner's password.

```bash
python scripts/play-store/make-graphics.py
python scripts/play-store/compose-screenshots.py <folder-of-phone-captures>
```

Play Store icons (512×512), feature graphics (1024×500) and 1080×1920
screenshots, into `build/play-store/<app>/` (gitignored).

### The private QA server

Every QA round runs the apps on an emulator against a private copy of the
backend, never against live. From `apps/backend-api`:

```bash
NODE_ENV=development PORT=7071 DEMO_MODE=true SEED_DEMO_DATA=true \
QB_DATA_DIR=<an empty temp folder> JWT_SECRET=<any local string> \
ADMIN_EMAIL=<local email> ADMIN_PASSWORD=<local 10+ chars> \
OTP_PROVIDER=fixed OTP_FIXED_CODE=123456 \
node --experimental-strip-types src/server.ts
```

Blank every live-service variable (Supabase, Upstash, MongoDB, Meilisearch, R2,
Firebase) and unset `DATABASE_URL` in that shell; take only the Razorpay **test**
keys and the Mapbox public token from `.env`. Emulator: AVD `qb34` (Android 15);
the apps reach the server at `http://10.0.2.2:7071/api`.

---

## Every check, in one command

```bash
npm run verify
```

Runs, in order and stopping at the first failure:

1. **Secret scan** — fails if any credential from `.env` reached a tracked file.
2. **Hardcoded URL scan** — fails if a deployment address appears outside an
   app's single `src/config.ts`.
3. **Translation check** — every key in EN, HI and KN; every `t('key')` in the
   app source resolving; every `{placeholder}` surviving translation.
4. **Diagnostics** — 34 structural checks.
5. **Typecheck** — **all ten workspaces.** Until 19 September this ran in three,
   and both web portals were completely broken without the gate noticing.
6. **Tests** — 17 backend suites plus the design system and pricing engine.

```bash
npm run verify:full
```

Everything above, plus the production-configuration checks. Those start real
servers in child processes with real environments, because a refusal to boot
cannot be observed any other way. Slower — about two minutes of server starts —
so `verify` is the everyday gate and `verify:full` is the release gate.

**728 checks, 0 failures** as of 19 September 2026.

---

## Running the platform locally

```bash
npm run dev --workspace=@quick-bites/backend-api
```

Starts the API and sockets on `http://127.0.0.1:5000`. With `SEED_DEMO_DATA=true`
(the default outside production) it seeds demo restaurants, menus and accounts,
and `customer@quickbite.app` / `pass123` works.

```bash
npm run dev --workspace=@quick-bites/admin-web
```

The web console, if you prefer a browser to the admin app.

---

## Individual checks

```bash
node scripts/check-secrets.mjs
```

```bash
node scripts/check-hardcoded.mjs
```

```bash
node scripts/diagnostics.js
```

```bash
npm test --workspace=@quick-bites/backend-api
```

Run one suite on its own — useful when something fails and you want the detail:

```bash
cd apps/backend-api && node --experimental-strip-types src/test/sockets.security.test.ts
```

Suites: `health`, `db`, `orders`, `search`, `sockets`, `sockets.security`, `otp`,
`onboarding`, `payments`, `security`, `pipeline`, `admin`, `partner`,
`features`, `contract`, `resilience`, `regression`.

Individual checks that are not backend suites:

```bash
node scripts/check-i18n.mjs
```

```bash
node scripts/check-production-boot.mjs
```

---

## Building the Android apps

```bash
bash scripts/build-apks.sh
```

Produces all four signed, universal APKs in `build/apk/`. Roughly 10–30 minutes
from cold on this machine.

```bash
bash scripts/build-apks.sh --only customer-mobile
```

One app only. The names are the directory names: `customer-mobile`,
`restaurant-mobile`, `delivery-mobile`, `admin-mobile`.

```bash
bash scripts/build-apks.sh --aab
```

Also builds the Play Store bundles (`.aab`) for Customer, Partner and Rider into
`build/aab/`. The Admin app is never published, so it has no bundle.

Every build takes the next versionCode (recorded in `release/version.json`),
restores each `keystore.properties` from `C:\Users\priya\quickbites-keystores`,
and refuses to finish with the wrong key, the debug key or a lower version. See
`SIGNING_KEYS.md`.

### Things that will bite you

**Stop the Gradle daemon before rebuilding.** The build starts by deleting and
regenerating `android/`, and a running daemon holds those files open — the build
fails with `EBUSY: resource busy or locked`:

```bash
cd apps/customer-mobile/android && ./gradlew --stop
```

**Do not leave a shell sitting inside `apps/*/android`.** Same reason.

**JDK 17 is required.** Gradle 8.10 and the Android plugin here reject newer
Java. The build script finds it automatically on Windows, macOS and Linux and
tells you the install command if it cannot.

**Builds are universal on purpose.** They carry all four ABIs so the file that
ships is the file that can be launch-tested, including in an emulator. Passing
`--arm-only` halves the size and removes that ability.

---

## Checking what you built

```bash
"$ANDROID_HOME/build-tools/35.0.0/apksigner.bat" verify --print-certs build/apk/QuickBites-Customer.apk
```

Each app must be signed by **its own** key — look for `OU=customer`, `OU=partner`,
`OU=rider`, `OU=admin` respectively. A mismatch means one app was signed with
another's key, and the two can never be installed side by side.

```bash
"$ANDROID_HOME/platform-tools/adb.exe" install -r build/apk/QuickBites-Customer.apk
```

Install on a connected device or a running emulator. **A build that passes every
static check can still die at launch** — it has happened on this project — so
open each app before publishing anything.

---

## The hosted deployment

```bash
curl https://quick-bites-production.up.railway.app/health
```

Expect `"status":"HEALTHY"` and `"demoMode":false`. If the service is not
running, the environment variables are the first thing to check. Production now
refuses to start without **`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET` and
`DATABASE_URL`**, rather than coming up with no way in or — in the case of the
last one — coming up healthy and writing every order to a container filesystem
that the next deploy throws away.

---

## Git

```bash
git log --oneline -20
```

```bash
git status --short
```

Read `CHANGELOG.md` before starting work and append to it after. It is the
shared source of truth when several sessions work in this one checkout.
