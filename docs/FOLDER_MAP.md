# Folder map — every Quick Bites folder, what it holds, how they connect, where new files go

> **Every AI and developer reads this before creating, moving or saving any file.**
> It is the one place that says which folder holds what. Every other document links here
> instead of repeating it. When you add a folder, move a file, or start keeping a new kind
> of file, update this map **in the same commit** (and `CHANGELOG.md`).
>
> Verified on 17 Oct 2026 at commit `3caa076` (paths, sizes and references checked by hand
> and by `git grep`). Sizes are approximate and change with every build.

**The repo is PUBLIC** (`github.com/Sumyaranjan2007/Quick-bites`). No key, password, token,
phone code, tester email or personal ID goes into any tracked file. This map says *where* a
secret lives, never its value. `node scripts/check-secrets.mjs` fails on a committed secret.

---

## 1. Where to save what (the rules)

| You are making… | Save it in | Never in | Notes |
|---|---|---|---|
| Backend code (route, service, repository) | `apps/backend-api/src/<routes\|modules\|db\|middlewares\|notifications\|sockets>/` | anywhere else | New router → mount it in `routes/apiRouter.ts`; new staff route that checks ownership → add to the mount list in `middlewares/auth.ts` (see `docs/AUTH_AND_ROLES.md`). |
| A backend test suite | `apps/backend-api/src/test/<name>.test.ts` **and** its name in the `SUITES` list of `scripts/run-backend-tests.mjs` | – | The runner fails on a suite that is on disk but not listed. |
| Phone-app code | `apps/<app>/src/{screens,components,lib}/` | `apps/<app>/android/`, `ios/` (generated, gitignored) | Web-only versions are `*.web.ts` beside the native file. Modals come from `src/components/Modal`. |
| Code shared by apps and server | `packages/shared-types/src/index.ts` (types, default rates), `packages/pricing-engine/src/index.ts` (bill maths) | copying it into each app | Expo config plugins: `packages/config/expo-plugins/`. |
| Build/check/release scripts | `scripts/` (one-off doc tools: `scripts/docs/`) | `scratch/` | `scripts/play-store/` = Play graphics. |
| A living guide or map (current truth) | `docs/` (store guides: `docs/play-store/`, `docs/app-store/`) | the repo root | Add one line to `docs/README.md`. |
| A plan for upcoming work | `docs/plans/<topic>-YYYY-MM-DD.md` | the root | When it is done or stale, add a HISTORICAL banner; move to `docs/history/` only if no code comment names its path (`git grep`). |
| A document that is no longer kept current | `docs/history/` with the HISTORICAL banner + a line in `docs/history/README.md` | – | **Exception:** the 15 historical files at the root listed in §3 must stay (CI checks them). |
| Something generated from code | `docs/generated/` (regenerate with its script; never edit by hand) | – | `node scripts/docs/route-inventory.mjs` writes `ROUTES.md` and `APP_CALLS.md`. |
| Privacy policy / terms text | `legal/*.md` | – | **The live server renders these** at `/privacy`, `/terms` (`routes/publicPages.ts:244-245`). Editing them changes the public pages. |
| A record of a change | top of `CHANGELOG.md` (newest first) | a new file | Owner-facing summary first, then the mechanism. |
| Something only the owner can do | `OWNER_ACTIONS.md` Part 0 | – | Keep it short and at the top. |
| A settled owner decision | `docs/DECISIONS.md` (one dated line) and, for money, `CLAUDE.md` §4 | – | – |
| A new environment variable | code reads it in `apps/backend-api/src/config/env.ts`; name it in `.env.example`, `docs/CONFIG_AND_SECRETS.md`, `CLAUDE.md` §3 | a value in any tracked file | Value goes on Railway (production) or the root `.env` (this PC). |
| Signed APKs/AABs of a release | `D:\my all projects\quick-bites-release-archive\vNN-<what>-YYYY-MM-DD\` | the repo (`build/apk`, `build/aab` are scratch, gitignored) | Never rename `2026-09-23` (scripts read it). |
| Play Store graphics, testers CSV, DLT drafts | `build/play-store/` (gitignored) | tracked folders | `testers.csv` holds personal emails: never commit. |
| Screenshots from test runs | `build/screenshots/` (gitignored) | tracked folders | `scripts/launch-test.sh`, `scripts/test-shot.sh` write here. |
| Throwaway files of one AI session | the session's own scratchpad (outside the repo) | the repo | – |
| Old files nobody uses but the owner wants kept | `D:\my all projects\quick-bites-old-files\<what>-YYYY-MM\` + a line in its `README.txt` | deleting them | Owner rule (17 Oct): never delete, file and label. |
| Signing keys and their passwords | `C:\Users\priya\quickbites-keystores\` **only** | anywhere else, ever | See `SIGNING_KEYS.md`. Do not open, move or copy. |
| Downloaded credentials (Firebase JSON, Apple `.p8`) | the owner's password manager, then Railway / App Store Connect | the repo, Downloads long-term | – |

**Names:** folders lowercase-with-dashes, no spaces. Dated files `YYYY-MM-DD`. Release
folders `vNN-<what>-YYYY-MM-DD` (NN = versionCode).

**Moving a file:** `git mv`, then `git grep` the old path (code comments too) and fix every
reference, then run `node scripts/diagnostics.js` and the gate. Never `git add -A`.

---

## 2. Every Quick Bites location on this PC

| Location | Size | What it is | In git? | Used by / connected to |
|---|---|---|---|---|
| `D:\my all projects\quick bites` | 4.1 GB (mostly generated `android/` builds and `node_modules`) | **The project** (main checkout, branch `main`). Pushing `main` deploys the live server. | yes | Everything below. |
| `D:\qb` | 0 | A shortcut (junction) to the project folder. | no | Nothing needs it. Builds through it skipped the release guards once (fixed `c05d582`). If removed: `cmd /c rmdir D:\qb`, never a recursive delete. |
| `D:\my all projects\quick-bites-release-archive\` | ~4.4 GB | Signed APKs/AABs per release, one folder each: `2026-09-23` (v7, the certificates' source), `2026-09-25-v8`, `2026-09-26-v9`, `v11-best-so-far-2026-09-26` (renamed 17 Oct), `v21-22-23-2026-10-06`, `v28-customer-2026-10-11`, `v29-sdk54-2026-10-16`, `v30-new-customer-package-2026-10-16`, `v31-map-crash-fix-2026-10-16`, `v32-rider-package-2026-10-16`, `v33-rider-in.quickbite.rider-2026-10-17`. | no | `scripts/test-release-guards.mjs:34` and `release/signing-certificates.json:3` read `2026-09-23`. Never edit contents. |
| `D:\my all projects\quick-bites-old-files\` | ~330 MB | Kept-but-unused items, labelled in its `README.txt`: the old `qb-sessionC` worktree (branch `b-docs`, fully in `main`), `scratch-doc-generators-2026-09` (was `scratch/`), `old-apks-from-downloads-2026-09-21`. | no (the worktree is registered with git) | Nothing. Remove the worktree only with `git worktree remove`. |
| `D:\my all projects\quick-bites-competitor-study\` | ~320 MB | Private competitor study (17 Oct): pulled APKs, decoded resources/code, screen recordings, per app. **Never copy anything from it into the repo or the apps**; findings are written in our own words in `design/motion/`. | no | Nothing reads it. |
| `C:\Users\priya\quickbites-keystores\` | ~25 KB | The four upload keys + `*.keystore.properties` (passwords). Also `quickbites-customer.jks` (old, password lost 22 Sep) and `quickbites-admin.UNUSABLE-no-password.jks.bak` (made 18 Sep without a password; replaced 20 Sep, `901f292`). Keep all. | no | `scripts/build-apks.sh` restores `android/keystore.properties` from here. `SIGNING_KEYS.md`. |
| `C:\Users\priya\.claude\projects\D--my-all-projects-quick-bites\memory\` | small | The AI's memory files (one fact each) + `MEMORY.md` index. | no | Loaded by Claude Code each session. |
| `C:\Users\priya\.claude\skills\` | – | User-level Claude skills (`seniordev`, `ui-ux-designer`, `less-token`, `cleancode`). | no | `CLAUDE.md` §10. |
| `C:\Users\priya\Downloads` | – | Owner's working files: customer invoice PDFs, `QUICK_BITES templates.json`, `full quick bite.pdf`, `Quick Bites Fix Plan.html`, a logo JPEG, and **the Firebase service-account private key (.json)**. | no | Nothing reads them. The Firebase key belongs in a password manager (it is on Railway as `FCM_SERVICE_ACCOUNT_JSON`). |
| `~/.appstoreconnect/private_keys/` (on the Mac) | – | App Store Connect API key. | no | `docs/app-store/IOS.md`. |

Git worktrees and branches (17 Oct): `main` (here); `b-docs` (in quick-bites-old-files);
`.claude\worktrees\hungry-morse-9de0a0` and `sad-ptolemy-343a4a` (made by the desktop app, at
`8dc3fed`, which is in `main`; clean); branches `archive/2026-09-25-s10-alt-superseded` and
`archive/2026-09-25-brain-sync-b` (old work, `main` has its own version). `git worktree list`
shows the current state.

---

## 3. Inside the project folder

### Root files

| File | What | Why it is at the root |
|---|---|---|
| `CLAUDE.md` | Start here: the handoff, money rules (§4), working rules (§8). | Claude Code loads it automatically. |
| `AGENTS.md` | Pointer to `CLAUDE.md` for other AIs. | Convention. |
| `README.md` | Public front page. | GitHub. |
| `CHANGELOG.md` | Every change, newest first. | `diagnostics.js` requires it. |
| `OWNER_ACTIONS.md` | What only the owner can do (Part 0 current). | Owner reads it first. |
| `COMMANDS.md` | Command reference. | `diagnostics.js` requires it. |
| `SIGNING_KEYS.md` | Where the keys are, how not to lose them. | Named by `scripts/release/releaseGuards.mjs:135`. |
| `SESSION_COORDINATION.md` | Rules for two AI sessions in one folder. | Rules still apply. |
| `PRD.md`, `TAD.md`, `APP_FLOW.md`, `MENTAL_MODEL.md`, `FEATURE_TICKETS.md`, `IMPLEMENTATION_PLAN.md`, `AI_RECOVERY.md`, `TEAMMATE_GUIDE.md`, `SLIDES.html`, `FRONTEND_SPEC.md`, `SECURITY_ACCESS.md`, `OBSERVABILITY.md`, `SEO_PERFORMANCE.md`, `TESTING_STRATEGY.md`, `DATABASE_SPEC.md` | **HISTORICAL** September documents. Do not trust them. | **`scripts/diagnostics.js:39-53` fails CI if any is missing.** Moving them needs that script changed first (`docs/OPTIMIZATION_BACKLOG.md`). |
| `package.json`, `package-lock.json`, `turbo.json` | npm workspaces + Turborepo. | Tools expect them. |
| `railway.json` | Railway build: `apps/backend-api/Dockerfile`, health check `/health`. | Railway reads it. |
| `docker-compose.yml`, `nginx/` | Local stack (Postgres, Redis, Meilisearch, backend, nginx). Not used in production. | CI runs `docker compose config`. |
| `.env` (gitignored), `.env.example` | Local build/test values; the list of names. | Read by `app.config.js` files and scripts. |
| `.gitignore`, `.dockerignore` | What git / Docker skip. | – |
| `.github/workflows/ci.yml` | CI on every push: secrets scan, hardcoded URLs, diagnostics, build, tests, compose check. | GitHub. |
| `.claude/launch.json` | Dev servers for the desktop app's preview. | Claude desktop app. |
| `.idea/`, `.vscode/`, `.kilo/`, `.turbo/` | Editor settings, tool caches. | – |

### Folders

| Folder | What is inside | Connected to |
|---|---|---|
| `apps/backend-api/` | The server: `src/` (Express + Socket.IO), `Dockerfile`, `data/store.json` (local data, gitignored), `web/` (built websites, gitignored), `assets/`, `prisma/` (unused leftover). Map: `docs/BACKEND_MAP.md`. | Railway builds it; all four apps call it. |
| `apps/customer-mobile/` | Customer app (Android `in.quickbites.app`, also iPhone). | `/api` (REST + sockets). |
| `apps/restaurant-mobile/` | Partner app (`com.quickbite.partner`); also the `/partner` website. | `/api`; `scripts/build-web.mjs`. |
| `apps/delivery-mobile/` | Rider app (`in.quickbite.rider`). | `/api`; background GPS. |
| `apps/admin-mobile/` | Operations app (`com.quickbite.admin`, private); also the `/admin` website. | `/api/admin`; `scripts/build-web.mjs`. |
| `apps/*/android/`, `apps/*/ios/` | **Generated** by `expo prebuild`, gitignored. Never hand-edit. | `scripts/build-apks.sh`. |
| `packages/shared-types/` | Types for every record, default rates (`DEFAULT_PRICING_RATES`). | Server + apps. |
| `packages/pricing-engine/` | The bill: rider pay, delivery fee, platform fee, GST. | Server (quote, checkout). |
| `packages/design-system/` | Only the web shell (`src/web/glassShell.ts`). | Websites. |
| `packages/config/` | `tsconfig.base.json`, Expo config plugins (signing, Mapbox token, ...). | Each `app.json`. |
| `scripts/` | Gate, checks, APK build, web build, release guards, Play graphics, `docs/route-inventory.mjs`. | `COMMANDS.md`. |
| `release/` | `version.json` (last versionCode), `signing-certificates.json` (pinned certificates). | `scripts/build-apks.sh`. Commit after a build. |
| `legal/` | Privacy policy, terms, compliance, data handling. | **Served live** by `routes/publicPages.ts`; copied by the Dockerfile. |
| `docs/` | Living maps and guides (`docs/README.md` lists them), `plans/`, `play-store/`, `app-store/`, `history/`, `generated/`, `prompts/`, `index.html` (old landing page). Role sessions' files (18 Oct): `SECURITY.md` (security audit + rules + pre-release checklist), `reviews/REVIEW_LOG.md` (code review of every commit), `qa/QA_PLAN.md` (acceptance checks and phone scripts per plan item), `ops/OPS_GUIDE.md` (Railway Pro, backups, Google Cloud keys, monitoring). | Each is written only by its role session (master plan "Who builds what"). |
| `design/` | HISTORICAL design tokens/prompts; `customer-screens/` (September mock-ups, moved 17 Oct). **Current:** `motion/` (motion spec per screen), `system/` (design tokens, type, components, accessibility), `screens/` (one spec per new screen for Stages D and E), `ART_BRIEF.md` (what illustrations, icons and photos are needed) — 17–18 Oct, specs only, not built. | `diagnostics.js` requires `design/`. |
| `security/` | HISTORICAL security checklist. | `diagnostics.js` requires `security/`. |
| `build/` | `MANIFEST.md`, `chunk-00..09.md` (HISTORICAL, tracked, required by `diagnostics.js:67-82`); gitignored: `apk/`, `aab/`, `play-store/`, `app-store/`, `screenshots/`; untracked `QuickBites-PlayStore-graphics.zip` (named in `OWNER_ACTIONS.md`). | `scripts/build-apks.sh` writes `apk/`, `aab/`. |
| `node_modules/` | Installed packages (gitignored). | `npm ci`. |

---

## 4. How the pieces connect

```
 Customer app ─┐            REST /api/...  +  Socket.IO (same host)
 Partner app ──┼──────────► apps/backend-api on Railway ──► Postgres (Railway)
 Rider app ────┤            (Dockerfile; pushing main deploys)   │
 Operations ───┘            also serves /partner, /admin websites, /privacy, /terms
                                    │
        Razorpay/RazorpayX · Mapbox · Meilisearch · FCM/APNs · Brevo email · MSG91 · Groq
```

- Code: `packages/*` feed both apps and server; `legal/` feeds the live pages; `scripts/build-web.mjs`
  turns the Partner and Admin apps into the websites on every deploy.
- Release: `scripts/build-apks.sh` → `build/apk|aab` (+ keys from the keystore folder, pins from
  `release/`) → copy to `quick-bites-release-archive\vNN-…` → Play Console.
- Details: `docs/SYSTEM_MAP.md`.

---

## 5. Keeping this map true

- Change a folder or start a new kind of file → update §1–§3 here in the same commit.
- Check: `git ls-files | cut -d/ -f1 | sort -u` against §3; `git worktree list` against §2.
- Every other Markdown file starts with one pointer line to this map (added 17 Oct 2026; `legal/*` is
  excluded because the live server shows it as public pages, `CHANGELOG.md` because it is a log).
  **A new `.md` file gets the same line under its title.** Do not copy this map into other files.
- Check: `grep -L "Where files live and where new files go" $(git ls-files '*.md')` should list only
  `CHANGELOG.md`, `docs/FOLDER_MAP.md` and `legal/*`.
