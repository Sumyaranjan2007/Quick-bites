# Google Play Release Guide

Status of each Android app, how to build a signed release, and the steps that
must be done by a human in Play Console.

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

`versionCode` must increase on every upload — it is currently `1` in each
`app.json`. Bump it before each release or Play will reject the duplicate.

---

## 4. What is already handled in code

- Release signing via upload keystore (Expo config plugin, survives prebuild)
- `targetSdk`/`compileSdk` 35, `minSdk` 24
- AAB output with Proguard and resource shrinking
- Only `INTERNET` and `VIBRATE` requested; Expo's default
  `SYSTEM_ALERT_WINDOW`, storage, camera and microphone permissions are blocked
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
4. **Data Safety form.** Declare what is collected: name, email, phone, delivery
   address, order history; plus precise location for the rider app.
5. **Content rating questionnaire.**
6. **Store listing assets:** app icon 512×512, feature graphic 1024×500, and at
   least two phone screenshots per app.
7. **Rider app location disclosure.** The rider app streams GPS during a trip.
   Play requires a prominent in-app disclosure before the first location request,
   and background location needs a separate declaration and review. Confirm
   whether continuous background tracking is actually needed — foreground-only is
   far easier to get approved.
8. **Partner, rider and admin apps are closed-audience tools.** Play may query a
   public listing for an app only usable by onboarded staff. Prefer closed
   testing, or state the audience clearly in the listing.

---

## 6. Known product gaps before a real launch

Not Play blockers, but they affect real users:

- **Data durability.** The backend keeps state in memory with a JSON snapshot
  (`apps/backend-api/src/db/client.ts`). A restart or redeploy can lose recent
  orders. A managed Postgres (the Prisma schema and docker-compose Postgres
  already exist) should be wired before taking real orders.
- **No online payment.** Checkout is cash on delivery; there is no Razorpay SDK
  integration, so no card or UPI payment path exists.
- **Catalogue size.** Four seeded restaurants.
- **Logo wordmark** reads "Quickbits" while the apps are named "Quick Bites".
