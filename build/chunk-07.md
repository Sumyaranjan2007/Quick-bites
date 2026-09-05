# Chunk 07: Core Application Portals (Customer, Partner, Admin)

**Goal:** Build the primary screens and components across all three portals, enforcing the 4-state UI rule (Loading skeleton, Success, Error with retry, Empty with CTA) and form persistence.  
**Estimated Time:** 120 minutes  
**Dependencies:** Chunk 04, Chunk 06  
**Unlocks:** Chunk 08 (Real-Time Integration)  

---

## 1. Portals & Screens Built
1. **Customer App (React Native + Expo):**
   - Home Discovery Feed (Veg Mode switch, search bar, restaurant cards).
   - Restaurant Detail Screen (categorized menu, dish cards, customization modal).
   - Cart & Checkout Sheet (address selector, bill summary, coupon input).
   - Order History & Profile.
2. **Restaurant Partner Portal (React 18 + Vite):**
   - Live Order Terminal (audio alert, incoming modal, prep timer buttons).
   - Menu Catalog Manager (categories, dish editor, in-stock toggle).
   - Analytics & Commission Payout Ledger.
3. **Admin Dashboard (React 18 + Vite):**
   - Operations Control Tower (live order counters, server health).
   - Restaurant KYC Verification Pipeline.
   - Dispute Resolution & Refund Console.
   - Demo Tool: "Generate Test Restaurant" button.

---

## 2. Verification Commands

```bash
# Typecheck and build all three frontend clients
npm run build
```

---

## 3. Rollback Instructions
Revert screens and components in `apps/customer-mobile`, `apps/restaurant-web`, and `apps/admin-web`.
