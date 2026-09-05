# Quick Bite Platform -- Security & Access Specification (SECURITY_ACCESS)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Information Security Team  

---

## 1. Authentication Architecture

```
[Client Application]
         |
         | 1. POST /api/v1/auth/verify-otp { email, code }
         v
[API Gateway]
         |
         | 2. Verify with Supabase GoTrue Auth
         v
[Supabase Auth]
         |
         | 3. Returns RS256 Asymmetric Signed JWT Pair
         |    - Access Token: 15-minute TTL
         |    - Refresh Token: 7-day TTL (Rotating)
         v
[API Gateway]
         |
         | 4. Stores refresh token in HttpOnly SameSite Cookie (Web)
         |    or returns in JSON payload for SecureStore (Mobile)
         v
[Subsequent API Requests]
         |
         | Headers: Authorization: Bearer <access_token>
         v
[JWT Verifier Middleware]
         |-- Decodes JWT header
         |-- Validates RS256 signature using Supabase Public Key
         |-- Checks Redis token revocation blocklist
         |-- Injects { userId, role, email } into req.user
         v
[Domain Route Controller]
```

---

## 2. Authorization & RBAC Matrix

| Resource / Action | Guest (Unauth) | Customer | Restaurant Partner | Admin (Super) |
|-------------------|----------------|----------|--------------------|---------------|
| **Browse Restaurants & Menus** | ALLOW | ALLOW | ALLOW | ALLOW |
| **Create Order** | DENY | ALLOW | DENY | DENY |
| **View Order Details** | DENY | ALLOW (Own) | ALLOW (Assigned) | ALLOW (All) |
| **Accept/Reject Kitchen Order**| DENY | DENY | ALLOW (Own Store) | ALLOW (Override) |
| **Modify Menu & Dish Prices** | DENY | DENY | ALLOW (Own Store) | ALLOW (All) |
| **Approve Restaurant KYC** | DENY | DENY | DENY | ALLOW |
| **Issue Order Refund** | DENY | DENY | DENY | ALLOW |
| **Access Fraud Radar** | DENY | DENY | DENY | ALLOW |

---

## 3. Parameterized SQL Mandate

To ensure zero SQL injection vulnerabilities, all database operations must use parameterized queries:

### VULNERABLE PATTERN (STRICTLY FORBIDDEN):
```typescript
// NEVER DO THIS: Direct string concatenation
const query = `SELECT * FROM orders WHERE customer_id = '${customerId}' AND status = '${status}'`;
await db.query(query);
```

### ENFORCED SECURE PATTERN (PRISMA / PARAMETERIZED):
```typescript
// ALWAYS DO THIS: Strongly typed, parameterized input
const orders = await prisma.order.findMany({
  where: {
    customerId: customerId,
    status: status,
  },
  orderBy: { createdAt: 'desc' },
});
```

---

## 4. Rate Limiting Strategy (Token Bucket)

Enforced via Upstash Redis sliding window:
- **Global Public Endpoints:** 100 requests / minute per IP.
- **Authentication Routes (`/auth/*`):** 5 requests / minute per IP.
- **Order Placement (`/orders`):** 10 requests / minute per User ID.
- **Payment Verification Webhook:** 120 requests / minute (IP whitelisted to Razorpay CIDR blocks).
- **Penalty for Threshold Violation:** HTTP 429 Too Many Requests with `Retry-After` header.

---

## 5. Security Headers (Helmet Configuration)

Every HTTP response sent by the backend API must include the following security headers:
- **Content-Security-Policy (CSP):** `default-src 'self'; img-src 'self' data: https://*.cloudflare.com https://*.osm.org; script-src 'self';`
- **Strict-Transport-Security (HSTS):** `max-age=31536000; includeSubDomains; preload`
- **X-Frame-Options:** `DENY` (Prevents clickjacking)
- **X-Content-Type-Options:** `nosniff` (Prevents MIME sniffing)
- **Referrer-Policy:** `strict-origin-when-cross-origin`
- **Cross-Origin-Resource-Policy (CORP):** `same-origin`
