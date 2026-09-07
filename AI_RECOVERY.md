# Quick Bite Platform -- AI Recovery Protocols (AI_RECOVERY)

**Version:** 2.0.0  
**Date:** September 6, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Native Mobile Food Delivery Ecosystem)  
**Target Audience:** Human Supervisors & AI Agents  

Use these standardized prompt interventions whenever an AI assistant exhibits hallucination, context drift, unauthorized tech stack deviations, or build loops.

---

## 1. Hallucination Recovery

### Intervention 1: Unauthorized Technology Usage
> **Copy-Paste Prompt:**  
> "Stop. Read `IMPLEMENTATION_PLAN.md` and list every technology in the approved Tech Stack. Only use those approved technologies. Do NOT invent new libraries or frameworks. Discard any unauthorized files."

### Intervention 2: Fabricated File Paths
> **Copy-Paste Prompt:**  
> "You are hallucinating non-existent files. Run directory listings on the actual project workspace. List the files that ACTUALLY exist. Re-read `README.md` and continue from reality."

### Intervention 3: Architecture Deviation
> **Copy-Paste Prompt:**  
> "Check your latest code against `TAD.md`. Is it consistent with the modular monolith architecture? If not, revert your changes and follow `TAD.md` strictly."

---

## 2. Context Loss Recovery

### Intervention 1: General Amnesia / Compaction Recovery
> **Copy-Paste Prompt:**  
> "You have lost context. Execute the MANDATORY SESSION START protocol: Read `README.md`, `CHANGELOG.md` (last 3 entries), `build/MANIFEST.md`, and `MENTAL_MODEL.md`. Tell me what you understand and which chunk is active."

### Intervention 2: Build Status Verification
> **Copy-Paste Prompt:**  
> "What is the current build status? Read `build/MANIFEST.md` and show me the chunk status table. State what has been verified and what remains."

---

## 3. Multi-AI Conflict Resolution

### Intervention 1: Conflicting Code Changes
> **Copy-Paste Prompt:**  
> "There is a conflict in [filename]. Read `CHANGELOG.md` to identify who changed it last and why. Read `TAD.md` for the authoritative design. Keep the correct version, discard the other, and log your resolution in `CHANGELOG.md`."

### Intervention 2: Incomplete Chunk Handover
> **Copy-Paste Prompt:**  
> "Chunk [X] was marked IN-PROGRESS by a previous session but is incomplete. Run the verification commands from `build/chunk-[X].md`. Report the failures, fix them, complete the chunk, and mark it DONE in `build/MANIFEST.md`."

---

## 4. Behavior & Quality Enforcement

### Intervention 1: Scope Creep & Feature Inflation
> **Copy-Paste Prompt:**  
> "Stop adding new features. Read `FEATURE_TICKETS.md`. Only build the exact tickets assigned to this chunk. Do not invent unapproved capabilities."

### Intervention 2: Violating the 4-State UI Rule
> **Copy-Paste Prompt:**  
> "Audit [Component Name] against the 4-State UI Rule. Show me the code for: Loading (skeleton), Success, Error (with retry button), and Empty (with CTA). Implement any missing states now."

### Intervention 3: Unparameterized SQL or Missing Validation
> **Copy-Paste Prompt:**  
> "Audit all endpoints in [module]. Verify that every query uses Prisma parameterized inputs, every request is validated via Zod schemas, and every route has rate limiting. Fix any vulnerabilities immediately."
