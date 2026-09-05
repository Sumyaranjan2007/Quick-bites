# Quick Bite Platform -- Human Command Shortcuts (COMMANDS)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Target Audience:** Human Developers & Project Operators  

This document contains copy-paste command prompts that humans can give to AI agents to trigger specific workflows, builds, fixes, UI updates, and demo actions.

---

## 1. Setup & Build Commands

| Prompt Command | What It Does / Instructions Triggered |
|----------------|---------------------------------------|
| `Execute Chunk [X]` | Tells AI to build Chunk X from `build/chunk-[X].md`, run verification tests, update `MANIFEST.md`, and log changes to `CHANGELOG.md`. |
| `Build everything from scratch` | Initiates full sequential build starting with Chunk 00 through Chunk 09. |
| `Run diagnostics` | Executes the full diagnostics script from Chunk 00, testing database connectivity, Redis, and health checks. |
| `Set up the development environment` | Installs monorepo dependencies (`npm install`), checks environment variables, and launches dev servers. |

---

## 2. Fix & Debug Commands

| Prompt Command | What It Does / Instructions Triggered |
|----------------|---------------------------------------|
| `The backend won't start -- fix it` | AI inspects `backend-api` startup logs, checks port conflicts, verifies DB credentials in `.env`, and fixes errors. |
| `WebSocket not connecting -- fix it` | AI inspects Socket.io client configuration, auth handshake headers, CORS whitelist, and fixes connectivity. |
| `[Feature X] is not working -- fix it` | AI reads the relevant ticket in `FEATURE_TICKETS.md`, inspects component & service code, and fixes logic gaps. |
| `Fix all lint/type errors` | AI runs `npm run lint` and `npm run typecheck` across the monorepo and resolves all compiler warnings. |

---

## 3. UI & Design Commands

| Prompt Command | What It Does / Instructions Triggered |
|----------------|---------------------------------------|
| `Switch to dark mode / light mode` | Toggles theme context and validates all CSS variables against `design/DESIGN_TOKENS.md`. |
| `Redesign the [component]` | Updates component visuals using CSS variables while strictly preserving the 4-state UI rule. |
| `Make it more minimal and data-dense`| Reduces padding and margins using `--space-2` and `--space-3` tokens for professional high-density display. |
| `Apply festive seasonal theme` | Updates seasonal tokens (e.g. Diwali gold accent or Holi vibrant colors) in `design-system` package. |

---

## 4. Demo & Presentation Commands

| Prompt Command | What It Does / Instructions Triggered |
|----------------|---------------------------------------|
| `Start the demo for me` | Starts backend and web apps in Demo Mode, loads mock data, and provides direct localhost URLs. |
| `Load demo data` | Runs the seed script to populate test restaurants, active orders, and customer accounts. |
| `Generate a test restaurant` | Calls the admin endpoint `POST /api/v1/admin/demo/generate` to create a full restaurant with 15 menu dishes. |
| `Prepare for a live investor demo` | Runs full verification, clears transient test orders, verifies all 4 UI states, and activates Demo Mode. |

---

## 5. Deployment & Emergency Commands

| Prompt Command | What It Does / Instructions Triggered |
|----------------|---------------------------------------|
| `Build Docker images` | Executes Docker builds for backend API and web dashboard containers. |
| `Audit security checklist` | Runs through `security/SECURITY_CHECKLIST.md` and verifies all 85+ protection items. |
| `Roll back to last working state` | Reverts git working tree to previous commit logged in `CHANGELOG.md`. |
| `Everything is broken -- start fresh from docs` | Re-executes session start protocol, verifies all planning documents, and resumes build from current valid chunk. |
