# Store Release Guide — Google Play & Apple App Store

Status of each app, how to build a signed release, and the steps that must be
done by a human in Play Console / App Store Connect.

**Android:** signed AABs build and are verified here.
**iOS:** configured but never compiled — this machine has no Xcode. See the iOS
section at the end.

---

## 1. Apps and package IDs

| App | Package ID | Play track |
|---|---|---|
| Customer (`apps/customer-mobile`) | `com.quickbite.app` | Production |
| Partner (`apps/restaurant-mobile`) | `com.quickbite.partner` | Production |
| Rider (`apps/delivery-mobile`) | `com.quickbite.rider` | Production |
| Admin (`apps/admin-mobile`) | `com.quickbite.admin` | **Internal testing only** |

The admin app is internal operations tooling. Publishing it publicly invites
rejection and exposes moderation controls — keep it on the internal testing
track or distribute it outside Play.

---

## 2. Upload keystores — read this first

Keystores were generated locally and are **deliberately not in this repo**:

```
~/.quickbites-upload-keys/
  quickbites-customer-upload.jks   quickbites-customer.password
  quickbites-partner-upload.jks    quickbites-partner.password
  quickbites-rider-upload.jks      quickbites-rider.password
  quickbites-admin-upload.jks      quickbites-admin.password
```

RSA 4096, valid ~30 years, one distinct password per app.

> **Back these up somewhere safe and private right now** (password manager or
> encrypted backup). If you lose an upload key you cannot ship updates to that
> app under the same listing — you would have to publish a new one and lose your
> installs and reviews. Do not commit them; `.gitignore` blocks `*.jks`,
> `keystore.properties` and `*.password`, but that only protects this repo.

Gradle finds the credentials via `apps/<app>/android/keystore.properties`
(gitignored). On a different machine or in CI, set these instead:

```
QB_KEYSTORE_PATH  QB_KEYSTORE_PASSWORD  QB_KEY_ALIAS  QB_KEY_PASSWORD
```

If no key is configured the release build silently falls back to the debug key —
installable locally, but **rejected by Play**. Verify before uploading:

```bash
keytool -printcert -jarfile app-release.aab | grep Owner
# Expect: Owner: CN=Quick Bites, OU=<app>, ...   (NOT CN=Android Debug)
```

---

## 3. Building a release

```bash
cd apps/customer-mobile
npx expo prebuild --platform android --no-install
cd android && ./gradlew bundleRelease
# -> app/build/outputs/bundle/release/app-release.aab
```

Requires JDK 17 (Gradle 8.10 does not support newer JDKs) and Android SDK 35
with NDK 26.1.10909125.

Upload the **`.aab`** to Play. The `.apk` in `build/apk/` exists only for
sideloading via a direct link and is not a valid Play artifact.

### The two builds differ, deliberately

```bash
./gradlew assembleRelease -PqbPhoneAbisOnly   # shareable APK, ~27 MB
./gradlew bundleRelease                       # for Play, every ABI
```

`-PqbPhoneAbisOnly` drops the x86 and x86_64 native libraries, which were 24 MB
of a 51 MB APK and run on no shipping Android phone. That matters for a file
someone forwards over mobile data.

**Never pass that flag to `bundleRelease`.** Play generates a per-device APK
from the bundle, so each user already downloads only their own slice — removing
x86_64 saves them nothing and silently drops Chromebooks, x86 tablets and
Windows Subsystem for Android from the listing. The filter lives behind a Gradle
property for exactly this reason: forgetting it produces a fat APK, which is
merely wasteful, while the opposite default would produce an ARM-only Play
listing that looks fine until a user reports they cannot install it.

Note that `splits.abi` is ignored when building a bundle but `ndk.abiFilters`
is not, so the filter has to be conditional rather than simply declared.

### Testing on an emulator

A flagged APK will not install on a standard Android emulator, which is x86_64
on most machines. Build without the flag, or use an ARM system image.

`versionCode` must increase on every upload — it is `3` in each `app.json` as of
version 1.1.0. Bump it before each release or Play will reject the duplicate.

---

## 4. What is already handled in code

- Release signing via upload keystore (Expo config plugin, survives prebuild)
- `targetSdk`/`compileSdk` 35, `minSdk` 24
- AAB output with Proguard and resource shrinking
- Permissions are declared per app rather than inherited, and each one is
  requested at the moment it is used rather than at startup. What ships:

  | App | Permissions | Why |
  |---|---|---|
  | Customer | `INTERNET`, `VIBRATE`, fine + coarse location, camera, microphone | Location places the delivery pin and sorts restaurants; camera is the profile photo; microphone is voice search |
  | Partner | `INTERNET`, `VIBRATE`, fine + coarse location, camera | Location places the kitchen on the map at registration; camera photographs a dish and the FSSAI/PAN documents sent for verification |
  | Rider | `INTERNET`, `VIBRATE`, fine + coarse location, camera | Location is the delivery itself; camera is documents and the profile photo |
  | Admin | `INTERNET`, `VIBRATE` | Nothing else is needed |

  `SYSTEM_ALERT_WINDOW` and legacy storage are blocked in all four.
  `RECORD_AUDIO` is blocked in the partner, rider and admin apps — only the
  customer app has a feature that records anything.

- **Foreground location only.** No app declares `ACCESS_BACKGROUND_LOCATION`.
  The rider reports position while the app is open and they are on shift, and
  nothing else. This is deliberate: background location triggers a separate
  Play review that takes weeks and asks you to justify a use case this product
  does not have.
- Demo credentials, one-tap demo login and the server-URL picker are `__DEV__`
  only, so they do not ship
- In-app account deletion (`DELETE /auth/me`, re-authenticated) with
  anonymisation of past orders
- Saved delivery addresses with server-side ownership checks

---

## 5. Still required — human steps in Play Console

These cannot be done from the codebase.

1. **Create each app** in Play Console and enrol in Play App Signing.
2. **Host the legal documents** at public HTTPS URLs and enter them in the
   listing. Drafts exist in `legal/` (`PRIVACY_POLICY.md`, `TERMS_OF_SERVICE.md`)
   but Play needs live URLs, not files in a repo.
3. **Account deletion URL.** Play requires a *web* deletion route in addition to
   the in-app one. Publish a page that lets a user request deletion and link it
   in the Data Safety section.
4. **Data Safety form.** Declare, for every app that collects it:

   | Data | Apps | Collected | Shared | Why |
   |---|---|---|---|---|
   | Name, email, phone | all four | Yes | No | Account and order contact |
   | Delivery address | customer | Yes | No | Delivering the order |
   | Precise location | customer, partner, rider | Yes | No | Pin the delivery point, place the kitchen, route the rider |
   | Photos | customer, partner, rider | Yes | No | Profile picture, dish photo, KYC documents |
   | Purchase history | customer | Yes | No | Order history and refunds |
   | Payment info | none | **No** | — | Razorpay's own sheet handles the card; no card data reaches this app or its server |

   The last row matters and is easy to get wrong. Declaring that the app
   collects payment information when it does not invites a review question you
   cannot answer well; the checkout hands off to Razorpay's SDK and only ever
   sees a payment id and a signature.
5. **Content rating questionnaire.**
6. **Store listing assets:** app icon 512×512, feature graphic 1024×500, and at
   least two phone screenshots per app.
7. **Location disclosure, three apps not one.** The customer app asks for
   location to place a delivery pin, the partner app to place its kitchen, and
   the rider app to route and report a delivery. Play requires a prominent
   in-app disclosure before the FIRST location request in each of them.

   All three are foreground-only and none declares background location, so the
   separate background-location review does not apply. Do not add it later
   without budgeting weeks for that review.
8. **Partner, rider and admin apps are closed-audience tools.** Play may query a
   public listing for an app only usable by onboarded staff. Prefer closed
   testing, or state the audience clearly in the listing.

---

## 6. Known product gaps before a real launch

Not Play blockers, but they affect real users:

This list was stale as of 21 September 2026 and has been corrected. Two entries
claimed gaps that had already been closed — a stale gap list is how a real gap
hides among fake ones.

- ~~**Data durability.**~~ **Closed.** `db/postgresStore.ts` persists to a
  managed Postgres when `DATABASE_URL` is set, and production refuses to start
  without it.
- ~~**No online payment.**~~ **Closed.** The Razorpay native SDK is integrated in
  the customer app (`lib/nativePayments.ts`), with real signature and webhook
  verification on the server.
- **The platform cannot send money.** Payouts and settlements are records of a
  decision, not transfers: an administrator marks one paid and types a UTR by
  hand. No bank account exists in the data model for any partner or rider. This
  is what `PAYMENTS_PLAN.md` P2 and P3 build, and it is the real blocker for
  trading at scale.
- **Catalogue size.** Four seeded restaurants.
- **Logo wordmark** reads "Quickbits" while the apps are named "Quick Bites".

---

# Apple App Store — iOS

## What is configured in code

All four apps now carry the iOS settings that are decided in the repo:

- **Bundle identifiers** — `com.quickbite.app` / `.partner` / `.rider` / `.admin`
- **`buildNumber`** — starts at `1`; must increase on **every** upload
- **App icon with no alpha channel.** App Store Connect rejects transparent
  icons outright (`ITMS-90717`); all four icons were RGBA and are now flattened
- **Privacy manifest** (`PrivacyInfo.xcprivacy`) — required by Apple since May
  2024. Declares the required-reason APIs the React Native runtime uses
  (UserDefaults, file timestamp, boot time, disk space) and the data collected:
  email, name, phone, delivery address, order history — all linked to the user,
  none used for tracking
- **`ITSAppUsesNonExemptEncryption: false`** — these apps use only HTTPS, which
  is exempt. Without this you answer the export-compliance questionnaire on
  every upload
- **`supportsTablet: false`** — the UI is laid out for phones and has not been
  designed or tested on iPad. Shipping an untested iPad layout risks a
  Guideline 4.0 rejection. Turn this on only after doing iPad layout work
- **Account deletion** — already implemented for Play, and equally required by
  App Store Guideline 5.1.1(v)

Generate the native project with:

```bash
cd apps/customer-mobile
npx expo prebuild --platform ios --no-install
```

## What cannot be done from this repo

**An iOS build requires a Mac with full Xcode.** This machine has only the
Command Line Tools — no Xcode, no CocoaPods, no simulators — so the apps have
**not** been compiled, run, or archived for iOS. The configuration above is
verified by inspecting the generated `Info.plist` and privacy manifest, not by a
build.

Before an iOS release someone must:

1. **Install Xcode** (Mac App Store, ~15 GB) and run `sudo xcode-select -s
   /Applications/Xcode.app`, then `sudo gem install cocoapods`.
2. **Join the Apple Developer Program** (US$99/year). Signing certificates and
   provisioning profiles are tied to that account's Team ID and cannot be
   created without it.
3. `cd apps/<app>/ios && pod install`, open the `.xcworkspace`, set the team,
   and archive — or use `eas build --platform ios`, which handles signing in the
   cloud and does not need local Xcode.
4. **Create each app in App Store Connect**, then upload and submit for review.
5. **Test on a real device or simulator.** No iOS build has ever been run; the
   Android build revealed a crash from a missing native module, and iOS has not
   had the equivalent shakeout.

## iOS-specific review notes

- **Usage-description strings are required and are now declared.** This note
  used to say none of the apps used camera, photos, contacts or location, and
  that the rider sent simulated coordinates. All of that stopped being true:
  every app takes real GPS, three of them take photographs, and the purpose
  strings are set in each `app.json` through the `expo-image-picker` and
  `expo-location` plugin options. Apple rejects a permission prompt with no
  purpose string, so check these against the table above before each submission
  — **a purpose string that no longer describes what the app does is the same
  false declaration as a missing one**, and the partner app's said "photograph a
  dish" for a build that also photographed a food licence.
- **Guideline 4.2 (minimum functionality).** The partner, rider and admin apps
  are staff tools; a public listing for an app only usable by onboarded staff
  attracts scrutiny. Prefer TestFlight or a private distribution method.
- **Demo account for review.** App Review needs working credentials to get past
  the login screen. Supply a demo login in App Store Connect review notes — the
  in-app demo button is `__DEV__`-only and will not exist in the build they test.
