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
| 3 | Give us your Razorpay keys | 5 min | Payouts are recorded by hand, not sent |
| 4 | Give us your GSTIN and business details | 5 min | Customers get receipts, not tax invoices |
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

## 3, 4 and 5 — the payments session's list

These three are theirs, and they will describe them properly. In short:

- **Razorpay keys** — payouts currently record that money *should* move. With
  the keys, money actually moves. The bookkeeping is identical either way, so
  nothing has to be reconciled afterwards.
- **GSTIN, legal name, registered address** — until these exist, customers get
  a *payment receipt*, not a *tax invoice*. That is deliberate: an invoice with
  a placeholder GSTIN is not a draft, it is a false legal document that a
  customer might claim tax credit against. This gap grows with every order, so
  it is worth doing early.
- **A grievance officer** — a named person, an email and a postal address. The
  e-commerce rules require it, and until it exists every payment policy says
  out loud that the formal escalation route is incomplete.

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
