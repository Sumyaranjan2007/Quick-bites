# Chunk 02: Core Backend API & Middleware Stack

**Goal:** Build the foundational Express server, global middleware pipeline (security headers, CORS, rate limiting, correlation IDs, Zod validation buffer, global error handling), and `/health` probe.  
**Estimated Time:** 60 minutes  
**Dependencies:** Chunk 01  
**Unlocks:** Chunk 03 (Data Access Layer)  

---

## 1. Key Implementation Elements

### Middleware Pipeline Order:
1. `correlationIdMiddleware` (Injects `X-Correlation-ID`)
2. `helmet()` (Sets CSP, HSTS, X-Frame-Options)
3. `cors(whitelistOptions)` (Enforces CORS whitelist)
4. `express.json({ limit: '1mb' })` (Parses JSON bodies)
5. `rateLimiterMiddleware` (Token bucket via Upstash Redis / In-memory fallback)
6. `supabaseAuthMiddleware` (RS256 JWT validation)
7. `globalErrorHandler` (Returns standard JSON envelope on errors)

### `/health` Endpoint Response:
```json
{
  "status": "HEALTHY",
  "timestamp": "2026-09-05T18:35:00Z",
  "services": {
    "database": { "status": "UP" },
    "cache": { "status": "UP" }
  }
}
```

---

## 2. Verification Commands

```bash
# Test backend server boots and health endpoint returns 200
npm --prefix apps/backend-api run build
npm --prefix apps/backend-api run test:health
```

---

## 3. Rollback Instructions
Revert changes in `apps/backend-api`.
