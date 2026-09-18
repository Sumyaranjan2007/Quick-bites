# Quick Bites — Security & Access Control

**Version:** 3.0.0
**Date:** 18 September 2026
**Status:** Current against the platform as built

---

## 1. Who can be who

| Role | How the account is created | Credential | Can trade when |
|------|---------------------------|-----------|----------------|
| **Customer** | Verifying a code sent to a phone number creates it | Phone number + one-time code. **No password exists.** | Immediately |
| **Restaurant partner** | Self-registration in the partner app | Email + password | An administrator approves the KYC document |
| **Delivery rider** | Self-registration in the rider app | Email + password | An administrator approves the KYC document |
| **Administrator** | Created at boot from `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Email + password | Immediately; production refuses to start without it |

Role is **always** assigned by the server and never read from a request body.
Self-registration routes are role-specific endpoints; posting `role: 'super_admin'`
to any of them yields the role that endpoint mints and nothing else. A check
asserts this.

### An account with no password cannot be signed into with a password

`verifyCredentials` used to run its password check inside `if (user.passwordHash)`,
so an account without one fell past the check and was returned as authenticated.
That was unreachable while every account had a password, and stopped being
unreachable the moment customers began signing in by phone: those accounts hold
no hash, and their address is `<phone>@phone.quickbite.app`, derivable from the
number. Anyone who knew a customer's phone number could have signed in as them
with any password they typed. The absence of a hash is now an explicit refusal.

**Never give a customer a password.** Two credentials on an account whose
security model is possession of a phone is one credential too many.

---

## 2. One-time codes

| Property | Rule |
|---|---|
| Storage | SHA-256 hashed. Never logged, never returned in a response. |
| Lifetime | `OTP_TTL_MINUTES`, default 5. |
| Reuse | Deleted on successful verification, so a captured code cannot be replayed. |
| Guessing | `OTP_MAX_ATTEMPTS`, default 5, then the code is **destroyed** — not merely locked. |
| Resend | Cooldown of `OTP_RESEND_COOLDOWN_SECONDS`, so the endpoint cannot bombard a handset or run up an SMS bill. |
| Enumeration | A request for an unknown number is indistinguishable from one for a known number: same status, same message. |
| Rate limit | Per IP **and per phone number**. The credential limiter originally keyed on `req.body.email`, which phone sign-in never sends, leaving the entire customer front door with only a per-IP ceiling — the one limit a distributed attacker ignores. |

**A fixed code is refused in production** unless `OTP_ALLOW_FIXED_IN_PRODUCTION=true`
is set deliberately. Configuration is re-read per request, so flipping the
variable on the host takes effect without a process continuing to issue codes it
should not. Removing that variable is the switch to real OTP.

---

## 3. Authorization: HTTP

Every mutating route carries a role-scoped `authMiddleware`, Zod validation of
the request shape, and an ownership assertion where a resource has an owner
(`assertOwnsRestaurant`, per-order customer checks, `requireRiderSelf`).
Administrator routes additionally check a named permission against the account's
assigned role, and every administrative action is written to the audit log with
the actor's identity.

---

## 4. Authorization: WebSocket

Historically the socket layer authenticated the *connection* and then trusted
whatever room name arrived next, which meant the data the HTTP layer guards was
readable by asking for it over a socket instead. All five subscriptions are now
authorized, mirroring the HTTP rules — a person may watch an order over a socket
exactly when they may read it over HTTP.

| Subscription | Permitted to |
|---|---|
| `join:order` | That order's customer, its assigned rider, the owning restaurant, or an administrator |
| `join:restaurant` | The owning partner or an administrator. This room carries whole order objects — names, addresses, phones, bills |
| `join:menu` | Any signed-in user. Carries stock and kitchen-open flags only, deliberately separate from the order room |
| `join:admin` | Administrators only |
| `join:riders` | A delivery partner who is **on shift** |
| `rider:location` | Only the assigned rider, and only while the order is `OUT_FOR_DELIVERY` |

Identity comes from the verified JWT and nowhere else. `auth.userId` and
`auth.role` remain in the handshake type for older app builds and are ignored;
trusting them is what let any connection claim to be an administrator.

Every predicate fails closed: a missing record, an unknown role, or a throwing
lookup all deny.

### Live location is gated on both paths

Tracking begins at pickup. This is the behaviour customers expect and it is the
rider's privacy — where they are before collecting an order is not the
customer's business.

The rider app reports position over **REST**, not the socket. That endpoint
checked the assigned rider but not the order status, so gating only the socket
would have produced a rule that looked enforced and was not. Both carry it.

---

## 5. Payments

- Amounts come from the server's stored bill. A client that can name its own
  price eventually will.
- Signatures verify against **Razorpay's** order id, constant-time. Verifying
  against our own order number only ever passed against a mock.
- Webhooks verify against the **raw request bytes** — re-serialising a parsed
  body reorders keys and no signature would ever match — and are applied
  idempotently by event id, because Razorpay retries until it gets a 2xx.
- The key secret never leaves the server and never appears in a response body.
- **No card data ever touches this platform.** The customer enters it inside
  Razorpay's checkout. Adding a card form to a Quick Bites screen would put the
  platform into PCI-DSS scope and outside RBI tokenisation rules at once.

---

## 6. Secrets

- `.env` is gitignored; `.env.example` carries placeholders only.
- `scripts/check-secrets.mjs` reads the real values out of `.env` at runtime and
  searches every tracked file for them, so the scanner holds no secret of its
  own and prints only the variable name and location. Shapes that would never be
  in this machine's `.env` — a live Razorpay key, an AWS key id, a private key
  block — are matched by pattern. It runs in CI before anything else.
- `scripts/check-hardcoded.mjs` refuses a deployment URL outside an app's single
  `src/config.ts`.
- `JWT_SECRET` and `RAZORPAY_KEY_SECRET` have **no built-in default in
  production**: the service refuses to start rather than fall back to a value
  that is readable in a public repository.
- Android upload keystores live outside the repository and are gitignored.
  Losing one means that app can never be updated under its package id again.

---

## 7. Rate limiting

| Surface | Limit |
|---|---|
| General API | 100 requests per minute per IP |
| Credential endpoints | 10 attempts per 5 minutes, per IP **and** per account (email or phone) |

Tests clear the buckets through an explicit reset rather than the limits being
relaxed under `NODE_ENV=test`, so the path under test is the path production
runs.

---

## 8. Transport and headers

Helmet security headers on every response: CSP, HSTS, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, Referrer-Policy. CORS is an explicit origin
whitelist with no wildcard in production. Request bodies are capped at 1 MB.

---

## 9. What is deliberately not defended

- **A single backend instance.** Two replicas editing the same document
  overwrite each other silently. Do not raise the replica count without giving
  upserts a version check first (`db/postgresStore.ts`).
- **Unbounded hydration.** Boot loads every order ever written, so memory and
  start-up time grow with lifetime order count rather than active orders.
- **A fixed OTP while `OTP_ALLOW_FIXED_IN_PRODUCTION` is set.** Anyone who knows
  the code can sign in as any phone number. It exists for a closed tester group
  and must be removed at launch.
