# Known issues — open problems, with evidence

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. Nothing here was changed by the documentation
work; each item needs its own fix (and, for app-side fixes, a new build). Remove an item in the
commit that fixes it.

## Behaviour

**K1–K3: fix written but paused (17 Oct 2026), not tested or committed** — plan and status in
`docs/plans/k1-k3-fixes-2026-10-17.md`.

| # | Problem | Evidence | Cost / risk | Fix needs |
|---|---|---|---|---|
| K1 | **Orders never store the customer's phone**, so the Rider app's "Call customer" button has no number | Order built at `apps/backend-api/src/modules/orders/orderService.ts:780-800` without `customerPhone`; no code sets it later (`grep -rn "customerPhone" apps/backend-api/src` shows only reads, e.g. `modules/orders/contactVisibility.ts:128`); the button calls `trip.customerPhone` (`apps/delivery-mobile/src/screens/TripScreen.tsx:348`). The same empty field reaches refunds (`modules/payments/refunds.ts:234-241`) and admin views (`routes/admin/financeRoutes.ts:317`) | riders cannot call a customer they cannot find; support calls cost time | server only: set it from the customer account when the order is created (no app build) |
| K2 | **A malformed `Origin` header gives 500 instead of 403** | `middlewares/cors.ts:23-25` returns a plain `Error` with no status; `middlewares/errorHandler.ts:9` turns a missing status into 500 | noisy error logs, misleading status; no data risk | server only: give the error a 403 status |
| K3 | **Pending emailed confirm links live in memory** and vanish on every deploy or restart | `pendingRoles = new Map()` at `routes/authRouter.ts:714` | a partner/rider who registered just before a deploy must register again | server only: keep them in the store (hashed token) |
| K4 | **The payee text still promises "paid automatically on the weekly run"**, contradicting "admin pays whenever" | `modules/payments/payoutPromise.ts:140` (cadence from rate `payoutCadenceDays: 7`, `packages/shared-types/src/index.ts:1875+`) | partners and riders may expect automatic weekly money | **owner's wording first**, then server text |
| K5 | Live public pages still show the business phone `6666666666` | `OWNER_ACTIONS.md` Part 0 item 00.4 | looks unfinished to reviewers | owner: Operations → Settings → Business registration |

## Documents that disagree with the code (fixed or noted in this round)

| # | Document said | Code says | Status |
|---|---|---|---|
| D1 | `CLAUDE.md` §2: repositories are the only writers | many routes and modules write the store directly (`docs/DATA_MODEL.md`) | fixed in `CLAUDE.md` §2 (17 Oct) |
| D2 | `CLAUDE.md` §5: 84 backend suites | 87 (`docs/TESTING.md`) | fixed in `CLAUDE.md`, `AGENTS.md`, `COMMANDS.md` (17 Oct) |
| D3 | `SIGNING_KEYS.md` top note and `OWNER_ACTIONS.md` Part 0 B.4: use PEPK / "an existing key" | owner decided Google-managed app signing on 16 Oct (`CLAUDE.md` §6) | fixed in both documents (17 Oct) |
| D4 | `riderPerKm` suite header: "Rs 10 a road km" | default is ₹12 (`packages/shared-types/src/index.ts:1908`) | open: a comment inside a test file (code edit needs the owner's OK) |

## Housekeeping

| # | Item | Where |
|---|---|---|
| H1 | Variables read but never used: `SUPABASE_*`, `MONGODB_URI`, `PASSWORD_RESET_ECHO`, `UPSTASH_*` (label only); `GOOGLE_MAPS_ANDROID_KEY` read by no app | `docs/CONFIG_AND_SECRETS.md` |
| H2 | The Firebase service-account private key sits in the owner's Downloads folder | `docs/FOLDER_MAP.md` §2 |
| H3 | `apps/backend-api/prisma/schema.prisma`, `docs/index.html`, `docker-compose.yml`'s Redis are leftovers | `docs/OPTIMIZATION_BACKLOG.md` |
| H4 | Keys shared in chats still to rotate: Groq, `ADMIN_PASSWORD`, MSG91 OTP-widget token | `CLAUDE.md` §3 |
