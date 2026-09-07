# Quick Bite Platform -- Security & Access Specification (SECURITY_ACCESS)

**Version:** 2.0.0  
**Date:** September 6, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Information Security & Architecture Team  

---

## 1. Authentication Architecture & Token Exchange

All 4 physical mobile devices authenticate against the backend API gateway using role-validated credentials:

```
[Mobile Client (Customer / Partner / Rider / Admin)]
                    |
                    | 1. POST /api/auth/login { email, password, role }
                    v
            [API Gateway Router]
                    |
                    | 2. Verify Argon2/Bcrypt hash against UserRepository
                    v
            [User Store / PostgreSQL]
                    |
                    | 3. Returns User Profile + 3-part Base64 JWT Token
                    |    (Header.Payload.Signature with user ID, email, role)
                    v
            [Mobile Client Stores Token in SecureStore]
                    |
                    | 4. All subsequent API calls: Authorization: Bearer <token>
                    v
            [AuthMiddleware Verification]
                    |-- Decodes base64 payload
                    |-- Enforces role authorization (e.g. requiredRole === 'restaurant_owner')
                    |-- Injects req.user context { id, email, role, isGold }
                    v
            [Protected Domain Controller]
```

---

## 2. 4-Role RBAC Authorization Matrix

| Resource / Action | Guest (Unauth) | Customer | Restaurant Partner | Delivery Partner (Rider) | Admin (Super) |
|-------------------|----------------|----------|--------------------|--------------------------|---------------|
| **Browse Geofenced Restaurants & Menus** | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| **Place Order (`POST /api/orders`)** | DENY | ALLOW | DENY | DENY | DENY |
| **View Active Order Status & Doorstep OTP**| DENY | ALLOW (Own) | ALLOW (Assigned Store) | ALLOW (Assigned Trip) | ALLOW (All) |
| **Accept/Reject Order & Set Prep Time** | DENY | DENY | ALLOW (Own Store) | DENY | ALLOW (Override) |
| **Toggle Menu Item In/Out of Stock** | DENY | DENY | ALLOW (Own Store) | DENY | ALLOW (All) |
| **Toggle Shift Online/Offline** | DENY | DENY | DENY | ALLOW (Own Shift) | ALLOW (Admin View) |
| **Broadcast GPS Telemetry** | DENY | DENY | DENY | ALLOW (Own Active Trip)| ALLOW (Admin View) |
| **Validate Doorstep 4-Digit OTP** | DENY | DENY | DENY | ALLOW (Assigned Trip) | ALLOW (Override) |
| **Approve / Reject KYC Documents** | DENY | DENY | DENY | DENY | ALLOW |
| **Issue Instant Wallet Dispute Refund** | DENY | DENY | DENY | DENY | ALLOW |
| **Access Control Tower Metrics & GMV** | DENY | DENY | DENY | DENY | ALLOW |

---

## 3. Cryptographic Doorstep Handshake (4-Digit Delivery OTP)

To prevent delivery fraud and ensure food is handed to the rightful customer:
1. When an order transitions to `READY_FOR_PICKUP` or `OUT_FOR_DELIVERY`, the backend generates a random 4-digit cryptographic OTP (e.g. `5931`) stored securely in `orders.delivery_otp`.
2. The OTP is **only** displayed on the Customer Mobile App (`apps/customer-mobile`).
3. The Delivery Partner (`apps/delivery-mobile`) must enter the customer's 4-digit OTP upon physical handover.
4. The backend verifies the OTP via `POST /api/orders/:id/verify-otp` in a transactional block:
   - If valid: Order status transitions to `DELIVERED`, rider earnings are credited to `wallet_ledger`, and customer delivery confirmation push is dispatched.
   - If invalid: Delivery cannot complete, preventing unauthorized claim closures.

---

## 4. Parameterized SQL & Data Access Mandate

All database operations strictly enforce parameterized queries to eliminate SQL injection risks:

```typescript
// SECURE PATTERN: Parameterized input prevents SQL injection
const result = await db.query(
  'SELECT * FROM orders WHERE customer_id = $1 AND status = $2 ORDER BY created_at DESC',
  [customerId, status]
);
```

---

## 5. Security Headers & Network Hygiene

Every response sent by the Quick Bite API Gateway enforces modern HTTP security headers:
- **Strict-Transport-Security (HSTS):** `max-age=31536000; includeSubDomains; preload`
- **X-Frame-Options:** `DENY` (Anti-clickjacking)
- **X-Content-Type-Options:** `nosniff` (Anti-MIME sniffing)
- **Referrer-Policy:** `strict-origin-when-cross-origin`
- **CORS Whitelist:** Dynamically supports local loopbacks, private LAN addresses, and approved `*.trycloudflare.com` tunnel domains.
