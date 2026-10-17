# Where to find what

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Start with `CLAUDE.md` (the handoff), then **`docs/FOLDER_MAP.md`** (every folder, and where new
files go). Every map below points at the code with `file:line` and says the date and commit it
was checked against. Where a map and the code disagree, the code wins: fix the map.

| Question | Document |
|---|---|
| Which folder holds what, on this PC and in the repo? Where do I save a new file? | `docs/FOLDER_MAP.md` |
| How do the four apps, the server, Railway and the outside services fit together? | `docs/SYSTEM_MAP.md` |
| Which routers and endpoints exist, who may call them? | `docs/BACKEND_MAP.md`, full list `docs/generated/ROUTES.md` |
| Which screen is in which file, and what does it call? | `docs/APPS_MAP.md`, calls `docs/generated/APP_CALLS.md` |
| What data is stored, which code writes it, how is it saved? | `docs/DATA_MODEL.md` |
| How do people sign in? Roles, multi-role accounts, confirm links, deletion? | `docs/AUTH_AND_ROLES.md` |
| Prices, rider pay, cash, ledger, payouts, invoices, GST? | `docs/MONEY_FLOWS.md` |
| Push notifications, channels, rider GPS → customer map, Mapbox rules? | `docs/NOTIFICATIONS_AND_TRACKING.md` |
| Every environment variable (names only) and what breaks without it? | `docs/CONFIG_AND_SECRETS.md` |
| The test gate, every suite, QA server, emulator and phone recipes? | `docs/TESTING.md` |
| Building, signing, versionCodes, Play Console and App Store status? | `docs/RELEASE_AND_STORES.md` (+ `SIGNING_KEYS.md`, `docs/play-store/`, `docs/app-store/IOS.md`) |
| Deploy, health, roll back, rotate a key, codes not arriving? | `docs/RUNBOOK.md` |
| What is broken or inconsistent right now? | `docs/KNOWN_ISSUES.md` |
| What has the owner already decided? | `docs/DECISIONS.md` (money also `CLAUDE.md` §4) |
| What could be made better (proposals, not built)? | `docs/OPTIMIZATION_BACKLOG.md` |
| What only the owner can do? | `OWNER_ACTIONS.md` Part 0 |
| What changed, when? | `CHANGELOG.md` |
| Commands | `COMMANDS.md` |
| The 17 Oct reorganisation (what moved, what was kept) | `docs/ORGANIZATION_PLAN.md` |
| Old documents (true when written, not current) | `docs/history/README.md`, and the 15 HISTORICAL files at the root (`docs/FOLDER_MAP.md` §3) |
| Plans | `docs/plans/` (newest: `menu-ai-maps-money-2026-10-01.md`, `cod-menus-payouts-playstore-2026-10-02.md`) |
| Downloads and installing the APKs | `docs/DOWNLOAD.md` |

Regenerate the generated files after changing a route: `node scripts/docs/route-inventory.mjs`.
