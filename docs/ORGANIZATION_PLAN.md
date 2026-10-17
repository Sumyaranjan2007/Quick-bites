# Organisation plan — Quick Bites folders on this PC

**Written:** 17 October 2026 at commit `c25685c` (before anything moved).
**Status:** approved by the owner on 17 Oct 2026 ("Yes, all moves") and carried out the same
day. For the leftovers the owner answered "don't remove them, just save them in a proper folder
and mark them properly": nothing was deleted; see "What was done with the leftovers" below.

## What we found that limits the plan

1. **`scripts/diagnostics.js:39-53` requires 18 documents to sit at the repo root**
   (`PRD.md`, `TAD.md`, `APP_FLOW.md`, `MENTAL_MODEL.md`, `FEATURE_TICKETS.md`, `README.md`,
   `IMPLEMENTATION_PLAN.md`, `CHANGELOG.md`, `COMMANDS.md`, `AI_RECOVERY.md`,
   `TEAMMATE_GUIDE.md`, `SLIDES.html`, `FRONTEND_SPEC.md`, `SECURITY_ACCESS.md`,
   `OBSERVABILITY.md`, `SEO_PERFORMANCE.md`, `TESTING_STRATEGY.md`, `DATABASE_SPEC.md`),
   the folders `build`, `legal`, `design`, `security` (`:56-64`) and `build/chunk-00..09.md`
   + `build/MANIFEST.md` (`:67-82`). GitHub CI (`.github/workflows/ci.yml`) and
   `npm run verify` run it. Moving any of them fails CI. Changing the script is a code
   change this task may not make, so **they stay where they are** (each already carries a
   HISTORICAL banner). A one-line script change to free the root is in
   `docs/OPTIMIZATION_BACKLOG.md`.
2. **`legal/*.md` is read by the live server** (`routes/publicPages.ts`, copied by
   `apps/backend-api/Dockerfile`). Stays.
3. **`docker-compose.yml` and `nginx/`** are checked by CI (`docker compose config`). Stay.
4. **`docs/plans/deep-audit-2026-09-25.md`, `docs/plans/cod-menus-payouts-playstore-2026-10-02.md`,
   `docs/app-store/IOS.md`** are named by path in code comments
   (`abuseGuards.test.ts:10`, `profitGuards.test.ts:4`, `launchRound.test.ts:2`,
   `scripts/eas-mapbox-netrc.mjs:6`). Stay.
5. **`quick-bites-release-archive\2026-09-23`** is read by `scripts/test-release-guards.mjs:34`
   and named in `release/signing-certificates.json:3`. Its name stays.

## The moves (need the owner's yes)

| # | Item | Action | Why | References to update |
|---|---|---|---|---|
| M1 | `FEATURES_PLAN.md`, `FREE_DEPLOYMENT_GUIDE.md`, `MASTER_FIX_PLAN.md`, `OWNER_SETUP.md`, `PAYMENTS_PLAN.md`, `QUICK_BITE_COMPLETE_RESEARCH.md`, `REBUILD_PLAN.md`, `SCALE_PLAN.md`, `TEST_PLAN.md` | **Move to `docs/history/`** (`git mv`, banner kept) + an index `docs/history/README.md` | Historical, not checked by any script; clears 9 of 33 root files | `CLAUDE.md` §9, `OWNER_ACTIONS.md:403`. Code comments name them without a path (`razorpayXAdapter.ts:33`, `refunds.test.ts:2`, `sockets.security.test.ts:4`, `errorHandler.ts:12` names OBSERVABILITY, which stays): still found by file name, so no code edit. Other historical docs that mention them by bare name are left as written. |
| M2 | `STORE_RELEASE.md` | **Move to `docs/play-store/STORE_RELEASE.md`** | Store guide belongs with the listings | `README.md:63`, `CLAUDE.md` §9 |
| M3 | `DOWNLOAD.md` | **Move to `docs/DOWNLOAD.md`** | Living guide, not a root file | `README.md:65`, `CLAUDE.md` §9. `.gitignore:31` comment names it by file name only: left. |
| M4 | `design for customers/` (15 files, mock-ups) | **Move to `design/customer-screens/`** | Folder name with spaces; belongs under `design/` | `MENTAL_MODEL.md:154` (one line) |
| M5 | `quick-bites-release-archive\27-09-26 best version so far with all workin` | **Rename to `v11-best-so-far-2026-09-26`** (contents untouched) | Its APKs are versionCode 11, built 26 Sep (read with `aapt`); matches the `vNN-what-date` scheme | none (no file names it) |

Root after the moves: the 7 living files (`CLAUDE.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`,
`OWNER_ACTIONS.md`, `COMMANDS.md`, `SIGNING_KEYS.md`), `SESSION_COORDINATION.md` (its rules still
apply), the 15 historical files pinned by `diagnostics.js`, and the tool config files.

## Leftovers found (the owner chose: keep, file and label; nothing deleted)

| # | Item | Size | Evidence | Recommendation |
|---|---|---|---|---|
| D1 | Worktree `D:\my all projects\qb-sessionC` (branch `b-docs`) | 16 MB | `git log main..b-docs` is empty: everything is in `main`; no uncommitted changes | Remove with `git worktree remove` |
| D2 | Worktrees `.claude\worktrees\hungry-morse-9de0a0`, `sad-ptolemy-343a4a` (+ branches `claude/hungry-morse-9de0a0`, `claude/sad-ptolemy-343a4a`) | 31 MB | Both at `8dc3fed`, which is in `main`; clean | Remove |
| D3 | Branch `builder/s10-alt` | – | One commit (`02ec582`, 25 Sep), an alternative S10 fix; `main` has its own (`3336fd1`, `dishOptions.ts`) | Delete branch |
| D4 | Branch `brain-sync-b` + remote `origin/claude/nice-lamport-vxf4yf` | – | One docs commit to `docs/plans/brain-sync.md` (25 Sep), September cloud-session notes | Delete |
| D5 | `D:\qb` (a shortcut/junction pointing at the repo) | 0 | Builds through it skipped the release guards once (fixed in `c05d582`). Removing it removes only the shortcut, never the repo, **if done with `rmdir`**, never a recursive delete | Remove with `cmd /c rmdir D:\qb` |
| D6 | `scratch/` (gitignored, 19 generator scripts) | 384 KB | Wrote the September historical docs; nothing runs them | Delete, or keep (harmless) |
| D7 | `build/screenshots/` (gitignored) | 11 MB | One emulator run's evidence, September | Delete |
| D8 | `Downloads\QuickBites-*.apk` (4 old APKs) | ~300 MB | Copies of old builds; every release is archived | Delete |

### What was done with the leftovers (17 Oct 2026)

| # | Done |
|---|---|
| D1 | `git worktree move` to `D:\my all projects\quick-bites-old-files\qb-sessionC-worktree-b-docs` (still registered with git, branch `b-docs` unchanged) |
| D2 | Left in place: the desktop app manages `.claude\worktrees`; recorded in `docs/LOCAL_MACHINE.md` |
| D3 | Branch renamed `archive/2026-09-25-s10-alt-superseded` |
| D4 | Branch renamed `archive/2026-09-25-brain-sync-b`; the GitHub branch is left as it is |
| D5 | Left in place (removing it is the only "move"); explained in the old-files README and `docs/LOCAL_MACHINE.md` |
| D6 | Moved to `quick-bites-old-files\scratch-doc-generators-2026-09` |
| D7 | Left in place (scripts write new screenshots there); labelled with `build/screenshots/README.txt` |
| D8 | Moved to `quick-bites-old-files\old-apks-from-downloads-2026-09-21` |

`D:\my all projects\quick-bites-old-files\README.txt` labels each item.

**Never delete** (listed so nobody tries): `quickbites-customer.jks` (old customer key, password
lost 22 Sep, `SIGNING_KEYS.md`) and `quickbites-admin.UNUSABLE-no-password.jks.bak` (admin key made
18 Sep without its password; replaced 20 Sep, commit `901f292`). They are unused but cost nothing.

## Security items found (owner action, not a move)

- **`Downloads` holds the Firebase service-account private key** (`quick-bites-ff708-firebase-adminsdk-….json`).
  That key can send pushes as Quick Bites. Once it is on Railway (`FCM_SERVICE_ACCOUNT_JSON`), keep one
  copy in a password manager and delete the one in Downloads. It must never enter the repo.
- `Downloads` also has two customer invoice PDFs, `QUICK_BITES templates.json`, `full quick bite.pdf`,
  `Quick Bites Fix Plan.html` and a logo JPEG: personal working files, left alone.

## How the moves will be checked

Before: commit `c25685c`; gate 1344 checks passed, 0 failed (only `fssaiBadge`'s known Windows exit
crash); typecheck, secrets, i18n, APK secrets, hardcoded URLs, `diagnostics.js` 34/34, web build all
pass; the four `expo config --type introspect` outputs saved. After the moves: the same run, the
same results, the four Expo configs byte-identical, and a grep (comments stripped) for every old path.
