# Motion — Cart and checkout

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

Screen: `apps/customer-mobile/src/screens/CartAndCheckoutScreen.tsx`. Tokens: [`README.md`](README.md).

| Element | Trigger | Motion | Haptic |
|---|---|---|---|
| Sections (items, coupon, tip, address, bill) | page opens | fade in and rise 8 px, 40 ms apart | – |
| "You saved ₹X" strip (top) | coupon or discount present | slides down `standard`; amount counts up from 0 over 600 ms | – |
| Item quantity | −/+ | same number roll as the stepper; the line price and the total roll too | select |
| Item removed (qty 0) | − | row collapses (height layout animation `standard`, fade) | select |
| Coupon applied | server accepts | coupon row turns green with a check that draws itself (300 ms); a small burst of amber dots from the check (our own Lottie, 900 ms, once) | success |
| Coupon refused | server refuses | row shakes (as the options sheet) + message fades in under it | warning |
| Tip chips | tap | selected chip fills `springPress`; the bill total rolls | select |
| Bill details | tap "Total bill" | expands with a layout animation `standard`; chevron turns 180° | select |
| Delivery address | change | address text cross-fades `quick` | – |
| Pay / Place order bar | always | sticky at the bottom; total rolls on every change | – |
| Place order | press | `press` scale; then the label becomes a spinner in place (no layout jump) | tap |
| Order placed | server confirms | our own "placed" check animation full-screen (Lottie, 1.2 s), then tracking opens with the screen change | success |
| Payment failed / cancelled | Razorpay returns | sheet slides up with the reason and "Try again" | warning |

Rule: the Place order button can never be tapped twice while it shows the spinner (it already must not, `orderService` refuses duplicates; the motion must not hide that).
