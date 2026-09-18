# Quick Bite Platform -- Build Manifest & Execution Tracker (MANIFEST)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Active Build Tracker  
**Phase:** Build complete (chunks 00-09). Ongoing work is tracked as the phases of `MASTER_FIX_PLAN.md`.  
---

## 1. Master Build Chunks Matrix

| Chunk ID | Chunk Name | Target Packages / Areas | Dependencies | Estimated Time | Status |
|----------|------------|-------------------------|--------------|----------------|--------|
| **chunk-00** | Diagnostics & Self-Test Suite | `scripts/diagnostics.js` | None | 30 mins | DONE |
| **chunk-01** | Scaffolding & Monorepo Configuration | Root, Turborepo, TSConfig, `.env` | chunk-00 | 45 mins | DONE |
| **chunk-02** | Core Backend API & Middleware Stack | `apps/backend-api/src/server.ts` | chunk-01 | 60 mins | DONE |
| **chunk-03** | Data Access Layer & Schema Seeds | PostgreSQL DDL, PostGIS, Mongo | chunk-02 | 60 mins | DONE |
| **chunk-04** | Business Logic, Pricing & Payments | Order state machine, Razorpay | chunk-03 | 90 mins | DONE |
| **chunk-05** | Search & Catalog Indexing Engine | Meilisearch Cloud sync, Cache | chunk-03 | 45 mins | DONE |
| **chunk-06** | Frontend Design System & Theme Shell | `packages/design-system`, i18n | chunk-01 | 60 mins | DONE |
| **chunk-07** | Core Application Portals (4-States) | Customer, Partner, Admin apps | chunk-04, 06 | 120 mins | DONE |
| **chunk-08** | Real-Time Engine, WebSockets & Push | Socket.io rooms, FCM hub | chunk-04, 07 | 60 mins | DONE |
| **chunk-09** | Production Hardening, CI/CD & Deploy | Docker, GitHub Actions, Nginx | chunk-07, 08 | 60 mins | DONE |



---

## 1b. Master Fix Plan (Session 23 onwards)

The ten build chunks are complete. Work since then is tracked by the phases of
`MASTER_FIX_PLAN.md`, which was agreed with the owner after a five-batch
interrogation.

| Phase | Name | Status |
|-------|------|--------|
| **0** | Groundwork: secret scanner, JDK 17, portable build script, APKs out of git | DONE |
| **1** | WebSocket authorization | DONE |
| **2a** | Phone + OTP identity (server), email subsystem removed | DONE |
| **2b** | Phone sign-in in the apps, staff recovery copy | DONE |
| **3** | Partner and rider self-registration, bootstrap administrator | DONE |
| **4** | Production starts empty | DONE |
| **5** | Real Razorpay integration, webhooks, idempotency | DONE (server) |
| **6** | Feature pass | NOT STARTED |
| **7** | Nothing hardcoded: one config per app, scanner | DONE |
| **8** | Languages EN/HI/KN | VERIFIED (existing strings at parity; new sign-in strings are English-only) |
| **9** | Legal and compliance | DONE (documented; the human steps are listed) |
| **10** | App identity and the APK build | IN PROGRESS |
| **11** | Documentation | IN PROGRESS |
| **12** | Final verification | PENDING |

**Not done, and deliberately so:** the customer app does not yet present the
Razorpay checkout. Doing so needs a native module (a WebView or the Razorpay
SDK), and this project has a documented history of a build that passed every
static check and died at launch on every device because of a native dependency.
There is no emulator image on the build machine to launch-test against, so the
module is not being added to a binary that testers are about to install. The
server side is complete, verified against Razorpay's live test API, and
activates the moment the app can present a checkout.

## 2. Chunk Execution Rules

1. **Strict Dependency Order:** Never begin chunk `N` until chunk `N-1` (or its declared dependencies) is verified and marked `DONE`.
2. **Mandatory Verification:** Each chunk file specifies exact verification commands. If verification fails, the AI must fix errors before advancing.
3. **Changelog Synchronization:** After completing any chunk:
   - Update this manifest: Change status from `READY` -> `IN-PROGRESS` -> `DONE`.
   - Log files created and modified into `CHANGELOG.md`.
4. **4-State Rule Compliance:** No frontend chunk is considered complete unless every data component implements Loading, Success, Error, and Empty states.

---

## 3. Global Diagnostics & Health Verification

To verify platform health across all completed chunks at any time:
```bash
# Run the global diagnostic self-test suite
node scripts/diagnostics.js
```
