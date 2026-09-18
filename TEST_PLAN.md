# Quick Bites — Full Test Plan

**Version:** 1.1.0
**Date:** 19 September 2026
**Purpose:** Everything that can be proven before a human picks up a phone.

This plan exists because the real-world test is expensive. Four people, four
phones, a kitchen and a rider is an hour of other people's time, and it should
be spent finding the things only real use finds — not a 404, a crash on launch,
or a filter that was never wired up.

So: every layer that can be checked by a machine is checked by a machine first,
in every environment the code will actually run in. What is left over for the
human test is genuinely human.

---

## 1. The rule this plan is built on

**A check that has never failed is not evidence.**

Both scanners written for this project passed on their first run while the thing
they were hunting was sitting in the repository. One had an empty regex
alternative that matched every string; the other stripped `//` comments and so
truncated every line at `https://`.

Every suite below therefore has a **mutation** column: the specific change that
must turn it red. A suite that cannot be made to fail is not tested, it is
decorative.

---

## 2. Environments

| # | Environment | What it proves | Reachable now |
|---|---|---|---|
| **E1** | Local dev — in-memory store, seeded | Behaviour, features, business rules | Yes |
| **E2** | Test harness — real Express on an ephemeral port | The whole stack wired together | Yes |
| **E3** | Production configuration — `NODE_ENV=production` locally | The refusals, the empty start, the hardening | Yes |
| **E4** | Android emulator, API 34 (`qb34`) | The APKs install, launch and render | Yes |
| **E5** | Hosted Railway deployment | The real thing, over the real network | **Blocked on deploy** |
| **E6** | Real phones, four roles | What only people find | The human test |

E5 is blocked deliberately: the deployment still runs the previous release, and
pushing before the owner sets `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET` and
`DATABASE_URL`
would take the working API down. Everything E5 would prove is proven in E3
except latency and the hosting platform itself.

---

## 3. Layers

### Layer 0 — Static analysis (E1)

| Check | Catches | Mutation that must fail it |
|---|---|---|
| `check-secrets.mjs` | A real credential in a tracked file | Paste a live key into README.md |
| `check-hardcoded.mjs` | A deployment URL outside `config.ts` | Add the Railway URL to a screen |
| `diagnostics.js` | Missing files, broken structure | Delete a required module |
| `typecheck` × 10 workspaces | Type errors anywhere | Unbind an imported name |

**Note:** until this session, `typecheck` ran in **3** of 10 workspaces. The two
web portals were completely broken — `API_BASE` referenced nothing — and the
gate could not see it. All ten are wired in now.

### Layer 1 — Unit (E1)

Pure functions with no I/O: the pricing engine and the design system. Fast, and
the only place where arithmetic is checked in isolation.

### Layer 2 — Integration / API (E2)

17 suites, real HTTP and WebSocket against a real Express app. The defects this
project has actually had were never a pure function returning the wrong number —
they were a route missing an ownership check, a socket room anyone could join, a
signature verified against the wrong value. Those only appear assembled.

| Suite | Guards |
|---|---|
| `health` | Uptime, correlation ids, probes |
| `db` | Spatial distance, transactions, persistence |
| `orders` | Pricing, idempotency, the status state machine |
| `search` | Fuzzy search, filters, cache |
| `sockets` | Real-time delivery to the right rooms |
| `sockets.security` | Who may subscribe to what |
| `otp` | Phone sign-in, guessing, replay, enumeration |
| `onboarding` | Registration and the approval gates |
| `payments` | Signatures, webhooks, replay, tampering |
| `security` | Headers, rate limits, injection, hardening |
| `pipeline` | One order through all four portals |
| `admin` | The console and role-scoped permissions |
| `partner` | The kitchen's own view |
| `features` | Reorder, tip, ETA, filters, cancellation refunds |
| `regression` | One check per defect a user reported |

### Layer 3 — Contract (E2) — **new**

Every API path the four apps call must exist on the server.

This is the highest-value new suite in this plan, because it catches the exact
class of failure that was about to reach the owner's testers: the customer app
asking `POST /api/auth/otp/request` of a server that answers `404`. Nothing in
layers 0–2 looks at whether the client and the server agree, because each is
correct on its own.

The suite reads the app source, extracts every URL template, and asks the
running Express router whether it has a handler for it.

### Layer 4 — Localisation (E1) — **new**

Three languages are a promise, and a missing key is a screen that silently falls
back to English. Checks that every key exists in `en`, `hi` and `kn`, and that
every `t('key')` in the app source resolves to a real key.

### Layer 5 — Production configuration (E3) — **new**

The production build refuses to start without an administrator, and starts empty
when it does. Both are behaviours, and neither is exercised by a test suite that
runs in `NODE_ENV=test`.

| Check | Expected |
|---|---|
| No `ADMIN_EMAIL` | Refuses to boot |
| No `ADMIN_PASSWORD` | Refuses to boot |
| Short `ADMIN_PASSWORD` | Refuses to boot |
| No `JWT_SECRET` | Refuses to boot |
| No `DATABASE_URL` | Refuses to boot — it used to come up healthy and discard every order |
| All set | Boots, `demoMode:false`, zero restaurants |
| Demo tokens | Rejected |
| Fixed OTP without the opt-in | Refused |

### Layer 6 — Money and concurrency (E2) — **new**

| Check | Why |
|---|---|
| Bill conservation | What the customer pays must equal what everyone receives plus tax, to the paisa |
| Concurrent identical orders | One idempotency key must produce one order, not N |
| Two riders, one trip | Exactly one wins; the other is refused |
| Restart persistence | An order placed before a restart is there after it |

### Layer 7 — Build (E1)

APK produced, signed by its **own** key, universal ABIs, plausible size — and
**scanned for credentials it should not contain**.

```bash
node scripts/check-apk-secrets.mjs
```

The source scanner reads tracked files. An APK is neither source nor tracked: it
is a bundle produced by a tool that inlines constants and folds `__DEV__`
branches, so a credential can be absent from every file in the repository and
present in the binary handed to a tester. The rider app's sign-in screen holds
`useState(__DEV__ ? 'pass123' : '')` — correct, and correct only for as long as
the release build really does fold that branch away. This checks the binary.

It matches the real values from `.env` and never prints them, plus patterns that
are wrong in a client whatever `.env` says: a live Razorpay key, a private key
block, the seeded password, an AWS key id. The test-mode key **id** is
deliberately not forbidden — reaching the client is what it is for.

### Layer 8 — Launch and render (E4)

Install, launch, confirm the process is alive, and screenshot the first screen.
A build that passes every static check can still die at launch — it has happened
on this project — and a process that is alive can still be rendering a blank
white screen.

### Layer 9 — Hosted (E5) — blocked

Health, the new endpoints answering 200, and the four-role journey over the real
network. Runs the moment the owner deploys.

### Layer 10 — Human (E6)

What is left after all of the above:

- Does the chime actually wake a partner who is not looking at the phone?
- Is the rider's map usable one-handed on a bike?
- Does the Kannada fit the buttons?
- Does a real kitchen understand the screen without being told?
- Does it survive a lift, a basement, a dead zone?

---

## 4. Results

Recorded in §5 of this document as each layer runs, and in `CHANGELOG.md`.

---

## 5. Run log — 19 September 2026

Executed by Claude Opus 5 before any human test.

### Layers 0–6 — `npm run verify:full`

**714 checks, 0 failures.**

| Layer | Result |
|---|---|
| Secrets | Clean across 373 tracked files |
| Hardcoded URLs | None outside each app's `config.ts` |
| Translations | 100 keys complete in EN, HI and KN; 79 `t()` calls all resolve; every `{placeholder}` survives |
| Diagnostics | 34/34 |
| Typecheck | **10/10 workspaces** (was 3/10 — see below) |
| Backend suites | 17/17 |
| Contract | 97 client API paths, all resolved |
| Money / races / restarts | 15/15 |
| Production configuration | 17/17 |

### Two defects found by layers that did not exist before

**Both web portals were broken.** `export { DEFAULT_API_URL as API_BASE } from
'./config'` forwards a name to importers without binding it locally, so every
`${API_BASE}` in `admin-web/src/api.ts`, `admin-web/src/lib/adminApi.ts` and
`restaurant-web/src/api.ts` referenced nothing. Broken since `56386d9`. The gate
could not see it because `typecheck` ran in three workspaces. All ten now run,
and reintroducing the bug fails the gate.

**Production started with no database.** With `DATABASE_URL` unset the service
reported `HEALTHY`, accepted real orders, and wrote them to a container
filesystem destroyed on the next deploy. The Postgres path already refused to
start when it could not reach the database, for exactly this reason; the file
path had no equivalent guard. It refuses now.

### Every new check was shown to go red

| Mutation | What went red |
|---|---|
| GST charged on the tip | 2 feature checks |
| Refund suppressed on cancellation | 5 feature checks |
| Prep countdown frozen | The stuck ETA, reproduced exactly: `35 -> 35` |
| `/auth/otp/request` renamed | The live 404, reproduced exactly |
| A Hindi key removed | 1 translation check |
| A Kannada `{placeholder}` dropped | 1 translation check |
| Platform fee set to `5.907` | The sub-paisa check (the conservation check did **not** catch it) |
| `API_BASE` re-export restored | The typecheck gate |

Three checks caught their own authors first: the contract extractor reported a
clean contract for three apps it had never read, the translation parser broke on
`"WHAT'S YOUR"` and accused Hindi of having keys English did not, and the
production-boot check read this machine's `data/store.json` and reported four
restaurants in an empty deployment.

### Layer 2b — live journey against a running dev server

Not a test harness: `npm run dev`, real HTTP, four real accounts.

| Step | Result |
|---|---|
| Tipped order quoted and placed | ₹742.90 total, ₹40 tip carried onto the bill |
| ETA at placement | 30 min, `PREP_AND_TRAVEL`, over a measured 1.2 km |
| ETA after the kitchen promised 25 min | 35 min, `KITCHEN_ESTIMATE` — it moved, and rose honestly because the kitchen asked for longer than the default |
| Rider offer on a ₹75-tipped order | **₹115** = ₹40 base + ₹0 delivery (Gold) + ₹75 tip |
| Claimed trip | Still ₹115 — the tip survives the claim |
| Reorder | Exact repeat detected |
| Cancellation reasons in Kannada | Served translated |
| Veg + rating filter | 1 of 4 restaurants |
| Cancel with `TOO_LONG` | 200, code stored, no refund (unpaid COD) — correct |

### Layer 8b — the admin web console, in a browser

The console was broken for anyone who tried to use it, so compiling was not
enough. Signed in at `admin@quickbite.app` against a local backend:

- The sign-in screen rendered.
- `POST /api/auth/login` → 200, `GET /api/admin/me` → 200, `GET /api/admin/dashboard` → 200.
- The control tower rendered with real figures: 4 restaurants, 2 customers, 1 driver, 1 pending KYC.
- **Zero console errors.**

### Layers 7–8 — build, launch, render

Recorded in `CHANGELOG.md` for 19 September 2026 alongside the artifact table.

### Layer 9 — hosted

**Not run.** The deployment still serves the previous release, and pushing before
the owner sets the Railway variables would take the working API down. See
`OWNER_ACTIONS.md` Part 0.
