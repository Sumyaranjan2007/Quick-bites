# Money flows — price, rider pay, cash, payouts, ledger, invoices, GST

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. **The owner's money rules are settled — do not
re-ask** (`CLAUDE.md` §4, `docs/DECISIONS.md`). Before changing any money path, grep every
place that sets the same state (`CLAUDE.md` §8, "Money paths have copies").

## The bill (one engine, frozen on the order)

| Step | Where |
|---|---|
| Default rates (all editable by admins, versioned) | `DEFAULT_PRICING_RATES`, `packages/shared-types/src/index.ts:1875`; versions in `pricingConfigs` (`modules/payments/pricingConfig.ts`) |
| Rider pay = road km × ₹/km, never below the minimum | `riderPayFor`, `packages/pricing-engine/src/index.ts:38` (defaults `riderPerKmFee: 12`, `riderMinEarningPerTrip: 30`, shared-types `:1908-1909`) |
| ₹/km per city (minimum and markup stay global) | `modules/payments/riderCityRates.ts` (`cityRateFor` `:40`, `ratesForRestaurant` `:78`); Admin → Rates |
| Delivery fee = rider pay + delivery markup % | `packages/pricing-engine/src/index.ts:283-285` (`riderDeliveryMarkupPercent`, default 0) |
| Platform fee GST only with a GSTIN (none yet) | `platformFeeGstFor`, `modules/orders/orderService.ts:330` |
| Road distance | Mapbox Directions (one trip) / Matrix (many): `modules/places/routingService.ts`; `ROAD_DISTANCE_FACTOR` |
| Quote and checkout use the same engine; the bill is frozen on the order (`order.bill`, `OrderBillBreakdown` shared-types `:525`) | `modules/orders/orderService.ts` |
| Dish options checked on every order | `modules/orders/dishOptions.ts` |
| Margin floor at checkout | `modules/payments/orderMargin.ts` |
| Gold members get a delivery discount (not free delivery) | `modules/membership/membershipService.ts`, pricing engine |

## Paying

| Way | Where | Rule |
|---|---|---|
| Online (Razorpay) | `routes/paymentRouter.ts` (`/start` `:87`, webhook `:139`), `modules/payments/capture.ts`, `razorpayAdapter.ts` | webhook trusted only by signature |
| Charged twice → second payment refunded | `modules/payments/duplicateCapture.ts` | – |
| Cash on delivery | `acceptsCash` (`orderService.ts:326`); refused with `COD_NOT_ACCEPTED` (`:584`) | **per restaurant, admins only** (People → restaurant → Payments) |
| Online at the door (QR) | `routes/cashRouter.ts`, `modules/payments/doorPayment.ts` | QR expiry `doorQrExpiryMinutes` |
| Cash a rider carries | `modules/payments/cashDeposits.ts` | ceiling `codCashCeiling` (₹3000), warning at 80% |

## Where the money goes (ledger)

- Double-entry, append-only, in paise: `modules/payments/ledger.ts` (`post` `:149`, `balanceOf` `:251`, `audit` `:333`). Balances are always derived from it, never stored.
- One order is split into ledger lines by `modules/payments/earnings.ts`: kitchen share, commission, rider pay **plus the whole tip** (`:129-130`, counted once), platform fees.
- **5% GST on food** that the customer paid is credited to `TAX_GST_PAYABLE` (`earnings.ts:375`), never to the kitchen's payout (section 9(5) model). **Quick Bites collects this with no GSTIN yet: owner to take to a CA** (`OWNER_ACTIONS.md`).
- Money in at the gateway and its settlement: `modules/payments/gatewaySettlements.ts`, `reconciliation.ts`.
- Refunds: `modules/payments/refunds.ts`, cap `refundCap.ts`; cases in `refundRequests`.

## Payouts (partners and riders)

| Rule | Where |
|---|---|
| No hold period (0 days both), ₹100 minimum | rates `partnerHoldDays`, `riderHoldDays`, `minPayoutAmount` (shared-types `:1875+`) |
| What is owed | `duesFor`, `modules/payments/payouts.ts:178`; `allDues` `:339` |
| Draft → approve → pay | `draftPayout` `:364`, `approvePayout` `:441`, `markPayoutPaid` `:517` (by hand: UPI/bank + UTR), `executePayout` `:593` (RazorpayX) |
| Large payouts need a second person; a super admin may approve their own | threshold `makerCheckerThreshold` (`payouts.ts:391`), self-approval check `:456` |
| Daily cap | `dailyPayoutCap`, `paidInLast24hPaise` `:353` |
| Payee asks to be paid (no amount stored) | `modules/payments/payoutRequests.ts`; `POST /api/earnings/payout-requests` (`routes/earningsRouter.ts:148`) |
| Where they are paid | `modules/payments/payeeAccounts.ts`; full numbers encrypted apart (`payeeAccountNumbers.ts`, `PAYEE_ACCOUNT_KEY`) |
| Telling them | `notifications/payeeNotifier.ts` |
| Checks | pay the same payee twice in tests; assert `payable + held === outstanding` (`CLAUDE.md` §8) |

## Statements and invoices (6 Oct)

- One builder: `modules/payments/statements.ts` (`statementFor` `:226`) → `modules/payments/statementPdf.ts` (labelled "Not a GST tax invoice", `:320`).
- Partner/Rider: `GET /api/earnings/statement` (`:64`), `/statement.pdf` (`:96`), `/invoices.zip` (`:118`, one PDF per order + summary).
- Admin: Money → Pay → Owed → Statement (same builder, admin routes in `routes/admin/payoutRoutes.ts`).
- Customer receipt: `routes/invoiceRouter.ts`.

## Open money questions (owner)

- The payee text still promises "Everything owed is paid automatically on the weekly run"
  (`modules/payments/payoutPromise.ts:140`, cadence from rate `payoutCadenceDays: 7`, wording
  `runCadence` `:56`) — contradicts paying whenever; waiting for the owner's wording (`docs/KNOWN_ISSUES.md`).
- GST collected without a GSTIN; record retention 5 years (privacy policy) vs 72 months (GST) — for a CA.
- Razorpay live keys not yet on Railway (live was on `rzp_test_` keys on 2 Oct).
