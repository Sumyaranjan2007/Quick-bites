# Chunk 03: Data Access Layer, PostgreSQL DDL & Mongoose Schemas

> **HISTORICAL — not kept up to date (banner added 6 Oct 2026).** True when written; parts describe things since removed or replaced (a Cloudflare tunnel, seeded `pass123` accounts, wallets, Google Maps, the old `apps/admin-web` and `apps/restaurant-web`). For the current state read **`CLAUDE.md`** (start here), then `OWNER_ACTIONS.md` and `CHANGELOG.md`.

**Goal:** Implement database client connections, Prisma schema for PostgreSQL with PostGIS geometry types, Mongoose models for MongoDB menu catalogs, and idempotent seed fixtures.  
**Estimated Time:** 60 minutes  
**Dependencies:** Chunk 02  
**Unlocks:** Chunk 04 (Business Logic & Pricing) & Chunk 05 (Search Indexing)  

---

## 1. Relational Entities (Prisma / Postgres)
- `User` (id, email, phone, role, isGold, preferredLanguage)
- `Restaurant` (id, ownerId, name, coordinates [Point], fssai, status, rating)
- `Address` (id, userId, label, addressLine, coordinates [Point])
- `Order` (id, idempotencyKey, orderNumber, customerId, restaurantId, status, totalAmount)
- `OrderItem` (id, orderId, mongoDishId, itemName, unitPrice, quantity, total)
- `RestaurantPayout` (id, restaurantId, grossSales, commission, netPayable)

## 2. Document Models (Mongoose / MongoDB)
- `Menu` (restaurantId, categories: [{ name, items: [{ name, price, isVeg, optionGroups }] }])
- `Review` (orderId, customerId, restaurantId, rating, comment, verifiedPurchase)

---

## 3. Verification Commands

```bash
# Validate database connection and seed demo restaurant
npm --prefix apps/backend-api run db:seed
```

---

## 4. Rollback Instructions
Run `npx prisma migrate reset` and drop MongoDB collections.
