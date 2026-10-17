# Prompt: organise the Quick Bites folders and document everything (no code changes)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

Copy everything below the line into a new Claude Code session opened in
`D:\my all projects\quick bites`.

---

You are taking over **Quick Bites**, a live food-delivery platform (four Android apps + one
backend) for Harohalli / Ramanagara, Karnataka. The owner is **not a developer**: lead with what
something costs, earns or risks, answer their question first, use plain words, and say
"deployed" and "observed working" as different claims.

Your job has three parts, in this order, and **none of them may change how any app or the
server behaves**:

1. **Find and organise** every folder and file on this PC that belongs to Quick Bites.
2. **Document the whole project** so the next AI can find anything without re-reading the code.
3. **List optimisations** (as proposals with cost/benefit). Do not implement them.

## 0. Read first (do not skip)

1. `CLAUDE.md`: the single handoff. Its §8 "Working rules" are mandatory.
2. `OWNER_ACTIONS.md` Part 0, the top five entries of `CHANGELOG.md`, `SIGNING_KEYS.md`.
3. Your memory index (`MEMORY.md` in the Claude projects memory folder), if loaded.

## 1. Hard safety rules (breaking one is worse than not finishing)

- **No behaviour change.** Do not edit code under `apps/*/src`, `apps/backend-api/src`,
  `packages/*/src`, `scripts/*.mjs|*.sh`, any `app.json`, `package.json`, `Dockerfile`,
  `railway.json`, `turbo.json`, `nginx/`, or `release/`. Comment or doc-only edits inside code
  need the owner's OK first.
- **Never delete anything.** Moving is allowed only after the owner approves a written plan
  (step 3). Things you think are junk go on a "candidates to delete" list for the owner.
- **Never touch the signing keys**: `C:\Users\priya\quickbites-keystores\`. Do not move, rename,
  open or copy them into the repo. Losing them means the apps can never be updated. You may
  *list* the file names and read `release/signing-certificates.json`.
- **Never touch `D:\my all projects\quick-bites-release-archive\` contents** (4.4 GB of signed
  APKs/AABs per release). You may propose consistent folder names; renaming needs approval.
- **The repo is PUBLIC** (`github.com/Sumyaranjan2007/Quick-bites`). No key, password, token,
  code, phone code, tester email, or personal ID in any tracked file. Say *where* a secret lives,
  never its value. `node scripts/check-secrets.mjs` must pass before every commit.
- **Git:** stage by explicit path only. Never `git add -A`, `git add .`, `git commit -a`,
  `git stash`, `git reset --hard`, `git checkout -- .`, `git clean`. Use `git mv` to move tracked
  files so history follows them. Pushing `main` deploys the live server; the owner has authorised
  pushing finished, gated work. End commit messages with the attribution line your system prompt gives.
- **Do not run** `scripts/build-apks.sh` (it consumes versionCodes), `scripts/reset-live.mjs`,
  or anything that signs in to the live system. Do not sign in to any owner account.
- **Other sessions may be working in this repo.** Run `git status` and `git worktree list` before
  each phase. Never edit a file another session changed and has not committed.

## 2. Phase A: inventory (read only)

Build a table of every Quick Bites location: path, size, last modified, what it is, whether git
tracks it, and **what references it** (grep `scripts/`, `Dockerfile`, `.github/`, `app.json`,
`package.json`, docs). Known starting points (verify each, add what you find):

| Location | What we believe it is (verify) |
|---|---|
| `D:\my all projects\quick bites` | The repo (main checkout). |
| `D:\my all projects\qb-sessionC` | A git worktree on branch `b-docs` (an old cloud/"Session C" checkout). Check if it is merged into `main`; if fully merged, propose removal with `git worktree remove` (owner approves). |
| `.claude\worktrees\hungry-morse-*`, `sad-ptolemy-*` | Detached app-made worktrees at `8dc3fed`. Check for uncommitted work before proposing cleanup. |
| `D:\qb` | Appears empty / a junction to the repo. Builds through it once skipped release guards (CLAUDE.md §6). Find out what it is; propose keeping or removing. |
| `D:\my all projects\quick-bites-release-archive` | Signed builds per release. One folder is named `27-09-26 best version so far with all workin`; propose a consistent `vNN-<what>-YYYY-MM-DD` scheme. |
| `C:\Users\priya\quickbites-keystores` | Upload keys + passwords. List names only. `quickbites-customer-v2.jks` and `quickbites-admin.UNUSABLE-no-password.jks.bak` need explaining: match fingerprints against `release/signing-certificates.json` with `keytool -list` **only if** it needs no password; otherwise ask the owner. |
| `C:\Users\priya\.claude\projects\D--my-all-projects-quick-bites\memory` | The AI memory files. |
| Repo root | 33 `.md` files: some living, many marked HISTORICAL (CLAUDE.md §9). Plus `SLIDES.html`, `docker-compose.yml`. |
| `scratch/` | Gitignored one-off generator scripts (`gen_*.js`, `build_chunk_*.js`). |
| `build/` | `apk/`, `aab/`, `play-store/` (gitignored, has testers CSV and DLT drafts), plus tracked historical `MANIFEST.md`, `chunk-*.md`; an untracked `QuickBites-PlayStore-graphics.zip`. |
| `design/`, `design for customers/` | Design tokens/prompts; mock-up folders (the folder name has spaces). |
| `docs/` | `plans/`, `play-store/`, `app-store/`, `index.html`, `prompts/`. |
| `security/`, `nginx/`, `legal/`, `release/` | Check each is still used. |

Also look for Quick Bites files outside these places: Downloads (`google-services*.json`,
`.docx` DLT forms, `.p8` Apple key, screenshots), Desktop, `D:\` root. **Only list them**; files
like `google-services.json` and `.p8` are credentials-adjacent and must not enter the repo.

## 3. Phase B: a reorganisation plan, approved before anything moves

Write `docs/ORGANIZATION_PLAN.md` with one row per item: **Keep / Move to … / Archive to … /
Candidate to delete (owner decides)**, the reason, and every reference that must be updated.
Proposed shape (adjust to what you find):

- Repo root keeps only: `CLAUDE.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `OWNER_ACTIONS.md`,
  `COMMANDS.md`, `SIGNING_KEYS.md`, and the config/build files tools expect at the root.
- Living guides go to `docs/` (`docs/store/` for Play + App Store, `docs/plans/`, `docs/legal`
  stays at `legal/` if the server reads it: **`routes/publicPages.ts` renders `legal/*.md`**, so do
  not move those).
- HISTORICAL docs go to `docs/history/` with their banner kept, and one index line each.
- `design for customers/` becomes `design/customer-screens/` only if nothing references the old path.

Show the plan to the owner in plain words (what moves where, what is a delete candidate, the risk)
and **wait for their yes**. Then move with `git mv`, update every reference you listed, and grep
the old path again (code and docs, with comments stripped) to prove nothing still points at it.

## 4. Phase C: documentation a new AI can work from

Goal: a new AI reads `CLAUDE.md` plus one map, and knows where everything is. Every claim carries a
`file:line` pointer and a "Verified on <date> at <commit>" line. Prefer tables to prose. Write from
the code as it is; where a doc and the code disagree, the code wins and you note the fix.

Create or refresh, under `docs/` (one index: `docs/README.md` "Where to find what"):

1. **`SYSTEM_MAP.md`**: the four apps and the backend, who uses what, how they connect (REST,
   Socket.IO rooms, push channels), hosting (Railway + Postgres), the websites at `/partner` and `/admin`.
2. **`BACKEND_MAP.md`**: every router file → every endpoint (method, path, auth/role, body schema,
   what it does) → which app screen calls it. Generate the endpoint list with a small read-only
   script (`scripts/docs/route-inventory.mjs`, new file, no imports of app code that starts the
   server) so it can be regenerated; commit its output.
3. **`APPS_MAP.md`**: per app, every screen → file → API calls → hidden settings (6 taps on the
   sign-in logo). Note web-only `*.web.ts` files.
4. **`DATA_MODEL.md`**: every `memoryStore` collection, its fields, which repository writes it,
   how it persists (Postgres in production, `store.json` locally).
5. **`AUTH_AND_ROLES.md`**: phone + email codes (`otpService`, `OTP_PROVIDER`), staff password
   sign-in, multi-role accounts (`rolesOf`, `grantRole`, `scope: 'customer'` tokens and the mount
   list in `middlewares/auth.ts`), the emailed confirm link (`askToConfirmByEmail`,
   `/api/auth/confirm/:token`, in-memory, 30 min, single use), `emailProven`, deletion rules.
6. **`MONEY_FLOWS.md`**: pricing, rider pay, COD per restaurant, payouts, ledger, invoices, GST
   (owner decisions in CLAUDE.md §4 are settled: do not re-ask).
7. **`NOTIFICATIONS_AND_TRACKING.md`**: FCM/APNs, channels and `forApp`, the rider GPS → socket
   → customer map pipeline, Mapbox usage (`LocationPuck`, never `UserLocation`).
8. **`CONFIG_AND_SECRETS.md`**: every environment variable by **name**, where it is set, what
   breaks without it. No values.
9. **`TESTING.md`**: the gate, every suite and what it protects, the known environmental failures
   (`fssaiBadge` exit crash, `onboarding` port 5040), mutation-testing practice, the private QA
   server, emulator and owner-phone recipes (CLAUDE.md §5).
10. **`RELEASE_AND_STORES.md`**: versionCodes, signing, archive naming, Play Console and App Store
    status, testers, what is waiting on the owner.
11. **`RUNBOOK.md`**: deploy, check `/health`, roll back (revert commit + push), read errors,
    rotate a key, what to do when email or SMS codes stop arriving.
12. **`LOCAL_MACHINE.md`**: the Phase A table in final form: every folder on this PC and what it is.
13. **`KNOWN_ISSUES.md`**: open problems with evidence. Already known, verify each:
    - Orders never store the customer's phone (`orderService.ts` builds the order without
      `customerPhone`), so the Rider app's "Call customer" button has no number.
    - A malformed `Origin` header makes `middlewares/cors.ts` throw, which the error handler turns
      into a 500 instead of a 403.
    - Pending confirm links live in memory and vanish on every deploy.
    - The partner policy still promises a "weekly run"; owner wording pending.
14. **`DECISIONS.md`**: dated owner decisions (money, scope, launch), one line each with the source.

Then bring the living docs in line: shorten `CLAUDE.md` to a start-here page that links to the
maps (keep §4 money rules and §8 working rules in it), update `README.md`, `AGENTS.md`,
`COMMANDS.md`, the "what changed since" notes, and add a `CHANGELOG.md` entry. Update the memory
files only where a fact changed (one fact per file, index line in `MEMORY.md`).

## 5. Phase D: optimisation proposals (do not implement)

Write `docs/OPTIMIZATION_BACKLOG.md`: each item with what it saves or earns, the risk, the effort,
and whether it needs a new app build. Look at least at: code duplicated across the four apps
(`nativeMap.ts`, `Modal.tsx`, API clients), APK size, unused dependencies (`npx depcheck`
read-only), dead code and unused routes (from the route inventory vs app calls), gate run time,
the in-memory store's growth, and doc duplication. The owner picks; nothing is built in this task.

## 6. Proof that nothing broke (run before Phase B and again at the end, compare)

```bash
node scripts/run-backend-tests.mjs
npx turbo typecheck
node scripts/check-secrets.mjs
node scripts/check-i18n.mjs
node scripts/check-apk-secrets.mjs
node scripts/build-web.mjs
```

For each phone app, `npx expo config --type introspect` before and after must be identical.
Note the starting commit (`git rev-parse HEAD`) before Phase A; at the end, `git diff --stat
<start>..HEAD` must show only moves, docs, the new `scripts/docs/` file and its output. If any check differs from the baseline, stop, undo your last step, and tell the owner.

## 7. How to work and report

- Keep a task list; commit per phase (moves in one commit, docs in another) with clear messages.
- Ask the owner only real decisions (moves, deletions, unknown keystores), all at once, in plain
  words, with your recommendation first.
- Finish with a short report: what moved where, what is waiting for the owner's yes, which docs
  exist and what each answers, the optimisation list's top three, and the before/after check results.
