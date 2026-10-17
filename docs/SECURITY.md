# Security — audit findings, rules for every change, pre-release checklist

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Owner of this file: the security review session (master plan Stage A3 and Stage F,
`docs/plans/master-plan-2026-10-18.md`). The repo is **public**: no key, password, token,
phone code or personal data in this file or any tracked file.

---

## 1. Audit, round 1 — 18 Oct 2026, server at commit `bd5ca2b`

**For the owner.** No serious hole was found: nobody can sign in as someone else, reach admin
pages without permission, read another customer's orders or addresses, or fake a payment.
One medium problem: a signed-in customer can put any phone number on their own account
without proving it, which can lock the real owner of that number out. A few small clean-ups.
The server's own libraries have no known vulnerabilities.

Method: read every router against `docs/generated/ROUTES.md` and `middlewares/auth.ts`, then
**ran** each suspected flaw against a local server (seed data, throwaway `QB_DATA_DIR`) before
writing it down. Findings marked "proven" were reproduced; the rest were confirmed by reading
the exact code path.

### Findings

| # | Severity | Where | What an attacker can do | Fix | Status |
|---|---|---|---|---|---|
| M1 | **Medium** | `apps/backend-api/src/routes/authRouter.ts:270` (`PATCH /api/auth/me`, schema `:258`) → `db/repositories/userRepository.ts:242` | Any signed-in customer sets **any** phone on their account: no code, no check that another account holds it. **Proven:** a seeded customer took an unused number; when the real owner then asked for a sign-in code, the pending code was addressed to the attacker's email, so the owner cannot sign up with their own number. Riders and kitchens would also call whatever number was set (K1 now stores it on orders). | Now: refuse a phone already held by another account (`findByPhone` → 409 `PHONE_IN_USE`). Master plan B6: a code to the new number before it is saved. | sent to main session |
| L1 | Low | `routes/authRouter.ts:170, :226, :252`; `routes/restaurantRouter.ts:380, :407, :428, :447`; `routes/walletRouter.ts:80` | On an unexpected error these answer `500` with the raw `error.message`, bypassing the production masking in `middlewares/errorHandler.ts`; internal details (library or database messages) reach the caller. | `next(err)` instead of answering in place. | open |
| L2 | Low | `sockets/socketServer.ts:83` | Socket tokens are verified without pinning the algorithm (`middlewares/auth.ts` pins `HS256`). jsonwebtoken 9 already refuses `none`, so not exploitable today; one library change away from being so. | `jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] })`. | open |
| L3 | Low | `routes/restaurantRouter.ts:385` (`GET /api/restaurants/owner/:ownerId`) | A **Customer-app** session of a restaurant owner (phone + emailed code) reads the kitchen's full record, while kitchen money (`/earnings`) is correctly refused. **Proven:** 200 with the full record vs 403 on `/earnings/statement`. Needs the owner's inbox, so impact is small, but it breaks the rule "kitchen data stays behind the Partner password" (`CLAUDE.md` §8). | Refuse customer-scope tokens here (role guard `restaurant_owner` + staff, or add the mount to the scope check in `middlewares/auth.ts`). | open |
| L4 | Low | `middlewares/cors.ts:37` | Any `https://*.vercel.app` or `*.railway.app` site (anyone can create one) is an allowed browser origin. The API uses bearer tokens, not cookies, so another site still cannot act as a signed-in user; it is unnecessary width. | Allow only our exact hosts (`CORS_WHITELIST`, same-host rule already covers our own pages). | open |
| L5 | Low | `routes/kycRouter.ts:50`, `routes/restaurantRouter.ts:1015`, `routes/riderRouter.ts:417` | Document "photos" accept any `https://` link and `data:image/svg+xml`. An admin opening/saving the document makes their phone or browser fetch a stranger's server (reveals the admin's IP, can serve any file). Downloads are saved as files and never sent the admin's sign-in, so no takeover. | Accept only `data:image/(jpeg|png|webp)` (and our own host if files move to storage). | open |
| L6 | Low | `routes/restaurantRouter.ts:537` | Dish `imageUrl` is checked with `z.string().url()`, which accepts `javascript:` and `data:` schemes. Rendered only as images today (no script runs), but any future link use would be a script injection. | `https://` only. | open |

### Checked and holding (no action)

| Area | Evidence |
|---|---|
| Token checks | HS256 pinned; block, deleted account, password-change revocation (`tv`) and role demotion all apply on every request from the store (`middlewares/auth.ts`). Demo tokens impossible in production (`config/env.ts:53`). Secrets refuse to default in production (`config/env.ts:38`). |
| Admin | Every admin route behind `authMiddleware('admin')` + `attachAdminAccess` + `requirePermission`/super-admin checks; reset guarded by role, deployment switch, then phrase (`routes/admin/platformRoutes.ts:152`). |
| Customer-app scope | Customer-scope tokens act only as customer; `/earnings`, `/payee-accounts`, `/kyc` refused (proven 403); order status changes use the forced role (`routes/orderRouter.ts:453`). |
| Ownership | Orders, messages, tracking, ratings, addresses (`addressRepository.update/remove` take the caller id), devices, support replies, KYC (`assertControlsEntity`), rider profile, `/auth/me/:userId`, order delivery address (`orderService.ts:436, :629`). |
| Rider contact privacy | Customer phone only to the rider holding the trip, only while live (`riderRouter.ts` `shapeTripForRider`, `contactVisibility.ts`); open offers carry none (`pipeline` check, 18 Oct). |
| Rate limits | Sign-in, registration and codes limited per IP **and** per account (email/phone), 10 per 5 min (`middlewares/rateLimiter.ts`); global 100/min; `trust proxy` = 1 (Railway). Codes compared in constant time, attempts capped (`modules/auth/otpService.ts:255`). |
| Payments | Amount from the stored bill (`routes/paymentRouter.ts:84-108`); Razorpay/RazorpayX signatures HMAC + `timingSafeEqual`; double charges refunded (`duplicateCapture` suite). |
| Sockets | Identity only from the signed token; blocked/revoked refused; room joins checked (`sockets/socketAuth.ts`, `sockets.security` suite). |
| Uploads | Size-capped (KYC 700 KB, avatar ~650 KB, JSON 1 MB, menu photo route 8 MB), image-prefix checked; nothing uploaded is served back from our domain; admin downloads use `a.download` and send no sign-in (`admin-mobile/src/lib/download.web.ts`). |
| Pages and emails | User text escaped (`routes/publicPages.ts:24` `escape`) in confirm pages and emails. |
| Dependencies | `npm audit --workspace @quick-bites/backend-api --omit=dev`: **0** vulnerabilities. Whole monorepo: 40 (14 moderate, 25 high, 1 critical) all in app build tooling (Expo CLI, Metro, Jest, `shell-quote` in the React Native CLI); none ship in the server or run on phones' data. Cleared by the next Expo SDK upgrade (master plan Stage C). |

---

## 2. Rules every change must follow

### Server
1. Every new route: a guard at the mount or the route (`authMiddleware('<role>')`), input through
   `validate({ body|query|params: zod })`, and an **ownership check on every id** in the path or body.
   A staff route that checks ownership instead of a role goes into the customer-scope list in
   `middlewares/auth.ts` (`CLAUDE.md` §8).
2. Every new admin power gets its **own permission** (`modules/admin/permissions.ts`) and an audit line.
   Destructive actions (Remove/Block, payouts over threshold, reset) need a second confirmation.
3. Errors: throw `AppError(message, status, code)` and pass others to `next(err)`. Never answer
   `res.status(500).json({ error: err.message })`.
4. Never trust the client for money, role, price, distance, time or identity. The server recomputes.
5. Anything sensitive in a response (phone, address, OTP, bank, documents) is shaped per viewer
   (`contactVisibility.ts`), and only while needed.
6. Codes, links and tokens: random (`crypto.randomBytes`), stored as hashes, short expiry, single use,
   rate-limited, compared in constant time. Sign-in and code routes use `authRateLimiterMiddleware`.
7. Contact changes (phone, email) only after a code to the **new** address; sessions revoked on
   password or contact change (`tokenVersion`).
8. URLs from users: allow-list schemes (`https:` only, or `data:image/(jpeg|png|webp)`), size caps.
   HTML built on the server always goes through `escape`.
9. Outbound calls (Google Maps, Exotel, Brevo, Razorpay, Groq): host fixed in code, timeouts, circuit
   breaker, no user input in the host.
10. One server instance (in-memory store, sockets, timers). No replicas without the redesign.

### Accounts and data
11. Blocked identifiers (email, phone, FSSAI, GSTIN, PAN, licence) stored hashed and checked on
    every sign-up, sign-in, contact change and admin Create (master plan B6).
12. Personal data never in logs (phones masked as today: `90005*****`), never in URLs.
13. Bank numbers stay encrypted apart (`PAYEE_ACCOUNT_KEY`); never returned in full.

### Apps
14. No key in an app except the restricted map keys; `node scripts/check-apk-secrets.mjs` must pass.
15. Tokens in secure storage (`expo-secure-store`) once Stage F lands; HTTPS only; release builds
    with R8/ProGuard (`enableProguardInReleaseBuilds`, already on) and Hermes bytecode.
16. Never `UserLocation` (crash), never log tokens or codes on the device.

### Every commit
17. `node scripts/check-secrets.mjs` and the gate. A security fix leaves one check behind that fails
    when the guard is removed (mutate and watch it fail, reading stdout **and** stderr).

---

## 3. Pre-release checklist (run before every "make APK")

| Area | Check |
|---|---|
| Server | All findings in §1 marked fixed or accepted by the owner; `docs/generated/ROUTES.md` regenerated and every new row has a guard; gate green; `npm audit --workspace @quick-bites/backend-api --omit=dev` = 0 high/critical. |
| Railway | `NODE_ENV=production`; `ALLOW_PLATFORM_RESET` false/absent; `SEED_DEMO_DATA`, `DEMO_MODE`, `OTP_ALLOW_FIXED_IN_PRODUCTION` absent; `JWT_SECRET` long random; keys shared in chat rotated (Groq, `ADMIN_PASSWORD`, MSG91 widget token); Postgres backups on and one restore tested. |
| Accounts | Super-admin password changed; staff roles least-privilege; reviewer number/code set only for the review window. |
| Google Maps keys | Android key restricted to the four packages, each with **both** SHA-1s: our upload key **and** Play's app-signing key (Play Console → Test and release → App integrity); iOS key to `in.quickbites.app`; server key limited to Places (New), Geocoding, Routes, Roads (+ Railway static IP if available); budget alerts and daily quotas set. |
| Apps | `check-apk-secrets.mjs` passes on the built AAB/APK; release signing with the upload key; ProGuard on; no debug server address baked in; Data safety form matches what the app collects (location, phone, email, photos). |
| Play Integrity (Stage F) | Server verifies the Integrity token on sign-in and order placement; failures logged, then enforced once false positives are known. |
| Data | Logs sampled for phones/emails/tokens; old personal data handled per the privacy policy. |

### What cannot be prevented, and what we do instead

Anyone can download an Android app and read it (we did exactly that to study another app). So:
nothing secret ever ships in the app; every rule is enforced on the server; map keys are
locked to our packages and certificates; Play Integrity makes scripted fake clients expensive;
rate limits and audit logs make abuse visible. Code shrinking (R8) and Hermes bytecode make the
app harder to read, not unreadable: never rely on them for security.
