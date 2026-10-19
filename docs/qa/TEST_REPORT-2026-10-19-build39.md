# Test report: build 39, round 2 (19 Oct 2026)

**Tester session, 19 Oct 2026, evening.** Release APKs from `build/apk/` (all four `1.4.0-20261019.39`, commit
`6f01b8f`) on the emulator `qb34` (Android 14), driven with adb and mobile-mcp. A fresh private QA server on port 7071
(seeded accounts, fixed code 123456, no Google, Firebase or RazorpayX keys; the Razorpay **test** keys from `.env`).
Websites `/partner` and `/admin` rebuilt with `scripts/build-web.mjs` and opened in the built-in browser. Nothing touched
the live server or the owner's phone. No app or server code was changed.

Screenshots: `D:/dev-data/temp/tester/` (not in the repo; `v*` Customer, `x*` Partner, `y*` Rider, `w*` Operations).
"API" in a row means the step was driven through the same route the app calls, so money, refunds and cancellations could
be repeated many times; every UI step says so.

## Summary

- **The main journey works across all four apps.** Operations created a kitchen with a password, approved its FSSAI and
  PAN, set its map location from a Google Maps link; the kitchen requested a dish with sizes, Operations approved it, the
  kitchen went online; the customer ordered with the new − count + stepper; the kitchen got the ringing alert, accepted,
  printed a 58 mm ticket; the rider got a one-rider offer (₹30, 910 m, 108 s), accepted, chatted with the customer, picked
  up with code 2317, delivered with the customer's code 4216, and took ₹263 cash. The customer's map and the tracking API
  followed the rider live.
- **Money adds up on every bill I checked by hand (5 orders, figures below), and Finance, the dashboard and the invoices
  now show one "ours" (₹117.03).** But that "ours" is still wrong: **GST on our commission is booked on every new order
  although there is no GSTIN** (R2-2, T-4 not fixed). On one order that is ₹27.
- **One blocking defect:** when Operations cancels an order after pickup, the rider is stuck on the cancelled trip for
  good: the app shows "Delivery in progress", he can take no new trip, gets no offers, and neither app nor Operations can
  free him (R2-1).
- **Stage H:** help chat (typed questions, topics, talk to a person, staff reply appears in the same chat, both keep
  writing) works in all three apps; the rider "Set up your phone" card works and the GPS chip is right at once; the
  stepper works; Forgot password works in Partner (and Rider by the same route) but **Operations still shows the old
  "Locked out?" text** (R2-9); the Pure Veg warning with "Give anyway" works; kitchen Location works from a full Maps link.
- **Notifications:** the Partner new-order alert is shown while the app is open, but **tapping it opens Home, not the
  order**, and it is filed under the silent fallback channel, not "New orders" (R2-4, R2-5). The Customer app never asks
  for notification permission on Android 14 (R2-19). Everything sent by FCM (most notifications) can only be checked as
  server log lines on QA, which has no Firebase.
- **Crashes:** the Rider app crashed twice on relaunch after being killed mid-trip (expo-location background task), then
  opened fine and resumed the trip (R2-3). No other crash, native crash or ANR.
- **Old findings:** 11 of the 19 are fixed; T-4 and T-16 are partly fixed; the rest are seed data or were not retested
  (table below).

## Customer app (`in.quickbites.app`)

| Feature | Steps | Expected | Actual | Result | Screenshot |
|---|---|---|---|---|---|
| Sign in by code | Phone + email, 123456 | Home | Home | PASS | v03 |
| Notification permission | Sign in, relaunch | Android asks once | Never asked; `POST_NOTIFICATIONS` stays false | FAIL R2-19 | — |
| Dish with sizes | ADD → Full | Size sheet, required | Half ₹70 / Full ₹110 | PASS | v06 |
| − count + stepper (H4) | Add, then +, then − | Stepper on the card; + asks the size; − removes one | Yes; − removed the last-added (Half); cart kept Full ₹110 | PASS | v08–v12 |
| No bounce on cart bar | Add twice | Calm | No bounce seen | PASS | v07, v10 |
| Long kitchen name | Open "Sri Annapoorna Meals and Tiffin Centre Harohalli Branch" | Wraps | Wraps on 3 lines, ticket in capitals | PASS | v05 |
| New kitchen card | Home feed | Veg dish only, no type set | Card says "Non-Veg"; "₹400 for two" default | FAIL R2-14 | v04 |
| Place cash order | Place Order | Code shown | QB-618416 / QB-133824 | PASS | v13 |
| Active-order strip | Home while order is out | Strip "On its way to you" | Missing until the app was restarted | FAIL R2-18 | v16, v18 |
| Live tracking | Rider moves 12.6872 → 12.6880 | Map and API follow | API position updated, not stale; map shows bike, home, line | PASS | v19, v20 |
| Cash up to 15 km | Quotes at 10.14 / 16.64 / 41 km, COD with spoofed `distanceKm: 1` (API) | Cash ok / refused / out of range | Exactly that (`COD_TOO_FAR`, `OUT_OF_DELIVERY_RANGE`) | PASS | — |
| Edit profile keyboard (T-6) | Edit → Change email | Sheet above keyboard | Yes | PASS | v21 |
| Help: typed question (H1) | "where is my refund" | Refund topic | Matched "My order is late" | FAIL R2-6 | v26 |
| Help: Refund status | Topic, customer has 3 refund cases | Their status | "You have no refund requests" | FAIL R2-6 | — |
| Help: call care | "Call customer care" | Dialer | Dialer with +91 78994 15741 | PASS | v24 |
| Network drop | Wi-Fi + data off, open app, back on | "You are offline", retry | "No saved addresses yet", empty feed; pull-to-refresh restores the feed, header stays "Set your location" | FAIL R2-8 | v28–v30 |
| Rotation | Turn to landscape | — | Portrait only (locked) | INFO | — |
| Cancel before / after accept / while cooking (API) | Cancellation quote + cancel | Policy | Free in all three (cancel fees are 0 % on QA); customer and kitchen notified | PASS (policy note) | — |
| Cancel after pickup (API) | Cancel | Refused | `CUSTOMER_CANNOT_CANCEL_NOW` | PASS | — |
| Refund request (API) | 3 cases: missing item ₹200, quality (full), wrong item ₹50 | Reach Operations | All three listed; 3 staff pushed | PASS | — |

## Partner app (`com.quickbite.partner`)

| Feature | Steps | Expected | Actual | Result | Screenshot |
|---|---|---|---|---|---|
| Forgot password (H5) | Email → code from log → new password → sign in | Works | "Password changed", sign-in with new password (Enter submits) | PASS | x02–x05 |
| Notification permission | First sign-in | Asked | Asked | PASS | x05 |
| Header after approval | Operations approves both documents | Header updates | Still "Awaiting verification · Locked" until app restart | FAIL R2-12 | x07, x18 |
| Request a dish with sizes | Name, section, Half 70 / Full 110, Veg | Sent | "Awaiting approval"; price list shows "Rs 70.00" | PASS (Rs: R2-16) | x16 |
| Size validation | Bad price, tap Send | Error near the button | Error shown far above; button looks dead | FAIL R2-17 | x12, x13 |
| Menu buttons (T-5) | Menu tab | Padded | Padded, two lines | PASS | x07 |
| New order alert | Order placed while app open | Banner + ring | Banner "New order QB-133824 · ₹220"; ring started (media player) | PASS | x20 |
| Tap the alert | Tap banner / shade | Opens the order | Opens Home | FAIL R2-4 | x23 |
| Alert channel | `dumpsys notification` | "New orders" channel, own sound | Fallback "Miscellaneous" channel | FAIL R2-5 | — |
| Accept, 20 min | Accept → Confirm | Promised in 20 min | Yes, pickup 2317 | PASS | x26 |
| Kitchen ticket 58 mm | Print | Dishes, size, code, no prices | Yes | PASS | x27 |
| Ready → waiting for rider | Start preparing → Ready | Waiting for a rider | Yes, then "Handed to Vikram" | PASS | x28 |
| Help: topic (H1) | Help → Payouts | Live answer | "₹184.80 owed, ₹184.80 of it can be sent now. We have no verified bank or UPI account" | PASS, wording R2-21 | x33 |
| Statement (API) | One day 19→19 Oct | 2 orders | 0 orders; 19→20 Oct shows 2 | FAIL R2-15 | — |
| Receipts ZIP (API) | Period | Receipts only | 2 receipts; `invoices.zip` returns the same receipts | PASS | — |
| Payout received (API + site) | Operations pays | Push + history | "You have been paid ₹738.66 … ending 9012" | PASS | — |
| Two kitchens, one owner (API) | Partner adds one bank account | Both kitchens payable | Only Bangalore Biryani; Udupi stays "NO_ACCOUNT" | QUESTION R2-22 | — |

## Rider app (`in.quickbite.rider`)

| Feature | Steps | Expected | Actual | Result | Screenshot |
|---|---|---|---|---|---|
| Sign in | rider@ | Home | Home | PASS | y03 |
| Set up your phone (H3) | Deny notifications twice, then Allow each item | Each Allow works; card hides when done | Location, camera prompts; a permanently refused one opens Settings; battery opens the battery list; card hides | PASS | y06–y14 |
| GPS chip (T-11) | Go online | Correct at once | "GPS on · sending your location" at 1 s | PASS | y16 |
| Offer, one rider, 108 s | Kitchen marks ready | Offer with countdown | "90 s to respond" ~18 s after ready; ₹30, 910 m | PASS | y18 |
| Offer while app is in background | Ready with rider app hidden | Alert | No alert (needs FCM; QA has none) | NOT TESTABLE | — |
| In-trip chat | Message the customer | Sent | Sent; keyboard covers the box while typing | FAIL R2-11 | y23–y26 |
| Kill mid-trip, reopen | Force stop, launch | Resumes | **Crashed twice** (`LocationTaskConsumer` NPE), third launch resumed the trip | FAIL R2-3 | y20, y21 |
| Pickup / delivery codes | 2317, 4216 | Accepted | Yes; "Collect ₹263.00" | PASS | y28–y32 |
| Collect online at the door | Show UPI code | QR | "That QR code could not be created. Take cash" (Razorpay QR API 404 with test keys) | NOT TESTABLE | y31 |
| Delivery complete | — | Pay + cash | "Rs 30.00 earned… Cash collected: Rs 263.00" | PASS (Rs: R2-16) | y32 |
| Help: typed + person (H1) | "how much cash do I have to deposit", Talk to a person, write, staff replies, write again | Live answer, same chat | "You are carrying ₹263.00"; staff reply appeared within ~6 s of reopening; "Thanks" reached Operations | PASS | y36–y40 |
| Decline (API) | Pass | Recorded, not re-offered | `declinedByRiderIds` set | PASS | — |
| Release a claimed trip (API) | Cancel before pickup | Back to the pool | `READY_FOR_PICKUP`, `UNASSIGNED`; no pay | PASS | — |
| Stuck after Operations cancel | Ops cancels after pickup | Trip ends | Stuck for good | FAIL R2-1 | y33 |
| Cash deposit (API) | Declare ₹1,959.60, staff counts ₹1,950 | Variance kept | `VARIANCE`, ₹9.60 still in hand, payout blocked until deposited | PASS | — |

## Operations app (`com.quickbite.admin`) and websites

| Feature | Steps | Expected | Actual | Result | Screenshot |
|---|---|---|---|---|---|
| Forgot password (H5) | Sign-in → Forgot password? | Email-code flow | "Locked out? … change ADMIN_PASSWORD and redeploy" | FAIL R2-9 | w02 |
| Create with password (H6) | Create a restaurant with password | They can sign in | Sign-in works; dialog says "They got an email to set their own password" | PASS, text R2-10 | w09 |
| Restaurant search | Type "Annapoorna" | Filters | Filters only on Enter (by design) | INFO | w11 |
| Documents approve | PAN, then FSSAI | Verified and trading | "Approved — still not verified (FSSAI)", then "verified and now trading" | PASS | w16, w18 |
| Kitchen Location (H6) | Address search | Suggestions or a message | Nothing at all (no Google on QA, and no "not found" text) | FAIL R2-13 | w23 |
| | Paste `maps.app.goo.gl` share link | Pin or a reason | "No location yet…" (short links not read) | FAIL R2-13 | w24 |
| | Paste full Maps link → Save | Pin, list distance | 12.68350, 77.47720; customer list 0.39 km (was blank); no "Saved" message | PASS | w25, w26 |
| New kitchen default point | After Create | Harohalli or "not set" | 12.97160, 77.59460 (central Bengaluru, ~40 km) | FAIL R2-13 | w22 |
| Pure Veg seal on meat (T-3) | Switch on | Warning, Give anyway | Lists Chicken and Mutton Biryani; Cancel keeps it off; Give anyway sets it | PASS | w30, w31 |
| Approve a dish | Catalogue → Menu requests → Approve | Live | "1 approved"; partner sees "Now on your menu" | PASS | w34, w35 |
| Support reply (H1) | Help → Support → reply | Reaches rider | Reached the rider chat | PASS | w38 |
| Reassign rider (API) | Ops moves a trip to rider 2 | New rider told and paid | "Support gave you a trip"; delivered; rider 2 paid ₹30 | PASS | — |
| Refunds (API) | Approve ₹150 + refund by hand; full ₹426.60; reject; refund twice | Right money, right messages | Amounts right, second refund `ALREADY_REFUNDED`; reject sends nothing; hand refund push says "Open the link" | FAIL R2-7 | — |
| Payouts (API) | Hand pay, pay again, RazorpayX, ₹100 minimum, cash blocks | — | See "Paying people" | PASS (RazorpayX not testable) | — |
| One "ours" | Dashboard, /admin/revenue, invoices | Same | ₹117.03 everywhere (₹92 after the full refund) | PASS, but see R2-2 | — |
| `/partner` website | Signed-in dashboard, Money | Same as app | Same figures, ₹ | PASS | — |
| `/admin` website | Dashboard | Loads | Loads; the built-in browser would not draw screenshots this round, text read only | PASS | — |

## The money, by hand

Rates on QA: commission 15 %, TDS 1 %, TCS 1 %, food GST 5 %, platform fee ₹5, delivery markup 0 %, Gold customer
(10 % off delivery), rider ₹12/km to 4 km sliding to ₹8/km at 35 km, minimum ₹30.

| Order | Inputs | Expected bill | Actual | Kitchen | Rider | "Ours" expected (no GSTIN) | Invoice "ours" |
|---|---|---|---|---|---|---|---|
| QB-447786 (M1) | 2 × Chicken Biryani Large (+₹150) + Raita (+₹30) = 2 × ₹500; pack ₹25; 0.39 km; WELCOME50; tip ₹20 | 1000 + 50 GST + 25 + 27 (30 − 3 Gold) + 5 − 100 + 20 = **₹1,027** | ₹1,027 | 1000 + 25 − 150 − 10 = **₹865** ✓ | 30 + 20 tip = ₹50 ✓ | 1027 − 865 − 50 − 50 GST − 10 TDS − 10 TCS = **₹42.00** | ₹15.00 (₹27 "GST on commission") ✗ |
| QB-868196 (M2) | Paneer Biryani ₹280; pack ₹25; **10.14 km** | rider 10.14 × (12 − 6.14/31 × 4 = ₹11.21) = ₹113.65 → ₹114; delivery 114 − 11.4 = 102.6; total 280 + 14 + 25 + 102.6 + 5 = **₹426.60** | ₹426.60 | 280 + 25 − 42 − 2.8 = **₹260.20** ✓ | ₹114 ✓ | **₹32.80** | ₹25.24 ✗ |
| QB-203286 (M3) | 3 × Ghee Podi Idli ₹95; pack ₹15; 0.26 km; tip ₹10 | 285 + 14.25 + 15 + 27 + 5 + 10 = **₹356.25** | ₹356.25 | 285 + 15 − 42.75 − 2.85 = **₹254.40** ✓ | 30 + 10 = ₹40 ✓ | **₹41.90** | ₹34.20 ✗ |
| QB-133824 | 2 × Dosa Full ₹110; 0.91 km | 220 + 11 + 0 + 27 + 5 = **₹263** | ₹263 | **₹184.80** ✓ | ₹30 ✓ | **₹32.80** | ₹26.86 ✗ |
| Quote 16.64 km | Mutton Biryani | rider 16.64 × ₹10.37 = ₹172.5 → ₹173; cash refused | ₹173, cash refused | — | — | — | — |

Every invoice adds up to what the customer paid; the error is only which line the money sits on.

**Refund effect on the kitchen:** M1 refund ₹150 (missing item) charged the kitchen 150 × 865 / 1027 = ₹126.34; M2 full
refund ₹426.60 charged its whole ₹260.20. Kitchen dues 1,125.20 − 386.54 = **₹738.66**, which is what was paid. The rider
keeps trip pay and tips on refunded orders.

**Paying people (API):** hand payout ₹738.66 with UTR → PAID, push to partner; the same kitchen again → `NOTHING_PAYABLE`;
RazorpayX → `RAIL_UNAVAILABLE` (not configured), the payout sat at APPROVED and hid the kitchen from "dues" until cancelled
(then hand-paid fine); rider ₹30 → `BELOW_MINIMUM` ("carries to the next run"); rider holding cash → blocked
`CASH_IN_HAND`; after deposits rider 2 paid ₹234 (= 30 + 30 + 20 tip + 114 + 30 + 10 tip, tips 100 % to the rider), second
attempt refused.

**Cancellations (API, push lines from the server log):**

| Case | Who is told | Refund / fee | Kitchen earns | Rider pay |
|---|---|---|---|---|
| Customer, before accept | customer, kitchen | free | 0 | 0 |
| Customer, after accept | customer, kitchen | free (fee 0 % on QA) | 0 | 0 |
| Customer, while cooking | customer, kitchen | free | **0 for food already cooking** (policy question) | 0 |
| Kitchen rejects / cancels after accept | customer, kitchen | free | 0 | 0 |
| Rider passes | — | — | — | 0; not offered again |
| Rider releases before pickup | nobody pushed | — | — | 0; back in the pool |
| Customer, after pickup | — | refused | — | — |
| Operations, after pickup | customer, kitchen; **rider not told** | free | 0 | **0 for a rider who collected the food**; rider stuck (R2-1) |
| Operations reassigns | new rider "Support gave you a trip" | — | normal | new rider paid |

## Old findings (build 36 report)

| # | Now |
|---|---|
| T-1 | Seed data, not code (jury J-C1); a real kitchen with approved papers kept trading in this round |
| T-2 | Fixed: 5-digit FSSAI, 13-character FSSAI, short PAN, short GSTIN refused |
| T-3 | Fixed: warning lists the non-veg dishes, Give anyway |
| T-4 | **Partly:** one "ours" everywhere; **GST on commission still booked** (R2-2); dashboard says "Earned by restaurants" |
| T-5 | Fixed |
| T-6 | Fixed in Edit profile; same problem in the rider in-trip chat (R2-11) |
| T-7 | Fixed: create reply and order list no longer carry `pickupCode` |
| T-8 | Fixed: blocked customer gets `ACCOUNT_BLOCKED`, no token |
| T-9 | Fixed: "Wrong email or password, or this is not a Partner account." |
| T-10 | Not retested (address picker not reopened) |
| T-11 | Fixed |
| T-12 | Not retested at the door |
| T-13 | Fixed in the rider and partner help chats (own messages shown) |
| T-14 | Not retested |
| T-15 | Fixed: "mutton" finds only Mutton Biryani |
| T-16 | **Partly:** ₹ on most screens; "Rs" remains (R2-16) |
| T-17 | Fixed in the Partner app (Enter signs in); website not retested |
| T-18 | Seed data, unchanged |
| T-19 | Build number is 39 as briefed |

## Bugs

**R2-1 · High · A rider is stuck for good on an order Operations cancelled after pickup.**
Steps: order → ready → rider claims → pickup code → Operations cancels the order (reason "QA ops cancel after pickup").
Expected: the trip ends for the rider, he is told, and he can take new trips. Actual: the order is CANCELLED but its
`riderStage` stays `PICKED_UP`; the Rider app shows "Delivery in progress #QB-344505"; claiming any trip answers
`RIDER_ALREADY_ON_TRIP`; dispatch never offers him anything; going offline/online, `unassign-rider`
(`ORDER_ALREADY_CLOSED`) and the rider release (`ORDER_CANCELLED`) cannot free him. No push to the rider. Suspected:
`apps/backend-api/src/modules/orders/riderTrip.ts:41` (`hasActiveTrip` checks only the stage, not the order status) and
`modules/orders/orderService.ts:1024` (`cancelOrder` never clears `riderStage`); the same `hasActiveTrip` gates claims
(`routes/riderRouter.ts:887`) and dispatch (`modules/orders/tripOffers.ts:102`).

**R2-2 · High (money and tax) · GST on our commission is booked on every new order, with no GSTIN.**
Steps: deliver any order, open its invoice. Expected (CHANGELOG, Stage H): no GST on commission without a GSTIN; "ours"
on QB-447786 = ₹42.00. Actual: "GST on commission ₹27.00", "Quick Bites keeps ₹15.00"; the ₹27 goes to
`TAX_GST_PAYABLE`. Same on all four orders checked (₹5.94, ₹7.56, ₹7.70). Cause: no bill carries `platformFeeGstPercent`
(checked on every new order), so `apps/backend-api/src/modules/payments/earnings.ts:93` treats every bill as "GSTIN at
checkout". The rate is passed into pricing (`modules/orders/orderService.ts:501`, `:770`) but not kept on the bill.

**R2-3 · Medium · Rider app crashes on relaunch after being killed mid-trip.**
Steps: rider on a trip, `am force-stop`, launch. Actual: two crashes at 21:41:49–50, `java.lang.NullPointerException` in
`expo.modules.location.taskConsumers.LocationTaskConsumer.executeTaskWithLocationBundles` from `TaskJobService`; the next
launch worked and resumed the trip. Suspected: the background location task firing before the JS task is registered
(`apps/delivery-mobile/src/lib/shiftService.ts:37`, defined from `App.tsx`, not from `index.ts` before
`registerRootComponent`).

**R2-4 · Medium · Tapping the Partner "New order" notification opens Home, not the order.**
Steps: Partner app open, customer orders, tap the banner or the shade entry. Expected (H2): the order. Actual: Home.
Suspected: `apps/restaurant-mobile/src/lib/orderAlert.ts:154` schedules the notification without `data` (no order id),
so `useNotificationTaps` (`src/lib/notificationTaps.ts`) has nothing to route. Same pattern in
`apps/delivery-mobile/src/lib/orderAlert.ts:140` (not tapped this round).

**R2-5 · Medium · The order alerts land in the silent fallback channel and ring on the media volume.**
`dumpsys notification` shows the Partner "New order" under `expo_notifications_fallback_notification_channel`, not
`kitchen-orders` (which exists with `new_order` sound, importance 5). The in-app ring is an `expo-av` player with
`USAGE_MEDIA`: a kitchen phone with media volume at zero hears nothing. Suspected:
`apps/restaurant-mobile/src/lib/orderAlert.ts:163` and `apps/delivery-mobile/src/lib/orderAlert.ts:149` put `channelId`
in `content`; expo-notifications reads the Android channel from the trigger (`trigger: { channelId }`).
(No sound could be heard: the emulator runs with `-no-audio`.)

**R2-6 · Medium · Help chat gives wrong answers to refund questions.**
Customer types "where is my refund" → topic "My order is late" (both score 1; the first in the list wins,
`apps/backend-api/src/modules/support/helpChat.ts:104-115`). Topic "Refund status" for a customer with 3 refund cases
(2 refunded) → "You have no refund requests": it looks only at the latest order (`helpChat.ts:262`).

**R2-7 · Medium · Refund messages.** (a) Rejecting a refund sends the customer nothing (QB-203286: only the 3 staff
"requested" pushes). (b) A rejected case can be approved afterwards with no note. (c) A refund paid by hand
(`manualReference`) pushes "Your refund has been sent… Open the link and enter any UPI id", but there is no link.
Suspected: `apps/backend-api/src/routes/admin/financeRoutes.ts:205` (decision route) and the refund push text in
`modules/payments/refunds.ts`.

**R2-8 · Medium · Customer app offline says "No saved addresses yet".**
Steps: Wi-Fi and data off, open the app. Expected: an offline message and a retry. Actual: "No saved addresses yet.
Choose a point on the map", an empty restaurant list, no offline notice; back online it stays empty until pull-to-refresh,
and the header stays "Set your location" until restart. Suspected: `apps/customer-mobile/src/screens/DiscoveryFeedScreen.tsx`
(address and feed load treat a network failure as "none").

**R2-9 · Medium · Operations "Forgot password?" is not the email-code flow.**
Expected (H5, all sign-in pages): email → code → new password. Actual: "Locked out? Administrator access is set on the
server. Change ADMIN_PASSWORD…". The server already sends staff codes (`PASSWORD_RESET_CODE` for ops@ logged).
Suspected: `apps/admin-mobile/src/screens/LoginScreen.tsx:121-131`.

**R2-10 · Low · Create with a password: wrong confirmation.** Dialog "They got an email to set their own password" though
a password was set (the server's message says so correctly). Suspected: `apps/admin-mobile/src/components/AccountTools.tsx:56`
reads `result?.message`, but the api client returns only `payload.data` (CLAUDE.md §8 "Check what the app reads").

**R2-11 · Low · Rider in-trip chat: the keyboard covers the message box.** Suspected:
`apps/delivery-mobile/src/components/TripChat.tsx` (same fix as T-6).

**R2-12 · Low · Partner header stays "Awaiting verification · Locked" after the kitchen is approved,** through a
pull-to-refresh; only a restart shows "Closed · Offline". Suspected: the kitchen status is read once at sign-in in the
Partner app.

**R2-13 · Low · Kitchen Location rough edges.** A kitchen created by Operations starts at 12.97160, 77.59460 (central
Bengaluru) and is listed with no distance until someone sets the location; address search with no result (or no Google)
shows nothing; a phone "Share" link (`maps.app.goo.gl/…`) is refused with "No location yet" and no reason; Save gives no
confirmation. Suspected: `apps/admin-mobile/src/components/KitchenLocation.tsx:38-70` and the default point on Create.

**R2-14 · Low · New kitchen card says "Non-Veg"** although its only dish is veg and no kitchen type is set; "₹400 for two"
is a default nobody entered.

**R2-15 · Low · One-day statement is empty.** `/api/earnings/statement?from=2026-10-19&to=2026-10-19` → 0 orders;
`to=2026-10-20` → 2 orders. The `to` day is excluded. Suspected: `apps/backend-api/src/routes/earningsRouter.ts:65`.

**R2-16 · Low · "Rs" still shown:** Partner order cards ("Rs 220.00") and "Awaiting approval Rs 70.00"; Rider delivery
complete ("Rs 30.00 earned… Rs 263.00"); help answers ("Rs 263.00", "Rs 184.80"); refund and payout pushes; invoice and
receipt PDFs.

**R2-17 · Low · Partner dish request: validation error far from the button.** "Every size needs a name and a price above
zero" appears at the sizes, off screen; tapping "Send for approval" seems to do nothing.

**R2-18 · Low · Customer Home: the active-order strip appears only after a restart.** `useActiveOrders` refreshes on
mount only (`apps/customer-mobile/src/lib/useActiveOrders.ts`).

**R2-19 · Low · Customer app never asks for notification permission on Android 14.** Partner, Rider and Operations asked;
Customer stayed `granted=false` after sign-in and relaunch. Suspected: `apps/customer-mobile/src/lib/pushRegistration.ts:31-44`
asks before creating any notification channel (Android 13+ shows the prompt only once a channel exists).

**R2-20 · Low · A delivered order fully refunded counts as "cancelled"** on the Partner dashboard ("25 % of finished orders
were delivered rather than cancelled").

**R2-21 · Low · Partner help "Payouts" answer contradicts itself:** "₹184.80 of it can be sent now. We have no verified
bank or UPI account to pay into yet."

**R2-22 · Question · One owner, two kitchens:** the bank account partner@ added pays Bangalore Biryani House only; Udupi
Sri Krishna Bhavan (same owner) stays "NO_ACCOUNT". Fine if accounts are per kitchen; the Partner app should then say so.

Seen once, not reproduced: the new kitchen switched itself to Offline while I opened More → Help (22:26:59); turning it
back on and repeating did not happen again.

## Cases with no fix available today (and why)

- **Notifications while an app is closed** (rider offers, customer order updates, staff alerts, payout and refund pushes):
  they travel by Firebase, which the QA server does not have. Checked only as `FCM_PUSH_DISPATCHED … LOG_ONLY` lines.
  A phone round against a server with Firebase is the only test.
- **RazorpayX payouts:** not configured on QA (`RAIL_UNAVAILABLE`); only hand payouts can be tested.
- **Online payment and the door UPI QR:** the Razorpay checkout crashes the emulator, and the QR API answers 404 with
  test keys; cash only.
- **Background GPS with the screen off** and battery behaviour: emulator only feeds fixes while running; needs a phone.
- **Sound:** the emulator runs with `-no-audio`; the ring was confirmed only as an audio player starting.
- **Address search and road lines:** need the Google server key.
- **Session expiry (7 days):** cannot be shortened without changing server code; blocked and deleted accounts were tested
  through the API.
- **Rotation:** all four apps are portrait-only by design.
- **Small screens:** only one emulator size (1080 × 2340) was available.
- **iPhone app.**

VERDICT: ISSUES FOUND
