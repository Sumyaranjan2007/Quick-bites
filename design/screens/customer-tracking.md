# Customer — Order tracking

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** always answer "where is my food and when will it arrive", honestly. **Built on:**
`screens/OrderTrackingScreen.tsx`, `components/LiveOrderMap.tsx`, `lib/useOrderSocket.ts`
(`rider:location_update`). Plan D5, B3, B11. Motion: `../motion/order-tracking.md`.

## Layout

```
┌──────────────────────────────────┐
│ (←)                       (Help) │
│  Google map, top 55%             │  kitchen pin (our icon), home pin (maroon),
│        🛵 → our bike marker      │  bike marker (ART_BRIEF §2), route line maroon 4 px
├─────────── grab handle ──────────┤  Sheet: snaps 35% / 85%
│ Arriving in 12 min               │  `title`, minutes roll
│ Out for delivery · 7:42 PM       │  status + clock time
│ ●━━━━●━━━━●━━━━○━━━━○             │  Placed · Accepted · Preparing · Picked up · Arriving
│ ┌──────────────────────────────┐ │
│ │ ✓ We're ahead of time        │ │  only when live ETA ≤ promise − 3 min (B3)
│ │ About 6 min earlier than     │ │  green-50 card, veg-green text
│ │ promised.                    │ │
│ └──────────────────────────────┘ │
│ (photo) Vikram · your rider  (Call)│ Call while the trip is live (masked calls on hold)
│ Delivery code  4 8 2 1           │  big, tabular; "Tell this to your rider at the door"
│ Order details ›  Bill ›  Help ›  │
└──────────────────────────────────┘
```

**Before pickup** the map shows the kitchen and home only (rider hidden, `contactVisibility`); the
sheet says "Preparing your food · ready in about 15 min".

## States

| State | What shows |
|---|---|
| GPS stale (> 30 s) | bike stays, a small "Updating…" chip on it; ETA keeps last value |
| Running late (live ETA > promise + 5 min) | honest card, amber-50, maroon text: "Running a little late. New time 8:05 PM." No apology wording, no hiding |
| Rider reassigned | sheet line "A new rider is picking up your order" + new name |
| Delivered | our "delivered" animation once, `haptic.success`, rating card rises (stars) |
| Cancelled | red-tinted card with the reason and refund line from the server |
| Map can't load | map area shows the route as a simple line drawing + status; everything else works |

## The bike

Our own top-down bike icon, maroon, 40×40 dp, `flat`, rotated to the heading from the last two
snapped points; glides linearly between GPS fixes over the time between them (cap 3 s; Android
`animateMarkerToCoordinate`, iPhone `AnimatedRegion`); turn transitions `quick`. Camera fits kitchen +
bike + home with 48 dp padding, eases `slow`, pauses while the person drags, resumes after 8 s.

## Checks

Rider never visible before pickup; "ahead" card appears only on the threshold and leaves if time
slips; a 30 s GPS gap shows "Updating…" and no jump when fixes resume.
