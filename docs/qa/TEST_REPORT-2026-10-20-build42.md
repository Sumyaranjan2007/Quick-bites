# Test report: build 42, round 3 (20 Oct 2026)

**Tester session, 20 Oct 2026, 08:30–09:45 IST.** Release APKs from `build/apk/` (all four `1.4.0-20261020.42`,
versionCode 42, release-signed, commit `e8fc9b5`) installed **as updates** over build 39 on the emulator `qb34`
(Android 14), driven with adb and mobile-mcp. A fresh private QA server on port 7071 from `e8fc9b5` (seeded accounts, fixed
code 123456, no Google, Firebase or RazorpayX keys, `ORDER_SWEEP_INTERVAL_SECONDS=5`). Websites `/partner` and `/admin`
(built by the builder at 07:39) in the built-in browser. Checklist: [`ROUND3_TEST_PLAN.md`](ROUND3_TEST_PLAN.md). No app or
server code was changed.

Screenshots and logs: `D:/dev-data/temp/tester/r3/` (not in the repo; `v*` Customer, `x*` Partner, `y*` Rider, `w*`
Operations; `*.txt`/`*.json` are API runs, `inv-*.pdf` invoices, `y44-crash.txt` and `y55-crash-loop.txt` the crash stacks).
"API" means the step was driven through the same route the app calls.

## Summary

- **Real time works.** Every write reaches the accounts it touched and every Operations console within ~5 ms (sockets), and
  no other customer (checked with 7 accounts listening). On screen, with no touch: Partner new order (ring + banner on the
  `kitchen-orders` channel), Partner cancellation dialog, Partner header after approval (R2-12), dish approval, Customer cancel
  button turning into "Ask support to cancel" at 2:00, staff reply in the help chat (1.5 s), order chat both ways, COD switched
  off with the cart open, delivery radius change, Operations dashboard and both websites. Apps recover by themselves after
  going offline (~30 s).
- **Money is right.** Pickup pay matches my hand figures on 4 distances (6.89 km → ₹0, 7.15 km → ₹42.90, 10.01 km → ₹60.06),
  is frozen at claim and at Operations assignment, never touches the customer bill (₹430.90 on all four), comes out of "ours"
  (52.30 → 9.40 → −7.76), and the same rider paid twice gets only the new money each time. Two bills checked line by line.
- **One blocker:** the **Rider app goes into a crash loop** after it is force-stopped while on shift (R3-1, the R2-3 crash,
  now worse): 6 crashes, it never opened again until I cleared the app's storage.
- **Two more High:** the full-screen "Operations has assigned you" card **traps the rider** when Operations moves the trip
  away (R3-2), and a trip offer can arrive **only as a row in Trips**, with no full-screen card, countdown or ring (R3-3).
- **Keyboard (item 4):** OTP boxes opened the keyboard 10 of 10 times and most forms are fine, but the **Customer help chat**
  box is covered (its oversized contact buttons take 40 % of the screen) (R3-4), and two buttons need the keyboard closed
  first (R3-6, R3-22).
- **Save address from a map pick fails** with "Request payload validation failed" on QA (R3-5); from "Use my current location"
  it works.
- Round-2 leftovers: 16 fixed, R2-3 not fixed, R2-13 partly, R2-4 partly, R2-22 not reached.

## Real time (phase A)

| Case | Steps | Result | Evidence |
|---|---|---|---|
| Routing of `sync` (7 sockets) | COD switch, rider block, pricing change, order placed/accepted, address added | Right accounts + Operations only; pricing to everyone; customer B never hears customer A | `a_sync.txt` |
| Partner new order, app open | API order | Card + heads-up "New order QB-416003", channel `kitchen-orders` | x04 |
| Partner hears customer cancel | API cancel | Dialog "Order #QB-416003 cancelled — Stop preparing", list 5→4 | x06 |
| Partner header after approval (R2-12) | Ops approves FSSAI + PAN | "Awaiting verification · Locked" → "Closed · Offline" in 2 s | x13, x14 |
| Partner dish approved, kitchen online | Ops approves | "Recent decisions: Now on your menu", "Online · LIVE" | v64 |
| Customer cancel window | Accept, watch | "Cancel order · 1:46 left" → "Ask support to cancel" at 2:00, no touch | v39–v41 |
| COD off with cart open (A3) | Ops switches COD off | "accepts online payment only", Cash gone in 3 s | v81, v82 |
| Radius 35 → 1 km (A8) | Ops pricing | List shrinks to the 3 kitchens within 1 km, nearest first | v86–v88 |
| Home active-order strip (R2-18) | Order out for delivery | Strip "On its way to you" without restart | v55 |
| Help chat staff reply | Ops replies (API) | In the open chat in 1.5 s | v50 |
| Order chat | Rider ↔ customer | Both ways, instant, ticks, times | y16–y19 |
| Operations dashboard / Help | API order, resolve | Live orders 4→5; ticket moves to Request history | w11, v51 |
| `/partner`, `/admin` websites | API orders | Total 10→11; Live orders 3→4 | browser |
| Offline (R2-8) | Wi-Fi + data off, relaunch | "Can't reach Quick Bites… refreshes by itself", recovers in ~30 s | v83–v85 |

## Order clock, cancel window, dispatch (phase B)

| Case | Expected | Actual | Result |
|---|---|---|---|
| Before accept | No time | "ARRIVING IN —", "Waiting for the kitchen to accept your order"; API `basis: AWAITING_ACCEPT` | PASS (v38) |
| After accept (15 min cook, 1.56 km) | cook + ride, counting | 26:46 at accept+13 s; promise = accept + 27 min (15 cook + 6 handling + ~6 ride) | PASS |
| Cancel at 61 s / 125 s (API) | allowed / refused | 200 / `409 CUSTOMER_CANCEL_WINDOW_OVER`; `cancelUntil` = accept + 120 s | PASS (quote text R3-8) |
| Cancel after window (app) | "Ask support to cancel" → help about this order | Opens Help, but no order card; ticket does carry the order | PARTLY (R3-9) |
| Offer at 10 min left | No offer before | QB-475111 (15 min) entered dispatch at 10:00 left; 10-min-cook orders offered at once | PASS |
| Offer card distances | Both legs + pickup pay | "Pick up from · 1.7 km from you", "Deliver to · 390 m", ₹ | PASS (labels R3-16) |
| Offer delivery to the app | Instant, full screen | 2nd offer reached the app 26 s late (82 of 108 s left); 3rd only in Trips list | FAIL (R3-3) |

**Pickup pay by hand** (kitchen Punjab Grill 12.6748, 77.4698; rider placed due north; no Google so road = straight × 1.3):

| Case | Straight km | Road km expected | Frozen `riderPickupKm` | Pay expected | Frozen `riderPickupPay` | Trip pay total |
|---|---|---|---|---|---|---|
| P1 near | 2.000 | 2.60 | 2.6 | ₹0 | ₹0 | ₹31 |
| P2 just under | 5.300 | 6.89 | 6.89 | ₹0 | ₹0 | ₹31 |
| P3 just over | 5.500 | 7.15 | 7.15 | ₹42.90 (all km) | ₹42.90 | ₹73.90 (offer said ₹74.20, R3-14) |
| P4 far | 7.700 | 10.01 | 10.01 | ₹60.06 | ₹60.06 | ₹91.06 |
| Ops-assigned, near | — | 0.78 | 0.78 | ₹0 | ₹0 | ₹30 (was ₹0 before the fix) |

Customer bill on all four: 360 + 18 GST + 20 pack + 27.90 delivery (31 − 10 % Gold) + 5 = **₹430.90**, identical. Kitchen
360 + 20 − 54 − 3.60 TDS = **₹322.40** each. "Ours" = 430.90 − 322.40 − rider − 18 − 3.60 TDS − 3.60 TCS = **52.30 / 52.30 /
9.40 / −7.76**, matching `/admin/orders/:id/economics` and the invoice PDF (inv-QB-705049.pdf, parts add to ₹430.90).

**Pay the same rider twice** (QA Rider 23, two far trips then a third): cash deposited and confirmed; payout 1 = **₹182.12**
(91.06 × 2) PAID; second draft `NOTHING_PAYABLE`; third trip ₹91.06 refused as below the ₹100 minimum ("carries to the next
run"); `payable + held = outstanding` before each run (`pay2.txt`).

**App bill (Customer UI, QB-475111):** 700 + 35 GST + 25 pack + 30 delivery + 5 platform − 100 WELCOME50 + 15 tip = **₹710** ✓;
rider offer "₹45" = 30 + 15 tip ✓. New kitchen: 90 + 4.50 + 30 + 5 = **₹129.50** ✓.

## Help chat (phase C)

| Case | Result | Evidence |
|---|---|---|
| Chat, topics, "Talk to a person", same thread | PASS | v43–v48 |
| Own message clock → tick, times | PASS | v48 |
| Resolve by staff → Request history (1), fresh chat | PASS | w18, v51–v54 |
| Resolve by user (API) → `RESOLVED`, Ops sees "resolved by USER" | PASS | `c_priv` run |
| Another customer reads / resolves / replies to my ticket | 404 / 404 / 403 | PASS |
| Operations sees who: name, role, phone, earlier requests, the order | PASS (no tap to People record) | w14 |
| "where is my refund" → refund topic; refund status lists the real case (R2-6) | PASS | `h_checks.txt` |
| Layout and keyboard | FAIL (R3-4) | v42, v46 |
| Bot answer about cancelling after the window | FAIL (R3-8) | v44 |

## Trip given by Operations (phase D)

| Case | Result | Evidence |
|---|---|---|
| Card within 2 s, "compulsory", pay ₹30 | PASS | y42 |
| Sound repeats (~1.7 s) until Start | PASS, but on the media stream (R3-12) | `dumpsys audio` |
| Back does not dismiss | PASS | y43 |
| Shown again after app kill, before Start | PASS (after the crash loop was cleared) | y48 |
| "Call Operations" button, rider → restaurant distance | Missing (R3-12) | y42 |
| Ops moves the trip to another rider before Start | FAIL: card stays, Start → "Order not found" (R3-2) | y49–y52 |

## Live tracking (phase E)

| Case | Result | Evidence |
|---|---|---|
| Rider app in front / Home pressed / Settings app in front / screen off | Customer feed got every fix ~3 s apart in all four | `trackc` runs |
| No fix for 2+ min | Customer feed `riderLocationStale: true` after 40 s; Ops alert only at **10 min** (R3-11) | log |
| Customer full-screen map | Bike, home, trail, follows; pan → "Re-centre" → follows again; "320 m away · just now" | v57–v61 |
| Approximate location only | Rider stays online; setup card ticks Location (R3-10) | y40, y41 |
| Re-route when off the line | Not testable (no Google key: straight line) | — |
| Kill mid-trip / on shift, reopen (R2-3) | **Crash loop** (R3-1) | y44–y55 |

## Keyboard and OTP (phase F)

About 35 fields checked with the keyboard open (screenshots in r3/). Fine: Customer phone, email, OTP, name, save-address
fields, tip, coupon; Partner sign-in, dish name/section/price/description; Rider sign-in, trip chat (R2-11 fixed), pickup and
delivery codes; Operations sign-in, forgot password (email, code, new password), create restaurant (all 9 fields), support
reply. **OTP boxes: keyboard opened 10 of 10 taps** on every box after closing it, wrong code error visible above the
keyboard, backspace clears, right code auto-submits, the photo shrinks. Failures: R3-4, R3-6, R3-22; cosmetic R3-19.

## Customer home and cart (phase G)

| Case | Result | Evidence |
|---|---|---|
| Use my current location → Save with own name "Moms place" | Saved once, listed in "Deliver to" | v13–v18 |
| Choose on map → Save | **Fails** (R3-5) | v26, v27 |
| First visit (no address) | Block present but below the fold (R3-17) | v08–v10 |
| Radius list nearest first, live | PASS | v86–v88 |
| "Complete your meal": row, ADD → − 1 +, bill updates | PASS | v29, v30 |
| Dishes already in the cart excluded | FAIL (R3-7) | v29 |
| "Your usual" / "Most ordered" tags | Not seen: `/popular` was empty when the cart was opened (no deliveries yet) | — |

## Round-2 leftovers (phase H)

| # | Now |
|---|---|
| R2-1 | **Fixed:** Ops cancel after pickup frees the rider at once, rider told, keeps ₹30 |
| R2-2 | Fixed: GST on commission ₹0 on every invoice checked |
| R2-3 | **Not fixed, worse** (R3-1) |
| R2-4 | Partly: tapping the Partner alert opens the Orders list with the order on top, not the order itself |
| R2-5 | Fixed: `kitchen-orders` channel |
| R2-6, R2-7 | Fixed (refund topic and status; reject tells the customer; re-approve needs a note; no double refund; no "link" text) |
| R2-8 | Fixed |
| R2-9 | Fixed: Operations forgot password by email code, then sign-in with the new password |
| R2-10 | Fixed: "They can sign in now with the password you set" |
| R2-11, R2-12, R2-14, R2-15, R2-16, R2-17, R2-18, R2-20, R2-21 | Fixed |
| R2-13 | Partly: server still stores a new kitchen at central Bengaluru (R3-21) |
| R2-19 | Asked on the first sign-in (permission became granted); the retest was blocked by a leftover Rider crash window |
| R2-22 | Not reached (Partner Money screen not opened) |

## Bugs

**R3-1 · Critical · Rider app crash loop after it is force-stopped while on shift (R2-3, worse).**
App: Rider. Steps: rider online (with or without a trip), `am force-stop in.quickbite.rider` (what Android or a battery
saver does), open the app. Expected: it opens and resumes. Actual: `NullPointerException` in
`expo.modules.location.taskConsumers.LocationTaskConsumer.executeTaskWithLocationBundles` from `TaskJobService.onStartJob`,
"Quick Bites Rider keeps stopping" on every launch: 6 crashes in `dumpsys dropbox` (v42), 55 location jobs queued. Cancelling
the jobs helped once; the second time nothing but **Clear storage** made it open. A rider in the field would be locked out
mid-shift. Evidence: y44–y55, `y44-crash.txt`, `y55-crash-loop.txt`. Suspected: the queued location jobs fire before the JS
task is defined (`apps/delivery-mobile/index.ts`, `src/lib/shiftService.ts`); the R2-3 fix (define the task first) did not
take effect for headless starts.

**R3-2 · High · The "Operations has assigned you" card traps the rider when Operations moves the trip away.**
App: Rider. Steps: Ops assigns QB-319712 → card rings; Ops reassigns it to another rider before Start. Expected (plan D):
"Operations moved order #N to another rider", alarm stops, card closes. Actual: ring stops but the card stays; Back is blocked;
"Start trip" → "Could not start the trip. Order not found."; OK returns to the same card. Only killing the app escapes, which
then hits R3-1. Evidence: y49–y52.

**R3-3 · High · Trip offers do not reliably reach the rider's screen.**
App: Rider. Three orders past their 10-minute mark, one rider online. Offer 1 appeared at once. Offer 2 (QB-689110) was made
at 03:25:02 but appeared ~26 s later (82 of 108 s left). Offer 3 (QB-246237) was live on the server (`secondsLeft 88`) while
Home showed nothing; it existed only as a row in Trips → "Available offers" (no countdown, no ring, no pickup distance), and
an earlier offer of the same order expired unseen. Expected: every offer full screen with countdown and ring at once.
Evidence: y11–y13, `/admin/deliveries/live` output. Suspected: the offer socket event is missed after the previous offer
closes and the app falls back to polling.

**R3-4 · High (item 4) · Customer Help: oversized contact buttons; the keyboard covers the message box.**
App: Customer. Help & support. "Call customer care" and "Chat on WhatsApp" are drawn as two huge pills ~300 px wide × 900 px
tall (40 % of the screen), so the chat gets ~200 px. With the keyboard open only the top edge of the input and Send show; the
messages disappear; typed text is invisible. Evidence: v42, v46. Suspected: the contact row's style in
`apps/customer-mobile/src/screens/SupportScreen.tsx` (items stretch to the row height).

**R3-5 · Medium · Save address from "Choose on map" fails: "Request payload validation failed."**
App: Customer. Home → location → Choose on map → Confirm → flat, PIN, Work → Save address. Actual: the generic validation
text, nothing saved. Cause: `apps/customer-mobile/src/components/SaveAddressSheet.tsx:58` sends `city: picked.city || ''`;
`POST /addresses` requires a city (`routes/addressRouter.ts:14`). On QA there is no place lookup; live, any pin whose lookup
has no city fails the same way. Also the PIN box shows "562112" as a grey placeholder, which reads as filled in, then says
"Enter a valid 6-digit PIN code". Evidence: v26, v27.

**R3-6 · Medium · "Save address" ignores taps while the keyboard is open.**
Same sheet, after typing the custom name: two taps on Save address did nothing (the keyboard stayed or closed); it saved only
after a third tap with the keyboard closed. Evidence: v16, server address list. Suspected: missing
`keyboardShouldPersistTaps="handled"` on the sheet's scroll view.

**R3-7 · Medium · "Complete your meal" lists dishes already in the cart.**
App: Customer. Add Kolkata Shahi Mutton Biryani from the menu, open the cart: the first suggestion is that same dish, shown
with − 1 +. Cause: `apps/customer-mobile/src/components/CartSuggestions.tsx:72` leaves plain (no-option) cart lines out of
`inCart`. Evidence: v29, v30.

**R3-8 · Medium · Help and the cancellation quote still say the order can be cancelled after the 2 minutes.**
After the window closed, Help → "Cancel my order" answered "You can cancel order #QB-475111 from its screen… a cancellation
charge may apply". The cancellation quote at 125 s returns `canCancel: false` with the message "You can cancel this order free
of charge." Expected: "The kitchen is cooking; ask support". Evidence: v44, `b1_cancel.txt`. Suspected:
`modules/support/helpChat.ts` CANCEL answer and the quote message in `routes/orderRouter.ts`.

**R3-9 · Medium · "Ask support to cancel" loses the order, and help greets the wrong name.**
The button opens Help with no order card (the ticket does carry QB-475111). The greeting said "Hi Quick" and Operations sees
the customer's messages as "Quick Bites Customer" although the account name is "Asha QA": the name set on the "What should we
call you?" step after the code is not in the signed-in session (`routes/supportRouter.ts:47` reads `req.user.fullName`).
Evidence: v42, w15.

**R3-10 · Medium · Rider can work with approximate location.**
Choosing "Approximate" (then "Keep approximate") keeps the rider online, "GPS on · sending your location", and the setup card
ticks Location. Plan E2: precise location required to go online. With ~2 km accuracy the customer map and dispatch distances
are wrong. Evidence: y40, y41.

**R3-11 · Medium · Operations hears about a silent rider only after 10 minutes.**
Rider GPS cut for 2.5 min on a live trip: no alert. `OPS_ALERT_RIDER_WENT_SILENT` came at 10 min (`riderLocationSilentMinutes`
= 10). Plan E2: 2 minutes. The customer feed did mark the position stale after 40 s.

**R3-12 · Medium · Assigned-trip alarm: media volume, no "Call Operations", one distance.**
The ring plays with `USAGE_MEDIA` (expo-av): a phone with media volume at zero is silent (the R2-5 lesson). The card has only
"Start trip" (plan: also "Call Operations") and shows the customer distance (390 m) but not the rider's distance to the
restaurant. Evidence: y42, `dumpsys audio`.

**R3-13 · Medium · The customer is told "6 min" when the rider is at the door.**
On `OUT_FOR_DELIVERY` the time = ride + `DELIVERY_HANDLING_MINUTES` (6): with the rider 10 m away the tracking said 6 min
(`distanceKm: 0, minutesRemaining: 6`). Suspected: `modules/orders/eta.ts:87` `travelMinutes` adds handling to the en-route
case.

**R3-14 · Low · Offer card promises a little more than is paid.** P3 (7.15 km): the offer said pickup ₹43.20 / earn ₹74.20
(7.2 km rounded first), the order froze ₹42.90 / ₹73.90. Use the same figure in both.

**R3-15 · Low · Pickup pay is not shown as its own line.** Invoice: "Rider trip pay Rs 91.06"; rider statement: one "Trip
earning 91.06". Expected "₹31 trip + ₹60.06 pickup (10 km)". The invoice prints a loss ("Quick Bites keeps −Rs 7.76") in green.
Evidence: inv-QB-705049.pdf, `/earnings/statement`.

**R3-16 · Low · Offer card labels.** "Total trip 390 m" is the restaurant → customer leg only (the 1.7 km to the kitchen is not
in it). The first offer after going online showed no "from you" distance.

**R3-17 · Low · First-visit address block is below the fold.** New customer: header, search, categories, offer banner and two
filter rows come first; "Save your address first" starts at ~85 % of the screen (plan: the top third). The "Use my current
location" button text touches its edges. Evidence: v08–v10.

**R3-18 · Low · Address wording.** After saving "Moms place" the Home header shows "QA Tower" (a piece of the flat line); the
save sheet says "The spot you chose on the map" after "Use current location"; the red "Enter your flat…" error stays after
the field is filled. Evidence: v17, v13, v24.

**R3-19 · Low · Sheets lifted by the keyboard slide under the status bar.** The title overlaps the clock: Customer save address
(v16), Operations ticket (w16), Operations create restaurant (w29).

**R3-20 · Low · Cancellation texts.** The Operations free-text reason is pushed to the customer word for word ("Another reason
— QA ops cancel after pickup"): an internal note would reach the customer. The rider's push title for a cancellation is "Trip
moved by support".

**R3-21 · Low · R2-13 partly: a kitchen created by Operations is still stored at 12.9716, 77.5946** (central Bengaluru) until
someone sets its location.

**R3-22 · Low · Rider pickup code: Enter does not submit and "Confirm pickup" is under the keyboard.** The rider must close the
keyboard and scroll. Evidence: y23–y25.

**R3-23 · Low · Enter does not sign in** on the Operations app and the `/admin` website (the Partner app and `/partner` do).

**R3-24 · Low · Partner screens.** A new kitchen with no orders reads "0% of finished orders were delivered rather than
cancelled". Earnings "₹991" while help says "₹952.87 owed" (the ₹50 refund is not reflected on the dashboard).

**R3-25 · Low · Customer empty Cart has no bottom tab bar** (only the system Back leaves it). Evidence: v74.

**R3-26 · Low · Full-screen tracking map shows distance only** ("320 m away · just now"); the plan's "1.2 km away · 4 min"
has no minutes.

Feel (not numbered): "Order Confirmed" is the headline while the kitchen has not accepted yet; Customer "Deliver to" sheet and
"Send Code" take ~2 s to respond; Partner and Rider cold starts show a blank screen for 6–8 s (software-rendered emulator, so
judge on a phone).

## Notes on this round (environment, not app defects)

- **Rider and Operations apps were pointed at the live server** after the update to 42 (Customer and Partner kept QA). Before
  I noticed, the Rider app sent two sign-in attempts with the seeded test login (`rider@quickbite.app`) to live; both were
  refused. Nothing was changed on live. Both apps were then pointed at QA before any further use.
- The emulator crashed at 09:12 and came back from an **old snapshot** (apps at versionCode 32/33, server setting live again);
  build 42 was reinstalled over them (another clean update path) and the settings fixed before signing in. One Customer launch
  from that snapshot showed "signed out", meaning it had called live with an old token.
- Not testable here: notifications with an app closed (FCM), real sound (`-no-audio`), Google road lines and re-routing,
  online payment and the door QR, a real phone's GPS and OEM battery killers, small screens, iPhone. Not reached: R2-22, every
  remaining form (Partner bank/UPI, Rider documents/bank, refund-request and rating screens, account deletion, Operations
  settings), "nearest rider first" with two riders on screen.

VERDICT: ISSUES FOUND
