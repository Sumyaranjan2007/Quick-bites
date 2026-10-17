# Operations guide: hosting, deploys, backups, monitoring, outside services

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

Written 18 Oct 2026 for master plan Stage A2 (`docs/plans/master-plan-2026-10-18.md`), from Railway's
and Google's current docs (sources at the end; checked 18 Oct, re-check before relying on a number).
Day-to-day deploy/rollback steps stay in `docs/RUNBOOK.md`; variable names in
`docs/CONFIG_AND_SECRETS.md`. **Only the owner signs in to Railway, Google Cloud, Exotel.**

## 1. The one fact that decides everything: one server, one process

All data lives in memory (`apps/backend-api/src/db/client.ts`) and is saved to Postgres as it changes
(`db/postgresStore.ts`, only changed documents). Live order updates (Socket.IO), the order sweeper and
dispatch timers also live in that one process. So:

- **Never set Replicas above 1 and never add a second region.** Railway splits traffic randomly
  between replicas and has no sticky sessions; two copies would each hold their own data and their own
  sockets, and orders, tracking and payouts would diverge.
- More capacity comes from a **bigger single instance**, which Railway does on its own (below).

## 2. What Railway Pro gives this app, and what to switch on

| Pro feature | What it means for us | Do it? |
|---|---|---|
| Vertical autoscaling up to the plan limit (Pro: up to 24 vCPU / 24 GB per replica) | Railway grows the one instance automatically as memory/CPU are needed. No button. The store growing (`docs/OPTIMIZATION_BACKLOG.md` O14) is covered for a long time. | nothing to set; watch Memory in Metrics |
| Replicas (up to 42) | Not usable for us (§1). | **no** |
| Volume backups (daily / weekly / monthly; kept 6 / 27 / 89 days) | Snapshots of the Postgres volume, restorable in the same project. | **yes**: daily + weekly + monthly |
| Point-in-time recovery (PITR, WAL archive to a bucket) | Restore Postgres to any minute, into a **new** service, the live one untouched. | **yes**, enable now (the window starts at the first base backup) |
| Static outbound IPs (IPv4, Pro only) | Our calls to Google, Razorpay etc. leave from fixed addresses. **Shared with other Railway customers**, so an IP lock on the Google server key narrows who can use a leaked key but does not make it ours alone. | **yes**, then add the IPs to the Google server key (§5) |
| Usage limits (email alert + hard limit) | Email when spend passes an amount; hard limit **takes the service offline**. | email alert **yes**; hard limit **no** (or set far above normal), an offline food app is worse than a bill |
| Monitoring (Observability → monitors on CPU / RAM / disk / egress, email) | Early warning of a memory climb or runaway egress. | **yes** (§6) |
| Image retention 120 h | Older deployments can be rolled back for 5 days. | nothing to set |
| Business Class Support | Paid add-on. | only if needed |

### 2.1 Click by click (owner)

1. **Backups:** Railway → project *endearing-ambition* → environment *production* → **Postgres** service →
   **Backups** tab → tick **Daily**, **Weekly**, **Monthly** → review the staged change → **Deploy**.
2. **PITR:** same Backups tab → **Enable PITR** → confirm. Railway creates a bucket `Postgres-PITR` and
   redeploys Postgres (a short blip). Wait until the date picker appears on the tab (first base backup done).
3. **Static IPs:** **backend** service → **Settings** → **Networking** → **Enable Static IPs** → note the
   IPv4 addresses shown (they are not secret; send them to the session) → **Deploy**.
4. **Deploy drain time:** backend service → **Settings** → Deploy → **Draining seconds = 30**
   (or variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`). Leave **Overlap seconds** at 0.
   Why: Railway's documented default gives the old server about 3 s after SIGTERM before killing it;
   our shutdown saves the whole store and closes sockets (`server.ts:198-222`, it force-exits at 10 s).
5. **Usage alert:** railway.com/workspace/usage → **Set Usage Limits** → Compute: custom email alert at
   about 1.5 × a normal month; no hard limit.
6. **Monitors:** backend service → **Observability** → add monitors: Memory above 70% of what you
   expect (start at 2 GB), CPU above 80% for 10 minutes, Network egress above a normal day × 3.
   Same for Postgres: disk above 70% of the volume.
7. **Replicas:** backend service → Settings → **Scale**: confirm it shows **1 replica, 1 region**.

### 2.2 Restore test (do once now, then every 3 months)

A backup nobody has restored is a hope, not a backup.

1. Postgres → Backups → pick a date in the PITR picker (an hour ago) → **Restore to this moment**.
   Railway makes a new service `Postgres-restored-<date>`; the live one keeps running.
2. In the new service → **Data** tab: check `store_documents` has rows, e.g. the count of `orders`
   (`SELECT collection, count(*) FROM store_documents GROUP BY 1;`) roughly matches live.
3. Delete the restored service (it is a copy; deleting it touches nothing live).
4. Write the date and the counts in `docs/ops/OPS_GUIDE.md` §8.

**If live data is ever lost:** do not restore over live. Restore to a new service as above, check it,
then point the backend's `DATABASE_URL` at it (backend → Variables) and **Deploy**. The old volume
stays until deleted.

## 3. Deploys: what happens, and one known risk

Sequence (Railway): push `main` → build `apps/backend-api/Dockerfile` → new server boots, loads the whole
store from Postgres (`server.ts:61`), saves boot changes, listens → Railway calls `/health` until 2xx
(`railway.json` timeout 30 s) → new server takes traffic → old server gets SIGTERM, saves, exits.
Healthchecks run **only at deploy**, not afterwards (§6 covers that gap).

**Known risk (from reading the code, not reproduced):** between the new server loading the store and
the old one stopping, the old one still takes requests. A write it makes in that window reaches Postgres
but **not the new server's memory** until the next restart, and the new server may later overwrite that
document from its older copy. With a ~30 s window and today's traffic the chance is small, not zero.
Mitigations: keep Overlap at 0 (§2.1-4), deploy at quiet hours (not 12:00-14:30 or 19:00-22:30), and
the code fix proposed to the main session (the new server re-reads documents updated after its load
time, once it is live). Until fixed: after a deploy at a busy time, check the order count in Operations
matches the database (§2.2 query on a copy).

### Deploy checklist (adds to `docs/RUNBOOK.md`)

1. Gate green; push `main` (outside the busy hours above).
2. `curl -s https://quick-bites-production.up.railway.app/health`: `uptimeSeconds` small = new server;
   every `services.*` up/configured; `dependency.state` `closed` (an `open` circuit = that outside
   service is failing).
3. Prove the change is live with one harmless request that only the new code answers this way
   (example 18 Oct: a malformed `Origin` on `POST /api/auth/login` answers **403** `ORIGIN_NOT_ALLOWED`).
4. Railway → backend → Logs for 5 minutes: no new `ERROR` lines (§6 list).
5. Rollback: `git revert <commit>` → gate → push (never force-push). For an instant fallback while that
   builds: Railway → Deployments → the previous deployment → **Redeploy** (kept 120 h on Pro).

## 4. Postgres: also keep an off-site copy

Volume backups and PITR live inside Railway. Once a month, keep one copy outside:
`railway link` (in the repo folder, owner signed in) → `railway connect postgres --tunnel-only` → in a
second terminal `pg_dump "<the URL it prints>" --format=custom --no-owner --file=qb-YYYYMMDD.dump`
→ store the file in the owner's encrypted cloud drive (it holds personal data: never in this repo,
never emailed). Needs PostgreSQL client tools on the PC.

## 5. Google Maps Platform: three keys, budgets, caps (before master plan B2)

Google's advice is to split app keys and server keys, ideally into **two projects** so a burst from
the apps cannot use up the server's quota. We use two projects.

1. console.cloud.google.com → project picker → **New project** `qb-maps-apps`, then `qb-maps-server`.
   For each: **Billing** → link the billing account (card needed).
2. In each project: **APIs & Services → Library**, enable only:
   - `qb-maps-apps`: **Maps SDK for Android**, **Maps SDK for iOS**.
   - `qb-maps-server`: **Places API (New)**, **Geocoding API**, **Routes API**, **Roads API**.
3. **Find the fingerprints first** (Android key needs two per app):
   - Google's app-signing key: Play Console → each app → **Protected with Play** (left menu) →
     **Play app signing** → section **App signing key certificate** → copy **SHA-1**.
   - Our upload key: same page, **Upload key certificate** → **SHA-1** (`release/signing-certificates.json`
     pins only the SHA-256 of these keys; the SHA-256 shown on that Play page must match it, which
     confirms you are looking at the right key).
   - Fingerprints are not secret.
4. `qb-maps-apps` → **APIs & Services → Credentials → Create credentials → API key**, twice:
   - **qb-android**: **Application restrictions → Android apps** → **Add** one row per package and
     fingerprint: `in.quickbites.app`, `com.quickbite.partner`, `in.quickbite.rider`, `com.quickbite.admin`,
     each with its app-signing SHA-1 **and** its upload SHA-1 (8 rows). **API restrictions → Restrict key**
     → Maps SDK for Android → **Save**.
   - **qb-ios**: **iOS apps** → bundle `in.quickbites.app`; API restriction Maps SDK for iOS → **Save**.
5. `qb-maps-server` → Credentials → **API key** `qb-server`: **Application restrictions → IP addresses**
   → the Railway static IPs from §2.1-3; **API restrictions** → Places API (New), Geocoding, Routes, Roads → **Save**.
6. **Budgets** (both projects share the billing account): **Billing → Budgets & alerts → Create budget**
   → Alerts only → name `qb-maps-monthly` → scope: both projects → Specified amount (start ₹5,000) →
   thresholds 50 / 90 / 100 % of actual → email billing admins → **Finish**. A budget only warns; it
   never stops spending.
7. **Daily caps** (the real stop): `qb-maps-server` → **APIs & Services** → click each API → **Quotas** →
   tick the per-day request quota → **Edit quotas** → set: Places Autocomplete 5,000/day, Place Details
   2,000/day, Geocoding 2,000/day, Routes (compute routes + matrix elements) 10,000/day, Roads 5,000/day
   → **Submit**. Raise them as orders grow (rule of thumb: daily orders × 20). Caps take effect with some
   delay, so leave headroom.
8. Values: `qb-server` → Railway backend Variables `GOOGLE_MAPS_SERVER_KEY` → **Deploy**. `qb-android`,
   `qb-ios` → the root `.env` on this PC (names in `docs/CONFIG_AND_SECRETS.md` once B2/C2 add them).
   **Never paste a key in chat**; tell the session "keys set".
9. Prices: check **Billing → Pricing** for the India price list before launch (global list: Roads
   Snap to Roads $10 per 1,000 for the first 100k a month; free monthly amounts per SKU replaced the
   $200 credit in March 2025).

Rotation: key page → **Rotate key** (old and new both work), ship/update, then **Delete the previous
key**. App keys only change with an app update, so rotate them together with a release.

## 6. Monitoring and alerts

Railway does not check `/health` after a deploy. Three layers:

| Layer | Set up | Alerts the owner when |
|---|---|---|
| External uptime check (free UptimeRobot or Railway's Uptime Kuma template) | HTTP(S) monitor on `https://quick-bites-production.up.railway.app/health`, every 5 min, keyword `HEALTHY`, email + phone app | the site is down or unhealthy for 2 checks |
| Railway monitors (§2.1-6) | CPU, memory, disk, egress | resources climb before they fail |
| Log watch (Railway → backend → Logs, search the event name) | daily 2-minute look until a log alerting tool is chosen | the events below appear |

Events worth a look, all logged as JSON with `event` (`grep -rn "event: '" apps/backend-api/src`):

| Event | Means | First check |
|---|---|---|
| `DIRTY_MISS` | a write was saved only by the 10-minute backstop | tell the main session (a code path misses `set()`) |
| `OTP_REQUESTED … deliveryAccepted:false`, many `OTP_VERIFY_FAILED` | sign-in codes not going out / being guessed | Brevo dashboard, `docs/RUNBOOK.md` codes table |
| `PLACES_API_REFUSED`, `ROUTING_API_REFUSED`, `CIRCUIT_OPENED` | map provider failing (address search off, distances estimated) | `/health` `addressLookup` / `roadDistance`, Google console quotas and billing |
| `FCM_DELIVERY_FAILED`, `APNS_SEND_FAILED`, `KITCHEN_PUSH_FAILED`, `RIDER_TRIP_PUSH_FAILED` | pushes not reaching phones | Firebase / APNs keys on Railway |
| `PAYMENT_FAILED`, `PAYMENT_RECONCILE_FAILED`, `RAZORPAY_*_FAILED`, `RAZORPAYX_*_REFUSED` | money path errors | Razorpay dashboard; never retry payouts blindly |
| `ORDER_SWEEP_FAILED`, `ORDER_AUTO_CANCEL_FAILED` | timers not advancing orders | Logs around it; tell the main session |
| `ADMIN_NOTIFY_FAILED`, `MASKED_CALL_FAILED` | staff alerts / calls failing | provider keys |

## 7. Owner's list for Stage A2 (short)

1. Postgres: Backups daily + weekly + monthly; **Enable PITR**.
2. Backend: **Enable Static IPs**, send the IPv4 list; **Draining seconds 30**, Overlap 0; confirm 1 replica, 1 region.
3. Usage: email alert at ~1.5 × a normal month, no hard limit.
4. Monitors: memory, CPU, egress (backend), disk (Postgres).
5. External uptime monitor on `/health`.
6. One restore test (§2.2) and the first off-site `pg_dump` (§4).
7. Before master plan B2: Google Cloud two projects, three keys, budget, daily caps (§5).

## 8. Log

| Date | What | Result |
|---|---|---|
| 18 Oct 2026 | Deploy `bd5ca2b` (K1–K3) checked | `/health` uptime reset to 42 s at 19:42:30 UTC, all services up; malformed Origin → 403 `ORIGIN_NOT_ALLOWED` live |

## Sources

- Railway plans and limits: https://docs.railway.com/reference/pricing/plans
- Scaling, replicas, no sticky sessions: https://docs.railway.com/reference/scaling, https://docs.railway.com/guides/optimize-performance
- Backups: https://docs.railway.com/reference/backups; Postgres backups, PITR, pg_dump: https://docs.railway.com/guides/postgres-backups-restores
- Static outbound IPs: https://docs.railway.com/reference/static-outbound-ips
- Usage limits: https://docs.railway.com/reference/usage-limits
- Healthchecks: https://docs.railway.com/reference/healthchecks; deploy teardown, overlap, draining: https://docs.railway.com/deployments/deployment-teardown, https://docs.railway.com/reference/deployments
- Monitoring: https://railway.com/changelog/2025-06-20-monitoring-beta
- Google Maps key security: https://developers.google.com/maps/api-security-best-practices
- Play app signing fingerprints: https://support.google.com/googleplay/android-developer/answer/9842756
- Budgets: https://docs.cloud.google.com/billing/docs/how-to/budgets; capping API usage: https://docs.cloud.google.com/apis/docs/capping-api-usage
- Roads API billing: https://developers.google.com/maps/documentation/roads/usage-and-billing
