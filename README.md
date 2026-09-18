# Quick Bite Platform -- Master Architecture & Runbook (README)

**Version:** 2.0.0  
**Date:** September 6, 2026  
**Status:** Production Ready / Active  
**Project:** Quick Bite (Enterprise 4-Device Native Mobile Food Delivery Ecosystem)  
**Author:** Quick Bite Systems Architecture & Engineering Team  

---

## 1. Executive Summary & Ecosystem Topology

Quick Bite is an ultra-fast, transparent, multi-portal food delivery ecosystem engineered to benchmark against Zomato and Blinkit. Built on a modular monorepo architecture, the platform operates across **4 distinct physical mobile devices** connected to a central real-time backend over the public internet via Cloudflare Tunnel:

```
[Device 1: Customer Mobile]       [Device 2: Restaurant Mobile]
    apps/customer-mobile               apps/restaurant-mobile
     (React Native / APK)               (React Native / APK)
              \                                  /
               \                                /
      [HTTPS / WSS via Cloudflare Public Tunnel / LAN IP]
                               |
                               v
               +-------------------------------+
               |   Quick Bite Backend API      |
               |     (Node.js / Express)       |
               |      Port 4000 / Sockets      |
               +---------------+---------------+
                               |
              /                                 \
             /                                   \
[Device 3: Delivery Mobile]         [Device 4: Admin Mobile]
    apps/delivery-mobile                apps/admin-mobile
     (React Native / APK)              (React Native / APK)
```

---

## 2. The 4 Native Mobile Applications

Each application is a distinct native mobile client configured with its own role-based interface, Stitch UI tokens, and Lucide icons:

| Application Directory | Target Device & Persona | Key Functionality & Hardware Integrations | Release Status |
|-----------------------|-------------------------|-------------------------------------------|----------------|
| `apps/customer-mobile` | **Device 1: Customer** | Geofenced restaurant feed (<10km), live dish customizations, dynamic pricing engine, real-time order tracking, secret 4-digit doorstep delivery OTP display, Quick Bite Cash Wallet (Rs 500 preloaded). | Release APK Compiled (`build/apk/QuickBite-Customer.apk`) |
| `apps/restaurant-mobile` | **Device 2: Restaurant Partner** | Live kitchen order terminal with audio chime, 120s countdown accept/reject timer, Kitchen Order Ticket (KOT) itemized display, menu stock availability toggle, 4-digit pickup code handshake. | Production Ready (`apps/restaurant-mobile`) |
| `apps/delivery-mobile` | **Device 3: Delivery Partner** | Shift check-in/out toggle, 15s incoming broadcast card, turn-by-turn routing simulator, background 3s GPS telemetry streamer, doorstep 4-digit customer OTP validator, COD cash collection ledger. | Production Ready (`apps/delivery-mobile`) |
| `apps/admin-mobile` | **Device 4: Operations & Admin** | Platform pulse tower (GMV, active orders, fleet count), real-time order map, partner & rider KYC verification queues with 1-tap Approve/Reject, dispute resolver with instant wallet refund crediting. | Production Ready (`apps/admin-mobile`) |

---

## 3. How People Get Onto The Platform

The four seeded accounts sharing one password are gone. They were the reason the
staff apps could not be handed to a tester: the password lived in one
deployment's environment and nowhere else, and was not readable from the machine
the builds were made on.

### Customers — a phone number, no password

A customer signs in with their mobile number and a one-time code. Verifying a
code for a number nobody holds **creates the account**, so there is no separate
sign-up and nothing to forget.

There is no customer password anywhere in the system. An account without a
password hash cannot be signed into with a password at all — which matters,
because a passwordless account's derived address would otherwise have been a way
straight past the code.

### Restaurants and riders — register, then wait for approval

Both sign themselves up in their own app and land in `PENDING_APPROVAL`. They
can sign in immediately to upload documents, and they cannot trade until an
administrator approves them:

- a pending restaurant is invisible to discovery and orders against it are refused;
- a pending rider cannot start a shift.

Approving their KYC document is what opens those gates. Every approval and
rejection is recorded in the audit log against the administrator who made it.

### Administrators — one, from the environment

Exactly one administrator is created at boot from `ADMIN_EMAIL` and
`ADMIN_PASSWORD`. **Production refuses to start without them**, and refuses a
password shorter than ten characters. There is no default and no self-service
reset for the account that can approve every partner and rider on the platform;
recovery is changing the variable and redeploying, which re-applies it.

Staff who lose a password telephone operations, and an administrator sets a
temporary one — audit-logged, and refused for customers, who have no password to
reset.

### Local development

With `SEED_DEMO_DATA=true` (the default outside production) the demo restaurants,
menus and accounts are seeded as before, and `customer@quickbite.app` /
`pass123` still works locally. **Production seeds nothing.** A hosted platform
starts empty and fills up with real registrations.

### Verification codes before an SMS provider exists

`OTP_PROVIDER=fixed` accepts one code from `OTP_FIXED_CODE` and sends no SMS.
It is **refused in production** unless `OTP_ALLOW_FIXED_IN_PRODUCTION=true` is
set deliberately — anyone who knows six digits could otherwise sign in as any
number. Removing that variable is the entire switch to real OTP, once TRAI DLT
registration is complete. See `legal/COMPLIANCE.md` §1.

## 4. Master Project File Map

| File Path | Version | Purpose & Contents |
|-----------|---------|---------------------|
| `README.md` | **2.0.0** | Master context map, 4-device architecture, and execution runbook. |
| `PRD.md` | **2.0.0** | Product Requirements Document: 4 personas, 44 features, and non-functional requirements. |
| `TAD.md` | **2.0.0** | Technical Architecture Document: client topology, WebSocket protocol, and scaling. |
| `DATABASE_SPEC.md` | **2.0.0** | PostgreSQL schema, PostGIS spatial indexes, RLS policies, and wallet ledgers. |
| `APP_FLOW.md` | **2.0.0** | 4-device screen state machine, OTP handshake sequence, and error recovery trees. |
| `MENTAL_MODEL.md` | **2.0.0** | Plain-English code mechanics ("When X happens, system does Y because Z"). |
| `IMPLEMENTATION_PLAN.md`| **2.0.0** | Phased engineering blueprint, database migrations, and release milestones. |
| `CHANGELOG.md` | **2.0.0** | Chronological record of architectural updates, bug fixes, and verification results. |
| `COMMANDS.md` | **2.0.0** | Human copy-paste shortcuts for running, tunneling, and building mobile packages. |
| `SECURITY_ACCESS.md` | **2.0.0** | 4-role RBAC matrix, RS256 JWT tokens, OTP verification security, and telemetry guards. |
| `TESTING_STRATEGY.md` | **2.0.0** | Test automation strategy covering all 5 backend suites and multi-device E2E tests. |
| `scripts/start-tunnel.ps1` | **1.0.0** | Public Cloudflare / localtunnel launcher exposing port 4000 to the global internet. |

---

## 5. Quick Start & Multi-Device Execution Runbook

### Step 1: Start Backend API & Sockets
```powershell
# From the repository root:
npm run dev --workspace=@quick-bites/backend-api
```
The backend initializes the PostgreSQL client, seeds all 4 accounts, 8 authentic restaurants, full menus, and starts the Socket.IO server on `http://127.0.0.1:4000`.

### Step 2: Establish Public Cloudflare Tunnel
```powershell
# In a second PowerShell terminal:
powershell -ExecutionPolicy Bypass -File scripts/start-tunnel.ps1
```
This generates a secure public HTTPS/WSS URL (e.g. `https://quick-bites-api.trycloudflare.com`).

### Step 3: Connect the 4 Mobile Devices
Each mobile app includes a **Server / Cloud Tunnel URL** field on the login screen. Enter the public tunnel URL or your local network IP (e.g., `http://192.168.1.5:4000/api`), and log in using the pre-configured credentials:
1. **Device 1 (Customer):** Log in as `customer@quickbite.app` / `pass123`.
2. **Device 2 (Restaurant):** Log in as `partner@quickbite.app` / `pass123`.
3. **Device 3 (Rider):** Log in as `rider@quickbite.app` / `pass123`.
4. **Device 4 (Admin):** Log in as `admin@quickbite.app` / `pass123`.

### Step 4: Compiling Android APKs
To produce a standalone release APK for any of the apps:
```powershell
# Customer App Release APK
cd apps/customer-mobile/android
./gradlew assembleRelease
# Output: build/apk/QuickBite-Customer.apk (55.1 MB)
```

---

## 6. Verification & Automated Test Status

```bash
npm run verify
```

Secrets → hardcoded URLs → translations → diagnostics → typecheck (all ten
workspaces) → 17 backend suites. Stops at the first failure.

```bash
npm run verify:full
```

The same, plus production-configuration checks that boot real servers in real
child processes — the only way to observe a refusal to start.

**714 checks, 0 failures** as of 19 September 2026.

`TEST_PLAN.md` lays out eleven layers across six environments, with the mutation
that must turn each one red. Three are worth knowing about from here:

- **`contract`** reads all four apps' source, extracts the 97 URLs they build,
  and asks a running server whether a handler exists behind each. Every other
  suite tests one side against itself; this is the only one that checks the two
  agree. It exists because four signed, launch-verified APKs once pointed at a
  deployment that answered `404` to the sign-in endpoint, with every check green.
- **`resilience`** checks that bills balance to the paisa, that six simultaneous
  taps of Place Order produce one order, that two riders claiming one trip
  produce one winner, and that an order survives the store being rehydrated —
  which on Railway happens on every deploy.
- **`check-production-boot.mjs`** verifies the four refusals: no `ADMIN_EMAIL`,
  no `ADMIN_PASSWORD`, no `JWT_SECRET`, no `DATABASE_URL`. Each refuses rather
  than starting in a state the service cannot honestly serve from.

What automation still cannot tell you is in `TESTING_STRATEGY.md` §4–6.
