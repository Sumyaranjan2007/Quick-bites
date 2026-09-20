# What only you can do

**Version:** 1.2.0
**Date:** 20 September 2026

Everything in this file needs a human with an account, a legal identity, or a
credit card. Nothing here can be done from a code editor. It is ordered so that
each step unblocks the next.

---

## Part 0 — What to do for THIS build, in this order

The variables from the last session are already set and the API is live. This
build adds no variable that the service refuses to start without, so the order
below is about getting a working deploy, not about avoiding an outage.

### Step 1 — push, and wait for Railway to finish

```bash
git push origin main
```

Railway redeploys on push. Watch the deploy log until you see the banner. Two new
lines appear at boot that were not there before, and both are normal:

```
{"event":"ORDER_SWEEPER_STARTED","everySeconds":30,"acceptTimeoutMinutes":8,"riderAlertMinutes":10}
{"event":"PAYMENT_RECONCILIATION_STARTED","everySeconds":180,"reconcileAfterMinutes":5,"abandonAfterMinutes":30}
```

If you do **not** see those two lines, the background jobs did not start: orders
nobody accepts will sit there and lost payments will not be found. Everything
else still works, so it is not an outage — but it is worth a redeploy.

### Step 2 — confirm the deploy is healthy

```bash
curl https://quick-bites-production-9f45.up.railway.app/health
```

Want: `"status":"HEALTHY"` and `"demoMode":false`.

### Step 3 — confirm the new endpoints are live

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://quick-bites-production-9f45.up.railway.app/api/v1/places/status
```

Want **401**, not 404. 401 means the route exists and is correctly asking who you
are. A 404 means the deploy did not take.

### Step 4 — install the four APKs

**Uninstall the old ones first.** These are signed with the same keys, so an
update would normally work, but a clean install avoids any question about stale
state while you are testing.

### Step 5 — nothing else is required

There is no new mandatory variable. Everything added this session has a working
default. The two optional things you may want are in Part 1.4 and Part 1.5 below.

---

## Part 1 — Before anyone can test (required)

### 1.1 Set the Railway environment variables

Railway → your project → the backend service → **Variables**. Add these, then
redeploy.

| Variable | Value | What happens without it |
|---|---|---|
| `ADMIN_EMAIL` | your email address | **The service refuses to start.** |
| `ADMIN_PASSWORD` | a password you choose, **10+ characters** | **The service refuses to start.** |
| `JWT_SECRET` | a long random string (40+ characters) | The service refuses to start. |
| `DATABASE_URL` | Railway sets this for you when a Postgres service is attached — **check it is there** | **The service refuses to start.** It used to come up looking perfectly healthy and write every order to a disk the next deploy throws away. |
| `RAZORPAY_KEY_ID` | your `rzp_test_…` key id (Razorpay dashboard → Test Mode → API Keys) | Online payment is unavailable; cash on delivery still works. |
| `RAZORPAY_KEY_SECRET` | the matching test secret | As above. |
| `OTP_PROVIDER` | `fixed` | Defaults to `fixed` anyway. |
| `OTP_FIXED_CODE` | a 6-digit code you choose, e.g. `472913` | Defaults to `123456`, which is guessable. |
| `OTP_ALLOW_FIXED_IN_PRODUCTION` | `true` | **Nobody can sign into the customer app** — production refuses to issue a fixed code without this. |
| `SEED_DEMO_DATA` | `false` | Demo restaurants would appear on your live platform. |

**Delete `SEED_DEFAULT_PASSWORD`.** It does nothing now.

Two warnings about `OTP_ALLOW_FIXED_IN_PRODUCTION=true`:

- While it is set, **anyone who knows your six-digit code can sign in as any
  phone number**. Only give the code to people you are happy to have full access.
- **Removing it is the switch to real OTP.** Do that the day an SMS provider is
  configured, and not before — remove it earlier and nobody can sign in at all.

### 1.2 Check the deployment came up

Open `https://quick-bites-production-9f45.up.railway.app/health` in a browser.
You want `"status":"HEALTHY"` and `"demoMode":false`. If the service is not
running, the variables above are the first thing to check — it refuses to start
deliberately rather than coming up in a state it cannot honestly serve from.

There are now **four** of those refusals, and each is deliberate:

| Missing | Why it refuses rather than starting |
|---|---|
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | A platform with no administrator cannot approve a single restaurant. Coming up with no way in is not a safer failure than not coming up. |
| `JWT_SECRET` | The source is public. A built-in fallback would be a published signing key, and anyone could mint a token for any account. |
| `DATABASE_URL` | Without it, orders are written to the container's own filesystem, which is destroyed on every deploy. The service would report itself healthy while losing everything. |

### 1.3 Back up the signing keys — do this today

Four upload keystores were created on this machine:

```
C:\Users\priya\quickbites-keystores\
    quickbites-customer.jks
    quickbites-partner.jks
    quickbites-rider.jks
    quickbites-admin.jks
```

Their passwords are in `apps/*/android/keystore.properties` (not in git).

**Copy the folder somewhere that is not this computer** — a password manager, an
encrypted drive, a private cloud folder. If you lose one of these files:

> That app can **never be updated again** under its current name, by sideload or
> on the Play Store. Android refuses to install an update signed by a different
> key. The only fix is a new app identity, which means a new listing with no
> installs and no reviews.

Nobody can recover them for you. Not Google, not Anthropic, not me.

---

## Part 1.4 — Google Maps: what you actually need to buy, and what you do not

You asked whether you need a Google Maps API key. The honest answer is narrower
than the question suggests, and it saves you money, so it is worth reading
before you enable billing on anything.

### What you do NOT need a key for

**The map itself.** The live tracking map in the customer app and the navigation
map in the rider app render real street tiles from OpenStreetMap, which needs no
account, no key and no card. That has been true since before this session. If
what you wanted was "show a real map", you already have it, on every screen that
shows one, for nothing.

### What a key DOES buy

One thing: turning what somebody types into a real address with coordinates.
That is Google Places Autocomplete plus Geocoding, and it is the part that makes
a delivery address reliable — the rider navigates to a point rather than to a
sentence like "blue gate near the temple".

This matters more than it sounds. A wrong address is the single largest cause of
a failed delivery, and a hand-typed one gives nobody any way to tell it is
wrong.

### What it costs

**Ignore anything that tells you about a "$200 monthly credit".** Google removed
it in March 2025 and replaced it with a free allowance *per SKU*. Most articles
online are still out of date on this. The replacement is better for you: 70,000
free calls per SKU per month on the India price list, rather than one shared
$200 that everything drew from.

Two facts decide almost the whole bill:

**The map inside the apps is free.** Drawing a Google map in an Android app is
the *Mobile Native Dynamic Maps* SKU, which has unlimited free usage. No
per-load charge, no cap. The customer's tracking map, the address picker and the
rider's trip map cost nothing however often they are opened.

**What is metered is asking questions about places** — searching an address,
turning a pin into an address, measuring a road distance. All of those are
70,000 free per month each, and this platform makes roughly four of them per
order. At 50 orders a day you are not close to any cap; full workings are in
`QUICK_BITE_COMPLETE_RESEARCH.md` §2.1.

You still have to put a card on file — Google will not enable the APIs without
one — but at your stage you are very unlikely to be charged.

### Two keys, protected in two different ways

This is the part worth getting right, because the two keys are not
interchangeable and mixing them up is the expensive mistake.

| | **Server key** | **Android key** |
|---|---|---|
| Used for | Address search, pin→address, road distance | Drawing the map |
| Lives in | Railway only | Baked into each APK at build time |
| Restricted by | **IP address** + a list of APIs | **Package name + SHA-1** + Maps SDK only |
| Secret? | **Yes.** Treat it like a password | No — it ships inside every APK |

The Android key being extractable is not a flaw; it is how Google designed it.
Anyone can pull it out of an APK with `unzip`. What makes it useless to them is
the package-name and certificate restriction: without your keystore they cannot
sign an app that key will answer for. **So the restriction is not optional — it
is the entire protection.**

The server key is the opposite. It cannot be app-restricted, it bills per call,
and an unrestricted one that leaks is somebody else's bill arriving at the end
of the month. It lives on the server, the apps call the server, and the server
calls Google — which is also what makes the caching and rate limiting possible.

### Getting the keys (about fifteen minutes)

1. **console.cloud.google.com** → sign in.
2. Top bar → project dropdown → **New Project**, name it `quick-bites`, create.
3. Make sure that project is selected before doing anything else. Doing this in
   the wrong project is the most common mistake here.
4. **Billing** → **Link a billing account** → add a card.
5. **APIs & Services** → **Library**, and **Enable** each of these:
   - **Places API** — address search. If your project only offers "Places API
     (New)", enable that and tell me, because the code calls the legacy
     endpoints and I would need to change it.
   - **Geocoding API** — the address at a dropped pin.
   - **Distance Matrix API** — road distance for the delivery fee.
   - **Directions API** — road routes, used from Stage 4.
   - **Maps SDK for Android** — drawing the map in the apps.

#### The server key

6. **Credentials** → **Create credentials** → **API key**. Copy it.
7. **Edit API key** before closing:
   - **Application restrictions** → **None**.

     This is deliberate and it is the opposite of what this guide said before.
     IP restriction is the right answer on a host with a fixed address; Railway
     does not give you one on the plans this runs on, so an IP allow-list either
     blocks your own server today or breaks silently the next time the
     deployment moves. The symptom is not an error on screen — address search
     simply returns nothing, exactly as it would if no such street existed.

     What protects this key instead: it exists only as a Railway variable, it
     never enters an APK (`check-apk-secrets.mjs` fails any build that contains
     one), and it is limited to four APIs below. If you later move to a host
     with a static egress IP, add it here.

   - **DO NOT reuse the Android key here.** An Android-restricted key refuses
     every server-side call with `REQUEST_DENIED — This IP, site or mobile
     application is not authorized to use this API key`, and the apps degrade to
     manual address entry with nothing on screen to say why. These are two
     separate keys with two different restrictions; that is the whole point of
     there being two.
   - **API restrictions** → **Restrict key** → tick **Places**, **Geocoding**,
     **Distance Matrix** and **Directions**. Do **not** tick Maps SDK for
     Android; that belongs to the other key.
   - Name it `quick-bites-server` so you can tell them apart later.
8. Railway → backend service → **Variables**:

| Variable | Value |
|---|---|
| `GOOGLE_MAPS_SERVER_KEY` | the server key |
| `PLACES_REGION` | `in` |

#### The Android key

9. **Credentials** → **Create credentials** → **API key** again. Copy it.
10. **Edit API key**:
    - **Application restrictions** → **Android apps** → **Add** an entry for
      each of the four apps below. All four go on the one key.
    - **API restrictions** → **Restrict key** → tick **only** **Maps SDK for
      Android**.
    - Name it `quick-bites-android`.

| Package name | SHA-1 certificate fingerprint |
|---|---|
| `com.quickbite.app` | `27:73:59:D7:0F:68:63:1D:AF:63:FA:6C:EC:DA:CF:0D:14:25:F4:65` |
| `com.quickbite.rider` | `51:12:84:DC:BD:56:59:24:2C:0D:AF:89:FA:E1:15:3A:72:8F:4E:D4` |
| `com.quickbite.partner` | `90:CB:40:3A:70:B4:97:0D:3D:A1:32:1D:FB:DB:08:E1:8D:69:6E:89` |
| `com.quickbite.admin` | `E7:90:8F:36:AE:E4:79:17:A7:7E:F9:87:D9:6D:50:57:A6:A9:01:FF` |

> The admin fingerprint changed on 20 September. Its original keystore was
> created without its password being recorded anywhere, so the app was silently
> falling back to the ANDROID DEBUG KEY — unpublishable, and unable to update an
> existing install. A fresh keystore was generated; the admin app had never been
> published, so nothing was lost but the entry in this table. If you had already
> registered `A5:22:F2:…` in the Cloud console, replace it with the value above.

These fingerprints are from the release keystore this project signs with. If
you ever publish through Google Play with Play App Signing, Play re-signs your
app with **its own** key and you must add Play's SHA-1 here too, or the maps go
grey in the Play build while working perfectly in your sideloaded one.

11. The Android key goes in the **repository-root `.env`**, not in Railway and
    not in any file git tracks:

```
GOOGLE_MAPS_ANDROID_KEY=AIza...
```

    The build reads it from there. If it is absent the apps still build and run
    — they fall back to the drawn map they had before — so a missing key costs
    a feature and never a crash.

### How to tell it worked

Address search: customer app → Profile → Saved addresses → Add an address. A
**"Search your street, building or area"** box appears at the top. No box means
the server key is not reaching the backend.

The map: same sheet → **Choose on map**. Real streets means the Android key and
its restrictions are right. A **grey square with a Google logo** means the key
is present but rejected — almost always the package name or SHA-1 not matching.
The words *"Map not available in this build"* mean there is no key at all.

### If address search comes back empty

The health endpoint says whether the key reached the server:

```bash
curl -s https://quick-bites-production-9f45.up.railway.app/health | grep -o '"addressLookup":{[^}]*}'
```

`"configured":true` only means a key is SET. Whether Google accepts it is a
different question, and the answer is in the Railway logs:

```
PLACES_API_REFUSED   googleStatus=REQUEST_DENIED   detail=...
```

That line names the cause in Google's own words. The three that actually happen:

| `detail` says | What to change |
|---|---|
| "This IP, site or mobile application is not authorized" | Application restrictions are blocking your server — set them to **None**, or you pasted the Android key |
| "This API project is not authorized to use this API" | The API is not enabled in the Library |
| "You must enable Billing" | No card on the project |

---

## Part 1.5 — Optional timings you can tune

All of these have working defaults. Set them only if the defaults do not suit
you. Railway → Variables → redeploy.

| Variable | Default | Raise it if | Lower it if |
|---|---|---|---|
| `ORDER_ACCEPT_TIMEOUT_MINUTES` | `8` | Your kitchens are slow to reach a tablet during a rush | You would rather refund fast than keep people waiting |
| `RIDER_ASSIGN_ALERT_MINUTES` | `10` | You have plenty of riders and few false alarms | You want the control room told sooner |
| `ORDER_SWEEP_INTERVAL_SECONDS` | `30` | — | — (30s is already cheap) |
| `DELIVERY_PROXIMITY_METRES` | `300` | You deliver to large gated complexes and see false flags | You deliver in a dense area and want tighter checking |
| `PAYMENT_RECONCILE_AFTER_MINUTES` | `5` | — | You want lost payments found faster |
| `PAYMENT_ABANDON_AFTER_MINUTES` | `30` | Your customers take a long time over bank OTP screens | — |

---

## Part 1.6 — The switches, and where to find them

New this build: seven things you can turn off from the admin app without a
deploy. This is what you reach for at eight in the evening when the payment
gateway starts failing — a toggle instead of a forty-minute code change.

Admin app → **Switches** in the left rail. Each one says what stops working
and what the affected person is told.

| Switch | Turn it off when |
|---|---|
| Accept new orders | Something is badly wrong and you need to stop the bleeding. Orders already placed carry on cooking and delivering. |
| Online payment | The gateway is failing. Customers are offered cash on delivery instead of a spinner. |
| Cash on delivery | You do not want riders carrying cash tonight. |
| Coupon codes | A code has leaked or is being farmed, and you do not yet know which one. |
| New sign-ups | You are seeing scripted registration. Existing accounts sign in normally. |
| Offer orders to riders | You want to assign deliveries by hand instead of broadcasting them. |
| Background jobs | You are investigating the sweeper or reconciliation and want them to stop. |

Every flip is recorded against your name in the audit trail, with the note you
type when you flip it. Write a real note — "gateway 5xx, ticket 4412" is worth a
great deal at 2am.

Under the switches you will also see **Dependencies**, which shows whether the
payment gateway circuit is open. If it says open, the platform has stopped
calling Razorpay because it failed five times in a row, and it will try again by
itself after thirty seconds.

---

## Part 1.7 — Where "Server settings" went

It is no longer visible on any of the four sign-in screens. You asked for that:
no customer needs a "Backend API URL" box, and one typed into by accident leaves
an app that looks broken with no obvious way back.

**To reach it: tap the logo six times, quickly.** The field appears below, for
the rest of that session. It works identically in all four apps.

Nothing was removed — a tester can still point a build at a different server.

---

## Part 2 — Handing the apps to testers

### 2.1 Tell every tester to uninstall the old Quick Bites apps first

This build is signed with **different keys** from v1.2.0 and v1.2.1, so Android
will refuse to install it over an older copy and show a confusing error. Long-press
each old Quick Bites icon → Uninstall. No data is lost; it all lives on the server.

Every build after this one keeps the same keys, so this is a one-time step.

### 2.2 What to send them

The four APKs, and this: **paste full `https://…` links, never a bare file name.**
A file name typed into a phone's address bar becomes a Google search — that
already cost one of your testers an entire afternoon on unrelated apps.

### 2.3 What they will find

**The platform starts empty.** No restaurants, no riders, nothing. That is
deliberate: a demonstration restaurant a real customer can order from is worse
than an empty screen.

To get from empty to a delivered order:

1. **You**, in Quick Bites Operations: sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. **A tester**, in Quick Bites Partner: register a restaurant (name, address,
   city, pincode, FSSAI number), then upload a document from inside the app.
3. **You**: Documents → approve it. The restaurant becomes visible to customers.
4. **The partner**: add at least one menu item.
5. **A tester**, in Quick Bites Rider: register, upload a document.
6. **You**: approve the rider. They can now go on shift.
7. **A tester**, in Quick Bites: enter a phone number, enter your fixed code,
   order.

### 2.4 What is new in this build

Beyond sign-in by phone, five features arrived with this release. Each is worth
a minute of a tester's time:

- **Order again**, on any finished order in history. It shows what has changed
  since last time — a price that moved, an item that is out of stock, a dish
  that left the menu — *before* anything reaches the cart.
- **Tip the rider**, at checkout. The whole tip reaches the rider: no
  commission, no GST, and a percentage coupon cannot discount it.
- **A live arrival time** on the tracking screen, which actually moves. It
  counts down the kitchen's own promise while the food cooks, and switches to
  the rider's real position once the food is collected — never before.
- **Filters and sorting** on the home screen: veg, under 30 minutes, rated 4+,
  open now, under Rs 400 for two. They combine, and the server applies them.
- **Cancel with a reason**, and a paid order refunds itself in the same step
  rather than leaving anyone to chase support.

### 2.5 The full journey to check

Customer orders → partner accepts with a prep time → partner marks ready →
rider (on shift) gets the offer and claims it → rider collects using the
**pickup code** shown on the kitchen screen → **the customer's map now starts
moving** (it is dark before pickup, deliberately) → rider delivers using the
**4-digit OTP** the customer shows → operations sees all of it live and the
settlement ledger updates.

---

## Part 3 — Before you launch for real

### 3.1 TRAI DLT registration — start this early, it is the long pole

**Indian law blocks every commercial SMS to an Indian number unless you are
registered.** No provider can get around it, and switching provider does not
make it faster. Three approvals, each taking days:

1. **Entity registration** on a DLT portal (Jio, Airtel, Vi or BSNL — one
   propagates to all). Needs PAN, GST and an authorised signatory.
2. **Header / sender ID** — the six characters messages appear to come from,
   e.g. `QCKBTE`.
3. **Template approval** — the exact message text. What you send must match it
   character for character or the operator silently drops it.

Template to register:

```
{#var#} is your Quick Bites verification code. Valid for 5 minutes.
Do not share it with anyone.
```

Then pick a provider (MSG91 is the usual choice for Indian OTP volume), and tell
me — adding it is one file. Finally, **remove `OTP_ALLOW_FIXED_IN_PRODUCTION`**.

### 3.2 Razorpay live keys

Test mode works today and moves no real money. For live keys Razorpay needs:

- Business KYC: PAN, bank account, GST or a declaration of exemption.
- **Publicly reachable** privacy policy, terms, refund/cancellation policy and
  contact page. The text exists in `legal/`; it needs to be hosted at real URLs.

Then swap the two key values. Nothing in the code changes.

**Never let anyone add a card-number form to any screen.** Card details must
only ever be typed inside Razorpay's own checkout — anything else puts you in
PCI-DSS scope and outside RBI rules at the same time.

### 3.3 Business and legal

- **GSTIN registration** for the platform entity, and tax invoices carrying your
  GSTIN, the restaurant's GSTIN and an HSN/SAC code. The figures are calculated
  (5% GST, 15% commission, 1% TDS); the invoice document is not yet generated.
- **Grievance officer** — the Consumer Protection (E-Commerce) Rules 2020
  require a named officer with contact details displayed, complaints
  acknowledged within 48 hours and resolved within a month.
- **Verify each restaurant's FSSAI licence** against the public register. The
  number is collected and stored; nothing checks it is real.
- **Rider engagement terms** — whether riders are contractors or employees, and
  any social-security obligation, is a question for a lawyer.

### 3.4 Google Play

- Play needs an **AAB**, not an APK (`bundleRelease` rather than
  `assembleRelease`).
- A **hosted privacy policy URL** is mandatory in the listing.
- A **data safety declaration** — the table is prepared in
  `legal/COMPLIANCE.md` §6.
- A **web page for account deletion**, as well as the in-app path that exists.
- A **prominent location disclosure** in the rider app before the permission
  prompt, explaining what is collected and why.
- Play Console account (one-time fee), content rating, store listing.

---

## Part 4 — Decisions waiting on you

| Question | Why it matters |
|---|---|
| Which SMS provider? | Determines which driver I write. MSG91 recommended for India. |
| Should the partner, rider and admin apps be translated too? | The customer app is complete in English, Hindi and Kannada and is checked for it on every build. The three staff apps have no translation layer at all. That matches how most Indian delivery platforms work — staff tools stay in English — but it is a decision, and right now it is one nobody has actually made. |
| Should the customer app show the Razorpay checkout? | The server side is finished and verified. Presenting it in the app needs a native module, and I would want an emulator on the build machine first — this project has a history of a build that passed every check and died at launch because of one. |
| Feature pass? | Reorder, tipping, live ETA, search filters and cancellation reasons are specified but not built. |
| Custom domain? | Nicer than a `railway.app` address, and needed before Play submission looks credible. |

---

## Quick reference

```bash
# Is the hosted API alive?
curl https://quick-bites-production-9f45.up.railway.app/health
```

```bash
# Run every check locally: secrets, hardcoded URLs, diagnostics, types, tests
npm run verify
```

```bash
# Rebuild all four APKs (must be run from a path with no spaces — use D:\qb)
cd /d/qb && bash scripts/build-apks.sh
```
