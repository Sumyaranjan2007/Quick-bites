# Quick Bite Platform -- Human Command Shortcuts (COMMANDS)

**Version:** 2.0.0  
**Date:** September 6, 2026  
**Status:** Approved / Active  
**Target Audience:** Human Developers, QA Engineers & Product Operators  

This document contains copy-paste terminal and workflow commands to execute builds, launch the public multi-device tunnel, run tests, and manage the 4-device ecosystem.

---

## 1. Setup & Multi-Device Launch Commands

| Action | Command / Procedure | What It Does |
|--------|---------------------|--------------|
| **Start Backend API** | `npm run dev --workspace=@quick-bites/backend-api` | Launches Node.js Express server + Socket.IO on port 4000. Seeds real database with all 4 accounts, 8 authentic Indian restaurants, menus, and wallets. |
| **Launch Public Tunnel** | `powershell -ExecutionPolicy Bypass -File scripts/start-tunnel.ps1` | Creates a secure Cloudflare HTTPS/WSS tunnel exposing port 4000 so all 4 physical devices connect globally over 4G/5G/Wi-Fi. |
| **Launch Customer Mobile** | `npm run dev --workspace=@quick-bites/customer-mobile` | Starts Metro bundler for Customer Mobile App (Android/iOS). |
| **Launch Restaurant Mobile** | `npm run dev --workspace=@quick-bites/restaurant-mobile` | Starts Metro bundler for Restaurant Partner Kitchen Terminal. |
| **Launch Delivery Mobile** | `npm run dev --workspace=@quick-bites/delivery-mobile` | Starts Metro bundler for Delivery Partner Rider App. |
| **Launch Admin Mobile** | `npm run dev --workspace=@quick-bites/admin-mobile` | Starts Metro bundler for Admin & Operations Control Tower App. |

---

## 2. Compilation & Android APK Packaging Commands

| Target | Command | Output Artifact |
|--------|---------|-----------------|
| **Customer Mobile Release APK** | `cd apps/customer-mobile/android && ./gradlew assembleRelease` | Standalone unsigned APK with pre-bundled Hermes bytecode: `build/apk/QuickBite-Customer.apk` (55.1 MB) |
| **Verify APK Hermes Bytecode** | `unzip -l build/apk/QuickBite-Customer.apk \| Select-String "index.android.bundle"` | Confirms presence of `assets/index.android.bundle` inside the compiled package. |
| **Monorepo Typecheck** | `npm run typecheck` | Executes `tsc --noEmit` across all 10 packages/apps via Turbo repo with zero errors. |
| **Backend Test Suite** | `npm test --workspace=@quick-bites/backend-api` | Executes 38 automated integration tests covering health, database, orders, search, and real-time sockets. |

---

## 3. Real Accounts & Production Credentials

Use these verified credentials across the 4 physical devices:

```
[Device 1: Customer Mobile]
Email:    customer@quickbite.app
Password: pass123
Features: Gold status active, Rs 500 wallet balance, real-time OTP display

[Device 2: Restaurant Mobile]
Email:    partner@quickbite.app
Password: pass123
Features: Bangalore Biryani House terminal, 120s timer, KOT items, stock toggle

[Device 3: Delivery Mobile]
Email:    rider@quickbite.app
Password: pass123
Features: Vikram Singh shift check-in, 3s GPS telemetry, doorstep OTP validator

[Device 4: Admin Mobile]
Email:    admin@quickbite.app
Password: pass123
Features: Real-time pulse, GMV metrics, KYC approve/reject, 1-tap dispute refunds
```

---

## 4. Diagnostics & Troubleshooting Shortcuts

| Problem | Command / Action |
|---------|------------------|
| **Port 4000 Conflict** | `Get-Process -Id (Get-NetTCPConnection -LocalPort 4000).OwningProcess \| Stop-Process -Force` |
| **Re-seed Database** | `node apps/backend-api/src/db/seed.ts` (clears and re-seeds all transactional stores) |
| **Drive Mount Conflicts** | `subst D: /d` (unhooks virtual drive mappings to let physical volume mount) |
| **Clear Metro Cache** | `npx react-native start --reset-cache` |
| **Verify Public Tunnel** | Open the generated `*.trycloudflare.com/api/health` in mobile browser to confirm HTTP 200. |
