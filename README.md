# Quick Bite Platform -- Master AI Context Map (README)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Ecosystem)  
**Author:** Quick Bite Architecture & Engineering Team  

---

## 1. Project Identity

- **Project Name:** Quick Bite
- **Tagline:** Ultra-Fast, Transparent, Multi-Portal Food Delivery Ecosystem
- **Context:** High-performance food delivery platform benchmarked against Zomato, engineered to run 100% on cloud free tiers during initial rollout.
- **Portals:**
  1. Customer App (React Native + Expo for iOS & Android)
  2. Restaurant Partner Portal (React 18 + Vite Web App)
  3. Admin Dashboard (React 18 + Vite Web App)
  4. Rider App (Phase 1b - React Native + Expo)

---

## 2. Master Project File Map

| File Path | Purpose & Content Description |
|-----------|-------------------------------|
| `README.md` | Master AI context map, directory index, build order, and AI handoff protocols. |
| `PRD.md` | Product Requirements Document: personas, 42 features, NFRs, and scope limits. |
| `TAD.md` | Technical Architecture Document: ASCII topology, data flows, and scaling plans. |
| `APP_FLOW.md` | Complete screen journeys, 4-state UI rules, and error recovery trees. |
| `MENTAL_MODEL.md` | Plain-English code mechanics ("When X happens, system does Y because Z"). |
| `FEATURE_TICKETS.md` | 42 discrete engineering tickets with Given/When/Then and Definition of Done. |
| `IMPLEMENTATION_PLAN.md` | Complete technical specification, database SQL DDL, API schemas, and tokens. |
| `CHANGELOG.md` | Chronological version history, AI session handoffs, and status logs. |
| `COMMANDS.md` | Human copy-paste shortcuts for setup, debugging, theming, and demos. |
| `AI_RECOVERY.md` | Diagnostic prompts and protocols for recovering from AI context drift or hallucination. |
| `TEAMMATE_GUIDE.md` | Non-technical presentation guide, analogy dictionary, and 3-minute pitch script. |
| `SLIDES.html` | Dark-theme print-to-PDF pitch deck with 8 professional slides (zero emojis). |
| `FRONTEND_SPEC.md` | Component states, responsive breakpoints, optimistic UI, and form persistence. |
| `SECURITY_ACCESS.md` | Auth mechanics, RBAC matrix, token rotation, rate limits, and SQL parameterization. |
| `OBSERVABILITY.md` | Structured JSON logging schema, error tracking, health checks, and tracing. |
| `SEO_PERFORMANCE.md` | Web metadata, Open Graph, Core Web Vitals targets, and bundle size budgets. |
| `TESTING_STRATEGY.md` | Unit, integration, and E2E testing guidelines with deterministic seed fixtures. |
| `DATABASE_SPEC.md` | Complete PostgreSQL DDL, PostGIS indexes, Mongoose schemas, and RLS policies. |
| `legal/PRIVACY_POLICY.md` | Privacy policy compliant with India DPDP Act 2023 and global standards. |
| `legal/TERMS_OF_SERVICE.md`| Terms of service, acceptable use, merchant guidelines, and dispute clauses. |
| `legal/COMPLIANCE.md` | FSSAI food safety regulations, GST compliance, TRAI DLT, and consumer protection. |
| `legal/DATA_HANDLING.md` | Data classification, encryption at rest/transit, and breach notification playbook. |
| `design/UI_DESIGN_PROMPTS.md`| Visual specifications, spacing scales, micro-interactions, and component prompts. |
| `design/DESIGN_TOKENS.md` | CSS custom property tokens for color, typography, elevation, and seasonal themes. |
| `security/SECURITY_CHECKLIST.md`| 85+ audit verification checkboxes covering 15 defensive domains. |
| `build/MANIFEST.md` | Build progress tracker, chunk status matrix, and diagnostic runbook. |
| `build/chunk-00.md` to `09.md` | Copy-paste-ready build execution blueprints for chunks 00 through 09. |

---

## 3. AI Handoff & Session Protocols

### Session Start Protocol (MANDATORY for every AI worker):
1. **Read Core State:** Inspect `README.md`, `CHANGELOG.md` (last 3 entries), `build/MANIFEST.md`, and `MENTAL_MODEL.md`.
2. **Verify Working Directory:** Check current repository files to verify what exists physically versus what is planned.
3. **Check Active Chunk:** Identify the current chunk marked `IN-PROGRESS` in `build/MANIFEST.md`.
4. **State Your Understanding:** Explicitly inform the user:
   - "I have read the context. Current build status is [X/10 chunks]. I am working on Chunk [Y] ([Name])."

### Session End Protocol:
1. **Run Chunk Verification:** Execute the verification tests defined in the current chunk blueprint.
2. **Update MANIFEST.md:** Mark completed chunks as `DONE`.
3. **Log Changes to CHANGELOG.md:** Document files created, modified, known issues, and explicit instructions for the next AI.
4. **State Next Action:** Always specify what chunk or task comes next and why.

---

## 4. Build Order & Dependency Graph

```
[Chunk 00: Manifest & Diagnostics]
                 |
                 v
[Chunk 01: Scaffolding & Monorepo Configuration]
                 |
                 v
[Chunk 02: Core Backend Engine & Middleware Pipeline]
                 |
                 v
[Chunk 03: Data Access Layer, PostgreSQL DDL & Seeds]
                 |
                 v
[Chunk 04: Business Logic, Pricing & Payment Adapters]
                 |
                 v
[Chunk 05: Intelligence Layer & Search Indexing (Meilisearch)]
                 |
                 v
[Chunk 06: Frontend Design System & Shell Architecture]
                 |
                 v
[Chunk 07: Core Application Portals (Customer, Partner, Admin)]
                 |
                 v
[Chunk 08: Real-Time Engine, WebSockets & FCM Push Hub]
                 |
                 v
[Chunk 09: Security Hardening, Production Build & Docker]
```

---

## 5. Build Status Matrix

| Chunk ID | Name / Scope | Depends On | Parallel OK | Status |
|----------|--------------|------------|-------------|--------|
| **Chunk 00** | Manifest, Diagnostics & Self-Test Suite | None | No | READY |
| **Chunk 01** | Monorepo Scaffolding, TypeScript & Tooling | Chunk 00 | No | READY |
| **Chunk 02** | Core Express API & Global Middleware Pipeline | Chunk 01 | No | READY |
| **Chunk 03** | PostgreSQL DDL, PostGIS & Mongoose Schema | Chunk 02 | No | READY |
| **Chunk 04** | Order State Machine, Pricing & Razorpay Hub | Chunk 03 | No | READY |
| **Chunk 05** | Meilisearch Catalog Indexing & Cache Service | Chunk 03 | Yes | READY |
| **Chunk 06** | Frontend Design System, Themes & i18n Shell | Chunk 01 | Yes | READY |
| **Chunk 07** | Three Core Portals (Customer, Partner, Admin) | Chunk 04, 06 | No | READY |
| **Chunk 08** | Socket.io Real-Time Hub & FCM Push Hub | Chunk 04, 07 | No | READY |
| **Chunk 09** | Production Hardening, CI/CD & Deployment | Chunk 07, 08 | No | READY |

---

## 6. Cloud Services & Free Tier Limits

| Service | Portal / Purpose | Sign-Up URL | Free Tier Capacity | Fallback / Mock Mode |
|---------|------------------|-------------|--------------------|----------------------|
| **Supabase** | Auth & PostgreSQL DB | https://supabase.com | 50,000 MAU, 500MB DB | Local Docker Postgres |
| **Upstash** | Redis In-Memory Cache | https://upstash.com | 10,000 commands/day | In-memory Node.js Map |
| **MongoDB Atlas**| Menus & Catalog DB | https://mongodb.com/atlas | 512MB shared storage | Local embedded Mongo |
| **Meilisearch** | Search & Discovery | https://meilisearch.com | 100k documents free | PostgreSQL ILIKE search |
| **Cloudflare R2**| Image & Asset Storage | https://cloudflare.com | 10GB storage, 0 egress | Local file storage |
| **Razorpay** | Payment Gateway | https://razorpay.com | Unlimited Sandbox mode | Simulated mock handler |
| **Resend** | Transactional Emails | https://resend.com | 3,000 emails/month | Console logger |
| **Firebase** | FCM Mobile Push | https://firebase.google.com | Unlimited push alerts | In-app notification bell |
| **Render** | Backend App Hosting | https://render.com | 750 free hours/month | Local Node.js server |
| **Vercel** | Web Dashboards | https://vercel.com | 100GB bandwidth/month | Local Vite preview |

---

## 7. Rules for All AI Workers

1. **Rule 1 & Rule 24:** NO emojis anywhere in documentation or code. Use standard icon libraries (Lucide, Heroicons) or textual badges like `[CHECK]`, `[WARN]`, `[INFO]`.
2. **Rule 2:** All styling must utilize CSS Custom Properties (Variables) exclusively.
3. **Rule 3:** Demo Mode is mandatory. The entire application must operate without requiring third-party API keys.
4. **Rule 4:** The 4-State UI Rule must be implemented for every data component: Loading (skeleton), Success, Error (with retry), and Empty (with CTA).
5. **Rule 5 & Rule 6:** Auth must be enforced on backend only; all SQL queries must be strictly parameterized.
6. **Rule 10:** All forms must persist input state to local storage across errors and tab reloads.
