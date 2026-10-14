# Quick Bites on iPhone — the owner's guide

**Last updated:** 14 October 2026 · **App:** Quick Bites (customer) only · **iPhone bundle id:** `in.quickbites.app` (Android stays `com.quickbite.app`)

This is the same app as the Android customer app, built from the same code, talking to the
same live server (`https://quick-bites-production.up.railway.app`). An account made on Android
signs in on iPhone with the same phone number and sees the same orders, addresses and Gold
membership. The Partner, Rider and Operations apps stay Android-only.

Nothing in this file is a secret. Where a key or password is needed, this file says **where**
it goes, never what it is.

---

## 1. What you must buy or sign up for — in this order

| # | What | Cost | Where | Notes |
|---|---|---|---|---|
| 1 | **Apple ID with two-factor sign-in** | Free | appleid.apple.com | Use the business email if you can. |
| 2 | **Apple Developer Program** | **US$99 a year** (Apple shows the rupee price at checkout) | developer.apple.com/programs/enroll | See "Individual or Organization" below. Approval takes from a day to two weeks. |
| 3 | **App Store Connect** | Free (comes with #2) | appstoreconnect.apple.com | Where the app record, screenshots and review answers live. |
| 4 | **Apple push key (.p8)** | Free | developer.apple.com → Certificates, IDs & Profiles → **Keys** | Downloadable **once**. Keep it with the Android keystores. |
| 5 | **Expo account** | Free | expo.dev/signup | Lets you start iPhone builds from the Windows PC. The free plan has a monthly limit of iPhone builds in a slower queue — enough for this. Paid plans only make builds faster. |
| 6 | **Mac software** (backup builds, Simulator) | Free | Mac App Store: **Xcode**; nodejs.org: **Node.js 22**; Terminal: CocoaPods | Apple requires apps built with **Xcode 26**, so the Mac needs a recent macOS. |
| 7 | **An iPhone** for testing | — | — | Push notifications and the UPI payment apps only work on a real phone. |

**Total required spend: US$99 a year.**

### Individual or Organization?

- Your Udyam certificate says **Proprietorship** → enrol as an **Individual**. Apple does not
  accept a sole trader's business name as an organisation. The App Store shows your own name
  as the seller.
- It says **Private Limited** → enrol as an **Organization** with the D-U-N-S number you are
  getting for Google Play. The App Store shows "QUICK BITES".

Either way, food delivery is not one of the fields where Apple insists on an organisation.

---

## 2. One-time setup

### 2.1 Apple push key → Railway (makes iPhone notifications work)

1. developer.apple.com → Certificates, IDs & Profiles → **Keys** → **+**.
2. Name it `Quick Bites push`, tick **Apple Push Notifications service (APNs)**, choose
   **Sandbox & Production**, Continue, Register.
3. **Download** the `AuthKey_XXXXXXXXXX.p8` file. Note the **Key ID** (10 characters) shown on
   the page, and your **Team ID** (top-right of the developer site, under your name).
4. Railway → project **endearing-ambition** → backend → **Variables**, add:

   | Variable | Value |
   |---|---|
   | `APNS_KEY_ID` | the 10-character Key ID |
   | `APNS_TEAM_ID` | the 10-character Team ID |
   | `APNS_PRIVATE_KEY` | open the .p8 file in Notepad and paste **everything**, including the first line (BEGIN PRIVATE KEY between dashes) and the last line (END PRIVATE KEY) |
   | `APNS_BUNDLE_ID` | `in.quickbites.app` — the iPhone bundle id (it differs from Android's) |

   **Done 13 Oct 2026:** key `Y5SGGTTN2X` (Team Scoped, Sandbox & Production) is set on Railway and
   `/health` shows `applePush.configured: true`. A second key, `MUY24DP4Z3`, exists unused — leave it.

5. Click **Deploy**. Then open `https://quick-bites-production.up.railway.app/health` — it must
   show `"applePush":{"configured":true}`.

Android notifications are not touched by this; they keep going through Firebase.

### 2.2 Expo account and the project link (on the Windows PC)

Open PowerShell in `D:\my all projects\quick bites\apps\customer-mobile` and run, one at a time:

```bash
npx eas-cli@latest login
```

```bash
npx eas-cli@latest init
```

`init` writes the Expo project id into `app.json`. **Commit that change** (or ask the developer
to): every later build needs it.

### 2.3 The two map tokens on Expo (they are not in git)

expo.dev → your project → **Environment variables** → **Add**, for the **production** and
**preview/development** environments:

| Name | Value | Visibility |
|---|---|---|
| `MAPBOX_PUBLIC_TOKEN` | the `pk.…` token from the root `.env` on this PC | Plain text |
| `MAPBOX_DOWNLOAD_TOKEN` | the `sk.…` token from the root `.env` on this PC | **Secret** |

The `sk.` token only lets the build machine download the map library
(`scripts/eas-mapbox-netrc.mjs` writes it to that machine's `~/.netrc`). It is never put inside
the app. **The iPhone build does not actually need it** (checked 14 Oct 2026): CocoaPods
downloads the Mapbox iOS SDK (MapboxMaps 10.19) without a token. Only Android's Gradle download
does. Setting it on Expo does no harm.

### 2.4 The app record in App Store Connect

App Store Connect → **Apps** → **+** → **New App**:

- Platform **iOS**, Name **Quick Bites: Food Delivery** — "Quick Bites" alone is taken on the
  App Store. Created 13 Oct 2026, Apple ID `6822422503`. The name under the icon on the phone
  stays "Quick Bites" (that comes from the app, not the listing).
- Primary language **English (India)** or English (U.K.)
- Bundle ID **in.quickbites.app** (registered 13 Oct 2026 with Push Notifications on team
  `SPZBSG55FZ`). `com.quickbite.app` and `com.quickbites.app` were already taken by other
  Apple developers — bundle IDs are unique across all of Apple — so the iPhone app cannot use
  the Android package name. It can never change after the first upload.
- SKU `quickbites-customer-ios`, User access **Full access**

---

## 3. Building — from Windows with EAS (normal way)

**Never run EAS for Android.** Android APKs are built with `scripts/build-apks.sh` and the
keystores on this PC; an EAS Android build would be signed with a different key and could
never update the app on people's phones.

### For TestFlight / the App Store

In `apps/customer-mobile`:

```bash
npx eas-cli@latest build --platform ios --profile production
```

The first time, it asks for your Apple ID and offers to create the certificates and
provisioning profile — say **yes** and let EAS manage them. The build number goes up by itself
on every build. When it finishes (20–40 minutes in the free queue):

```bash
npx eas-cli@latest submit --platform ios --latest
```

The build appears in App Store Connect → **TestFlight** after Apple processes it (10–30 min).
Install the **TestFlight** app on your iPhone, accept the invite, and test.

### For the Mac Simulator (no Apple account needed for this one)

```bash
npx eas-cli@latest build --platform ios --profile simulator
```

Download the `.tar.gz` from the link, double-click it, and drag the `Quick Bites.app` onto an
open Simulator window.

### If the first iPhone build fails while compiling

Apple now requires Xcode 26, and `eas.json` asks EAS for its latest Xcode. This app is on
Expo SDK 52, which was made before Xcode 26. Its `fmt` library (bundled by React Native)
does not compile as C++20 under Xcode 26 ("call to consteval function … is not a constant
expression" inside `Pods/fmt`). The `withFmtCxx17` plugin in `app.json` compiles that one
library as C++17, which fixes it on both EAS and a Mac.

The same Xcode then fails at the **last** step, linking, with `Undefined symbols:
__OBJC_PROTOCOL_$_ExternalWalletSelectionProtocol` (and `…PaymentCompletionProtocolWithData`).
`react-native-razorpay` imports only `Razorpay-Swift.h`, which forward-declares those two
protocols, and the new compiler no longer produces them from a forward declaration. The
`withRazorpayXcode26` plugin pre-includes `RazorpayCore-Swift.h` (where they are defined) for
that one pod. Both plugins are in `app.json` and survive `expo prebuild --clean`.

If the build log shows other compile
errors inside React Native or a library (not in our code), tell the developer: the fix then
is an Expo SDK upgrade, which also needs a new Android release.

---

## 4. Building on your Mac with Xcode (backup way)

One-time:

1. Install **Xcode** from the Mac App Store, open it once, accept the licence, install the iOS
   platform it offers.
2. Install **Node.js 22** from nodejs.org.
3. In Terminal: `sudo gem install cocoapods`
4. `git clone https://github.com/Sumyaranjan2007/Quick-bites.git` and `cd Quick-bites`
5. Create a file named `.env` in that folder with the line `MAPBOX_PUBLIC_TOKEN=…` (same value as
   on the PC, or the backend's `MAPBOX_ACCESS_TOKEN` from Railway). It is ignored by git.
   `MAPBOX_DOWNLOAD_TOKEN` is not needed for iPhone; without it `npx expo prebuild` prints an
   *Android* warning, which is safe to ignore here, and `node scripts/eas-mapbox-netrc.mjs` below
   can be skipped.

Each time:

```bash
npm ci
```

```bash
node scripts/eas-mapbox-netrc.mjs
```

```bash
cd apps/customer-mobile && npx expo prebuild --platform ios --clean
```

- **Run in the Simulator (test build):** `npx expo run:ios`
- **Run on your iPhone (plugged in by cable):** `npx expo run:ios --device --configuration Release`
- **Send to App Store Connect:** `open ios/QuickBites.xcworkspace` → select the **QuickBites**
  target → **Signing & Capabilities** → Team = your team → **General** → set **Build** higher
  than the last build in App Store Connect → menu **Product → Archive** → **Distribute App** →
  **App Store Connect** → Upload.

A Simulator test build (`run:ios` without `Release`) is a developer build: it shows the hidden
"Server settings" after six taps on the logo. Store builds never do.

---

## 5. Test checklist (Mac Simulator and iPhone)

Tick each line on the **TestFlight** build (that is what Apple reviews). "Expected" is what must
happen. Anything else is a bug — note the step number and send a screenshot.

**Setup:** one Android phone with Quick Bites already signed in (account A); one phone number
that has never used Quick Bites (account B); the iPhone.

### A. First open, browsing without an account

| # | Do this | Expected |
|---|---|---|
| A1 | Install, open | Home screen with restaurants. **No sign-in screen first.** |
| A2 | Look at the top of the screen and the bottom bar | Nothing hidden under the notch / Dynamic Island or the home bar. |
| A3 | Search "dosa"; tap the microphone and say "biryani" | Results appear. The microphone asks permission with the Quick Bites reason. |
| A4 | Tap **Deny** on the microphone prompt; try again | A clear message, no crash. |
| A5 | Open a restaurant | Slides in from the right. Menu shows; no heart icons (guests have no favourites). |
| A6 | From the left edge, swipe right | Goes back to the home screen. |
| A7 | Add a dish with sizes and extras | The choice sheet works; the phone gives a light tap. |
| A8 | Tap **View Cart** | Sign-in screen with **Not now** at the top. |
| A9 | Tap **Not now** | Back to the restaurant; basket still there. |
| A10 | Tap **Profile** | Sign-in screen. |

### B. Sign in

| # | Do this | Expected |
|---|---|---|
| B1 | New number (account B) and your email → **Send Code** | The code arrives **by email** (check spam). Enter it on the code screen. |
| B2 | Enter a wrong code | "That code is not right", no crash. |
| B3 | Right code | "Welcome" name step → enter name → lands on the screen you came from (basket intact). |
| B4 | Allow notifications when asked | — |
| B5 | Sign out, sign in with **account A** (the Android account) | Same name, saved addresses, past orders and Gold status as on Android. |
| B6 | Close the app fully and reopen | Still signed in. |

### C. Ordering

| # | Do this | Expected |
|---|---|---|
| C1 | Basket → add a delivery address; tap the address fields | The keyboard never covers the field being typed in. |
| C2 | Allow location when asked | Map shows your position. Reason text is the Quick Bites one. |
| C3 | Check the bill | Same items, fees and total as Android shows for the same basket. |
| C4 | **Online order:** pay with UPI | Razorpay sheet opens; your UPI apps (GPay, PhonePe, Paytm…) are listed. Pay → success tap → tracking screen. |
| C5 | Online order, close the Razorpay sheet without paying | "Payment cancelled" style message, **not** "payment failed"; no order charged. |
| C6 | **Cash order** at a restaurant that allows cash | Cash option shown; order placed. |
| C7 | Restaurant that does not allow cash | Cash option not shown. |
| C8 | Tracking screen | Live status, map with restaurant and you, the **delivery code**. |
| C9 | Lock the phone; let the restaurant accept and the rider pick up | **Notifications arrive on the lock screen.** |
| C10 | Tap a notification | Opens Quick Bites. |
| C11 | Cancel an order (before the kitchen accepts) | Cancelled, refund message if paid online. |
| C12 | Delivered order → rate it; reorder it from Order history | Both work. |
| C13 | Chat with the rider; call the rider | Chat works; the call opens the iPhone dialler. |

### D. Account and help

| # | Do this | Expected |
|---|---|---|
| D1 | Profile | Big "Profile" title, no back arrow. |
| D2 | Profile → photo → Camera / Photos | Asks permission with Quick Bites' reason; Deny gives a message, no crash. |
| D3 | Profile → **Privacy policy**, **Terms of use** | Open in Safari, show the current pages. |
| D4 | Help & support → call, WhatsApp, email | Each opens the right app. |
| D5 | Quick Bites Gold → buy | Razorpay sheet; after paying, the Gold badge shows. |
| D6 | Notifications switch off / on | Works. |
| D7 | **Delete my account** (use account B, never A) | Sends a code; after entering it the app signs out. Signing in again with that number makes a **new** empty account. |

### E. Bad conditions

| # | Do this | Expected |
|---|---|---|
| E1 | Airplane mode, open the app | "Check your connection" messages, no crash, no endless spinner. |
| E2 | Turn the network back on, pull down to refresh | Loads. |
| E3 | Settings → Quick Bites → turn **Location**, **Notifications**, **Camera**, **Photos** off | The app still works; you can type an address by hand. |
| E4 | Settings → Accessibility → **Larger Text** to the biggest size | Text grows; nothing important is cut off. |
| E5 | Settings → Accessibility → Motion → **Reduce Motion** on | Screens change without sliding. |
| E6 | Phone in **Dark Mode** | The app stays in its own light colours and is readable. |
| E7 | Small iPhone (SE in the Simulator) and the largest Pro Max | Nothing overlaps; buttons reachable. |

---

## 6. What to fill in on App Store Connect

### App Information
- **Name:** Quick Bites: Food Delivery · **Subtitle (30):** `Local food, delivered fast`
- **Category:** Food & Drink (no secondary)
- **Content rights:** "Yes — contains third-party content and I have the rights" (restaurant
  photos and menus supplied by partners)
- **Age rating:** answer the questionnaire honestly. Quick Bites has no violence, gambling,
  alcohol sales or mature content. It **does** have a chat between customer and rider about an
  order — answer "yes" to messaging if asked. Accept whatever rating results.

### Pricing and Availability
- **Price:** Free · **Availability:** **India only** (delivery exists only in your service area)

### App Privacy
- **Privacy Policy URL:** `https://quick-bites-production.up.railway.app/privacy`
- **Data collection** — **published 14 Oct 2026.** "Yes, we collect data", then exactly these.
  For every one: **Linked to the user: Yes**, **Used for tracking: No**, purpose **App Functionality**
  (Precise Location also **Analytics**, for the Mapbox map's usage statistics).

  | Apple category | Data type | Why |
  |---|---|---|
  | Contact Info | Name, Email Address, Phone Number, Physical Address | Account; sign-in by phone number + a code sent to the email; delivery |
  | Location | Precise Location | Delivery address and distance; Mapbox map statistics |
  | User Content | Emails or Text Messages | Order chat with the rider/restaurant |
  | User Content | Photos or Videos | Profile photo |
  | User Content | Customer Support | Help requests and refund requests |
  | User Content | Other User Content | Order ratings |
  | Identifiers | User ID | The account id |
  | Identifiers | Device ID | Push notification token |
  | Purchases | Purchase History | Orders and Gold |
  | Financial Info | Payment Info | Card/UPI details entered in Razorpay's sheet |

  Not collected: no crash reporter, analytics or advertising SDK is in the app (checked
  against `package.json` on 14 Oct). Voice search uses Apple's speech recognition; the
  app sends only the resulting text as a search, which the server does not store.

- **Tracking:** No. There are no advertising or tracking libraries, so the app never shows
  Apple's "Allow tracking?" prompt (App Tracking Transparency does not apply).

### This version
- **Screenshots (checked in App Store Connect on 14 Oct 2026):** the only **required** set is
  **"iPhone with Dynamic Island (medium display)"** — 6.1"/6.3", portrait **1206 × 2622** or
  1179 × 2556 (API type `APP_IPHONE_61`), 1–10 images. Everything else is optional: large display
  1320 × 2868 / 1290 × 2796 / 1260 × 2736, iPhone Duo 1398 × 2034 / 2007 × 2853, older iPhones,
  and iPad (the app is iPhone-only). Take them with `scripts/app-store/screenshots.sh`
  (`SIZE=6.3` = iPhone 17 Pro, the default; `SIZE=6.9` = iPhone 17 Pro Max): `prepare`, then
  `shot 03-home` … after each screen, `check`, `finish`. It sets a clean status bar (9:41, full
  signal and battery). Set: home, restaurant, basket, checkout, tracking, profile.
- **Promotional text (170):** `Order from restaurants around Harohalli and track your food live, from the kitchen to your door.`
- **Description:** the "Full description" in `docs/play-store/listings.md` §1 (it fits Apple's
  4,000-character limit as it is).
- **Keywords (100):** `restaurants,order,biryani,dosa,veg,meals,lunch,dinner,takeaway,harohalli,ramanagara,kanakapura` (94/100 — "food" and "delivery" are left out because the app name already contains them, and Apple indexes the name)
- **Support URL:** `https://quick-bites-production.up.railway.app/terms` (it lists your email
  and phone) · **Marketing URL:** leave empty
- **Version:** 1.4.0 · **Copyright:** `2026 QUICK BITES`
- **Build:** pick the TestFlight build you tested.

### App Review Information
- **Sign-in required:** Yes
  - **User name:** the reviewer phone number (`OTP_REVIEW_PHONE` on Railway) — 10 digits
  - **Password:** the reviewer code (`OTP_REVIEW_CODE` on Railway) — **exactly 6 digits**; any
    other length switches the reviewer number off and the reviewer cannot sign in
- **Contact:** your name, +91 7899415741, officalquickbites@gmail.com
- **Notes** — paste this and fill the brackets:

```
Quick Bites is a food-delivery app for Harohalli and Ramanagara, Karnataka, India.

SIGN-IN: Restaurants and menus can be browsed without an account. Signing in is
needed only to order. Sign-in is by phone number plus email address: a one-time
6-digit code is sent to the email. For review, enter the phone number above and any
email address (for example review@example.com), tap "Send Code", then enter the
6-digit code above. No email or SMS is sent for this number. The same number and code
work for "Delete my account" in Profile; after deletion, signing in again creates a
new, empty account.

LOCATION: We deliver only in our service area in India. The review account has a
saved address there, so restaurants show delivery times. From elsewhere, all
restaurants are still listed.

PAYMENTS: Customers pay for physical food delivered to them (guideline 3.1.3(e)),
through Razorpay (UPI, cards, net banking) or cash on delivery where the restaurant
allows it. "Quick Bites Gold" is a 30-day membership that gives discounts on
delivery fees and food orders — a real-world service used outside the app — and is
also paid through Razorpay. Nothing digital is sold in the app. Please do not
complete a real payment; to see an order placed, choose cash on delivery at
"[DEMO RESTAURANT NAME]" — our team cancels review orders.

PERMISSIONS: location (delivery address), notifications (order status), camera and
photos (profile picture, only when tapped), microphone and speech recognition (voice
search, only when the microphone button is tapped). The app works with each one
denied.
```

- **Before you submit, on the live system:** sign in once on any phone with the reviewer number,
  add a **saved address in Harohalli**, and make sure "[DEMO RESTAURANT NAME]" is open and
  accepts cash. If a reviewer deletes the account, repeat this before the next submission.

### App Store rules this app was checked against

| Rule | Status |
|---|---|
| 2.1 Complete app, demo login | Reviewer number + code; review notes above. |
| 2.3.1 No hidden features | The hidden "Server settings" are removed from iPhone store builds. |
| 3.1.1 / 3.1.3(e) Payments | Food and Gold are real-world goods and services → Razorpay is allowed; no in-app purchase needed. |
| 4.8 Sign in with Apple | **Not required** — the app has no Google/Facebook/other third-party sign-in, only its own phone sign-in. |
| 5.1.1(i) Privacy policy | Link in App Store Connect **and** inside the app (Profile → Privacy policy). |
| 5.1.1(ii) Permission reasons | Every prompt has a specific reason; no "always" location; works when denied. |
| 5.1.1(v) Sign-in only when needed | Browsing needs no account on iPhone. |
| 5.1.1(v) Account deletion | Profile → Delete my account, completed in the app. |
| 5.1.2 / ATT | No tracking, no advertising IDs → no tracking prompt. |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` set; no questions on upload. |
| Privacy manifest | Declared in `app.json` (required-reason APIs and collected data). |

---

## 7. How the iPhone version differs from Android (on purpose)

- **Browse first:** iPhone shows restaurants and menus before sign-in; Android still asks first.
- **Back:** swipe from the left edge (Android uses its back button). Screens slide like iPhone
  apps; with Reduce Motion they do not.
- **Look:** big titles on Profile and Help, Apple-style switch and tab bar, 44-point minimum tap
  areas, small haptic taps (adding food, tabs, order placed).
- **Light colours always**, even in Dark Mode (dark mode for both phones is a later job).
- **No hidden server switch** in store builds.
- **Notifications** travel through Apple's service (APNs) instead of Firebase.

Everything else — prices, bills, cash rules, Gold, delivery codes, deletion rules — is the same
code and the same server.
