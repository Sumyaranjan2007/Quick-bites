# Round 3 test plan — build 40 (Tester, 20 Oct 2026)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md). How tests run: [`docs/TESTING.md`](../TESTING.md).

What is being built: [`docs/plans/round3-owner-items-2026-10-20.md`](../plans/round3-owner-items-2026-10-20.md) (phases A–H).
Earlier rounds: [`TEST_REPORT-2026-10-19-build36.md`](TEST_REPORT-2026-10-19-build36.md), [`TEST_REPORT-2026-10-19-build39.md`](TEST_REPORT-2026-10-19-build39.md).
The report for this round: `docs/qa/TEST_REPORT-<date>-build40.md`, same format (tables per app, money by hand, numbered
findings **R3-1…** with app, steps, expected, actual, severity, screenshot path, suspected file), ending `VERDICT: ALL GOOD`
or `VERDICT: ISSUES FOUND`. Strict: also report what is slow, confusing, ugly or unlike a top food-delivery app.

Each box below is one case. ✅ pass · ❌ finding (R3-n) · ⛔ not testable (say why) · ↺ retest after fix.

---

## 0. Setup (before any case)

- [ ] Builder's message read: build number, commit, APK path. `aapt dump badging` on all four APKs: versionCode **40**, packages
      `in.quickbites.app`, `com.quickbite.partner`, `in.quickbite.rider`, `com.quickbite.admin`, signed with the release key
      (`apksigner verify --print-certs`, same SHA-256 as build 39).
- [ ] Install **as an update** over build 39 on `qb34` (`adb install -r`, no uninstall): every app opens, still signed in.
- [ ] QA server per `docs/TESTING.md` from the **commit the builder names** (`git log -1` matches), port 7071, fresh
      `QB_DATA_DIR`, `OTP_PROVIDER=fixed OTP_FIXED_CODE=123456`, Razorpay test keys, no live keys, `DATABASE_URL` unset.
      `ORDER_SWEEP_INTERVAL_SECONDS=5` (env only, so the 10-min offer timing is seen within seconds of the boundary).
- [ ] `node scripts/build-web.mjs`, `/partner` and `/admin` open in the built-in browser against the QA server.
- [ ] Emulator `qb34` with `-gpu swiftshader_indirect`; all four apps pointed at `http://10.0.2.2:7071/api` (6 taps on logo).
- [ ] Clean slate for evidence: `adb logcat -c`, note `dumpsys dropbox` crash/ANR counts before starting.
- [ ] Screenshots to `D:/dev-data/temp/tester/r3/` (prefix `v` Customer, `x` Partner, `y` Rider, `w` Operations, `b` browser).

**"Side by side"** = Android split screen on the emulator (two apps at once) **or** an app on the emulator + the `/admin`
or `/partner` website in the built-in browser + the server log, with a stopwatch from the action to the change. Pass =
change appears within **~2 s, no touch, no pull-to-refresh**.

---

## A. Real-time everywhere (item 1)

Each row: do the action on the left, watch the right side **without touching it**.

| # | Action (where) | Must appear live (where) |
|---|---|---|
| A1 | Ops approves a kitchen's FSSAI + PAN (/admin) | Partner header leaves "Awaiting verification · Locked" (R2-12) |
| A2 | Ops blocks / unblocks the kitchen | Partner shows blocked / back; Customer feed drops / shows it |
| A3 | Ops switches COD off / on for a kitchen | Customer checkout hides / shows Cash (cart open) |
| A4 | Ops edits a live dish price, adds a dish, approves a menu request | Customer menu open shows new price/dish; Partner "Recent decisions" |
| A5 | Ops rejects a menu request with a reason | Partner request card shows rejected + reason |
| A6 | Ops approves / rejects a rider document | Rider Documents screen + home card update |
| A7 | Ops blocks a rider who is online | Rider app goes offline / blocked notice; no more offers |
| A8 | Ops changes delivery radius / COD km / rider pay / pickup pay settings | Customer home list and open quote change; Rider offer figures |
| A9 | Ops toggles Recommended / Pure Veg seal on a kitchen | Customer home order / Pure Veg filter |
| A10 | Ops pays a partner and a rider (hand payout, UTR) | Partner Money and Rider Earnings show paid; /partner website too |
| A11 | Ops approves / rejects a refund | Customer order shows refund state + message |
| A12 | Ops cancels an order (each stage) | Customer, Partner, Rider screens all change state |
| A13 | Ops reassigns a rider | Old rider's trip ends, new rider gets it (see D) |
| A14 | Partner accepts / preparing / ready | Customer tracking + Home active-order strip (R2-18) + Ops Live |
| A15 | Partner switches online / offline, section off | Customer feed / menu; Ops People |
| A16 | Rider claims, picks up, delivers | Customer, Partner, Ops Live, Ops dashboard counts |
| A17 | Customer places / cancels an order | Partner Orders (sound), Ops Live |
| A18 | Second Operations device (website + app) | Any admin change on one shows on the other |
| A19 | Privacy: customer B signed in on the website/API socket | Receives **no** sync for customer A's writes (check socket frames / server log) |
| A20 | App backgrounded 2 min, change made, app foregrounded | Screen current at once (foreground reload) |
| A21 | Server restarted while apps open (socket drops) | Apps reconnect and reload by themselves; no stale screen |
| A22 | Wi-Fi off 30 s, change made, Wi-Fi on | Change appears on reconnect, no pull |

**Chats (A3 of the plan, "like WhatsApp")**
- [ ] Order chat customer ↔ rider: message arrives on the other side instantly (no 6 s wait), both directions, 10 in a row.
- [ ] Own message shows at once with a clock, then a tick; timestamps on every bubble; list auto-scrolls to the newest.
- [ ] Message sent while the other app is in the background: shows on return without reload; push logged.
- [ ] Message with Wi-Fi off: clock stays, clear failed state + retry; no duplicate after reconnect.
- [ ] Long message (500 chars), emoji, Hindi/Kannada text, only spaces (refused), rapid double send (one message).
- [ ] Help chat (C below) and order chat: no polling in the network log (no `GET` every 6 s).
- [ ] Unread count on the Help entry when staff reply while the user is on another screen; clears on open.

## B. Order clock, cancel window, dispatch, pickup pay (items 2, 3 + money rule)

**B1 Cancel window (customer)**
- [ ] Before accept: Cancel shown, free, no countdown; cancels; Partner hears it.
- [ ] After accept: "Cancel available for 1:59" counting down each second; cancel at 1:30 → works, refund/fee per policy.
- [ ] At 0:00 the button becomes "Ask support to cancel" **without a reload**; tap opens the help chat about this order
      (order number pre-filled / shown).
- [ ] API at 2:05 after accept: `409 CUSTOMER_CANCEL_WINDOW_OVER`; `cancellation-quote` returns `cancelUntil` = accept + 120 s.
- [ ] App killed and reopened at 1:00 → counter resumes at the right value (from server time, not restart at 2:00).
- [ ] Emulator clock moved +5 min → counter still follows the server (not the phone clock) or document what happens.
- [ ] After pickup: no cancel at all (`CUSTOMER_CANNOT_CANCEL_NOW`), only support.
- [ ] Support (Ops) can still cancel after the window; customer told, refund correct.

**B2 Partner hears cancellations live**
- [ ] Customer cancels after accept, Partner app open on another screen: ring + banner "Order #N cancelled — stop cooking",
      order card shows Cancelled at once; tap → the order.
- [ ] Same with the Partner app in the background (alert channel, `dumpsys notification` channel = alert channel, not fallback).
- [ ] Ops cancels; rider assigned; rider arrived; customer message → each reaches Partner live (sound where planned).

**B3 Honest customer time**
- [ ] Placed, not accepted: **no time anywhere** (tracking, Home strip, order list, push): "Waiting for the restaurant to accept".
- [ ] Accept with 20 min cook, address X km: arriving = accept + 20 + ride min; check by hand from the order's
      `arrivingAt`, `riderRouteKm`/distance; shown countdown ticks every second.
- [ ] Kitchen taps Ready at 5 min (early): time jumps to now + ride.
- [ ] Rider picks up: time from rider's live position; moves as `adb emu geo fix` moves.
- [ ] Past arriving time, not delivered: "Running late · +1 min", +2 min… counting up live.
- [ ] Restaurant card estimate before ordering unchanged from build 39.
- [ ] Partner and Ops show the same promised time as the customer.

**B4 Riders offered at 10 min left**
- [ ] Cook 20 min: no offer at 0–9:59 elapsed (Ops Live shows none, rider app none); offer at 10:00 left (±sweeper 5 s).
- [ ] Cook 8 min: offer at once on accept.
- [ ] Cook 20 min, kitchen taps Ready at 3 min: offer at once.
- [ ] Two riders online at different distances: **nearest gets it first**; on pass/108 s timeout the next one; one at a
      time; Ops alert after 5 asked.
- [ ] Ops "offer now" before 10 min left: offer goes at once.
- [ ] Rider offline at 10-min mark, comes online at 8 min left: gets the offer.

**B5 Offer card**
- [ ] Shows "Restaurant 2.4 km from you · Customer 5.1 km from restaurant · You earn ₹N (+₹M pickup)"; figures match
      the order record and the earnings after delivery; readable, no clipping at the emulator size.

**B6 Pickup pay (₹6/km when the rider is more than 7 km from the kitchen) — by hand**
No Google key on QA → road km = straight line × 1.3. Kitchen point read from the order. Rider placed with `adb emu geo fix`.
| Case | Rider straight-line distance | Road km (×1.3) | Expected `riderPickupPay` |
|---|---|---|---|
| P1 near | ~2 km | ~2.6 | ₹0 |
| P2 just under | ~5.30 km | ~6.9 | ₹0 |
| P3 just over | ~5.50 km | ~7.15 | ~₹42.9 (all km × 6, not only above 7) |
| P4 far | ~7.7 km | ~10.0 | ~₹60 |
| P5 admin-assigned rider, far | ~7.7 km | ~10.0 | ~₹60 (assignment path) |
| P6 rider claims, releases, second rider claims | — | — | only the second rider's distance counts, first gets 0 |
- [ ] Customer bill identical with and without pickup pay (quote, checkout, receipt, invoice "customer paid").
- [ ] Rider: offer card, trip complete screen, Earnings today/week, statement, help "earnings" answer — each includes pickup pay once.
- [ ] Ops: order invoice PDF shows pickup pay as a platform cost, total still = what the customer paid; "ours" drops by it;
      dashboard / analytics / Pay "owed to rider" agree.
- [ ] Payout: pay the rider twice (P1 then P4 orders); second payout = only the new money; `payable + held = outstanding`.
- [ ] Settings: change ₹6 → ₹8 and 7 km → 5 km in Admin → Money → Rider pay; a **new** trip uses them, an old order keeps its frozen value.
- [ ] Cancelled after pickup / refunded order: rider keeps trip + pickup pay (per round-2 rule) — record what happens.

## C. Help = chat + request history (item 6)

Customer, Partner, Rider — same shape in all three:
- [ ] Help opens the current chat; bot answers a typed question; topics; "Talk to a person" connects Ops in the **same thread**.
- [ ] Customer "Raise a request" sheet and Partner raise form are **gone**; contact rows and refund requests still below the chat.
- [ ] Staff reply arrives instantly (socket), user replies, staff sees instantly.
- [ ] **Resolve by user:** "My issue is solved" → chat moves to Request history (title + date), fresh empty chat starts.
- [ ] **Resolve by staff:** Ops marks Resolved → user's chat moves to history live, fresh chat starts.
- [ ] Writing after resolve starts a new ticket; history keeps the old one unchanged; tap a history entry → whole thread, read-only.
- [ ] Titles: "Refund for order #N" etc., from first topic / first line; long first lines truncated nicely.
- [ ] History order newest first; 10+ tickets scroll.
- [ ] Privacy (API): user A cannot read user B's ticket by id (403/404); customer-scope token of a partner sees only customer tickets.
- [ ] Rate limit (5/hour) message is friendly.
- [ ] Round-2 R2-6: "where is my refund" → refund topic; "Refund status" lists all refund cases, not only the latest order.
Operations:
- [ ] Ticket list live; new ticket rings / sound; each ticket shows name, role chip (Customer/Partner/Rider), phone, kitchen
      name or rider id, open orders, earlier tickets; tap → that person's People record.
- [ ] Same on the `/admin` website.

## D. Admin-assigned trip rings like an alarm (item 9)

- [ ] Rider online, app open: Ops assigns order #N → full-screen card "Operations has assigned you order #N — this trip is
      compulsory", restaurant, both distances, pay (with pickup pay if far), sound repeating.
- [ ] Only buttons: **Start trip** (stops the sound, opens the trip screen) and **Call Operations** (dialer). Back key does
      not dismiss it.
- [ ] Rider app in background / another app open / screen off: alarm notification on the high-importance channel
      (`dumpsys notification`), tap → the card. (Full ring with app closed needs FCM: ⛔ on QA, note it.)
- [ ] Kill the app before acknowledging, reopen → card shown again (`riderAckAt` empty); after Start trip, never again.
- [ ] Ops moves the trip to another rider before Start → "Operations moved order #N to another rider", alarm stops, card closes.
- [ ] Ops assigns a rider already on a trip → refused or queued, clear message to Ops.
- [ ] Ops sees acknowledged / not yet in Live.

## E. Live tracking like "Find My Device" (items 7, 8)

Rider on a trip, customer tracking open in split screen. Move the rider with `adb emu geo fix` along a path every 3 s.
- [ ] App open: bike glides between fixes (no jumps), turns with heading, trail behind it, "1.2 km away · 4 min" updates.
- [ ] Rider app in background (Home pressed), Google Maps / another app in front: customer map keeps moving
      (server log shows `/riders/telemetry` every ~3 s from the service).
- [ ] Rider screen off (`adb shell input keyevent 26`) for 2 min: fixes keep arriving.
- [ ] Rider app swiped away from recents mid-trip: what happens (service keeps sending, or Ops alerted) — record; reopen
      does **not** crash (R2-3 regression: `LocationTaskConsumer` NPE).
- [ ] Shift mode vs trip mode: after delivery the rate drops back (log interval).
- [ ] No fix for 2 min (geo fix stopped + airplane mode on rider) → Ops alerted; customer sees "last seen N s ago", not a frozen bike pretending live.
- [ ] Camera keeps rider + home in view; customer pans → re-centre button; tap → back to following.
- [ ] Rider >150 m off the route → route re-drawn from the rider (at most once a minute; QA without Google = straight line: note).
- [ ] At the door (T-12 regression): home marker not hidden, sensible zoom.
- [ ] Permissions: go online with approximate location → asked for precise; location off → Android turn-on dialog;
      battery-saver exemption asked once; consent screen text mentions trip tracking; **no** "Allow all the time" request.
- [ ] Foreground-service notification visible during trip, wording clear.

## F. Keyboard never covers a field; OTP (item 4)

For **every** text field: tap it, keyboard open, the field and its submit button are fully visible; typing visible;
scroll reaches the next field; back key closes keyboard without losing text. Screenshot each with keyboard open.

**Customer:** sign-in phone, email, **OTP boxes**; address form (house/flat, landmark, name, custom name); location sheet
save form (G); search; dish special instructions / options; cart note / coupon / tip "other"; checkout; help chat box;
order chat box; refund request (amount, reason); rating/review; Edit profile (name, email change, password, code); delete
account (password / code); hidden Server settings URL.
**Partner:** sign in, forgot password (email, code, new password); sign up (all fields); dish request (name, price, sizes,
description); section name; whole-menu builder; documents (FSSAI, PAN, GSTIN numbers); bank / UPI form; profile edit; help
chat; reject-order reason; cook-time custom; deletion request.
**Rider:** sign in, forgot password, sign up; pickup code; delivery code; trip chat (R2-11); help chat; bank/UPI; documents;
cash deposit amount; deletion request.
**Operations:** sign in, forgot password (R2-9); people search; create restaurant / rider (all fields, password); kitchen
location search + link paste; dish edit / add; reject reasons (documents, menu, refund); payout UTR; settings numbers
(radius, COD km, rider pay, pickup pay); support reply box; cancel reason; refund amount.
- [ ] Bottom sheets (our `Modal`) lift with the keyboard; last button not behind the keyboard or the nav bar.
- [ ] Chat boxes sit on top of the keyboard; message list not hidden behind it.
**Customer OTP specifically:**
- [ ] Tap any of the six boxes → keyboard opens (10 times, after the step animation, after back-and-forth between steps).
- [ ] Type 6 digits → auto-submit; backspace moves back; paste a 6-digit code works; SMS autofill hint (if any) works.
- [ ] Hero image shrinks while the keyboard is open; boxes and Verify visible; wrong code message visible above the keyboard.
- [ ] Resend timer visible with keyboard open.
- [ ] Websites unchanged (forms still work, Enter submits).

## G. Customer home and cart (items 10, 11, 5)

**G1 Save from the home location sheet (item 10)**
- [ ] Home → location → "Use current location" → "Save this address": house/flat, landmark, name Home / Work / Other /
      **own name** ("Mom's place") → saved; appears in the sheet's saved list and the Address book with that name.
- [ ] Same from "Pick on map".
- [ ] Required-field errors visible above the keyboard; duplicate name allowed or explained.
- [ ] Signed-out visitor: browse works from a location; Save asks to sign in, then saves after sign-in (or returns cleanly).
- [ ] Address book form and sheet form behave identically (one component).
**G2 First visit (item 11)**
- [ ] New customer, no addresses: top third of Home = "Save your address to see restaurants near you" with *Use current
      location* and *Pick on map*; below it the recommended list.
- [ ] After saving: list = kitchens within `maxDeliveryKm`, nearest first, closed kitchens last "Not delivering currently";
      a kitchen at 36 km absent; change radius in Ops → list changes live (A8).
- [ ] Offline on first open (R2-8): an offline message + retry, **not** "No saved addresses yet"; back online recovers by itself.
**G3 "Complete your meal" (item 5)**
- [ ] Cart shows a horizontal row (photo, veg mark, name, price, ADD) above the bill; ADD → − 1 + stepper; bill updates.
- [ ] Items already in the cart excluded; dishes off sale / section off excluded; max 10.
- [ ] Customer with repeat orders here: "Your usual" first; then "Most ordered" (last 30 days); then menu order.
- [ ] Dish with required options → option sheet opens from ADD.
- [ ] Kitchen with 1 dish (all in cart) → row hidden, no empty box.
- [ ] API `GET /api/restaurants/:id/suggestions?exclude=…` — another kitchen's dishes never returned.

## H. Round-2 leftovers

| # | Retest |
|---|---|
| R2-1 | Ops cancels after pickup → rider freed, told, takes new trips (fixed in `080437a`: confirm) |
| R2-2 | No GST on commission without GSTIN: "ours" by hand = invoice (fixed: confirm on 3 orders) |
| R2-3 | Kill rider mid-trip, reopen ×3: no crash |
| R2-4 / R2-5 | Tap Partner and Rider alerts → the order; channel is the alert channel, alarm usage |
| R2-6 | Help refund answers (C) |
| R2-7 | Refund reject notifies; rejected cannot be silently approved; hand refund text has no "link" |
| R2-8 | Customer offline state (G2) |
| R2-9 | Operations forgot password by email code, end to end, then sign in |
| R2-10 | Create with password → dialog says they can sign in with that password |
| R2-11 | Rider trip chat keyboard (F) |
| R2-12 | Partner header live after approval (A1) |
| R2-13 | New kitchen default point (Harohalli or "not set"), search no-results text, `maps.app.goo.gl` link read or a clear reason, "Saved" confirmation |
| R2-14 | New kitchen card: no "Non-Veg" without a type; no invented "₹400 for two" |
| R2-15 | One-day statement includes that day |
| R2-16 | "₹" in every app screen, help answer, push text; PDFs keep "Rs" |
| R2-17 | Dish request size error next to the button / scrolled into view |
| R2-18 | Home active-order strip live (A14) |
| R2-19 | Customer asked for notification permission on Android 14 after sign-in |
| R2-20 | Refunded-delivered not counted as cancelled on Partner dashboard |
| R2-21 | Partner help payouts answer not contradictory |
| R2-22 | Payee per kitchen: Partner app says so for a two-kitchen owner |
| T-10, T-12, T-14 | Picker default point, tracking at the door, rider profile email/tick |

## R. Full regression pass (as rounds 1–2)

**End-to-end orders (UI where possible, API to repeat):**
- [ ] O1 cash order, options + sizes + pack charge + coupon + tip + Gold, delivered; bill by hand.
- [ ] O2 10 km order (rider pay slide); O3 16 km (cash refused `COD_TOO_FAR`); O4 41 km (`OUT_OF_DELIVERY_RANGE`).
- [ ] O5 far rider (pickup pay) delivered; O6 admin-assigned trip delivered.
- [ ] Pickup / delivery codes: wrong refused, right accepted; rider collects cash; cash deposit + variance.
**Cancellations by each party** (who is told live + push line, refund, kitchen earns, rider pay, rider freed):
- [ ] Customer before accept · customer in window · customer after window (refused) · kitchen rejects · kitchen cancels
      after accept · rider passes · rider releases before pickup · Ops before pickup · Ops after pickup · Ops reassigns.
**Refunds:** missing item partial, full, reject, refund twice (`ALREADY_REFUNDED`), kitchen charged pro-rata, rider keeps pay.
**Payouts:** hand payout + UTR, same payee twice (`NOTHING_PAYABLE`), ₹100 minimum, rider with cash blocked, RazorpayX (⛔ no keys).
**Money by hand:** table like round 2 — bill, kitchen, rider (+pickup), ours, invoice ours, dashboard, Finance, Pay — all agree.
**Notifications in all 4 apps:** permission asked once (each app); new order (Partner), offer + assigned (Rider), status
changes (Customer), new ticket / no rider / stale GPS (Ops); channel per `dumpsys notification`; tap routes to the right
screen; FCM-only ones as `FCM_PUSH_DISPATCHED` log lines.
**Websites:** `/partner` sign-in (Enter), dashboard, orders live, Money, receipts ZIP; `/admin` sign-in, dashboard, Live,
People, Support live, Money, invoice PDF; both get live updates (A).
**Health:** no crash / ANR / native crash (`dumpsys dropbox`, `logcat -b crash`) across the whole round; cold start time of
each app noted; any screen slower than ~1 s to show data noted.
**Feel:** scroll jank, spinners on every reload (should be silent per A), text clipping, "Rs", English quality, empty
states, compare to a top food-delivery app.

## Not testable on QA (state again in the report, with what was checked instead)

FCM pushes with apps closed; RazorpayX; online payment and door UPI QR (emulator crashes); real sound (`-no-audio`);
Google road distance and re-route (no server key: straight × 1.3); real GPS with screen off on a real phone and OEM battery
killers (emulator only: note limits); iPhone; small screens (one emulator size).
