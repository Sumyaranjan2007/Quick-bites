# Sign-in, accounts and roles

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. All paths under `apps/backend-api/src/` unless
written in full. Endpoints: `docs/generated/ROUTES.md` (section `authRouter.ts`).

## Who signs in how

| App | Method | Route |
|---|---|---|
| Customer | phone + email; a 6-digit code goes to the **email** (`OTP_PROVIDER=email`, since 11 Oct) | `POST /api/auth/otp/request` (`routes/authRouter.ts:1160`), `/otp/resend` (`:1192`), `/otp/verify` (`:1218`) |
| Partner | email + password; sign-up `POST /api/auth/register/partner` (`:916`) | `POST /api/auth/login` (`:181`) |
| Rider | email + password; sign-up `POST /api/auth/register/rider` (`:971`) | `POST /api/auth/login` |
| Operations | email + password; the one super admin comes from `ADMIN_EMAIL`/`ADMIN_PASSWORD` on every boot (`db/bootstrapAdmin.ts`) | `POST /api/auth/login` |

Tokens: JWT HS256, **7 days**, no refresh (`generateToken`, `routes/authRouter.ts:35-51`).
Checked by `authMiddleware` (`middlewares/auth.ts`): password changed → `SESSION_REVOKED`
(`:148`); bad/expired → `INVALID_TOKEN` (`:254`). All four apps return to sign-in on either.

## Codes (`modules/auth/otpService.ts`, `modules/auth/otpDrivers.ts`)

| Provider (`OTP_PROVIDER`) | Driver | Note |
|---|---|---|
| `email` (live) | `emailOnlyDriver` `otpDrivers.ts:166`, sends through Brevo `sendCodeByEmail` `:126` / `sendEmail` `:136` | needs `BREVO_API_KEY`, `EMAIL_FROM` |
| `msg91` | `msg91Driver` `:87` | SMS; blocked on DLT template (owner) |
| `2factor` | `twoFactorDriver` `:205` | kept as alternative |
| `fixed` | `fixedDriver` `:60` | one shared code; production refuses it unless `OTP_FIXED_CODE` is a private 6-digit code (`isPrivateCode` `otpService.ts:104`, check `:129`) |
| `twilio` | stub `:183` | – |

- **Reviewer number:** `OTP_REVIEW_PHONE` + `OTP_REVIEW_CODE` sign in without sending anything (`otpService.ts:80-82`).
- An account with an email always gets its code at that email, whatever is typed.
- A code counts as **email-proven** only when it really went through Brevo (not `fixed`, not the reviewer number): `emailed` set at `otpService.ts:180`, returned as `emailProven` from `verify` (`:227-280`).
- Limits: `OTP_TTL_MINUTES` (10 on live), `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`.

## Remove and Block (18 Oct 2026, owner Q1, master plan B6)

| Action | Who | Effect |
|---|---|---|
| **Block** | People → customer/rider/restaurant (`PATCH /api/admin/{customers,drivers,restaurants}/:id` `isBlocked`), "manage" permission per kind | Account locked, sessions cut (existing); its email, phone, kitchens' FSSAI/GSTIN/phone and rider licence go on a ban list (`modules/platform/blockedIdentifiers.ts`: canonical form hashed, one `settings` record) checked by every sign-up (`resolveIdentity`, partner/rider handlers, first code sign-in) → 403 `IDENTITY_BLOCKED`. Unblock clears that account's entries. |
| **Remove** | `POST /api/admin/accounts/:userId/remove` `{ confirmName, reason }`; "manage" permission for every kind of account the person has; never admins | `removeAccount` (`modules/platform/staffDeletion.ts`): refused while an order is in progress; kitchens closed, rider offline, account locked; data kept with `removedAt/removedReason/removedBy/removedIdentity`; email and phone freed (placeholder address) so the person may register again. Audit-logged. |

Suite `removeAndBlock`.

**Create (owner item 8):** `POST /api/admin/accounts/create` `{ kind: 'restaurant' | 'rider', …the sign-up
fields without a password }` builds the account with the sign-up's own record builders (`openRestaurant`,
`openRiderRecord`), checks the ban list and existing email/phone, emails a generated temporary password
(never in the response) and audit-logs it; the kitchen/rider then waits for review. Documents: existing
`POST /api/kyc/submit` (admins may submit for anyone); approval: existing review. Permission per kind.
Suite `adminCreate`.

## Forgot password (18 Oct 2026, master plan B6)

Partners, riders and staff: `POST /api/auth/password/forgot` `{ email }` → the same reply for every
email; for an account with a password (not the `ADMIN_EMAIL` super admin, not blocked) a 6-digit code
is emailed (Brevo), stored only as a hash on the user (`passwordReset`), 10 minutes, 5 tries, one email
a minute. `POST /api/auth/password/reset` `{ email, code, newPassword }` sets the password and raises
`tokenVersion` (every other device signed out). Wrong/expired/used code → 400 `INVALID_RESET_CODE`.
`passwordReset` is stripped from every user response along with `passwordHash`. Suite `passwordReset`.
Customers keep signing in with a code; the apps' "forgot" screens move onto this in Stage E.

## One account, several roles (17 Oct 2026)

| Piece | Where |
|---|---|
| `user.roles` array; `rolesOf(user)` falls back to `[user.role]` for old accounts | `db/repositories/userRepository.ts:261` |
| `hasRole`, `grantRole(userId, role)` | `userRepository.ts:269`, `:282` |
| Customer-app sign-in on a partner/rider account grants `customer` (Operations accounts refused: `STAFF_ACCOUNT`) | `routes/authRouter.ts:1244-1266` |
| Customer-app tokens carry `scope: 'customer'`; the middleware then acts as customer only (no admin bypass) | `middlewares/auth.ts:209-218` |
| Customer-scope tokens are refused on `/earnings`, `/payee-accounts`, `/kyc` (they check ownership, not role) | `middlewares/auth.ts:220` — **a new ownership-checked staff mount must be added to this regex** |
| New phone + email of an existing account, code really emailed → signs in to that account (`emailProven`); the account keeps its own phone | `routes/authRouter.ts:1242-1276` |
| With the shared `fixed` code an email proves nothing → `EMAIL_IN_USE` | `:1276` |
| No order from your own restaurant (`OWN_RESTAURANT`) | `modules/orders/orderService.ts:576` |
| Pushes go to the app the channel belongs to | `forApp`, `notifications/fcmDispatcher.ts:88` |

## Partner/Rider sign-up on an email already used in the Customer app

`resolveIdentity` (`routes/authRouter.ts:565`) decides: phone of another account →
`IDENTITY_CONFLICT` (`:587`); wrong password → `EMAIL_IN_USE`/`PHONE_IN_USE` (`:666`);
password-less (Customer-app) account → `CONFIRM_BY_EMAIL` (`:657`).

`askToConfirmByEmail` (`:746`) emails a link `GET/POST /api/auth/confirm/:token`:
- 30 minutes (`CONFIRM_TTL_MS` `:715`), single use, token stored only as a hash, one email a minute per account (`:766`).
- Kept in the store (`memoryStore.pendingRoleConfirmations`, saved before the email is sent): links survive deploys and restarts (fixed 18 Oct 2026, K3).
- GET (`:1051`) only shows a Confirm button (mail scanners open links); POST (`:1069`) repeats every check, sets the typed password, grants the role (`:1097`), creates the restaurant/rider.
- Link host: `PUBLIC_BASE_URL`, else `RAILWAY_PUBLIC_DOMAIN`, else the live URL (`:721-722`); never the request's Host.
- `/auth/confirm/` is exempt from the CORS origin check (`middlewares/cors.ts:40-43`); the page sends `Referrer-Policy: same-origin` (a `no-referrer` page makes browsers send `Origin: null`).

## Account deletion

| Who | How | Where |
|---|---|---|
| Customer | deletes at once (password or a fresh code) | `DELETE /api/auth/me` (`routes/authRouter.ts:310`) |
| Customer side of a partner/rider account | removes only addresses, favourites, name/address on past orders | `userRepository.removeCustomerSide` (`userRepository.ts:110`) |
| Partner / Rider | *requests* deletion; an admin completes it after dues are settled. While it waits (owner Q2, 18 Oct): **not blocked**, can sign in and see money; kitchen closed, rider offline and refused at go-online (`DELETION_PENDING`). The admin list shows dues, cash held, kitchens/rider, orders in progress and total, documents, last activity. Cancelling never lifts a separate block. | `modules/platform/staffDeletion.ts` (`requestStaffDeletion` `:36`, `completeStaffDeletion` `:130`, `cancelStaffDeletion` `:152`); admin routes `routes/admin/peopleRoutes.ts:702-747` |
| Public explanation | `/delete-account` page | `routes/publicPages.ts:247` |

## Admin permissions

Admin routes check `requirePermission('<area>.<action>')`; roles hold permission sets
(`adminRoles` collection, `routes/admin/rbacRoutes.ts`, `modules/admin/permissions.ts`,
`middlewares/adminAccess.ts`). The super admin holds all.

## Sockets

Connection token checked in `sockets/socketServer.ts:134+`; who may join which room in
`sockets/socketAuth.ts` (`canJoinOrder` `:60`, `canJoinRestaurant` `:99`). Losing access
closes open connections (`onAccessRevoked`, `userRepository.ts:16`).
