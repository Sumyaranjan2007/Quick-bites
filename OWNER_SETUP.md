# What only you can do

Everything in this list is **built and waiting**. None of it needs a code
change, a new APK, or another session. Each one switches on the moment you
supply the thing it is waiting for.

That distinction matters. "Five things are not done" and "five things are
waiting on you and take about ten minutes each" are very different sentences,
and this is the second one.

---

## The short version

| # | What | How long | What breaks without it |
| --- | --- | --- | --- |
| 1 | Turn on Google Maps billing + 2 APIs | 10 min | Delivery times are estimates, not measured |
| 2 | Create a Firebase project, add 4 files + 1 key | 20 min | No notifications reach any phone |
| 3 | Give us your RazorpayX keys | 5 min | Payouts are recorded by hand, not sent |
| 4 | Give us your GST registration | 5 min | Customers get receipts, not tax invoices |
| 5 | Name a grievance officer | 5 min | The legal escalation route is incomplete |
| 6 | Remove `ALLOW_PLATFORM_RESET` from Railway | 1 min | The "wipe everything" button stays armed |

Number 6 is the only urgent one. Do that today.

---

## 1. Google Maps — 10 minutes

**What it does now:** delivery distances are a straight line multiplied by a
road factor. Close, but not real.

**What you do:**

1. Go to <https://console.cloud.google.com> and open your project.
2. **Billing → Link a billing account.** Add a card. Google gives a free
   monthly allowance that a platform this size will sit comfortably inside.
3. **APIs & Services → Library**, and enable these two **exactly**:
   - **Places API** — the one described as *legacy*, NOT "Places API (New)"
   - **Distance Matrix API**

**This matters.** Your project currently has *Places API (New)* and *Routes
API* enabled. Those are different products with different addresses, and this
code does not call them. Enabling the wrong two looks like it worked and
changes nothing.

**How you know it worked:** delivery times on the customer home screen stop
being round numbers. Nothing else changes, and nobody has to rebuild anything —
that was checked by test, not assumed.

---

## 2. Firebase — 20 minutes

**What it does now:** every notification is written to the server log. Nothing
reaches a phone. The apps still work: the kitchen alarm rings over the live
connection while the app is open, and orders still arrive. What is missing is
the phone buzzing when the app is *closed*.

**What you do:**

1. Go to <https://console.firebase.google.com> → **Add project**. Call it
   `quick-bites`. You can turn Google Analytics off.
2. Add **four Android apps** to it. Firebase asks for a package name each time
   — use exactly these:

   | App | Package name |
   | --- | --- |
   | Customer | `com.quickbite.app` |
   | Partner | `com.quickbite.partner` |
   | Rider | `com.quickbite.rider` |
   | Admin | `com.quickbite.admin` |

   **Read those carefully.** It is `quickbite`, singular — not `quickbites` —
   and the customer app ends in `.app`, not `.customer`. Firebase will happily
   accept a package name that does not match your app; it simply never
   delivers to it, and there is nothing in the console that tells you so.
   These are copied from each app's `app.json`, which is the only thing that
   decides it.

3. Each one gives you a **`google-services.json`**. Download all four and send
   them to us, saying which is which. They are not secret, but they must not be
   mixed up.

4. **Project settings → Service accounts → Generate new private key.** That
   downloads one JSON file. **This one IS secret.** Do not put it in a message,
   a document, or the repository.

5. Put it into Railway yourself:
   - Railway → your project → **Variables** → **New Variable**
   - Name: `FCM_SERVICE_ACCOUNT_JSON`
   - Value: the entire contents of that JSON file, pasted in as one line
   - Save. Railway redeploys on its own.

**How you know it worked:** place a test order with the customer app closed.
The phone buzzes. Nothing is rebuilt; the server picks the credential up on the
redeploy.

---

## 3. Give us your RazorpayX keys — 5 minutes

**What works without it:** everything. Orders are paid for, refunds go back the
way the money came, what every partner and rider is owed is worked out to the
paise, and a payout is recorded with the reference you type in after making the
transfer in your own banking app.

**What it changes:** the transfer stops being something you do by hand. You
press Send, the money goes, and the reference comes back by itself.

The bookkeeping is **identical either way**. Both paths write exactly the same
ledger entries, so nothing has to be reconciled or corrected when you switch —
the day you add the keys, the only thing that changes is who makes the transfer.

**Where to get them:** RazorpayX dashboard → Account & Settings → API keys. You
need the key id, the key secret, and your **RazorpayX account number** — that is
the virtual account the money is sent FROM, not your ordinary current account
number. It is shown on the RazorpayX home page.

**Where they go** (Railway → Variables):

```
RAZORPAYX_KEY_ID
RAZORPAYX_KEY_SECRET
RAZORPAYX_ACCOUNT_NUMBER
RAZORPAYX_WEBHOOK_SECRET
```

The last one is optional but worth doing: it lets RazorpayX tell us when a
payout lands or bounces, instead of us finding out on the next sweep.

**How you know it worked:** open the admin app → **Pay** → draft a payment for
anybody who is owed something. The "How to pay" list will now offer RazorpayX as
the default instead of only manual transfer.

**One thing to know before you switch it on.** Verifying a partner's or rider's
bank account works by sending them one rupee and reading back the name the bank
holds. That costs a rupee per account and it is the only thing standing between
a typo and a week's earnings going to a stranger. Until the keys exist, accounts
are added but cannot be verified, and an unverified account cannot be paid.

---

## 4. Give us your GST registration — 5 minutes, and do this early

**What happens without it:** every customer who asks for their bill gets a
**payment receipt**. It says what they paid and it makes no tax claim.

That is deliberate and it is the right behaviour — but it is also a gap that
grows with every order you take, and it is the one item on this list I would do
first.

**Why we will not just print your GSTIN field blank.** A tax invoice is a legal
document. Somebody expensing their lunch hands it to their accounts department,
who claim input credit against it. An invoice carrying a made-up or empty GSTIN
is not a rough draft — it is a false document, and the person who relied on it
finds out in March. So the platform refuses to issue one until the registration
is real, and tells the customer plainly that they are holding a receipt.

**What we need**, exactly as it appears on your registration certificate:

- GSTIN (15 characters, e.g. 29AABCU9603R1ZM)
- Legal name — the name on the registration, which is often not your brand
- Trading name, if different
- Registered address, city, state and pincode
- PAN, and TAN if you have one
- An invoice prefix, if you want one other than `INV`

**Where it goes:** admin app → **Tax** → "Enter your GST details". Not an
environment variable — this is a business fact, not a secret, and it is edited
in the app so you can correct it without a redeploy.

You do not type your state code. It is taken from the first two characters of
the GSTIN, because a typed one that disagrees with the registration splits the
tax against a state you are not registered in, and that mistake is invisible on
screen until a return is rejected months later.

**How you know it worked:** the Tax screen turns from red to green and stops
saying invoices are not being issued. Open any delivered order in the customer
app and tap **Bill** — it now says "Tax invoice" and carries your GSTIN.

**What you get afterwards:** admin app → Tax → pick a month. It shows what you
supplied and the tax on it, the section 52 collection, and section 194-O per
partner. There is a CSV of the per-partner deduction list your accountant can
open directly.

**One thing to have your accountant confirm.** We invoice for the restaurant's
food under your GSTIN, not the kitchen's, because section 9(5) of the CGST Act
makes the platform liable for tax on restaurant service supplied through it.
That is the standard treatment for food delivery in India and it is what the
whole tax module assumes. It is also the kind of rule that moves by
notification, so have them confirm it before your first return. Nothing in this
software is a substitute for that.

---

## 5. Name a grievance officer — 5 minutes

**What we need:** a real person's name, a working email address, and a postal
address. A phone number and working hours are optional and both help.

**Why it cannot be skipped and why we have not invented one.** The Consumer
Protection (E-Commerce) Rules require a named grievance officer with a
contactable address. We could have typed "The Grievance Officer,
grievance@quickbites.app" into the policies and they would look finished.

That is worse than the gap. A customer with a genuine complaint writes to an
address nobody reads and concludes, entirely reasonably, that their complaint
has been received and is being dealt with. The gap is honest; the placeholder is
not.

So until you name somebody, **every payment policy says out loud in its closing
section that the formal escalation route has not been published yet** — and
still gives the in-app route, which genuinely works and reaches a person. Every
customer, partner and rider reading a policy sees that sentence.

**Where it goes:** admin app → **Tax** → the grievance officer section.

**How you know it worked:** open the customer app → Profile → "Payments and
refunds" → any policy → scroll to the bottom. Where it said the route was not
published, it now names your officer with their email and address.

**It does not need to be a lawyer or a separate hire.** For a firm this size it
is normally a director or the operations lead. It has to be somebody who will
actually read the email.

---

## 6. Remove `ALLOW_PLATFORM_RESET` — 1 minute, do this today

You added this so the data could be wiped for testing. It is still set.

While it is set, anybody who can reach the admin console and knows the
confirmation phrase can delete every restaurant, customer, rider and order on
the platform.

**Railway → Variables → find `ALLOW_PLATFORM_RESET` → delete it → Save.**

The button then refuses, and says it is refusing because the deployment is not
armed — rather than because you typed the phrase wrong. That distinction was
itself a bug that got fixed; the refusal now names the guard that stopped you.

---

## What you do NOT have to do

- **Rebuild any app** for items 1 to 5. Every one of them is a server-side
  credential. The only reason there are new APKs is the features themselves.
- **Change any code.** If anyone tells you a setting needs a code change to
  take effect, that is a bug and we want to hear about it.
- **Wipe the data again.** The platform is already empty and ready to test from
  scratch.

---

## Testing the new build

Install all four APKs and try this, in order. It exercises nearly everything
that changed.

1. **Sign up as a customer** on your phone number.
2. **Sign up as a rider using the SAME phone number**, and the same email and
   password. It now works — that was the bug you reported. Use a different
   password and it is refused, which is the point.
3. **As a partner**, open the new **Profile** tab. Add a cover photo, a
   description, cuisines, and your opening hours. Save.
   - Nothing changes for customers yet. That is correct.
4. **As an admin**, open **Profile changes**. You will see every field with its
   before and after. Approve some, refuse one with a reason.
   - Only the approved ones go live. The refused one comes back to the partner
     *with your reason against that field*.
5. **As a customer**, look at the feed. The restaurant now has a photo. If a
   partner has not added one, it shows their own food from their menu, and if
   they have none of that either, their initials on a colour — never a grey
   box, and never a stock photo of somebody else's food.
6. **Set the restaurant's opening hours to a window that has already ended**
   and try to order. You are refused, and told what time it opens again.
   - Then use **+1 hour** on the partner's Profile tab and order again. It
     works, and it expires by itself.
7. **Create a coupon in the admin console.** The badge appears on the
   restaurant card. Expire it. The badge disappears.
   - No coupon anywhere means no badge and no banner. Every card used to say
     "50% OFF" whether or not that was true.

---

## If something looks wrong

Tell us what you did and what you saw. Do not assume it is meant to be that
way — most of what has been fixed in this project was found exactly like that.
