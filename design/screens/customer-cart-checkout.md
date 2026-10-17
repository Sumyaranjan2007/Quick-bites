# Customer — Cart and checkout

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** check the order, see the real total and time, pay once. **Built on:**
`screens/CartAndCheckoutScreen.tsx` (quote, coupon, tip, address, Razorpay or cash where allowed).
Plan D4, B3 (promised time). Motion: `../motion/checkout.md`. Money rules: `CLAUDE.md` §4 (never
change a price shown; the server's quote is the truth).

## Layout (top to bottom, one scroll)

1. **Savings strip** (only when there is one): amber-50 band, "You save ₹150 on this order".
2. **Restaurant + items:** name; each item row: DietMark, name, chosen options in `caption`, Stepper
   sm, line price. "+ Add more items" link back to the menu.
3. **Coupon:** applied → green check "CRAVY150 applied · −₹150" + Remove; none → "Apply coupon ›".
4. **Delivery time:** "Delivery in 35–40 min" (frozen promise from the quote, B3).
5. **Deliver to:** label + address + "Change"; instructions chips if built (owner's pick).
6. **Tip your rider:** chips ₹10 ₹20 ₹30 Other; "100% goes to your rider."
7. **Bill:** collapsed "Total bill ₹964.39 · incl. taxes and charges ›"; expanded: item total,
   delivery fee, platform fee, packaging, GST, tip, discount, each from the quote.
8. **Cancellation and payment policies** link (exists, `PaymentPoliciesSheet`).

**Sticky pay bar:**
```
┌──────────────────────────────────┐
│ Pay by          ₹964.39          │
│ UPI / card ▾   [  Place order  ] │  method on the left (Online / Cash if the kitchen allows)
└──────────────────────────────────┘
```

## States

| State | What shows |
|---|---|
| Quote loading | totals as skeleton lines; Place order disabled "Getting your total…" |
| Price changed since add (server quote differs) | banner "Prices updated by the restaurant" + the new total; nothing is placed silently |
| Cash not accepted here (`COD_NOT_ACCEPTED`) | Cash option hidden; if picked earlier: "This restaurant takes online payment only." |
| Kitchen closed meanwhile | banner "Not delivering currently" + Place order disabled |
| Placing | button spinner, whole bar locked (double tap impossible) |
| Payment cancelled/failed | sheet "Payment didn't go through. Nothing was charged." / "If money left your account, it comes back in 5–7 days." + **Try again** |
| Placed | our "placed" animation (ART_BRIEF §2), `haptic.success`, then tracking |

## Checks

Total on the bar equals the bill's total equals the server quote; Place order cannot fire twice;
removing the last item returns to the restaurant page with the cart bar hidden.
