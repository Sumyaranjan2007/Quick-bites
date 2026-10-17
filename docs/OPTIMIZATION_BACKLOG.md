# Optimisation backlog — proposals only, nothing here is built

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Written 17 Oct 2026 at commit `3caa076`. The owner picks; each item is its own piece of work
with its own checks. "New build" = needs new APKs/AABs and a store release.

## Top three (recommended first)

| # | Item | Saves / earns | Risk | Effort | New build? |
|---|---|---|---|---|---|
| O1 | **Fix K1: store the customer's phone on new orders** (`orderService.ts:780`) so riders can call | fewer failed deliveries and support calls; it is a broken button today | low (server only; `contactVisibility.ts` already masks it by status) | small | no |
| O2 | **Keep pending confirm links in the store, not memory** (`authRouter.ts:714`) and **return 403 for a malformed Origin** (`cors.ts:23-25`) | partners/riders who sign up near a deploy no longer have to redo it; cleaner error logs | low | small | no |
| O3 | **Let `scripts/diagnostics.js` find historical docs in `docs/history/`** (change its `requiredDocs` list, `:39-53`), then move the 15 remaining September docs off the root | a root an AI can read in one glance; less chance an AI trusts a stale document | very low (CI-only check) | small | no |

## Code shared by copy across the four apps

Same file copied into each app (md5 compared on 17 Oct). A fix made in one copy and not the
others has happened before (`CLAUDE.md` §8, "money paths have copies").

| File | Copies | Identical? | Proposal |
|---|---|---|---|
| `src/components/Modal.tsx` | 4 | yes | move to a shared package (`packages/app-shared`) |
| `src/lib/useHiddenSettings.ts`, `src/lib/useHardwareBack.ts`, `src/components/ErrorBoundary.tsx` | 4 each | yes | same |
| `src/components/SafeScreen.tsx` | 3 | yes | same |
| `src/lib/cameraFit.ts` | 2 (customer, rider) | yes | same |
| `src/components/MenuBuilder.tsx` (896 lines) | 2 (partner, admin) | yes | same — biggest single win |
| `src/lib/apiFetch.ts` | 4 | 3 identical, customer differs | share the common part |
| `src/lib/nativeMap.ts` | 3 | all differ (318/269/305 lines) | share the core (the `LocationPuck` rule lives in each copy) |
| `src/lib/pushRegistration.ts`, `photo.ts`, `storedSession.ts`, `orderAlert.ts` | 2–4 | differ | review, share what is common |

Saves: one place to fix; smaller review. Risk: medium (Metro and workspace packages; the Android
customer app must not change unless the owner asks). Effort: medium. **New build: yes** (all apps).

## Size and dependencies

| # | Item | Evidence | Saves | Risk | New build? |
|---|---|---|---|---|---|
| O4 | APK size: Customer/Partner/Rider APKs are ~136 MB, Admin 56 MB; AABs ~64 MB | `build/apk`, `build/aab` (16 Oct) | Play already serves split APKs from the AAB; the sideloaded APKs could be split per ABI | low | yes |
| O5 | Workspace packages listed but never imported: Customer `@quick-bites/design-system`, `@quick-bites/shared-types`; Partner `@quick-bites/pricing-engine`, `@quick-bites/shared-types`, `react-native-svg`; Rider `@quick-bites/design-system`, `@quick-bites/pricing-engine`, `react-native-svg`; Admin `@quick-bites/pricing-engine`, `@quick-bites/shared-types` | grep of each app's code vs its `package.json` (17 Oct; `react-native-web`, `react-dom`, `@expo/metro-runtime` are needed for the websites and stay) | tidier installs | low–medium (`react-native-svg` may be a peer of another package: check before removing) | yes |
| O6 | Run a real dependency audit (`npx depcheck`, read-only) | not run here (it downloads a tool) | – | none | no |

## Dead code and leftovers

| # | Item | Evidence | Proposal | Risk |
|---|---|---|---|---|
| O7 | 52 `/api` endpoints have no literal caller in any app | `docs/generated/ROUTES.md` (bottom line). Some are real (webhook, confirm link, health, invoices built at run time), some look unused: `/api/wallets/*` (legacy wallet), `/api/test/echo`, `/api/auth/me/:userId`, `/api/riders/profile/:userId`, `/api/restaurants/:id/menu/items*` (partners now request changes), several `/api/admin/*` reports | check each by hand, then remove the unused with their tests | medium (an old app version on a phone may still call one) |
| O8 | Config read but never used: `SUPABASE_*`, `MONGODB_URI`, `PASSWORD_RESET_ECHO`, `UPSTASH_*` (label only); `GOOGLE_MAPS_ANDROID_KEY` read by no app | `docs/CONFIG_AND_SECRETS.md` | delete from `config/env.ts` and `.env.example`; remove `TWOFACTOR_*` from Railway | low |
| O9 | `apps/backend-api/prisma/schema.prisma`, `docs/index.html` (old landing page), Redis in `docker-compose.yml` | nothing references them | move to `docs/history/` or the old-files folder (owner rule: never delete) | very low |
| O10 | `apps/backend-api/src/routes/admin/legacyRoutes.ts`, `modules/payments/legacySettlements.ts` | names say legacy | confirm unused, retire | medium |

## Gate and tooling

| # | Item | Evidence | Saves | Risk |
|---|---|---|---|---|
| O11 | Gate takes ~1 min 46 s on this PC (87 suites, one process each) | baseline run 17 Oct | run independent suites in parallel → under a minute | medium (the lock and per-suite data dirs must hold) |
| O12 | `fssaiBadge` "fails" on every Windows run (exit crash after all checks pass) | `docs/TESTING.md` | close its handles cleanly so the gate is green on Windows | low |
| O13 | `scripts/build-web.mjs` prints Node `DEP0190` (shell + args) | build log | pass args without `shell: true` | low |

## Data growth (in-memory store)

| # | Item | Evidence | Proposal | Risk |
|---|---|---|---|---|
| O14 | Every document lives in memory and the whole store is loaded on boot; `ledgerEntries`, `auditLogs`, `orders`, `orderMessages` only grow | `db/client.ts`, `db/postgresStore.ts:153` | measure size now; above ~100k orders, archive old orders/messages to a cold table and load on demand | medium–high (money history must stay explainable) |

## Documents

| # | Item | Proposal |
|---|---|---|
| O15 | `CHANGELOG.md` is ~430 KB / 5,400 lines | split by month into `docs/history/changelog-YYYY-MM.md`, keep the last month in the root file |
| O16 | `CLAUDE.md`, `COMMANDS.md`, `OWNER_ACTIONS.md` repeat the same commands and settings | keep each fact in one place (the maps in `docs/`), link from the others |
| O17 | `OWNER_ACTIONS.md` Parts 1–2 (20 Sep) are partly superseded | move them to `docs/history/` |
