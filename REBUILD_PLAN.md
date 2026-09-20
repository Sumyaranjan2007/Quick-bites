# Quick Bites — the v2 rebuild

**Date:** 20 September 2026
**Shape:** five stages, each one tested and shippable, APKs handed over at the end of each.

Decisions already taken, so they are not re-litigated later:

| Question | Decision |
| --- | --- |
| Razorpay | Native SDK (`react-native-razorpay`), real UPI intent, cards, netbanking |
| Google Maps | Real Google maps everywhere. Key arrives before Stage 2 |
| Two orders, two restaurants | Track both, one rider each. No batching |
| Delivery fee | Distance-based, sensible defaults, admin-editable |
| Wallet top-up | **Removed entirely.** Replaced by a paid membership |
| Membership gives | Extra discount + priority support + free delivery (the existing gold flag) |
| Membership pricing | My defaults, admin-editable |
| Refunds | Always back to the original payment method |
| Theme (rider/partner/admin) | Light cream base, burgundy and gold accents |
| Rider GPS | Foreground only, while on shift. Nothing that needs Play background-location review |
| Rider no-show | Warn → auto-release to the pool → flag the rider |
| Play Store | Nothing obtained yet. Build Play-ready, hand over a checklist |

---

## What I found before planning

Three things change the size of this job, and all three are good news.

**The back button and screen-fitting are already built.** Every app has
`SafeScreen.tsx` and `useHardwareBack.ts`. So "the app closes when I press back"
and "it doesn't fit my phone" are **bugs in existing code**, not missing
features. The work is diagnosis, not construction — but it does mean I cannot
promise a fix until I have found why the existing code is not holding.

**Staying signed in is already built too.** `storedSession.ts` writes the token,
the account and the server address to device storage. So being asked for a phone
number on every launch is a restore path failing, not an absent feature.

**Razorpay is the opposite — it was never wired up.** `CartAndCheckoutScreen`
hardcodes `paymentMethod: 'CASH_ON_DELIVERY'`, and the Razorpay branch beside it
sends a fake signature (`'simulated_valid_signature'`) that only demo mode
accepts. No payment options appear because the app has never offered any. This
is a build.

**Delivery fee is already distance-based** — ₹30 up to 3km, +₹10/km beyond, in
the pricing engine. The defect is that checkout sends `distanceKm ?? 2.5`, so
when it has no real distance it invents 2.5km and every such order is charged
the same. Real distance fixes this without touching the formula.

---

## Stage 1 — foundations — **SHIPPED**

Verified on real APKs except the back-block during an in-flight order, which is
wired and typechecked but was never caught on a device: against a local backend
the order completes in milliseconds, and the emulator's network throttle does
not apply to host loopback. Recorded as unverified rather than claimed.

No API key needed. Everything here is visible on a phone the day it ships.

**All four apps**

- Screens fit every Android device, including three-button navigation bars,
  gesture bars, notches and cutouts. Diagnose why `SafeScreen` is not holding and
  fix it at the root rather than padding individual screens.
- Back button behaves: it goes back. Where going back would be wrong — mid-payment,
  mid-registration — a brief toast says why and the screen stays. Pressing back on
  the *home* screen twice within two seconds exits; once does not.
- Stay signed in until sign-out. Find why the stored session is not being restored.
- Rider, partner and admin move to the cream palette: `#FFF7E8` canvas,
  `#641C32` headers and primary actions, `#FFC928` calls-to-action, `#171313` text.
  Customer app is left alone.

**Customer**

- Logo aligned to match the other three apps. Same logo, different alignment.
- Sign-up bonus set to ₹0 and the code path removed, not just zeroed.
- Bill breakdown collapsed by default at checkout, with one tap to expand the full
  split — before paying, not after.
- Inside a restaurant: one continuous dish list instead of separate sections, with a
  single **Menu** button that jumps to a category.

**Admin**

- Screens fixed for small and large Android devices.
- Role creation restricted to super admin. Every other admin sees only what their
  role permits — no empty screens they cannot use, nothing missing that they need.

**Ships:** four APKs. Everything above is verifiable by you on a phone.

---

## Stage 2 — maps and addresses — **SHIPPED**

Both keys received. Server key on Railway; Android key baked in at build time by
the `withGoogleMapsApiKey` plugin from a gitignored `.env`.

Two things went beyond the plan because they turned out to be the same fault:
the server was inventing `distanceKm = 2.5` for every restaurant, which is where
the fixed "25 mins" on every card came from, and the partner apps had never sent
a restaurant's coordinates at all, so every restaurant on the platform sits at
the centre of Bengaluru until it re-registers.

- `react-native-maps` in the customer and rider apps. Wrapped so that a missing key
  or a failed native module degrades to the existing drawn map instead of crashing.
- The location chip at the top of the customer app opens a real map. Drag a pin,
  the address fills in from Google, add flat number and landmark by hand, save it.
  That is the flow you asked for and it replaces typing an address blind.
- Restaurants listed by region — the area a restaurant is actually in, against where
  the customer actually is, rather than a flat list.
- Delivery time on the home screen computed from the real distance between that
  restaurant and that customer. No fixed number.
- Delivery fee from real road distance. The formula already exists; this feeds it
  the truth instead of `2.5`.
- Partner app captures the restaurant's real location on a map during onboarding,
  which is what makes region-based listing possible at all.

**Ships:** customer and rider APKs with working maps, verified live if the key has
arrived.

---

## Stage 3 — payments and membership — **SHIPPED**

- Razorpay native SDK properly integrated. Test keys, test mode, real checkout
  sheet: UPI intent that opens GPay or PhonePe, cards, netbanking, wallets.
- Payment options at checkout: cash on delivery, plus every method Razorpay offers.
  Not a hardcoded single method.
- Refunds go back to the original payment method, every time. Card and UPI reverse
  through Razorpay and take the 3–7 working days Razorpay states; cash orders
  refund to a credit, because there is nothing to reverse.
- **Wallet top-up removed.** The wallet stays as a refund destination for cash
  orders only, which keeps it a closed loop and out of prepaid-instrument territory.
- **Membership built.** Purchasable through Razorpay, sets the existing gold flag
  and an expiry. Gives: free delivery over the threshold, an extra discount on every
  order, and priority in the support queue. Plans and prices editable from the admin
  app. Benefits apply the moment payment confirms and stop when it expires.

**Ships:** customer APK with real payments. You test with Razorpay test cards.

---

## Stage 4 — ordering and live tracking — **SHIPPED**

- One restaurant per order. Adding a dish from a second restaurant asks whether to
  start a new order rather than silently mixing the bill.
- A second order can be placed while the first is still coming. Both track
  independently.
- A bar at the bottom of the home screen for every order in flight. Tap it, go
  straight to that order's tracking.
- Prep time set by the restaurant when it accepts, not a fixed twenty minutes. The
  countdown already exists and starts from acceptance; this feeds it a real number.
- Tracking map: the restaurant's position and distance once accepted, then the
  rider moving in real time once they are on the way, smoothly rather than jumping.
- Dish-level filters on the home screen: filter by a dish and see every restaurant
  that actually has it.

**Rider**

- Offers by proximity to the rider.
- One trip at a time. No second offer until the current one is delivered.
- Accept-then-no-show: a push at ~5 minutes, auto-release back to the pool at ~8,
  and the rider flagged so a pattern is visible in the admin app.
- Location required while on shift, foreground only.
- Live map to the restaurant on accept; live map to the customer after pickup.
- Earnings computed from the actual payment and distance, not a flat figure.

**Ships:** customer and rider APKs. This is the stage where a full end-to-end
delivery is worth testing across three phones.

---

## Stage 5 — partner, admin, and the Play Store — **SHIPPED**, minus the dish-photo strip on the home card

**Partner**

- A restaurant is invisible to customers until approved and verified, exactly as
  riders already are.
- Dish photos: upload per dish, shown on the dish and scrollable on the restaurant
  card on the customer's home screen.
- Veg and non-veg marked at dish-request time and carried through to the customer's
  menu and veg filter.
- The menu a partner maintains is the menu a customer sees — one source, no copy.

**Admin**

- Coupons work correctly end to end: create, apply, expire, report.
- Support fully working, with tickets from all three apps arriving in one queue.
- Every portal's queries connected so nothing is raised into a void.

**Play Store readiness** (build side — the checklist below is yours)

- Target API level current, permissions minimised and each one justified.
- Data-safety declaration matching what the apps actually collect: location,
  phone number, payment status.
- Privacy policy text written for you to host.
- Release signing verified and the keystores documented.

**Ships:** all four APKs, plus a Play submission checklist.

---

## What only you can do

| When | What | Why |
| --- | --- | --- |
| ~~Before Stage 2~~ | ~~`GOOGLE_MAPS_SERVER_KEY` in Railway~~ | **Done.** |
| ~~Before Stage 2~~ | ~~`GOOGLE_MAPS_ANDROID_KEY` sent to me~~ | **Done.** Restrict it to the four package names and release SHA-1s — that restriction, not secrecy, is what protects it |
| Before Stage 3 | Razorpay **test** key id and secret in Railway | Already partly done — I will verify they are the right pair |
| Before Stage 5 | Google Play developer account, $25 | Takes days to verify identity. Start early |
| Before Stage 5 | Somewhere to host a privacy policy | I write the text; Play rejects without a public URL |
| Before going live | Registered business entity | Needed for Razorpay live keys and a Play account that takes payments |

---

## How this avoids breaking what works

Each stage ends with the full gate — 18 backend suites, production-configuration
checks, nine workspaces typechecked, secret and translation scans — plus rebuilt
APKs that are installed and launched before they are handed over. A stage that
cannot pass that does not ship, and I say so rather than handing over something
unverified.

Two standing rules for this rebuild:

**Nothing is reported as working because it compiles.** Every claim in these
stages is either verified on a device or flagged as unverified when I hand it
over. The delivery-OTP defect found last session had passed every static check
in the repository.

**Existing behaviour is diagnosed before it is replaced.** Three of the biggest
items here turned out to be bugs in code that already exists. Rewriting them
would have cost days and lost whatever they got right.
