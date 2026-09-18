# Quick Bites — Commands

**Version:** 4.0.0
**Date:** 19 September 2026

Copy-paste commands for humans. Everything here is run from the repository root
unless stated otherwise.

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

**714 checks, 0 failures** as of 19 September 2026.

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
curl https://quick-bites-production-9f45.up.railway.app/health
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
