# Quick Bites — Compliance

**Version:** 3.0.0
**Date:** 18 September 2026
**Status:** Current against the platform as built

This document records what the law and the distribution platforms actually
require of Quick Bites, what is already satisfied in code, and what only a human
can do. It is deliberately specific about the second category: most of what
remains cannot be finished by an engineer.

---

## 1. TRAI DLT registration — the long pole for real OTP

**This is law, not a vendor rule.** Indian telecom operators block every
commercial SMS sent to an Indian number unless the sender is registered on a DLT
(Distributed Ledger Technology) platform. No SMS provider — MSG91, Twilio,
Gupshup, anyone — can deliver around it, and changing provider does not shorten
it.

Three separate approvals are needed, in order:

| Step | What it is | Who does it | Typical wait |
|---|---|---|---|
| **1. Entity registration** | The business registers on a DLT portal (Jio, Airtel, Vi and BSNL each run one; registering on one propagates). Needs PAN, GST and an authorised signatory. | The business owner | 1–3 working days |
| **2. Header (sender ID)** | The six-character id the message appears to come from, e.g. `QCKBTE`. Approved per entity. | The business owner | 1–2 working days |
| **3. Template** | The exact message body, with variables marked. What is sent must match the approved template **character for character**, or the operator drops it silently — no error, no delivery report. | The business owner | 1–3 working days |

A compliant OTP template for this platform:

```
{#var#} is your Quick Bites verification code. Valid for 5 minutes.
Do not share it with anyone.
```

**Current state in code:** `modules/auth/otpDrivers.ts` holds a provider-agnostic
interface with a `fixed` driver that delivers nothing and accepts one configured
code. MSG91 and Twilio drivers exist as documented stubs. Selecting a real
provider is one file and the `OTP_PROVIDER` variable.

**Until DLT is complete**, the platform runs with `OTP_PROVIDER=fixed`. On a
public deployment that is only acceptable with
`OTP_ALLOW_FIXED_IN_PRODUCTION=true` set deliberately, for a closed tester
group, because anyone who knows the code can then sign in as any phone number.
**Removing that variable is the switch to real OTP.**

---

## 2. Payments

### What Razorpay requires before live keys

Test-mode keys (`rzp_test_…`) are free and need no KYC; they talk to Razorpay's
real servers and are what this platform currently uses. Live keys require:

- Business KYC: PAN, bank account, and either GST or a declaration of exemption.
- A **publicly reachable** privacy policy, terms of service, refund and
  cancellation policy, and contact page. Razorpay checks these before activating
  an account — they are a commercial requirement, not only a legal one.
- A registered business entity. A sole proprietorship is acceptable.

### What the code already does

- Amounts come from the server's stored bill, never from the client.
- Signatures are verified against Razorpay's own order id, constant-time.
- Webhooks are verified against the raw request bytes and applied idempotently
  by event id, so Razorpay's retries cannot pay an order twice.
- The key secret never leaves the server and is never in a response body; a
  build fails if any credential reaches a tracked file.

### Reserve Bank of India — card storage

**Merchants may not store card numbers.** Since 1 January 2022 card details must
be tokenised by the network or the gateway. Quick Bites never receives card
data: the customer enters it inside Razorpay's checkout. **Do not add a card
form to any Quick Bites screen** — it would move this platform into PCI-DSS
scope and out of RBI compliance simultaneously.

---

## 3. Food safety — FSSAI

Every restaurant selling food in India needs an FSSAI licence, and an aggregator
is expected to have collected it. Quick Bites:

- Collects the licence number at partner registration (mandatory field).
- Requires a document upload reviewed by an administrator before the restaurant
  becomes visible to customers — a pending restaurant is invisible to discovery
  and orders against it are refused.
- Records every approval and rejection in the audit log with the administrator's
  identity.

**Outstanding for a human:** the licence number should be checked against the
FSSAI register rather than only being stored. Nothing in code verifies it.

---

## 4. GST

- The pricing engine applies **5% GST** on the food component, which is the rate
  for restaurant service without input tax credit.
- A **15% platform commission** is deducted in the settlement ledger, and **1%
  TDS** is applied per section 194-O for e-commerce operators.

**Outstanding for a human:** GSTIN registration for the platform entity, and
issuing tax invoices that carry the platform's GSTIN, the restaurant's GSTIN,
the HSN/SAC code and a split of CGST/SGST. The figures are computed; the invoice
document is not yet generated.

---

## 5. Google Play

| Requirement | State |
|---|---|
| **AAB, not APK** | Play requires an Android App Bundle for new apps. The build script produces APKs for sideloading; `bundleRelease` is needed for submission. |
| **Public privacy policy URL** | Required in the store listing. `legal/PRIVACY_POLICY.md` has the content; it is not yet hosted at a URL. |
| **Data safety form** | Must declare collection of phone number, location, payment info. See §6. |
| **Account deletion** | Play requires an in-app path AND a web URL. `DELETE /api/auth/me` exists and is wired into the customer app. The **web URL does not exist yet**. |
| **Foreground location disclosure** | The rider app tracks location during a delivery. Play requires a prominent in-app disclosure **before** the permission prompt, explaining what is collected and why. |
| **Target API level** | Play enforces a minimum target SDK that rises annually; check the current floor at submission. |
| **Upload key custody** | Losing the upload key means the package id can never be updated again. See §8. |

---

## 6. Data safety declaration (prepared)

What Quick Bites collects, for the Play form:

| Data | Collected | Why | Shared |
|---|---|---|---|
| Phone number | Yes | Account identity and delivery contact | With the assigned rider, during an active delivery only |
| Name | Yes | Shown to the rider at the door | With the assigned rider |
| Delivery address | Yes | To deliver the order | With the assigned rider and the restaurant |
| Approximate/precise location | Rider app: yes, during a delivery. Customer app: yes, to find nearby restaurants | Dispatch and discovery | Rider location is shown to that order's customer **after pickup only** |
| Payment info | No — handled entirely inside Razorpay | — | Not received |
| Photos | Optional profile photo | Identifying the rider at the door | Profile photo shown to the customer |

Encryption in transit: yes. Deletion path: yes, in app.

---

## 7. Other obligations

- **Consumer Protection (E-Commerce) Rules 2020:** a grievance officer's name
  and contact must be displayed, and complaints acknowledged within 48 hours and
  resolved within one month. **Not yet published anywhere in the apps.**
- **IT Rules 2021:** a grievance redressal mechanism is required. The in-app
  support ticket system exists and satisfies the mechanism; the named officer
  does not.
- **Shops & Establishments / gig worker rules:** rider engagement terms, the
  payout model and any social security contribution are a legal question for the
  owner, not an engineering one.
- **No email marketing is sent**, so CAN-SPAM and equivalents do not currently
  apply. The email subsystem was removed entirely.
- **Children:** the platform is not directed at under-13s and collects no age.
  COPPA is not triggered, but an age gate would be needed before any alcohol
  category is ever added.

---

## 8. Signing key custody — read this before you lose it

The four upload keystores live **outside the repository** and are not in git:

```
C:\Users\priya\quickbites-keystores\quickbites-{customer,partner,rider,admin}.jks
```

Each app is signed by its own key. If a keystore is lost:

- The corresponding app **can never be updated again** under its current package
  id, on Play or by sideload. Android refuses an install whose signature differs
  from the installed app.
- The only remedy is a new package id, which is a new listing with no reviews
  and no existing installs.

**Back these up somewhere that is not this machine**, along with their
passwords. They are not recoverable and Anthropic, Google and Razorpay cannot
help you.

---

## 9. What only a human can do

1. TRAI DLT: entity, header, and template approval.
2. Razorpay business KYC, then swap two keys for live mode.
3. Host the privacy policy, terms, and refund policy at public URLs.
4. Publish a grievance officer name and contact.
5. GSTIN registration and tax-invoice issuance.
6. Verify each restaurant's FSSAI licence against the register.
7. Back up the signing keystores off this machine.
8. Google Play Console account, listing, content rating and submission.
