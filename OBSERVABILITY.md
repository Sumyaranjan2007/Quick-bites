# Quick Bite Platform -- Observability & Diagnostics (OBSERVABILITY)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Site Reliability Engineering Team  

---

## 1. Structured JSON Logging Schema

All backend log outputs must follow a uniform JSON schema to enable effortless log filtering and indexing:

```json
{
  "timestamp": "2026-09-05T18:30:00.123Z",
  "level": "INFO",
  "requestId": "req_8f1c3e0a-9d22-4c55-b778-90cb01e4a29a",
  "userId": "usr_4a8b-...",
  "role": "customer",
  "action": "ORDER_PLACED",
  "durationMs": 42,
  "message": "Order placed successfully for restaurant rst_102",
  "metadata": {
    "orderId": "ord_9901",
    "totalAmount": 489.00,
    "paymentMethod": "RAZORPAY_SANDBOX"
  },
  "error": null
}
```

### Standard Log Levels:
- **DEBUG:** Verbose developer debugging info (disabled in production).
- **INFO:** Normal business milestones (Order placed, Restaurant accepted, Payment verified).
- **WARN:** Degraded states or handled failures (Redis cache miss, rate limit reached).
- **ERROR:** Unhandled exceptions or external service failures with full stack traces.
- **FATAL:** Critical infrastructure outage (PostgreSQL unreachable, server shutting down).

---

## 2. Distributed Request Tracing (Correlation IDs)

1. Every incoming HTTP request is intercepted by `correlationIdMiddleware`.
2. If an `X-Correlation-ID` header is provided by the client, it is preserved; otherwise, a new UUID is generated.
3. The correlation ID is attached to the request context (`req.id`), included in all log entries, and reflected in the response header `X-Correlation-ID`.
4. Enables full distributed tracing from mobile touch event down to database queries.

---

## 3. Health Check Probe Specification (`/health`)

`GET /health` responds with HTTP 200 if all core services are operational, or HTTP 503 if any critical dependency is down:

```json
{
  "status": "HEALTHY",
  "timestamp": "2026-09-05T18:35:00Z",
  "uptimeSeconds": 86420,
  "services": {
    "database": {
      "status": "UP",
      "latencyMs": 14,
      "provider": "Supabase PostgreSQL"
    },
    "cache": {
      "status": "UP",
      "latencyMs": 6,
      "provider": "Upstash Redis"
    },
    "catalog": {
      "status": "UP",
      "latencyMs": 22,
      "provider": "MongoDB Atlas"
    },
    "search": {
      "status": "UP",
      "latencyMs": 18,
      "provider": "Meilisearch Cloud"
    }
  },
  "system": {
    "memoryUsageMb": 142.5,
    "cpuLoadPercent": 3.2,
    "activeSockets": 38
  }
}
```
