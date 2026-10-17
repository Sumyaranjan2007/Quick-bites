# Backend map — routers, endpoints, modules

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. **Every endpoint** (method, path, line, guard,
body schema, which app calls it) is in **`docs/generated/ROUTES.md`**; per-app calls in
`docs/generated/APP_CALLS.md`. Regenerate both after changing a route:

```bash
node scripts/docs/route-inventory.mjs
```

All paths answer under `/api/...` and `/api/v1/...` (`src/app.ts:73-74`). Responses are
`{ success, data, meta }` or `{ success: false, error: { code, message } }` (`middlewares/errorHandler.ts`).

## Routers (285 endpoints)

| Prefix | File | Mount guard (`routes/apiRouter.ts`) | Endpoints | What |
|---|---|---|---|---|
| `/api/health`, `/api/test/echo`, `/api/auth/me` | `routes/apiRouter.ts:31-65` | – / signed in | 3 | health, test echo, current user |
| `/api/auth` | `routes/authRouter.ts` | per route | 14 | staff register/login, phone/email codes, profile, delete account, partner/rider sign-up, emailed confirm link (`docs/AUTH_AND_ROLES.md`) |
| `/api/payments` | `routes/paymentRouter.ts` | none (webhook checks its signature) | 3 | start payment, config, Razorpay webhook |
| `/api/membership` | `routes/membershipRouter.ts` | per route | 5 | Gold plans, buy, confirm |
| `/api/kyc` | `routes/kycRouter.ts` | signed in (customer-scope tokens refused, `middlewares/auth.ts:220`) | 2 | restaurant documents |
| `/api/admin` | `routes/adminRouter.ts` → `routes/admin/*.ts` | `authMiddleware('admin')` + `attachAdminAccess` + `durable` (every write waits for the database); 404 on the public site host | 138 | Operations app and `/admin` website; each route states its permission (`requirePermission`) |
| `/api/riders` | `routes/riderRouter.ts` | `authMiddleware('rider')` | 26 | profile, documents, shift on/off, GPS (`POST /location` `:1322`), offers, trips, SOS, incentives |
| `/api/wallets` | `routes/walletRouter.ts` | signed in | 4 | wallet (legacy) |
| `/api/devices` | `routes/deviceRouter.ts` | per route | 2 | register / remove push token |
| `/api/payee-accounts` | `routes/payeeAccountRouter.ts` | per route (customer scope refused) | 4 | partner/rider bank or UPI account |
| `/api/cash` | `routes/cashRouter.ts` | per route | 6 | collect online at the door (QR), cash a rider carries |
| `/api/earnings` | `routes/earningsRouter.ts` | per route (customer scope refused) | 7 | statement, invoices (PDF/ZIP), ask to be paid |
| `/api/invoices` | `routes/invoiceRouter.ts` | per route | 2 | customer receipt, refund status |
| `/api/policies` | `routes/policyRouter.ts` | public | 3 | payment policies |
| `/api/support` | `routes/supportRouter.ts` | per route | 7 | help chat topics and fixed answers (B8, `modules/support/helpChat.ts`), tickets and refund requests from apps |
| `/api/addresses` | `routes/addressRouter.ts` | signed in | 4 | customer address book |
| `/api/places` | `routes/placesRouter.ts` | signed in | 4 | address search / reverse geocode (Mapbox) |
| `/api/customers` | `routes/customerRouter.ts` | per route | 4 | favourites, profile photo |
| `/api/restaurants` | `routes/restaurantRouter.ts` | per route | 24 | public listing and detail; partner's own kitchen, menu requests, profile edits, hours |
| `/api/orders` | `routes/orderRouter.ts` | per route | 15 | quote, create, list, detail, confirm payment, cancel, rating, chat, kitchen ticket PDF (B10) |
| `/api/search` | `routes/searchRouter.ts` | public reads; reindex admin-only | 3 | search, suggestions |
| site root | `routes/publicPages.ts` | public | 8 | `/`, `/privacy`, `/terms`, `/delete-account`, logo, robots, sitemap |
| `/partner`, `/admin` | `routes/webApps.ts` | the app's own sign-in | – | the websites (static build in `apps/backend-api/web/`) |

Admin sub-routers (`routes/admin/`): `catalogRoutes` 21 (B5 added `POST /menus/:restaurantId/sections/:categoryId/availability`, `GET`/`PUT /recommended-restaurants`; menus, menu requests, categories,
profile edits), `dashboardRoutes` 9, `financeRoutes` 14, `legacyRoutes` 3, `marketingRoutes` 7
(coupons), `orderRoutes` 9, `payeeRoutes` 4, `payoutRoutes` 21, `peopleRoutes` 16 (restaurants,
riders, customers, deletion requests `:702-747`), `platformRoutes` 3 (settings, guarded reset
`:150`), `pricingRoutes` 20 (rates, rider pay by city), `rbacRoutes` 8 (roles), `supportRoutes` 6.
Permissions are defined in `modules/admin/permissions.ts`; types `AdminPermission` in
`packages/shared-types/src/index.ts:1035`.

## Modules (business logic)

| Folder | Holds |
|---|---|
| `modules/auth/` | `otpService.ts` (codes: request `:110+`, verify `:227`), `otpDrivers.ts` (email/Brevo `:126-166`, MSG91 `:87`, 2Factor `:205`, fixed `:60`, `activeDriver` `:235`) |
| `modules/orders/` | `orderService.ts` (quote and create; order built at `:780`), `kitchenTicket.ts` (B10 receipt PDF, no prices), `orderStateMachine.ts`, `orderSweeper.ts` (timers), `dishOptions.ts` (option checks), `tripOffers.ts`, `riderTrip.ts`, `deliveryCompletion.ts`, `opsRescue.ts`, `contactVisibility.ts` (who sees which phone), `cancellationFee.ts`, `couponService.ts`, `eta.ts` |
| `modules/payments/` | `ledger.ts` (double entry, `post` `:149`), `earnings.ts` (splits an order into ledger lines), `payouts.ts` (dues `:178`, draft/approve/pay `:364-593`), `statements.ts` + `statementPdf.ts` (invoices), `pricingConfig.ts` (rate versions), `riderCityRates.ts`, `refunds.ts`, `cashDeposits.ts`, `payeeAccounts.ts`, Razorpay adapters, reconciliation |
| `modules/restaurants/` | opening hours, profile edits, documents, imagery, location, offers, insights |
| `modules/riders/` | metrics, policies, `tripPayout.ts` |
| `modules/menu/` | `menuBulk.ts` (whole menu), `menuAi.ts` (Groq photo reader) |
| `modules/places/` | `placesService.ts`, `routingService.ts` (Mapbox Directions/Matrix) |
| `modules/search/` | Meilisearch client, fallback search, sync |
| `modules/platform/` | feature flags, business identity, circuit breaker, `staffDeletion.ts` |
| `modules/admin/` | analytics, audit, permissions |
| `modules/membership/` | Gold plans |
| `notifications/` | `fcmDispatcher.ts` (channels, `forApp` `:88`), `fcmTransport.ts`, `apnsTransport.ts`, admin notifier/digest, payee notifier |
| `db/` | `client.ts` (store), `postgresStore.ts`, `repositories/*`, `seed.ts`, `bootstrapAdmin.ts`, `ensureTestRider.ts` |
| `middlewares/` | `auth.ts`, `adminAccess.ts`, `cors.ts`, `rateLimiter.ts`, `validate.ts` (Zod), `durable.ts`, `featureGate.ts`, `securityHeaders.ts`, `errorHandler.ts` |

## Adding a route (checklist)

1. Put it in the router for its prefix; validate the body with `validate({ body: Schema })`.
2. Staff route that checks ownership instead of `authMiddleware('<role>')`? Add its mount to the
   customer-scope refusal list in `middlewares/auth.ts:220`.
3. Money write? Check every other place that sets the same state (`CLAUDE.md` §8).
4. Add or extend a suite in `src/test/`; `bodyContract` and `routeContract` suites check the apps' calls.
5. `node scripts/docs/route-inventory.mjs` and commit the regenerated `docs/generated/*`.

**B5 (18 Oct):** partner `POST /api/restaurants/:id/menu/sections/:categoryId/availability` (section switch, owner only); `GET /api/restaurants` adds `isRecommended`, `cuisineType`, `needsLocation`, `listKind` (`recommended` when no location and admins chose kitchens). Section rule in one place: `modules/restaurants/menuSections.ts` (`sectionIsOn`, `dishesForOrdering` used by quote/checkout/reorder, `menuForCustomers`, `reopenSectionsDue` run by `orderSweeper`).
