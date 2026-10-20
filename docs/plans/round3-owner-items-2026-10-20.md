# Round 3 — real-time everywhere + the owner's 11 items (20 Oct 2026)

**Status:** planned 20 Oct, building. Build number for this round: **40** (APK + AAB, all four apps).
**Where it sits:** the builder ↔ Tester loop in `master-plan-2026-10-18.md` → START HERE → CURRENT STATE.
This file is the work list for round 3; each phase ends with its check and a gate run.

## For the owner, in one screen

| | |
|---|---|
| **What changes** | Every screen in all four apps (and both websites) updates by itself the moment the server changes anything — no pull-to-refresh. Help is a WhatsApp-style chat with a history. Orders get an honest countdown, riders are called at 10 minutes left, admin-assigned trips ring like an alarm, the customer watches the rider move like "Find My Device", the keyboard never covers a field, and the cart suggests dishes. |
| **Money rule added (owner, 20 Oct)** | A rider more than **7 km** from the restaurant when they take the trip is paid **all of that pickup distance × ₹6** by Quick Bites (10 km away = ₹60). Never on the customer's bill. Restaurant → customer pay stays as built (₹12/km sliding to ₹8). Both numbers editable in Admin → Money → Rider pay. |
| **Rules settled (owner, 20 Oct)** | Customer may cancel in the app for **2 minutes** after the restaurant accepts, then "Ask support to cancel". Customer sees **no time** until the restaurant accepts; then **cooking time + ride time restaurant → customer**, counting down live, and "+1 min, +2 min…" when late. Riders are offered the trip at **10 minutes** of cooking left (at once if the cook time is shorter, or the moment the kitchen taps Ready). Help chats can be closed by **staff or the user**. |
| **Cost** | Google road distance for the rider's pickup is one Routes call per accepted trip; re-drawing the route when a rider turns off it is at most one call a minute per live trip. |
| **Only you** | Nothing new. (Existing list: `OWNER_ACTIONS.md` Part 0.) |

## Phase order (each builds on the one before)

| Phase | Items | Why this order |
|---|---|---|
| A | 1 Real-time backbone | 2, 6, 9 all ride on it |
| B | 2, 3 + pickup pay | order clock, cancel window, dispatch timing, money |
| C | 6 Help chat | needs A |
| D | 9 Admin-assigned trip alarm | needs A |
| E | 7, 8 Live tracking | independent of B–D |
| F | 4 Keyboard + OTP | all four apps, native module → one build |
| G | 10, 11, 5 Customer home + cart | customer only |
| H | Round-2 leftovers (R2-8 … R2-22) | small, last |
| — | gate, push, build 40 APK + AAB, Tester round 3 | |

---

## A. Real-time everywhere (item 1)

**What is wrong today (traced 20 Oct).** The server emits only order, rider-location, kitchen, menu and
menu-request events (`sockets/socketServer.ts:370-646`). Nothing is emitted for help tickets, account
approvals/blocks/removals, KYC and profile decisions, COD switches, payouts, refunds or settings. On the
apps: Operations refreshes only its badge counts on a live event (`admin-mobile/App.tsx:318`), not the
screen open; Partner refreshes order screens only; Rider listens for offers only; Customer listens only on
the tracking screen. Help chat polls every 6 s (`components/SupportChat.tsx:86`). So anything an admin does
appears elsewhere only after a reload.

**Design — one signal, everywhere.**

1. **Server, one choke point.** `emitSync(userIds, topic)` → `user:<id>` room event `sync {topic, id?}`;
   `emitSyncAdmins(topic)` → `admin:control_tower`; `emitSyncAll(topic)` for platform settings that every
   app reads (pricing, radius, COD distance, banners, recommended kitchens).
   An Express middleware on `/api` fires after every **successful write** (non-GET, 2xx):
   - to every Operations console (`admin:control_tower`), so any admin screen anywhere stays current;
   - to the writer's own other devices (`user:<self>`);
   - to the **accounts the write touched**, resolved from the route's ids: `userId`/`id` → user,
     `restaurantId` → its owner, `riderId` → its user, `orderId` → customer + kitchen owner + rider,
     ticket `id` → who raised it, payee → its account. One resolver (`sockets/affected.ts`) with a suite.
   Topic = the first path part after `/api` (`orders`, `support`, `admin/people`, …), so a screen can
   ignore unrelated noise. Existing specific events stay (they carry data the screens use directly).
2. **Apps, one hook per app.** `src/lib/liveSync.ts` in each app: ONE shared socket per signed-in app
   (today each hook opens its own), `useLiveSync(reload, topics?)` calls `reload` (debounced 400 ms) when a
   matching `sync` arrives, when the socket **reconnects**, and when the app returns to the **foreground**
   (sockets die in the background; this is what makes "no reload ever" true on real phones). A push that
   arrives while the app is open also triggers it (covers networks that block websockets).
   - Operations: wired once inside `useResource` → every admin screen at once (silent reload, no spinner).
   - Customer / Partner / Rider: one `useLiveSync(load)` line in each screen that loads data
     (list in the build notes; every screen in `src/screens/` that calls the API).
3. **Chat like WhatsApp** (order chat and help chat): a new message arrives over the socket **with its
   body** and is appended at once (no refetch); my own message appears instantly with a clock, then a
   tick when the server has it; timestamps; auto-scroll; unread count on the Help entry. Skipped: read
   receipts and "typing…" — add if the owner asks.

**Check:** suite `liveSync` — a write by an admin on a restaurant reaches its owner's room and the admin
room and nobody else's; a customer's write never reaches another customer. Mutate the resolver, watch it
fail. Tester: two phones/emulator + website side by side, every admin action shows on the other side
within ~2 s with no touch.

## B. Order clock, cancel window, dispatch, pickup pay (items 2, 3 + owner money rule)

1. **Cancel window (2 min after accept).** Server: customer cancel allowed in `ORDER_PLACED`/`PAYMENT_PENDING`
   always, and until `acceptedAt + 2 min` after acceptance; later → `409 CUSTOMER_CANCEL_WINDOW_OVER` with
   "Ask support to cancel" (`routes/orderRouter.ts:512-590`, `cancellation-quote` returns `cancelUntil`).
   App: Cancel button with a live "Cancel available for 1:42" counter, then "Ask support to cancel" which
   opens the help chat about this order. Constant `CUSTOMER_CANCEL_AFTER_ACCEPT_MS` in one place.
2. **Partner hears everything live.** Customer cancellation, support cancellation, rider assigned/arrived,
   customer messages and every admin action on the kitchen: socket + sound + push on the alert channel
   (cancellation rings "Order #N cancelled — stop cooking").
3. **Honest customer time.** Before accept: no time at all ("Waiting for the restaurant to accept").
   At accept: `arrivingAt = acceptedAt + kitchen's cook minutes + ride minutes (restaurant → customer, the road
   distance recorded at checkout)`; the rider's ride to the kitchen is NOT added (the rider is called early).
   Kitchen taps Ready early → `now + ride`. Rider has the food → from the rider's live position.
   Past `arrivingAt` and not delivered → "Running late · +N min", counting up each minute.
   The app counts down from the server's timestamp every second (no "~10 min" constants).
   Files: `modules/orders/eta.ts` (`estimateArrival`), `OrderTrackingScreen.tsx:233-255`, the restaurant-card
   estimate before ordering stays as it is.
4. **Riders called at 10 minutes left.** One guard inside `offerTripToNearbyRiders` (all five callers route
   through it): no offer while cooking time left > 10 min and the food is not Ready; ops "offer now" passes
   `force`. The sweeper (every `ORDER_SWEEP_INTERVAL_SECONDS`) starts the offers on time; a timer per order
   at accept makes it exact. Nearest free rider first, all existing rules (one at a time, 108 s, alert after 5).
5. **Offer card shows both distances**: "Restaurant 2.4 km from you · Customer 5.1 km from restaurant ·
   You earn ₹61 (+₹60 pickup)".
6. **Pickup pay (new money rule).** At claim or admin assignment: road km rider → restaurant (Google, straight
   line × 1.3 when unavailable), frozen on the order as `riderPickupKm`, `riderPickupPay` = km × ₹6 when
   km > 7, else 0. Paid by the platform: added to the rider's share, NOT to the bill. Every site that reads
   rider pay must add it (money paths have copies): `payments/earnings.ts:133`, `payments/statements.ts:204`,
   `riders/tripPayout.ts:44` (`tripTakeHome`), `payments/restaurantCharges.ts:459`,
   `payments/orderInvoicePdf.ts:57`, `admin/analytics.ts:99`, `admin/dashboardRoutes.ts:157`,
   `admin/peopleRoutes.ts:357,422`, plus the Rider earnings screens. Settings `pickupPayFromKm` (7) and
   `pickupPayPerKm` (₹6) in pricing config, editable beside rider pay. Suite: pay the same rider twice, once
   near (₹0) and once far (₹60); ledger balances; customer total unchanged.

## C. Help like the Rider app's chat, with history (item 6)

- **One shape in Customer, Partner, Rider:** Help = the current chat (bot answers first, "Talk to a person"
  connects Operations in the same thread) + **Request history** (resolved chats, title + date; tap to read
  the whole thread). The Customer "Raise a request" sheet and the Partner raise form are removed; contact
  details and refund requests stay as rows under the chat.
- **Resolve:** Operations marks Resolved, or the user taps "My issue is solved" → the chat moves to history
  and a fresh chat starts. Writing again after resolve starts a new chat (history keeps the old one).
- **Real time:** replies arrive over the socket (A3); the 6 s poll goes.
- **Title:** the server names each ticket from the first topic or first line ("Refund for order #123").
- **Operations sees who:** each ticket shows the person (name, role chip Customer/Partner/Rider, phone,
  kitchen name or rider id), their open orders and their earlier tickets; tap opens their People record.
  Live list, new-ticket sound.
- Files: three `components/SupportChat.tsx` copies (kept identical), `customer-mobile/src/screens/SupportScreen.tsx`,
  `restaurant-mobile/src/screens/HelpCentreScreen.tsx`, `routes/supportRouter.ts`, `routes/admin/supportRoutes.ts`,
  `admin-mobile/src/screens/SupportScreen.tsx`. Suite: resolve by user and by staff, history order, a user
  never reads another's ticket.

## D. Trip given by Operations rings like an alarm (item 9)

Today: push only, "Support gave you a trip" (`opsRescue.ts` → `notifyRiderTripGiven`), no socket, no screen.
Build: socket `trip:assigned` to the rider's room + push on the high-importance alert channel with the
order sound; Rider app opens a full-screen card "Operations has assigned you order #N — this trip is
compulsory", restaurant, both distances, pay, the sound repeating until **Start trip**; then straight to the
trip screen. Only other button: "Call Operations". Shown again on app open if not yet acknowledged
(`order.riderAckAt`). Taken-off trips show "Operations moved order #N to another rider" and stop the alarm.

## E. Live tracking like "Find My Device" (items 7, 8)

**Root cause:** positions are sent by a watcher in the trip screen (`delivery-mobile/App.tsx:726`). When the
rider opens Google Maps to navigate or locks the phone, that JS watcher is throttled, and the shift
foreground service throws its fixes away (`lib/shiftService.ts:37`). So the customer's bike freezes.
Build:
1. During a trip the shift **foreground service switches to trip mode** (high accuracy, every 3 s / 5 m) and
   the task itself sends each fix to `/riders/telemetry` with the stored session and trip id — works with
   the screen off or another app open. Back to shift mode after delivery.
2. **Permissions and safety:** precise location required to go online; "Location is off" → the Android
   turn-on dialog; battery-saver exemption asked once (Xiaomi/Oppo/Vivo kill services); the existing consent
   screen explains the trip tracking. Background location ("Allow all the time") is NOT needed: the
   service starts while the app is open (no Play background-location review). Server already flags a fix
   older than 30 s; Operations is alerted when a live trip has no fix for 2 minutes.
3. **Customer map:** from "rider left the restaurant", the bike glides between fixes, turns with heading,
   the camera keeps rider + home in view (re-centre button after the customer pans), a trail of where the
   rider has been, live "1.2 km away · 4 min". When the rider is >150 m off the drawn route, the server
   re-draws it from the rider's position (at most once a minute per trip, cached).

## F. Keyboard never covers a field; OTP that always opens (item 4)

**Root cause:** SDK 54 draws every Android screen edge-to-edge, so Android no longer shrinks the window for
the keyboard, and most screens pass `behavior={undefined}` on Android (`KeyboardAvoidingView` in 33 places).
Build: `react-native-keyboard-controller` (Expo SDK 54-supported, New Architecture) in all four apps;
`KeyboardProvider` at each root; the library's `KeyboardAvoidingView` (same API, works on Android) in place of
React Native's; form screens scroll the focused field above the keyboard (`KeyboardAwareScrollView`); bottom
sheets in our `Modal` wrapper lift with the keyboard; chat boxes ride on top of the keyboard. Web unchanged.
**Customer OTP:** the hidden 1×1 input (`components/CodeBoxes.tsx`) is why taps fail on some Android phones:
it becomes a transparent input covering the six boxes (a tap lands on a real field), focus is re-asked after
the step animation, and the 42 % hero image shrinks while the keyboard is open. Every input in all four
apps goes on the Tester's list.

## G. Customer home and cart (items 10, 11, 5)

- **10 Save from the home location sheet:** after "Use current location" or a map pick, "Save this address":
  house/flat, landmark, name (Home / Work / Other or your own name) → the existing `POST /addresses`; the
  form is the Address book's own, moved into one component used by both. Saved addresses listed in the sheet.
- **11 First visit:** no saved address → the top third of Home is "Save your address to see restaurants
  near you" with *Use current location* and *Pick on map*; below it Quick Bites' recommended list; once saved,
  the list becomes the restaurants within the admins' radius (`maxDeliveryKm`), nearest first. Signed-out
  visitors can browse from a location; saving asks them to sign in.
- **5 "Complete your meal" in the cart:** server `GET /api/restaurants/:id/suggestions?exclude=…`: dishes on
  sale now and not in the cart, ranked by this customer's own repeat orders here ("Your usual"), then the
  kitchen's most-ordered of the last 30 days ("Most ordered"), then the menu's order; 10 at most, cached 5 min
  per kitchen. Cart: a horizontal row of cards (photo, veg mark, name, price, ADD → − 1 +) above the bill.

## H. Round-2 leftovers

R2-8 offline vs "no addresses", R2-9 Operations forgot-password by email code, R2-10 create-account alert
wording, R2-11 rider trip-chat keyboard (falls under F), R2-12 Partner header after approval (falls under A),
R2-13 kitchen location placeholder/no-results/share links/saved note, R2-14 new kitchen card defaults, R2-17
dish request error placement, R2-18 Home active-order strip (falls under A), R2-19 notification channel before
permission, R2-20 refunded-delivered counted as cancelled, R2-22 payee per kitchen note, R2-16 "Rs" → "₹" in
server texts (PDFs keep "Rs"). Details: `docs/qa/TEST_REPORT-2026-10-19-build39.md`.

## Loop protocol (owner, 20 Oct)

1. Builder finishes A–H, each with its suite + mutation check, gate green, pushes `main` (live), builds 40
   (APK + AAB) from `D:\qbx`, archives, commits `release/version.json` + 4 `app.json`.
2. Builder messages the **Tester** session: build number, what changed, where the APKs are.
3. Tester tests everything (its brief), writes `docs/qa/TEST_REPORT-<date>-build<N>.md` with VERDICT.
4. Builder researches every finding, appends a "Round N+1" section to this file (or a new round file), fixes,
   rebuilds, back to 2. **The owner's 20 Oct rule replaces "wait for the owner": act on each report at once.**
5. Ends when the Tester's VERDICT is ALL GOOD and the builder has nothing open.
6. **Only one session works at a time (owner, 20 Oct):** the builder never builds while the Tester is
   working, and the Tester never tests while the builder is working. Hand over by message, then stop.
7. If a session stops (usage limit, restart), a timer in the builder session re-checks every 2 hours and
   continues from CURRENT STATE; the Tester resumes from its report file.

## Tracker

| # | Item | Phase | Status |
|---|---|---|---|
| 1 | Real-time updates everywhere, chats like WhatsApp | A | ✅ 20 Oct (in build 40) |
| 2 | Cancel only 2 min after accept, then support; partner told live | B | ✅ 20 Oct (in build 40) |
| 3 | No time before accept; cook + ride; late +N; riders at 10 min left; pickup pay | B | ✅ 20 Oct (in build 40) |
| 4 | Keyboard covers fields; customer OTP | F | ✅ 20 Oct (in build 40) |
| 5 | Cart "Complete your meal" | G | ✅ 20 Oct (in build 40) |
| 6 | Help = chat + request history, resolve, admin sees who | C | ✅ 20 Oct (in build 40) |
| 7 | Customer map follows rider live, re-route | E | ✅ 20 Oct (in build 40) |
| 8 | Tracking permissions, background-safe | E | ✅ 20 Oct (in build 40) |
| 9 | Admin-assigned trip alarm screen | D | ✅ 20 Oct (in build 40) |
| 10 | Save address from home location | G | ✅ 20 Oct (in build 40) |
| 11 | First-visit address hero, radius by admins | G | ✅ 20 Oct (in build 40) |
| R2 | Round-2 leftovers | H | ✅ 20 Oct (in build 40) |
