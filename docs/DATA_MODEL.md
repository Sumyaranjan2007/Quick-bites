# Data model — every collection, who writes it, how it is saved

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`.

## How data is stored

| Fact | Where |
|---|---|
| All data lives in memory in `memoryStore`: 32 `Map` collections | `apps/backend-api/src/db/client.ts:62-147` (types), `:149-180` (instance) |
| Production saves to **Postgres**, one table `store_documents (collection, id, data JSONB, updated_at)` | `src/db/postgresStore.ts:144-150`; loaded on boot `:153` |
| Production refuses to start without `DATABASE_URL` (unless `ALLOW_FILE_PERSISTENCE=true`, for tests) | `src/server.ts:51` |
| Locally: `apps/backend-api/data/store.json` (gitignored); `QB_DATA_DIR` overrides the folder | `src/db/client.ts:28-31`, save `:317`, load `:337` |
| A test suite run directly without `QB_DATA_DIR` refuses to start (protects the developer store) | `src/db/client.ts:52-59` |
| Only changed documents are written; each `set`/`delete` marks its id | `src/db/client.ts:206-305` (change tracking), `flushStore` `:441`, `triggerAutoSave` `:495` |
| Money routes answer only after the write is in the database | `persistDurably` `src/db/client.ts:416`; `middlewares/durable.ts` (all admin writes) |
| Field types for every record | `packages/shared-types/src/index.ts` (line per type below) |
| Old snapshots are upgraded on load | `src/db/normaliseStore.ts` |
| Production seeds nothing; the super admin is re-applied from `ADMIN_EMAIL`/`ADMIN_PASSWORD` on boot | `src/db/bootstrapAdmin.ts`; `src/db/seed.ts` (demo data only with `SEED_DEMO_DATA`) |

## Collections

"Writers" = files that call `memoryStore.<collection>.set/delete` (tests excluded), found with
`grep -rln "memoryStore\.<name>\.\(set\|delete\)("`. **Code vs `CLAUDE.md`:** `CLAUDE.md` §2
says repositories are the only writers; in the code many routes and modules write directly
(listed below). Grep every writer before changing a collection's shape.

| Collection | Type (shared-types line) | Key fields | Writers |
|---|---|---|---|
| `users` | `UserProfile` :10 (+ `UserRecord` in `userRepository.ts:6`) | id, email, phone, fullName, role, **roles** (multi-role), isGold, isBlocked, adminRoleId, favouriteRestaurantIds | `db/repositories/userRepository.ts` |
| `restaurants` | `Restaurant` :147 | ownerId, name, phone, address, coordinates, fssaiLicenseNumber, gstin, **acceptsCash** (COD switch), packagingFee, status, kycStatus, isOpen, openingHours, commissionPercent | `restaurantRepository.ts`, `modules/platform/staffDeletion.ts`, `modules/restaurants/rejectionWatch.ts`, `routes/admin/legacyRoutes.ts`, `routes/admin/peopleRoutes.ts`, `routes/kycRouter.ts` |
| `addresses` | (address fields) | userId, addressLine, landmark, city, pincode, coordinates | `addressRepository.ts`, `userRepository.ts`, `db/seed.ts` |
| `orders` | `Order` :580 | orderNumber, customerId, customerName, customerPhone (from the account at checkout since 18 Oct; shown by `contactVisibility.ts`), restaurantId, riderId, status, paymentStatus, paymentMethod, items, **bill** (frozen prices, `OrderBillBreakdown` :525), deliveryOtp, pickupCode, distanceKm, riderPayout, riderCoordinates, timestamps | `orderRepository.ts`, `db/normaliseStore.ts`, `userRepository.ts`, `modules/orders/{deliveryCompletion,opsRescue,orderSweeper}.ts`, `routes/admin/{financeRoutes,marketingRoutes}.ts`, `routes/{cashRouter,paymentRouter,riderRouter}.ts` |
| `menus` | `RestaurantMenu` :465, `MenuItem` :447 | restaurantId, categories → items (price, isVeg, isAvailable, optionGroups); a category may carry `isAvailable: false` + `backAt` (section switch, B5; read through `modules/restaurants/menuSections.ts`) | `menuRepository.ts`, `menuSections.ts` |
| `menuRequests` | `MenuChangeRequest` :107 | restaurantId, kind (ADD_ITEM/EDIT_ITEM), payload, status, batchId, fromAiDraft | `menuRequestRepository.ts` |
| `profileEdits` | `ProfileEdit` :383 | restaurantId, changes, previous, status, rejections | `profileEditRepository.ts` |
| `riders` | `DeliveryRider` :888 | userId, driverCode, phone, vehicle, kycStatus, isOnline, currentCoordinates, codCashInHand, noShowCount | `riderRepository.ts`, `db/ensureTestRider.ts`, `modules/payments/cashDeposits.ts`, `modules/platform/staffDeletion.ts` |
| `kycDocuments` | `KycDocument` :949 | entityType, entityId, documentType, documentNumber, fileUrl, status | `kycRepository.ts`, `routes/riderRouter.ts` |
| `orderMessages` | `OrderMessage` :878 | orderId, senderRole, body | `messageRepository.ts` |
| `coupons` | `Coupon` :1355 | code, discountType, value, limits, budget, isActive | `couponRepository.ts`, `db/seed.ts` |
| `categories` | `PlatformCategory` :1392 | name, slug, sortOrder | `categoryRepository.ts` |
| `ledgerEntries` | `LedgerEntry` :1806 | transactionId, event, account, direction, **amountPaise**, orderId, payoutId, idempotencyKey. Append-only; every balance is derived from it | `modules/payments/ledger.ts` only |
| `pricingConfigs` | `PricingConfig` :1641 (rates `PricingRates` :1491, defaults `DEFAULT_PRICING_RATES` :1875) | version, rates, effectiveFrom. Append-only | `modules/payments/pricingConfig.ts` |
| `restaurantCharges` | – | per-restaurant markup (kept apart from the restaurant record on purpose) | `modules/payments/restaurantCharges.ts` |
| `payouts` | `RiderPayout` :1451 / `PayoutRecord` (`payouts.ts:65`) | payee, amount, state, UTR/reference | `payoutRepository.ts`, `modules/payments/{payouts,legacySettlements,paymentsHealth}.ts` |
| `restaurantSettlements` | `RestaurantSettlement` :1426 | restaurantId, period, netAmount, status | `settlementRepository.ts`, `legacySettlements.ts`, `routes/admin/financeRoutes.ts` |
| `payoutRequests` | – | payee asks to be paid; **no amount stored** | `modules/payments/payoutRequests.ts` |
| `payeeAccounts` | – | where a partner/rider is paid; no full account number (encrypted apart with `PAYEE_ACCOUNT_KEY`) | `modules/payments/payeeAccounts.ts` |
| `cashDeposits` | – | COD cash a rider brings in | `modules/payments/cashDeposits.ts` |
| `refundRequests` | `RefundRequest` :1285 | orderId, reasonCode, requested/approvedAmount, status, timeline | `refundRepository.ts` |
| `supportTickets` | `SupportTicket` :1328 | raisedBy, subject, message, status, replies | `supportRepository.ts`, `routes/admin/supportRoutes.ts` |
| `sosAlerts` | `SosAlert` :933 | riderId, orderId, coordinates, status | `routes/riderRouter.ts`, `routes/admin/supportRoutes.ts` |
| `riderIncentives` | – | milestones already paid | `modules/riders/riderMetrics.ts` |
| `wallets`, `walletTransactions` | `Wallet` :976, `WalletTransaction` :984 | legacy wallet | `walletRepository.ts`, `userRepository.ts` |
| `adminRoles` | `AdminRole` :1211 | key, permissions, isSystem | `adminRoleRepository.ts` |
| `auditLogs` | `AuditLogEntry` :1230 | actor, action, entity, before/after | `auditRepository.ts` |
| `deviceTokens` | `DeviceToken` :412 | userId, role, token, platform (ANDROID/IOS/WEB), appVersion | `deviceTokenRepository.ts` |
| `settings` | – | key/value switches: OTP state, recommended restaurants (`recommendedRestaurants`, B5, `modules/restaurants/recommended.ts`), membership plans, incentives, payment policies, business identity, feature flags, admin notification prefs | `modules/auth/otpService.ts`, `modules/membership/membershipService.ts`, `modules/payments/{incentiveConfig,paymentPolicies}.ts`, `modules/platform/{businessIdentity,featureFlags}.ts`, `notifications/{adminDigest,adminNotificationPrefs}.ts`, `routes/paymentRouter.ts` |
| `meta` | – | bookkeeping (seed revision, AI usage, city rates, account-number key check) | `db/seed.ts`, `modules/menu/menuAi.ts`, `modules/payments/{payeeAccountNumbers,pricingConfig,riderCityRates}.ts`, `routes/admin/platformRoutes.ts` |

Pending emailed confirm links are in the store since 18 Oct 2026 (`pendingRoleConfirmations`, keyed by a hash of the token, 30 minutes, written by `routes/authRouter.ts` only; wiped by the platform reset). `apps/backend-api/prisma/schema.prisma` is an
unused leftover.
