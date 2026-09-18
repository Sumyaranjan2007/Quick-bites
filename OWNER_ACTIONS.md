# What only you can do

**Version:** 1.0.0
**Date:** 18 September 2026

Everything in this file needs a human with an account, a legal identity, or a
credit card. Nothing here can be done from a code editor. It is ordered so that
each step unblocks the next.

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
| `RAZORPAY_KEY_ID` | `rzp_test_TdBBgoDoFaxINY` | Online payment is unavailable; cash on delivery still works. |
| `RAZORPAY_KEY_SECRET` | the test secret you gave me | As above. |
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
deliberately rather than coming up with no administrator.

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

### 2.4 The full journey to check

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
