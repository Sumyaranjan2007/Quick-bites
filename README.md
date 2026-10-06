# Quick Bites

Food delivery for Harohalli and Ramanagara, Karnataka: four Android apps, one
backend, and two websites (the Partner and Admin apps, running in a browser).
The customer app is also being prepared for the iPhone App Store.

**New here (person or AI)? Read [`CLAUDE.md`](CLAUDE.md) first.** It is the
current, complete handoff: where everything runs, where every setting lives, the
owner's decisions, the commands and the launch status. This README is the short
front door.

**Status, 6 October 2026:** live on Railway; APKs at 1.4.0 (Customer and Rider
versionCode 21, Partner 22, Admin 23); preparing the Google Play launch and the
iPhone build. Real SMS sign-in codes run through MSG91 and start arriving once
the owner links the DLT template; until then a private shared test code can be
switched on (see `OWNER_ACTIONS.md` Part 0 J).

---

## The four apps

| App | Folder | Package | For |
| --- | --- | --- | --- |
| Quick Bites | `apps/customer-mobile` | `com.quickbite.app` | customers: browse, order, pay online or cash where allowed, track live |
| Quick Bites Partner | `apps/restaurant-mobile` | `com.quickbite.partner` | restaurants: take orders, build menus (also from photos), see money, download invoices (PDF, or one PDF per order in a ZIP) |
| Quick Bites Rider | `apps/delivery-mobile` | `com.quickbite.rider` | riders: see pay before accepting, navigate, collect cash, earnings |
| Quick Bites Operations (admin) | `apps/admin-mobile` | `com.quickbite.admin` | the owner: approvals, rates, payouts, COD switch, menus, support |

Backend: `apps/backend-api` (Express + Socket.IO, TypeScript, PostgreSQL in
production). Live at `https://quick-bites-production.up.railway.app`.

Websites: the same server serves the Partner app at `/partner` and the Admin app
at `/admin` — the apps' own code built for the browser (`scripts/build-web.mjs`,
run by the Dockerfile on every deploy). There is no separate web codebase; the
old `apps/admin-web` and `apps/restaurant-web` were deleted on 6 Oct.

## How people sign in

- **Customers:** phone number + a one-time SMS code. Verifying a code for a new
  number creates the account. There are no customer passwords.
  Google's reviewers use one reviewer number set on the server
  (`OTP_REVIEW_PHONE` / `OTP_REVIEW_CODE`); no SMS goes to it.
- **Restaurants and riders:** register in their app, upload documents, and wait
  for an admin to approve them. Until then a restaurant is hidden and a rider
  cannot go online.
- **Admin:** exactly one super admin, created at every boot from `ADMIN_EMAIL`
  and `ADMIN_PASSWORD` on the server. Production refuses to start without them.
- **Production seeds nothing.** A fresh live platform is empty. Locally,
  `SEED_DEMO_DATA=true` seeds demo restaurants and `customer@quickbite.app`.

## Run, check, build

```bash
npm install
npm run dev --workspace=@quick-bites/backend-api     # local backend (data in apps/backend-api/data/)
node scripts/run-backend-tests.mjs                   # the gate: 83 suites
npm run verify                                       # secrets, i18n, typecheck, tests
bash scripts/build-apks.sh --aab                     # four signed APKs + Play bundles
node scripts/build-web.mjs                           # the /partner and /admin websites
```

Details, pitfalls and the private QA-server recipe: `COMMANDS.md` and
`CLAUDE.md` §5. Signing keys: `SIGNING_KEYS.md`. Play Store: `STORE_RELEASE.md`
and `docs/play-store/listings.md`. iPhone: `docs/app-store/IOS.md`. Installing on
phones: `DOWNLOAD.md`.

## Rules that matter most

- The repository is **public**: no secret ever goes into a tracked file.
- Every APK must install **over** the existing app (same key, higher versionCode);
  the build script enforces this.
- Stage by path; never `git add -A` or `git stash`. Pushing `main` deploys live.

## Documents

Living documents are listed in `CLAUDE.md` §9. Many older files in the root
(`PRD.md`, `TAD.md`, `APP_FLOW.md`, `DATABASE_SPEC.md`, the various `*_PLAN.md`)
are historical: correct when written, superseded since.
