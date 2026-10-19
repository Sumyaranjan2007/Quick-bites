# Test report: build 36 round (19 Oct 2026)

**Tester session, 19 Oct 2026.** Release APKs from `build/apk/` on the emulator `qb34` (Android 14, x86_64), all four
apps pointed at a private QA server (port 7071, seeded accounts, fixed code 123456, no live service keys).
Websites `/partner` and `/admin` built with `scripts/build-web.mjs` and opened in the built-in browser from the same
QA server. Nothing touched the live server or the owner's phone. No app or server code was changed.

Screenshots: `D:/dev-data/temp/tester/` (not in the repo). `xNN_s.png` is the half-size copy of `xNN.png`.

## Summary

- **Installed build is 37, not 36.** Every APK in `build/apk/` is versionCode 37 (`1.4.0-20261019.37`, built 19 Oct
  12:45); `release/version.json` also says 37. All results below are for 37.
- **The main journey works end to end on the phone apps:** customer sign-in by code, menu with options, cash order,
  kitchen accept with promised time, kitchen ticket print, ready, one-rider offer with countdown, accept, wrong and right
  pickup code, live tracking map with kitchen/home markers and the moving bike, wrong and right delivery code, rider
  pay and cash, partner receipt PDF, staff-only invoice PDF, manual payout once (a second is refused).
- **No crashes, ANRs or JS errors** in any app today (`dropbox` crash/native/ANR lists and `logcat -b crash` empty for
  19 Oct; the only crashes on the device are three from 16 Oct, older builds).
- **19 findings**: 1 High, 5 Medium, 12 Low, 1 info. The High one: rejecting a kitchen's **re-uploaded** document takes a
  trading kitchen off the customer feed, although its earlier licence was approved; a rider in the same situation keeps
  riding (T-1).
- Google map tiles render on the release build (rider trip map, customer tracking, address picker). With no server Google
  key on the QA server the tracking line is straight and the picker shows coordinates instead of a place name: expected.

## Customer app (`in.quickbites.app`)

| Feature | Steps | Expected | Actual | Result | Screenshot |
|---|---|---|---|---|---|
| Hidden server setting | Tap logo 6 times | Server URL field appears | Appears, kept `http://10.0.2.2:7071/api` | PASS | c04 |
| Old session | Launch over a token from another server | One "signed out" message | "You have been signed out" dialog, then sign-in | PASS | c01 |
| Sign in by code | Phone 9876543210 + email, code 123456 | Home | Home, Lexend font | PASS | c06 |
| Restaurant list, Pure Veg tag, Popular | Scroll home | Cards with tags | Shown | PASS | c07 |
| Dish options | Add Special Chicken Dum Biryani, pick Regular + Raita | Sheet with required/optional groups, price updates | ₹320 → ₹350 in cart | PASS | c09, c11 |
| Bill | Show bill | Parts add up | 350 + 17.50 + 25 + 27 + 5 = 424.50 | PASS | c14 |
| Place cash order | Place Order | Confirmed, delivery code shown | QB-306687, code 8322, 28 min | PASS | c15 |
| Cash up to 15 km (UI) | Address at 16.6 km | Cash hidden with reason | "Cash on delivery is available only up to 15 km… 16.6 km away" and only Pay now | PASS | c27 |
| Cash up to 15 km (server) | API orders at 10.1 / 16.6 / 27.4 / 41.1 km; one with `distanceKm: 1` spoofed | 10 km ok; 16.6 and 27.4 `COD_TOO_FAR`; 41 km `OUT_OF_DELIVERY_RANGE`; spoof refused | Exactly that | PASS | — |
| Rider pay slide | Quote at 16.64 km | ≈ 16.64 × ₹10.37 | `riderPay` 173 | PASS | — |
| Tracking map | After pickup | Road line, kitchen + home markers, moving bike | Kitchen and home markers joined by a line (straight: no server key), bike at the rider's GPS, "426 m away" | PASS | c16, c17 |
| Tracking at the door | Rider at the address | Useful view | Map zooms to street level, home marker hidden under the bike | FAIL (low, T-12) | c19 |
| Call the rider | Tap Call | Dialer opens | Dialer with +91 98765 11223 (seed record phone, T-18) | PASS | c18 |
| Address picker tooltip | Add address → Choose on map | Tooltip over pin | "Your order will be delivered here / Move the pin to your exact location" | PASS | c30 |
| Pin lift | Drag the map | Pin lifts with shadow, tooltip hides, coordinates update | Yes | PASS | c31, c32 |
| Use current location | Tap the pill, allow permission | Pin moves to the phone's position | 12.68180, 77.47510 (the emulator fix) | PASS | c34 |
| Picker start position | Open picker before location permission | Service area | Central Bengaluru (Cubbon Park, ~40 km away) | FAIL (low, T-10) | c30 |
| Haptics switch | Profile → Vibration on taps, tap items | Soft tick when on | `dumpsys vibrator_manager` shows TICK from the app; switch toggles | PASS | c38 |
| Help chat answer | Help → My order is late | Answer from live data | "Order #QB-156413 … waiting for the kitchen … about 60 min" | PASS | c40 |
| Help ticket | Talk to us → type → Send | Sent, staff notified | "Sent", push to 3 staff logged | PASS | c42 |
| Ticket message shown | After Send | Own message in thread | Not shown, only "Sent" | FAIL (low, T-13) | c42 |
| Staff reply pushed | Admin replies on the website | Customer push | "Quick Bites support replied" logged | PASS | — |
| Email change | Edit profile → Change → new email + password → code | Wrong code refused, right code changes email | Both | PASS | c49, c50 |
| Email field and keyboard | Type the new email | Field visible | Keyboard covers the field | FAIL (medium, T-6) | c46 |

## Partner app (`com.quickbite.partner`)

| Feature | Steps | Expected | Actual | Result | Screenshot |
|---|---|---|---|---|---|
| Sign in, wrong password | partner@ + wrong password | Plain error | "Invalid credentials or account does not have 'restaurant_owner' access permissions" | FAIL (low, T-9) | p05 |
| Sign in | pass123 | Dashboard, no "Kitchen not linked" flash | Dashboard | PASS | p06 |
| New order, accept | Orders → Accept → 20 min | Accepted, promised time | "Promised in 20 min" | PASS | p09 |
| Kitchen ticket | Print kitchen ticket, 80 mm | Dishes, options, pickup code, no prices | Exactly that | PASS | p10 |
| Preparing / ready | Start preparing → Ready for pickup | "Waiting for a rider" | Yes | PASS | p12 |
| Section switch | Menu → section off → For 1 hour | Dishes unavailable in menu, quote and checkout | "Off for customers · back Mon, 2:12 pm"; quote lists it in `unavailableItems`; checkout `DISH_OUT_OF_STOCK`; back on works | PASS | p15, p16 |
| Menu buttons | Menu tab | Readable buttons | "Build my whole menu (or read it from photos)" clipped, no padding; same on Replace/Remove | FAIL (medium, T-5) | p13, p17 |
| Upload document | Docs → PAN → number + gallery photo → Submit | In review | "In review", photo shown | PASS | p24 |
| Re-upload, FSSAI number edit | FSSAI → Replace → number 12345 + photo | 14-digit number required | Accepted "12345" | FAIL (medium, T-2) | p28 |
| Photo required | Submit without photo | Refused | "Add a photo of the document" | PASS | p26 |
| Payout figures | Money → Payouts | Sales − commission − TDS | 375 − 52.50 − 3.50 = 319 | PASS | p29 |
| Receipt (receipts only) | Statement → order → Download receipt → folder | PDF receipt | `QuickBites-receipt-QB-306687.pdf`: dishes at kitchen prices, commission 15 %, TDS 1 %, GST note, "Not a GST tax invoice" | PASS | receipt.png |
| Statement wording | Statement | Matches "pay whenever" | Still "paid automatically on the weekly run" (known open owner question, CLAUDE.md §4) | KNOWN | p31 |
| Payout received | After admin pays | Paid with reference | Website: "Rs 319.00 PAID … Reference UTRQA001" | PASS | — |

## Rider app (`in.quickbite.rider`)

| Feature | Steps | Expected | Actual | Result | Screenshot |
|---|---|---|---|---|---|
| Sign in | rider@ / pass123 | Home | Home (old session shown as inline "session expired" text, not the dialog the other apps use) | PASS | r04 |
| Location consent | Go online | Explanation, then system prompt | Consent screen, then Android prompt | PASS | r05, r06 |
| GPS chip | After "While using the app" | "GPS on" | "Location permission is off" for ~5 s, then "GPS on · sending your location" | FAIL (low, T-11) | r07, r08 |
| One-rider offer, 108 s | Kitchen marks ready | Offer to this rider with countdown | "New delivery offer", 97 s / 106 s left a few seconds after ready; ₹30, 390 m | PASS | r09, r22 |
| Operations sees the offer | Admin → Today → Live | Offer line | "With Vikram Singh · 92 s left · 1 asked" | PASS | a07 |
| Decline | Pass | Offer closed, recorded | `declinedByRiderIds: [rdr_vikram_01]`; not re-offered; ops alert "No rider for a cooked order" after 10 min | PASS | — |
| Trip map | Accept | Map with kitchen | Google tiles and kitchen marker | PASS | r10 |
| Call kitchen / customer | Phone buttons | Dialer opens | Dialer opens with the number on the order (seed phones, T-18) | PASS | r11 |
| Pickup code | 1111, then 6508 | Wrong refused, right accepted | "Code not accepted", then "Pickup confirmed" | PASS | r15, r17 |
| Delivery code | 0000, then 8322 | Wrong refused, right completes | "Code not accepted", then "Delivery complete … Rs 30.00 … Cash collected Rs 424.50" | PASS | r20, r21 |
| Document re-upload | Documents (re-upload made through the API) | Old licence still counts | "Your approved driving licence still counts, so you can keep riding"; a staff rejection keeps the rider ACTIVE and online | PASS | r28 |
| Profile details | Profile | Correct data | Email "—" (account has one); pending licence shown with a green tick | FAIL (low, T-14) | r26 |
| Photo-only documents (L5) | API: SVG data, https link, JPG | SVG and link refused | 400, 400, 201 | PASS | — |
| Phone change (PH1) | API `PATCH /riders/me` phone | Refused until SMS codes | 409 `PHONE_CHANGE_NEEDS_CODE` | PASS | — |

## Operations app (`com.quickbite.admin`)

| Feature | Steps | Expected | Actual | Result | Screenshot |
|---|---|---|---|---|---|
| Server setting | 6 taps, set QA URL | Changeable | Default was the live URL; changed to QA before sign-in | PASS | a03, a04 |
| Sign in | admin@ / pass123 | Dashboard | Dashboard, notification prompt | PASS | a05 |
| Live deliveries | Live | Empty, then the offer | As expected | PASS | a06, a07 |
| Restaurant sheet | People → Restaurants → kitchen | Details, COD switch, listing | Shown | PASS | a10, a11 |
| Recommended | Switch on | Listed first and in the no-location list | "number 1 of 1"; the anonymous list now holds only that kitchen | PASS | a12 |
| Pure Veg seal | Switch on for Bangalore Biryani House | Seal outranks kitchen type | Kitchen enters the Pure Veg filter although it sells chicken and mutton, no warning | FAIL (medium, T-3) | a13 |
| Per-person documents | Sheet → Documents | Grouped, photo, download, decide | Download all (ZIP), Show photo, number, Reject/Approve | PASS | a15, a16 |
| Reject a re-upload | FSSAI 12345 → Reject with reason | Re-upload requested; earlier approved licence keeps the kitchen trading | "Bangalore Biryani House is not verified and has been taken off the customer feed. Still needed: FSSAI food licence, PAN card" | FAIL (high, T-1) | a19 |
| Approve after all, approve PAN | Approve both | Back on feed | Back on feed only after PAN too; kitchen left Offline | PASS (see T-1) | a20, a22 |
| Full invoice PDF | API `/admin/orders/:id/invoice.pdf` | Staff only, adds up | admin 200 PDF; partner and customer 403; parts add to ₹424.50 | PASS | invoice.pdf |
| Money figures | Finance, Pay, invoice, dashboard | One figure per order | ₹55, ₹54.50 and ₹41.55 for the same order; "Owed to restaurants ₹319" after it was paid | FAIL (medium, T-4) | a23, a25 |
| Payouts | API: add bank (partner) → approve account → draft → send UTR → draft again | Paid once, second refused | Paid ₹319 (`UTRQA001`); second `NOTHING_PAYABLE`; rider blocked while holding cash | PASS | — |
| Deletion requests | Partner 2 requests → list → complete → sign in | Listed; sign-in refused after | Listed with orders/documents; login 401 after | PASS | — |
| Create / Remove | API create rider; remove with wrong name, right name | Wrong name refused | `CONFIRM_NAME_MISMATCH`, then removed | PASS | — |
| Block after Remove (G1) | Remove, block, sign up again with same email/phone/licence | Refused | 403 `IDENTITY_BLOCKED` | PASS | — |
| Block a customer | Block rahul.sharma, phone-code sign-in | Refused | Token issued, every call then 403 `ACCOUNT_BLOCKED` | FAIL (low, T-8) | — |

## Websites (`/partner`, `/admin`)

| Feature | Steps | Expected | Actual | Result |
|---|---|---|---|---|
| /partner sign in | Email + password, Enter | Signs in | Enter does nothing; the button signs in | FAIL (low, T-17) |
| /partner dashboard and Money | After sign in | Same as app | ₹319, 1 delivered; payout with UTR in history | PASS |
| /admin sign in and dashboard | admin@ | Dashboard | Shown | PASS |
| /admin help ticket reply | Help → Support → ticket → reply | Reply saved, customer pushed | Reply shown, push logged | PASS |

## Old issues re-checked (`docs/reviews/REVIEW_LOG.md`, `docs/SECURITY.md`)

| Item | Check | Result |
|---|---|---|
| L5 photo-only documents | SVG and link uploads | Refused (fixed) |
| L14 `/health` | Health reply on QA | Status and time only, no refusal text (fixed) |
| PH1 rider record phone | `PATCH /riders/me` phone | Refused (fixed) |
| G1 Block after Remove | Remove → block → sign up again | `IDENTITY_BLOCKED` (fixed) |
| S2 single rider re-offered | One rider passes | Not re-offered; ops alert at 10 min (behaviour changed; the "5 riders asked" miscount no longer happens here) |
| R5 customer phone on older orders | Rider trip and calls | Number present on the order |
| Partner "Kitchen not linked yet" flash | Partner sign-in | Not seen |
| Q1 email-change code cap | Not driven to the cap (needs 5 sends a minute apart) | not tested |
| All SECURITY.md rows | Marked fixed in the file | L5, L14 spot-checked above |

## Bugs

**T-1 · High · Rejecting a kitchen's re-uploaded document takes a trading kitchen off the customer feed.**
Steps: Partner → Docs → FSSAI → Replace this photo (any number, photo) → Submit. Admin → People → Restaurants → the
kitchen → Documents → FSSAI → Reject → reason → Ask for a re-upload. Result: "not verified and has been taken off the
customer feed. Still needed: FSSAI food licence, PAN card", although the earlier FSSAI was approved and the kitchen had
been trading with PAN not yet uploaded. Approving FSSAI again does not relist it while PAN is pending; the kitchen is
also left Offline. The rider path keeps "your approved licence still counts" and the rider stays ACTIVE after the same
rejection. Expected: same as riders, a rejected replacement leaves the approved document in force. Suspected:
`apps/backend-api/src/routes/admin/peopleRoutes.ts` `POST /documents/review` (≈ line 820) and the kitchen verification
recompute it calls.

**T-2 · Medium · FSSAI number is not validated.** Steps: Partner → Docs → FSSAI → Replace → number `12345` + photo →
Submit. Accepted and shown to the reviewer; once approved it is the licence printed on bills and receipts. Expected:
14 digits. Suspected: `apps/backend-api/src/routes/restaurantRouter.ts:1050` (any 1–40 characters) and the partner
Docs sheet. PAN (10 characters) and GSTIN have the same gap.

**T-3 · Medium · Pure Veg seal can be put on a kitchen that sells meat, with no warning.** Steps: Operations → People
→ Restaurants → Bangalore Biryani House → Pure Veg seal on. `GET /api/restaurants?pureVeg=true` then returns it, while
its menu has Chicken and Mutton Biryani. Expected: a warning listing the non-veg dishes, or refusal. Suspected:
`apps/admin-mobile` restaurant sheet (Listing) and the seal write in the catalogue curation route.

**T-4 · Medium (money, for the jury and a CA) · Four different figures for the same single order.** One delivered
order (₹424.50): Money → Finance "Net platform revenue ₹55"; Money → Pay "₹54.50 ours"; invoice PDF "Quick Bites keeps
₹41.55"; dashboard "Owed to restaurants ₹319" after that ₹319 was paid (Pay shows ₹0). The invoice also books "GST on
commission ₹9.45" and "TCS ₹3.50", while CLAUDE.md §4 says no GST is charged on the platform's fees without a GSTIN.
Suspected: `economicsOf` (dashboard) vs `splitForOrder` (invoice) vs the payout dues; `routes/admin/dashboardRoutes.ts`
owed figure. The `economicsOf` difference is already listed for the jury in CHANGELOG.

**T-5 · Medium (look) · Partner app buttons have no side padding.** Menu tab: "Build my whole menu (or read it from
photos)" wraps against the left edge and is clipped by the rounded corner; More → Profile: "Replace" / "Remove" touch
their edges. Suspected: `apps/restaurant-mobile/src/components/ui.tsx:200` (`button`: fixed `height: 50`, no
`paddingHorizontal`).

**T-6 · Medium (use) · Customer Edit profile: the keyboard covers the email field.** Profile → Edit → Email Change → tap
"New email": the sheet does not move above the keyboard, so the customer types blind. Suspected:
`apps/customer-mobile/src/screens/ProfileScreen.tsx` (Edit profile sheet, ≈ :750).

**T-7 · Low (privacy) · The kitchen pickup code reaches the customer.** `POST /api/orders` (create reply) and
`GET /api/orders` (list) include `pickupCode`; `GET /api/orders/:id` and `/tracking` strip it. Suspected:
`apps/backend-api/src/routes/orderRouter.ts:275` and `:30` not passing through the same shaping as `:112`
(`contactVisibility.ts`).

**T-8 · Low · A blocked customer still gets a token from phone-code sign-in.** Block a customer, then
`/auth/otp/verify` answers 200 with a token; every later call is 403 `ACCOUNT_BLOCKED`. Password sign-in refuses at once
with the reason. Suspected: `apps/backend-api/src/routes/authRouter.ts` `/otp/verify` (≈ 1259) has no `isBlocked` check.

**T-9 · Low · Partner sign-in error shows an internal role name.** Wrong password → "Invalid credentials or account does
not have 'restaurant_owner' access permissions". Suspected: `authRouter.ts` `/login` message.

**T-10 · Low · Address picker opens on central Bengaluru before location permission.** Cart → Add another address →
Choose on map (no permission yet) → map at 12.97160, 77.59460, about 40 km from Harohalli. Expected: Harohalli (service
area). Suspected: the customer address picker's default region.

**T-11 · Low · Rider GPS chip says "Location permission is off" for ~5 s right after granting it.** Go online → I agree →
While using the app. Suspected: `apps/delivery-mobile` home screen GPS chip reading permission before the grant settles.

**T-12 · Low · Tracking map at the door.** When the rider is at the address the map zooms to street level and the home
marker sits under the bike; no surrounding streets. Suspected: fit-to-markers in
`apps/customer-mobile/src/screens/OrderTrackingScreen.tsx` with two nearly equal points (needs a minimum span).

**T-13 · Low · Help: the customer's own message is not shown after sending.** Help → topic → Talk to us → type → Send:
only "Sent" appears. Suspected: customer Help screen.

**T-14 · Low · Rider profile.** Email shows "—" for rider@quickbite.app; "Driving licence — Pending" has a green tick.
Suspected: `apps/delivery-mobile` Profile screen.

**T-15 · Low · Search.** With the biryani section off, searching "mutton" returns "Ghee Podi Button Idli". Suspected:
search fallback when the matching dish is hidden.

**T-16 · Low (polish).** "Rs" and "₹" mixed inside Partner (Orders/Payouts "Rs", Statement "₹") and Rider (home "₹ 30.00"
next to "Rs 30"); Operations document titles "Fssai", "Pan"; truncated labels "Ask for a re-u…", "Upload a menu (or read
it from ph…"; customer order summary lists the dish without its options; partner header shows "Closed" next to a green
"LIVE".

**T-17 · Low · `/partner` website: Enter does not submit the sign-in form.** The button works.

**T-18 · Low (seed data, not app code) · Seed phones overlap.** Bangalore Biryani House has the demo customer's phone
(`seed.ts:217`), and the rider record's phone is the partner's (`seed.ts:195`), different from the rider account phone.
Calling tests then look wrong though the code dials what is on the order.

**T-19 · Info · Build number.** `build/apk/` holds versionCode 37 for all four apps, not 36 as briefed.

## What an emulator could not test

- **Payments:** Razorpay checkout (and the "Pay now" path, refunds, duplicate capture) — the payment page crashes the
  emulator (`docs/TESTING.md`); only cash orders were run.
- **Background GPS with the screen off**, the foreground-service notification over a long trip, battery behaviour.
- **Push notifications:** no Firebase on the QA server; pushes were checked only as `FCM_PUSH_DISPATCHED … LOG_ONLY` lines.
- **Road line and place names from Google:** no server key on QA, so straight lines and coordinates (expected fallback).
- **Real phone calls, SMS codes, emails** (fixed code; email-change code read from the dev log).
- **Haptics feel and motion smoothness:** only that vibrations fire (vibrator log) and sheets animate; judge on a phone.
- **iPhone app.**
- Not reached this round: rider ↔ customer in-trip chat, Q1 code cap, the admin-app invoice and ZIP buttons themselves
  (the routes were checked), partner help topics (covered by the `helpChat` suite).
