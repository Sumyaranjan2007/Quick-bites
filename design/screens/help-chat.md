# Help chat (Customer, Partner, Rider)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** answer the common question right away from our policies and the person's live data; hand
over to staff with everything attached when it can't. **Built on:** `SupportScreen.tsx` (customer),
`HelpCentreScreen.tsx` (partner), support tickets + replies (`supportRepository.ts`), admin
`SupportScreen.tsx`. Plan B8. Owner decision Q3: **fixed answers, no AI writing replies.**

## Layout

```
 Help
 ┌ Order #QB-427294 · Out for delivery ┐  context card when opened from an order
 Hi Priya, what's this about?            our message (left, cream bubble)
 (My order is late) (Item missing) (Refund status) (Payment) (Account) (Something else)
                                         quick-reply chips
          My order is late               their choice (right, maroon bubble)
 Your rider is 1.2 km away, arriving     answer built from live data
 in about 8 min.
 (That helps) (Talk to us)
 ─────────────────────────────────
 [ Type a message…            ] (send)   composer appears after "Talk to us" / "Something else"
```

Customer topics: late, item missing/wrong, refund status, payment charged twice, change address,
cancel, account. Partner: payouts, menu change status, orders, documents. Rider: payouts, cash
deposit, trip issue, documents. Each answer is written in plain words from our policies
(`/api/policies`) plus live data (order status, refund state, payout due).

**Talk to us** creates a ticket with: who, app, the order/trip, the chat so far, device/app version.
Staff reply in the admin Support screen; the reply appears in this thread with a push.

## States

| State | What shows |
|---|---|
| Waiting for staff | our line: "We've got it. We'll reply here and notify you." (no promised minutes) |
| Staff replied | maroon "Quick Bites support" name on their bubbles, push sent |
| Resolved | "Marked as solved. Still need help? Reply to reopen." |
| Offline | composer disabled, offline banner; sent messages show "Not sent · Retry" |

## Motion

New bubbles fade + rise 8 px (`quick`); chips appear 30 ms apart; typing nothing fancy (no fake "typing…" for fixed answers).

## Checks

Every quick reply has a written answer; Talk to us creates exactly one ticket with the order attached;
partner/rider topics never show customer topics.
