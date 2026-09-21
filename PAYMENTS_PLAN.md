# Quick Bites — Payments, Settlements and Payouts: the complete plan

**Version:** 1.0.0
**Date:** 21 September 2026
**Status:** APPROVED 21 September 2026. **P1 is built and verified** (Session 31);
P2 is next. Chunk status is tracked in `build/MANIFEST.md` §1c.
**Author:** Claude Opus 5, Session 31
**Supersedes:** the payment sections of `REBUILD_PLAN.md` Stage 3

---

## 0. What this document is

Every rupee that enters, moves through or leaves Quick Bites, and what the
platform does in each case when it goes wrong.

It was written after auditing the money code that already exists, not from a
blank page. Three things in here are **defects found during that audit**, not
features — they are in §2, because a plan that quietly fixes a defect without
saying so is a plan you cannot check.

Nothing here is built yet. It is for approval first, by explicit instruction.

---

## 1. Decisions taken (do not re-litigate)

| Question | Decision | Decided by |
| --- | --- | --- |
| Payout rail | **Multi-rail.** RazorpayX API, manual bank transfer with recorded UTR, and Payout Links. Admin chooses per payment; a default is configured | Owner, Session 31 |
| Door collection | **Dynamic UPI QR** on the rider's screen, confirmed by webhook | Owner |
| Cash-order refunds | **Payout Link.** Customer enters their own UPI. No customer bank detail is ever stored | Owner |
| Commission | **Per-restaurant rate**, admin-set, frozen per order | Owner |
| Customer wallet | **Removed.** Refunds return down the rail the money arrived on | Owner |
| Rider COD | Cash-in-hand, cleared only by a confirmed office deposit, and it **gates their payout** | Owner |
| Rate control | **Every rate admin-editable** with defaults pre-filled. What the admin sets is exactly what the customer pays | Owner |
| Payout authorisation | **Maker-checker above a threshold**, plus a daily cap | Owner |
| Partner hold period | **Delivery + 1 day** before money is payable | Owner |
| Who can raise a payment | Partner or rider raises a request with proof; admin also sees all dues daily regardless | Owner |
| Entity status | Registered, GSTIN held, current account live, Razorpay KYC done or in progress | Owner |

---

## 2. What the audit found

Three defects. All three are in scope and all three are fixed by this plan.

### 2.1 The admin refund queue pays store credit for card payments

`routes/admin/financeRoutes.ts` line 244, the `REFUND` action:

```ts
await walletRepository.credit(order.customerId, payable, ...);
```

Unconditional. It never inspects `order.paymentMethod`, never reads
`order.razorpayPaymentId`, and never calls `razorpayAdapter.refund`. A customer
who paid ₹480 by UPI and is refunded by an administrator receives ₹480 of
**Quick Bites credit**, and the success message says so in as many words.

The cancellation path in `modules/orders/orderService.ts` line 668 does it
correctly — gateway refund to source, and a case deliberately left open when the
gateway cannot settle. So the platform has two refund paths that disagree, and
**the wrong one is the one a human operates.** Every complaint refund and every
goodwill credit that came through the queue went to a wallet.

This is also precisely the behaviour now being removed.

### 2.2 Commission is hardcoded, twice

`packages/pricing-engine/src/index.ts` line 143 computes `itemsTotal * 0.15`.
`apps/backend-api/src/modules/admin/analytics.ts` line 18 declares
`const COMMISSION_RATE = 0.15` and computes it again for the revenue screen.

Two copies of one business number in two files. Change one and the revenue report
silently stops matching the settlements. Neither is per-restaurant and neither is
editable without a deploy.

### 2.3 Nothing on this platform can send money

There is no bank account in the data model. Not for riders, not for partners, not
for anyone. The only banking detail that exists is a **photograph** of a bank
proof in the KYC queue (`modules/restaurants/restaurantDocuments.ts` line 82),
which a human reads with their eyes.

A payout is a record of a decision, not a transfer: `POST
/admin/payouts/:id/status` sets a status and an administrator types a UTR by
hand. Marking it `PAID` credits the rider's **wallet**. Restaurant settlements
work the same way.

So today: the platform takes money correctly and cannot send any.

### 2.4 What is already right — do not rewrite these

- `modules/payments/razorpayAdapter.ts` — real Orders API, HMAC-SHA256 signature
  verification, raw-body webhook verification, constant-time comparison, circuit
  breaker, server-side amounts only. Good code. It is extended, not replaced.
- `modules/payments/reconciliation.ts` — recovers payments whose webhook was lost
  by asking the gateway what it holds against our order id.
- The frozen-at-draft discipline in `payoutRepository` and
  `settlementRepository`. Correct instinct; it stays.
- `GET /admin/finance/wallet-audit` — replays a journal and reports divergence
  rather than silently repairing it. That pattern becomes the ledger audit.
- Order cancellation refunding to source.

---

## 3. The money map

```
                          MONEY IN
  Customer --online-------> Razorpay ------> Platform current account
  Customer --cash at door-> Rider's pocket -> Platform (office deposit)
  Customer --UPI QR at door-> Razorpay -----> Platform current account   [NEW]
  Customer --membership----> Razorpay ------> Platform

                         MONEY HELD
  Ledger: partner payable, rider payable, rider cash-in-hand,
          tax payable, platform revenue

                         MONEY OUT
  Platform --RazorpayX payout--> Partner bank
  Platform --RazorpayX payout--> Rider bank / UPI
  Platform --gateway refund----> Customer's original card / UPI / netbanking
  Platform --payout link-------> Customer's own UPI          [cash orders]
  Rider ----cash at door-------> Customer                    [at-door refusal]
  Platform --manual + UTR------> anyone                      [fallback rail]
```

---

## 4. Architecture

### 4.1 Pricing Configuration — versioned, never mutated

A new entity `pricingConfigs`. An admin editing a rate creates a **new version**;
the old one is never overwritten. Every order stores the version it was priced
under and a frozen snapshot of the rates used.

This is what makes a settlement defensible eight months later: "why was this
order commissioned at 18%?" is answered by the order itself, not by whatever the
config happens to say today.

| Field | Default | Notes |
| --- | --- | --- |
| `gstFoodPercent` | 5 | GST on food, no ITC |
| `packagingFeeDefault` | 20 | Per order; a restaurant may override |
| `deliveryBaseFee` | 30 | Up to `deliveryBaseKm` |
| `deliveryBaseKm` | 3 | |
| `deliveryPerKmBeyond` | 10 | Per km, rounded up |
| `memberFreeDeliveryMinOrder` | 199 | Free delivery for members above this |
| `memberDiscountPercent` | existing | On food total only |
| `platformFeeBase` | 5.00 | |
| `platformFeeGstPercent` | 18 | Charged on the fee, giving ₹5.90 |
| `defaultCommissionPercent` | 15 | Fallback when a restaurant has no own rate |
| `commissionGstPercent` | 18 | GST we owe on our commission |
| `tdsPercent` | 1 | Section 194-O, withheld from partner payouts |
| `tcsPercent` | 1 | GST section 52, collected on net taxable supplies |
| `riderBaseFeePerTrip` | 25 | |
| `riderPerKmFee` | 6 | Beyond `riderBaseKm` |
| `riderBaseKm` | 2 | |
| `riderMinEarningPerTrip` | 30 | Floor |
| `codCashCeiling` | 3000 | Rider stops being offered COD above this |
| `codCashWarnPercent` | 80 | Notification threshold |
| `partnerHoldDays` | 1 | Delivery + N before payable |
| `riderHoldDays` | 0 | |
| `minPayoutAmount` | 100 | Below this, carries to the next run |
| `makerCheckerThreshold` | 10000 | Payouts above this need a second admin |
| `dailyPayoutCap` | 200000 | Platform-wide ceiling per 24h |
| `payoutLinkExpiryHours` | 72 | For customer cash refunds |
| `doorQrExpiryMinutes` | 15 | Capped at 120 by Razorpay |

Per-restaurant override: `restaurant.commissionPercent` (nullable → falls back to
the config default). Set by an admin at approval, changeable with an audit entry,
**never applied retroactively**.

**Every one of these is editable from the admin portal.** Nothing above lives in
source code once this lands.

### 4.2 The ledger — double entry, immutable, replayable

The single most important thing in this plan.

A new append-only `ledgerEntries` store. Every money event writes balanced
entries. Nothing anywhere else is allowed to be the authority on a balance —
balances are **derived by replay**, exactly as `wallet-audit` already does.

```ts
interface LedgerEntry {
  id: string;
  occurredAt: string;
  event: LedgerEvent;            // ORDER_PAID, COD_COLLECTED, PAYOUT_SENT, ...
  account: LedgerAccount;        // PARTNER_PAYABLE:<id>, RIDER_CASH:<id>, ...
  direction: 'DEBIT' | 'CREDIT';
  amountPaise: number;           // integers only. No floats touch money.
  orderId?: string;
  payoutId?: string;
  refundCaseId?: string;
  idempotencyKey: string;        // uniquely indexed. One event cannot post twice
  actorUserId: string | 'system';
  narration: string;
}
```

Accounts: `PLATFORM_BANK`, `GATEWAY_RECEIVABLE`, `PARTNER_PAYABLE:<id>`,
`RIDER_PAYABLE:<id>`, `RIDER_CASH:<id>`, `TAX_GST_PAYABLE`, `TAX_TCS_PAYABLE`,
`TDS_WITHHELD`, `REVENUE_COMMISSION`, `REVENUE_FEES`, `REFUNDS_PAID`,
`CUSTOMER_REFUND_PAYABLE`.

**Amounts are integer paise everywhere.** The current code rounds floats at every
step (`Math.round(x * 100) / 100`, eighteen times in the pricing engine). That is
survivable for display and is not survivable for a ledger that must balance to
zero.

Three properties this buys, all asked for by name:

- **Proof of why we are paying.** A settlement is a query over entries, each
  carrying its order id. "Why this number" has a literal answer.
- **A payment cannot post twice.** `idempotencyKey` is uniquely indexed.
- **Divergence is detectable.** A daily job re-derives every balance and reports
  any that disagrees. It reports; it never repairs.

### 4.3 Payout rail abstraction — "any situation"

```ts
interface PayoutRail {
  readonly id: 'RAZORPAYX' | 'MANUAL_BANK' | 'PAYOUT_LINK' | 'UPI_MANUAL';
  readonly displayName: string;
  available(): boolean;                          // keys present, account active
  send(i: PayoutInstruction): Promise<RailResult>;
  status(reference: string): Promise<RailStatus>;
}
```

| Rail | Used for | Behaviour |
| --- | --- | --- |
| `RAZORPAYX` | Default for partners and riders | `POST /v1/payouts` with a mandatory `Idempotency-Key`. Status by webhook and by poll |
| `PAYOUT_LINK` | Customer refunds on cash orders; anyone with no verified account | `POST /v1/payout-links`. Recipient enters their own UPI. Expiry configurable |
| `MANUAL_BANK` | Gateway down, amount above a rail limit, anything exceptional | Admin transfers by net banking and records the UTR. Ledger entries are identical |
| `UPI_MANUAL` | Small one-off corrections | Admin pays by UPI and records the reference |

The rail is chosen per payout: a default from config, overridable by the
administrator on the payment itself, with the reason recorded. **Every rail
produces the same ledger entries.** Only the reference format differs. That is
what makes "pay in any situation" safe rather than a way to lose track of money.

### 4.4 Payee accounts — and why we stop holding bank numbers

New `payeeAccounts` entity, for restaurants and riders:

```ts
{
  ownerType: 'RESTAURANT' | 'RIDER';
  ownerId: string;
  method: 'BANK' | 'VPA';
  holderName: string;
  accountLast4?: string;          // display only
  ifsc?: string;
  vpa?: string;
  razorpayContactId?: string;
  razorpayFundAccountId?: string; // what we actually pay to
  validationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'NAME_MISMATCH' | 'INVALID';
  registeredName?: string;        // what the bank says
  nameMatchScore?: number;        // 0-100, from Razorpay
  isDefault: boolean;
  addedAt: string; verifiedAt?: string;
  addedByUserId: string;
}
```

**Verification.** `POST /v1/fund_accounts/validations` with
`validation_type: "pennydrop"` deposits ₹1 and returns `account_status`,
`registered_name` and `name_match_score`. The platform compares the returned name
against the KYC name automatically:

- score ≥ 90 → `VERIFIED`
- score 70–89 → `NAME_MISMATCH`, queued for a human
- score < 70, or `account_status: invalid` → `INVALID`, refused

A rider cannot pay themselves into a stranger's account by typo or by intent, and
the platform finds out in seconds instead of after a payout has vanished.

**Then we throw the account number away.** Once Razorpay returns a
`fund_account_id`, that id is what we pay to. The raw account number is discarded
and only the last four digits are kept for display. Combined with customer
refunds going out by Payout Link, **Quick Bites never stores a full bank account
number for anybody.**

A changed account resets `validationStatus` and re-runs the penny drop. A payout
to an unverified account is refused by the server, not merely hidden in the UI.

### 4.5 Idempotency, everywhere money moves

Three independent layers, because one is not enough:

1. **Client** sends an `Idempotency-Key` on payout creation; a repeat returns the
   original result rather than paying again.
2. **Ledger** refuses a duplicate `idempotencyKey` at the storage layer.
3. **Razorpay** receives our key in its own mandatory `Idempotency-Key` header,
   so even a retry that gets past us cannot pay twice at the bank.

A payout whose result is unknown — timeout, crash mid-flight — is **never retried
blind**. It is marked `UNCERTAIN`, and a reconciliation pass asks Razorpay what
actually happened before anything is allowed to touch it.

---

## 5. Flows, case by case

### 5.1 Customer pays online (exists, extended)

Unchanged, except: on `paymentStatus = PAID`, ledger entries are written splitting
the bill into partner payable, rider payable, tax payable and platform revenue —
using the **frozen** rates on that order.

### 5.2 Customer pays cash on delivery

1. Order placed as `CASH_ON_DELIVERY`. Nothing is owed to anyone yet.
2. Rider delivers, takes cash, confirms the OTP.
3. Ledger: `RIDER_CASH:<id>` debited the full bill. The rider is now holding the
   platform's money and the platform knows exactly how much.
4. Partner and rider payables accrue as normal — what the customer paid and how
   are separate questions from what we owe.

### 5.3 Customer pays by UPI QR at the door — NEW

1. Rider arrives, taps **Collect online** on the delivery screen.
2. Server: `POST /v1/payments/qr_codes` — `type: upi_qr`, `usage: single_use`,
   `fixed_amount: true`, `payment_amount` from **the server's own bill**,
   `close_by` = now + `doorQrExpiryMinutes`, `notes: { orderId, orderNumber }`.
3. Rider's screen shows `image_url`. Customer scans with any UPI app.
4. `qr_code.credited` webhook → order `PAID`, method `UPI_AT_DOOR`, **no cash in
   hand is created**, rider's screen turns green over the socket.
5. QR closes on payment or expiry. An expired QR can be regenerated; the old one
   cannot be paid.

| Case | Behaviour |
| --- | --- |
| Customer pays, webhook is slow | Rider screen polls `GET /orders/:id/door-payment`; the server asks Razorpay directly rather than waiting |
| Customer scans but abandons | QR expires by `close_by`. Order stays COD. Rider takes cash |
| Customer pays twice | Single-use QR closes on first payment; a second cannot be made against it |
| Customer pays partially | Impossible: `fixed_amount: true` |
| Rider has no signal | QR cannot be generated. The screen says so and offers cash. Never a blank failure |
| Rider claims paid, no webhook | Rider cannot mark it paid. **Only the gateway can** |
| Customer pays after the rider leaves | Webhook still lands; order marked paid; the rider's cash-in-hand is reduced if it was already recorded |

Rule: **the rider's app can never mark an order paid.** Only a verified webhook or
a direct gateway query can. A delivery app is an attacker-controlled environment
holding other people's money, and this is the one place a lie pays.

### 5.4 Rider remits cash to the office

1. Nightly, and whenever cash-in-hand crosses `codCashWarnPercent`, the rider is
   notified: *"₹2,400 to deposit."*
2. At `codCashCeiling` the rider **stops receiving COD offers**. Online-paid
   orders still reach them, so they keep earning. Exposure per rider is bounded by
   a number the admin sets.
3. Rider declares in the app: amount, optionally a photo of the cash or slip.
   Status `DECLARED`.
4. At the office, an administrator counts and confirms the **received** amount.
5. Match → `CONFIRMED`, cash-in-hand reduced, ledger entries both sides.
   Mismatch → `VARIANCE`, flagged and audit-logged, cash-in-hand reduced by what
   was actually received, and the difference stays against the rider.
6. The payout gate lifts when cash-in-hand reaches zero.

| Case | Behaviour |
| --- | --- |
| Partial deposit | Allowed. Reduces by what was received. Gate stays until zero |
| Rider deposits more than owed | Refused with the figure; a credit is never created by a miscount |
| Declared ≠ received | `VARIANCE`, both numbers kept, visible on the rider's record |
| Rider disputes the count | Both figures and the declaration timestamp are on record. Neither party's word alone |
| Rider goes quiet holding cash | Appears in an ageing report; admin can block the account, which also ends their shift |
| Rider blocked while holding cash | The debt survives the block. The ledger does not forget |

### 5.5 Partner earns and is paid

1. Order delivered. Payable at **delivery + `partnerHoldDays`**.
2. The daily run drafts dues for every partner over `minPayoutAmount`.
3. The statement shows, per order: food total, packaging, commission at the
   **frozen** rate, GST on commission, TDS withheld, and any refund adjustment.
4. A partner may **raise a request** from their app at any time; it arrives in the
   same queue carrying the same statement. Raising it does not change the amount —
   it changes who is waiting for whom.
5. Admin clears: one approver below the maker-checker threshold, two above it.
6. RazorpayX payout to the verified fund account. Webhook updates status.

### 5.6 Rider earns and is paid

As above, with:

- Earnings from `riderBaseFeePerTrip` + distance + tips (tips paid in full, never
  commissioned).
- **Cash-in-hand must be zero.** A rider holding ₹2,000 of platform cash is not
  paid ₹1,800 of earnings; that is a net position, not a payment, and settling it
  by transfer would mean the platform paying out money it is owed.
- Offsetting is possible and is a **separate, explicit admin action** with its own
  ledger entries, never a silent subtraction.

### 5.7 Refunds — every case

| # | Paid by | Trigger | Money goes | Rail |
| --- | --- | --- | --- | --- |
| 1 | Card / UPI / netbanking | Cancelled before delivery | Back to source | Gateway refund |
| 2 | Card / UPI / netbanking | Complaint after delivery | **Back to source** (today: wallet — fixed) | Gateway refund |
| 3 | Card / UPI / netbanking | Partial (one bad dish) | Back to source, partial | Gateway refund |
| 4 | UPI at door | Any | Back to source | Gateway refund |
| 5 | Cash | Cancelled before the rider collects | Nothing owed — no money was taken | — |
| 6 | Cash | Refused at the door | Rider hands cash back, recorded against cash-in-hand | Cash |
| 7 | Cash | Complaint after delivery | **Payout Link**, customer enters own UPI | `PAYOUT_LINK` |
| 8 | Any | Partner already settled | Adjustment against their next settlement | Ledger |
| 9 | Any | Gateway refund fails | Case stays open in the queue, retried, escalates to Payout Link | Both |
| 10 | Any | Refund > order total | Refused | — |
| 11 | Any | Second refund attempt | Refused by idempotency and case status | — |
| 12 | Membership | Cancellation | Pro-rata by unused days. **Needs your confirmation — §11** | Gateway refund |
| 13 | Any | Payout link unclaimed at expiry | Reappears in the queue with an alert. Money is not written off | — |

Rules that hold across all thirteen:

- **Money goes back exactly the way it came.** No exceptions, no wallet, no
  credit, no substitution.
- A refund that has not settled is **never** displayed as refunded. The
  cancellation path already gets this right; it becomes the rule everywhere.
- Every refund writes ledger entries reducing platform revenue and, where
  relevant, the partner's payable.

### 5.8 Disputes and chargebacks

Razorpay's `payment.dispute.created` webhook currently has no handler. It gets
one: the order is flagged, any unsettled partner payable on it is **frozen**, and
the case appears in the admin queue. A chargeback lost after settlement becomes an
adjustment, exactly like a late refund.

---

## 6. Security and controls

| Control | Rule |
| --- | --- |
| Maker-checker | Payouts above `makerCheckerThreshold` need a second admin with `finance.payouts.approve` who is **not** the drafter. Server-enforced |
| Daily cap | Platform-wide payout ceiling per 24 hours. Refused at the server, alert at 80% |
| Account verification | A payout to an unverified fund account is refused by the server |
| Name matching | Automatic, scored, with a human queue for the middle band |
| Idempotency | Three layers (§4.5) |
| Integer paise | No floating-point arithmetic touches money |
| Immutable ledger | Append-only. A correction is a new entry, never an edit |
| Audit | Every rate change, payout, approval, refund and cash confirmation is audit-logged with before and after |
| Least data | No customer bank details, ever. No partner or rider account numbers after verification |
| Permissions | New granular permissions: `finance.payouts.draft`, `.approve`, `.execute`, `finance.config.edit`, `finance.cash.confirm` |
| Rate limiting | Payout endpoints get their own stricter limits |
| Webhook auth | Existing raw-body HMAC verification extended to payout, payout-link, QR and dispute events |
| Replay protection | Webhook event ids recorded; a replayed webhook is a no-op |

---

## 7. Tax

All rates from config, all lines shown separately on every statement.

| Line | Default | On what | Who bears it |
| --- | --- | --- | --- |
| GST on food | 5% | Food total | Customer |
| GST on platform fee | 18% | Platform fee | Customer |
| GST on commission | 18% | Our commission | Platform, owed to government |
| TDS s.194-O | 1% | Gross order value | Withheld from partner payout |
| TCS GST s.52 | 1% | Net taxable supplies | Collected, owed to government |

A partner's statement shows gross, commission, GST on commission, TDS withheld and
net — so the number they receive is explainable line by line without a phone call.
Monthly exports for filing: GSTR-1 style supply summary, TCS summary, and a TDS
summary per partner PAN.

The customer GST invoice carries the platform GSTIN, order number, HSN/SAC and the
tax split.

---

## 8. Work by app

**Backend** — new: `modules/payments/pricingConfig.ts`, `ledger.ts`, `rails/`
(razorpayx, payoutLink, manual), `payeeAccounts.ts`, `doorPayment.ts`,
`cashDeposits.ts`, `tax.ts`, `disputes.ts`. Extended: `razorpayAdapter.ts`,
`reconciliation.ts`, `financeRoutes.ts`, `riderRouter.ts`, `restaurantRouter.ts`,
`paymentRouter.ts`, `pricing-engine`.

**Admin (mobile + web)** — Pricing & Rates configuration; Daily Dues queue; payout
drafting, approval and execution with rail selection; cash deposit confirmation;
refund queue rebuilt around rails; payee account verification queue;
reconciliation and ledger audit; tax reports.

**Partner app** — add and verify a bank account; earnings statement per order;
raise a payout request; settlement history with every deduction named; the
commission rate they are on.

**Rider app** — add and verify a bank or UPI account; **Collect online** QR at the
door; cash-in-hand with ceiling warnings; declare a deposit; earnings statement;
raise a payout request.

**Customer app** — wallet screen and every wallet path removed; refund status shown
against the order with the rail and expected timing ("3–7 working days to your
card ending 4412"); payout-link claim flow for cash refunds; GST invoice download.

---

## 9. Build order

Each chunk ends with the full gate and is independently shippable.

| # | Chunk | Depends | Ships |
| --- | --- | --- | --- |
| **P1** | Pricing config (versioned) + integer-paise ledger + admin rates UI | — | You control every rate. Everything after rests on this |
| **P2** | Payee accounts + penny-drop verification + UI in partner and rider apps | P1 | Partners and riders can connect a verified bank account |
| **P3** | Payout rails + daily dues queue + maker-checker + admin execution | P1, P2 | **The platform can pay people.** The core of this plan |
| **P4** | Refunds rebuilt: source-rail always, payout links, all 13 cases, customer wallet removed | P1, P3 | Refunds are correct. Defect 2.1 closed |
| **P5** | Door UPI QR + cash ceiling + deposit declare/confirm + payout gating | P1, P3 | COD stops being a cash problem |
| **P6** | Partner and rider payout requests with statements | P3 | They can raise; you see proof |
| **P7** | Tax lines, customer invoices, filing exports | P1, P3 | Compliance |
| **P8** | Reconciliation, ageing, alerts, ledger audit, payment policy documents | all | Hardening |

---

## 10. Working alongside the other session

Another session is building unrelated features in parallel. Rules for this one:

**Owned exclusively by the payments work** — `modules/payments/**`,
`routes/admin/financeRoutes.ts`,
`db/repositories/{payout,settlement,refund,wallet}Repository.ts`,
`packages/pricing-engine/**`, and the new payments modules.

**Shared — coordinate before touching** — `modules/orders/orderService.ts`,
`routes/riderRouter.ts`, `routes/orderRouter.ts`,
`packages/shared-types/src/index.ts`, `db/client.ts`. Changes here are **additive
only**: new fields, new functions, no renames and no signature changes, so a merge
cannot silently break the other session's work.

**Never touched by this plan** — maps, search, menus, KYC documents, chat, support,
and notifications other than payment ones.

Each chunk is claimed in `build/MANIFEST.md` before work starts and released on
completion, per §3C of the existing protocol.

---

## 11. Assumptions I am making, and what I need confirmed

Defaults are in place for all of these, so the plan is executable as written. Say
the word on any you want changed.

1. **Rider payout cadence: daily**, consistent with clearing everyone daily.
2. **A rider earnings ledger replaces the rider wallet.** Earnings are a payable,
   not a spendable balance. The customer wallet is deleted entirely.
3. **Membership refund: pro-rata by unused days.** Confirm — a policy decision,
   not a technical one.
4. **Failed payouts retry twice** (1h, 6h) then flag for manual handling.
5. **Existing wallet balances are settled out** to their owners' banks before the
   wallet is removed, not deleted. Confirm.
6. **Tips are paid to riders in full** and never commissioned. Already true.
7. **Partner statements exportable as PDF**; riders see theirs in-app only.

---

## 12. What only you can do

| When | What | Why |
| --- | --- | --- |
| Before P3 | RazorpayX API key, secret and current account number in Railway | Nothing can pay out without it |
| Before P3 | IP allowlisting for RazorpayX in the Razorpay dashboard | **Mandatory.** Payout calls are refused without it, and Railway's egress IP is not static — this may need a static-IP proxy. Flagged early because it is the likeliest thing to block P3 |
| Before P3 | Confirm which Razorpay products are activated: Payouts, Payout Links, Account Validation, QR Codes | Each is separately enabled |
| Before P5 | Confirm QR Codes is enabled on the payment account | Door collection depends on it |
| Before P7 | GSTIN, PAN, registered address, and your CA's confirmation of the five rates | Wrong rates after money moves means reissuing settlements |
| Before live | Razorpay live keys once KYC completes | Test keys until then; no code change to switch |
| Ongoing | Float in the RazorpayX account | A payout against an empty account queues or fails |

---

## 13. How this will be verified

Nothing here is reported as working because it compiles — the standing rule from
`REBUILD_PLAN.md`.

- **Ledger**: property test. Across a randomised sequence of orders, refunds,
  payouts and deposits, every account's replayed balance equals its stored balance
  and the books sum to zero.
- **Idempotency**: the same payout fired six times concurrently produces one
  transfer — the same test shape that already proves six taps of Place Order
  produce one order.
- **Every refund case**: all thirteen rows of §5.7 asserted against a real HTTP
  server.
- **Maker-checker**: a drafter approving their own payout is refused; a second
  admin succeeds; the daily cap refuses at the boundary.
- **Verification**: a name mismatch is refused; an unverified account cannot be
  paid.
- **Door QR**: paid twice, expired, abandoned, and rider-claims-paid-without-
  webhook, all asserted.
- **Mutation testing** on every money path. A check that has never failed is not
  evidence.
- **On hardware**, with three phones: a full COD order deposited at the office, a
  full door-QR order, and a cash refund claimed through a payout link.

---

## 14. Razorpay APIs this plan depends on

Verified against Razorpay's documentation on 21 September 2026.

| Purpose | Endpoint | Notes |
| --- | --- | --- |
| Pay a partner or rider | `POST /v1/payouts` | `Idempotency-Key` header **mandatory** since 15 March 2025 |
| Cancel a queued payout | `PATCH /v1/payouts/:id/cancel` | Only while `queued` |
| Refund a cash order | `POST /v1/payout-links` | Recipient supplies their own account |
| Verify a bank account | `POST /v1/fund_accounts/validations` | `pennydrop`; returns `registered_name`, `name_match_score` (0–100), `account_status` |
| Door collection | `POST /v1/payments/qr_codes` | `upi_qr`, `single_use` requires `fixed_amount: true`; `close_by` 2 min–2 h |
| Refund to source | `POST /v1/payments/:id/refund` | Already integrated |

IP allowlisting is mandatory for RazorpayX. That is an infrastructure
prerequisite, not a code one, and it is the single most likely thing to delay P3.
