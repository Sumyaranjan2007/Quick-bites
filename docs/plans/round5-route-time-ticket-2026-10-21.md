# Round 5 — shortest route, honest arrival time, a proper kitchen ticket (21 Oct 2026)

**Status:** built 21 Oct 2026 (see the Tracker at the end). **Who tests:** the owner (the Tester session was retired on
21 Oct). This file stands alone: it explains the problems, their root causes in the code, the fixes, what does not
change, and how each fix is checked. Project overview: `CLAUDE.md`; money rules: `CLAUDE.md` §4.

## For the owner, in one screen

| | |
|---|---|
| **What was wrong** | (1) A kitchen ~1 km away was measured as 5.5 km: the customer paid a 5.5 km delivery fee, the rider was paid for 5.5 km, and the map drew a long detour. (2) "Arriving in 41:57" while the rider was 3 minutes away; the kitchen had set 15 minutes. (3) The kitchen ticket printed from the Partner website came out tiny, and the Epson kept feeding a whole length of paper. |
| **What changes** | (1) Google is asked for the **motorbike** route **and its shortest-distance alternative**, and the shortest is used for the fee, the rider's pay, the time and the map line — one route for all four. (2) The customer sees **no time** until the kitchen accepts, then **cooking time + the bike ride time**, nothing added. The number stays still and fades gently when it changes (no ticking seconds); once the rider has the food it shows the rider's real remaining minutes; past the promise it shows **"+N min" in red**, growing. (3) The ticket prints like the restaurant's own bill: monospace, big and bold, exactly as long as the order, so the printer stops and cuts. |
| **Cost** | Google bills the motorbike route at its higher rate: about ₹0.85 per route instead of ₹0.40; each order measures 1–3 routes and repeats are cached for 6 hours. Overpaying one rider by 4 km costs ₹48 — the fix pays for itself on the first wrong order. |
| **Not changed** | Live tracking (positions, the moving bike, trail, re-centre) is untouched apart from the route line it draws. Orders already placed keep the fee and pay they were priced with. Money rates, the 2-minute cancel window, the 10-minute rider call all stay. |
| **Only you** | One printer setting on the restaurant PC, once (Section C4). |

---

## A. The route: shortest Google route for fee, pay, time and map

**Evidence:** screenshot 1 (full-screen map): the drawn route leaves the kitchen west, goes north to Hosakote and back
south to the home; "5.5 km from you by road". The owner rode it in about 1 km.

**Root cause** (`apps/backend-api/src/modules/places/routingService.ts`):
- `callGoogleRoute`, `callGoogleMatrix` and `roadPath` ask Google's Routes API with `travelMode: 'DRIVE'` and take
  `routes[0]` — the **fastest car** route. For cars Google prefers the highway; a motorbike goes through town.
- `roadDistance` (checkout, quote, pickup pay) and `roadPath` (the map line) are separate calls, so even the line and
  the paid distance could disagree.
- Every money figure reads this distance: the bill's frozen `riderPay` (`riderPayFor(distanceKm)`), the delivery fee
  (rider pay + markup), cash-on-delivery limit, the delivery radius check, pickup pay (`modules/riders/tripPayout.ts`).

**Fix — `callGoogleRoute` + `shortestRoute(routes, from, to)` (same file):**
1. `POST https://routes.googleapis.com/directions/v2:computeRoutes` with `travelMode: 'TWO_WHEELER'`,
   `routingPreference: 'TRAFFIC_UNAWARE'`, `requestedReferenceRoutes: ['SHORTER_DISTANCE']`, field mask
   `routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.routeLabels`. Google returns its default
   (fastest) motorbike route **and** the shorter-distance route; we keep the **shortest by distance**.
2. If the motorbike request returns no route (coverage), the same request with `DRIVE`; if Google is unavailable, the
   existing straight-line × road-factor estimate (unchanged).
3. Distance, duration **and** polyline are cached together (key `route|<from>|<to>`, same 6 h cache), so the fee, the
   pay, the time and the map line come from the same route.
4. `roadDistance` (single pair) uses it; the matrix (restaurant list distances, radius) asks Google for `TWO_WHEELER`
   too; `roadPath` (map line, re-draw when the rider turns off it) returns the same route's polyline.
5. Sanity: a road can never be shorter than the straight line; a Google distance below 90 % of it is discarded
   (bad data) and the next answer/estimate is used.

**Pay:** unchanged rules (₹12/km sliding to ₹8, min ₹30; pickup pay over 7 km at ₹6/km); they now multiply the shortest
real route. Check: a Google reply with a 9.8 km default and a 6.1 km shorter route prices 6.1 km, with the 6.1 km
route's own time and line.

## B. The arrival time: honest, still, red when late

**Evidence:** screenshot 2: "ARRIVING IN 41:57" while the map says "817 m away · 3 min"; the kitchen had set 15 min.

**Root cause** (`modules/orders/eta.ts`, `customer-mobile/src/screens/OrderTrackingScreen.tsx`):
- The promise at acceptance = cook 15 + `travelMinutes(5.5 km)` = 5.5 km ÷ 18 km/h (18 min) + a fixed 6-minute
  handling allowance → ~40 min. The wrong distance (A) and the extra 6 minutes inflated it.
- The screen counted down to that promise every second, even after pickup, instead of the rider's live minutes.

**Fix (owner's rules, 21 Oct):**
1. No time before the kitchen accepts ("Waiting for the restaurant to accept") — as today.
2. At acceptance the promise = the kitchen's own cooking time + **the bike ride time of the shortest route** (Google's
   duration from A, frozen at checkout as `order.routeMinutes`; without Google, km ÷ speed). **No handling minutes.**
3. On screen: whole minutes (re-checked every 15 s; every second only while the 2-minute cancel countdown shows), the
   number **fading in** when it changes — no ticking seconds.
   Before pickup: minutes left to the promise. Once the rider has the food: the rider's live minutes (as the map's
   "3 min"). Past the promise: **"+N min" in red**, growing each minute (the label says "Running late").
4. The restaurant-card estimate before ordering uses the same rule (cook + ride, no handling).
5. The one wait that is real stays: food ready but the rider not there yet — the wait is the rider's ride to the kitchen
   (or the short handling allowance, whichever is longer), then the ride.

## C. The kitchen ticket: prints like the restaurant's own bill

**Evidence:** photo 3 (their POS bill): 80 mm, monospace, bold header, dashed rules, item/qty columns, cut right after
the content. Photo 4 (ours): tiny text, and the printer fed a long blank length.

**Root cause:** the Partner website opened the ticket **PDF** in a new tab and the browser's PDF viewer printed it on the
printer's default page (often A4 or "Roll paper 80 × 297 mm") with "fit to page": the 80 mm page shrank and the paper fed
to the end of that default page. The PDF itself also used small sizes (body 10 pt).

**Fix:**
1. One ticket layout (`modules/orders/kitchenTicket.ts`) drawn two ways: the PDF (the phone app, page exactly as tall as
   the ticket) and **HTML** (`GET /api/orders/:id/kitchen-ticket?format=html`).
2. HTML: Courier New bold, kitchen name 15 pt, order number 26 pt, dishes 14 pt bold as "2 x Chicken Dum Biryani"
   (quantity first, the way kitchens read a KOT), options indented "+ Large", body 12 pt, dashed rules, pickup code
   22 pt, `@page { size: 80mm <exact height>mm; margin: 0 }` (58 mm: smaller sizes). The server wraps the lines and fixes
   each line's height, so the page height is exact; a sample order measures 119 mm of content on a 122 mm page.
   The phone PDF uses the same lines and sizes (Helvetica).
3. The Partner website prints it **from the page** (a hidden frame and the browser's Print), not through the PDF viewer:
   no new tab, no "fit to page", the page is the ticket's own size, so the printer stops and cuts after it.
4. **One-time printer setting (owner, on the restaurant PC):** in the print window choose the Epson, **Margins: None**,
   **Scale: Default/100 %**; the browser remembers it. If an Epson driver still feeds extra paper: Windows → Printers →
   EPSON TM → Printing preferences → set "Paper size: Roll Paper 80 × 297 mm" with **"Reduce blank area / Paper saving:
   Bottom margin"** (APD driver) and "Cut: at end of document".
5. Still **no prices** on the kitchen ticket (owner decision B10, 18 Oct): it is the kitchen's order slip, not the
   customer's bill.

## What does not change (and why it is safe)

- **Live tracking:** the rider's fixes, sockets, moving bike, trail and re-centre are untouched; only the polyline source
  changes (same `routePolyline` field, now the shortest route).
- **Orders already placed:** their `distanceKm`, `bill.riderPay` and promise are frozen; only new quotes/checkouts use A.
- **Phone app ticket:** still a PDF through Android's print screen, with the new layout.

## Checks (in the gate, `node scripts/run-backend-tests.mjs`)

- `routing`: a simulated Google reply (default 9.8 km + shorter 6.1 km) → 6.1 km, its 18 min and its line; motorbike
  "no route" → car request; a route shorter than the straight line discarded. Mutated (take `routes[0]`): fails.
- `honestEta`: promise = cook + Google ride minutes, nothing added (the owner's case: 15 + 4 = 19 min); late minutes.
  Mutated (old formula with handling): fails.
- `kitchenTicket` (new checks): HTML on request, never cached; `@page` 80 mm × the computed height, growing with the
  items; Courier bold, 14 pt dishes, 26 pt number; the same lines as the PDF; no price, phone, address, payment or
  delivery code; long names wrap. Mutated (page height 297 mm; a total printed): fails.
- By hand: the Partner website on the private QA server printed a real accepted order through the hidden frame (the
  site's security policy allows it; bold monospace measured; no line overflows the roll).

## Tracker

| # | Item | Status |
|---|---|---|
| A | Shortest motorbike route for fee, pay, time and map | ✅ 21 Oct |
| B | Honest arrival time; still, fades, red when late | ✅ 21 Oct |
| C | Kitchen ticket prints like a POS bill and stops | ✅ 21 Oct |
| — | APK + AAB for the owner's test | see CHANGELOG |
