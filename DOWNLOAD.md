# Quick Bites — Android downloads

Four apps make up the platform. Install the customer app to order; install the
partner and rider apps on other phones to watch an order travel end to end.

Each app installs under its own name, so you can tell them apart on the phone:

| App | Launcher name | Who it is for |
| --- | --- | --- |
| `QuickBites-Customer.apk` | **Quick Bites** | Customers ordering food |
| `QuickBites-Partner.apk` | **Quick Bites Partner** | The restaurant's kitchen screen |
| `QuickBites-Rider.apk` | **Quick Bites Rider** | Delivery partners |
| `QuickBites-Admin.apk` | **Quick Bites Operations** | Platform administration |

> Download links are published on the **[Releases page](https://github.com/Sumyaranjan2007/Quick-bites/releases)**.
> Always copy the full `https://…` address. A bare file name pasted into a phone's
> address bar becomes a Google search, which has already cost one tester an
> entire afternoon on unrelated apps from the Play Store.

---

## Before you install: uninstall any older Quick Bites app

**This build is signed with a different key from v1.2.0 and v1.2.1.** Android
refuses to install an update whose signature does not match the installed app,
so an upgrade over an older Quick Bites will fail with a confusing error.

Remove the old apps first: long-press each Quick Bites icon → Uninstall. You
will lose nothing that matters — the data lives on the server.

Every future build will keep the signature this one uses.

---

## How to sign in

### Customer app — a phone number, no password

1. Open **Quick Bites**.
2. Enter any 10-digit Indian mobile number.
3. Enter the verification code. **While the platform is in testing it does not
   send SMS**, and the screen says so — use the code the platform owner gives
   you. It is set on the server as `OTP_FIXED_CODE`.
4. If the number is new, you will be asked for a name. That is the whole sign-up.

### Partner and rider apps — register, then wait for approval

1. Open **Quick Bites Partner** (or **Rider**) and choose to register.
2. Fill in the form. A restaurant needs its name, address, city, pincode and
   FSSAI licence number; a rider needs vehicle type and licence number.
3. You can sign in straight away, but **you cannot trade until an administrator
   approves you**. A pending restaurant is invisible to customers; a pending
   rider cannot start a shift. That is deliberate.
4. Upload your documents from inside the app, then ask the administrator to
   approve them in **Quick Bites Operations** → Documents.

### Operations app — the administrator

Sign in with the email and password set on the server as `ADMIN_EMAIL` and
`ADMIN_PASSWORD`. There is exactly one administrator account, and it is created
by the deployment itself.

---

## What you will find on a fresh platform: nothing

The hosted platform **starts empty**. There are no demonstration restaurants,
because a demonstration restaurant that a real customer can order from is worse
than an empty screen.

To get from empty to a working order:

1. Register a restaurant in the partner app.
2. Approve it in the operations app.
3. Add a menu item in the partner app.
4. Register a rider in the rider app, and approve it too.
5. Order from the customer app.

---

## The full four-role journey

Best done on four phones, or three phones and an emulator.

1. **Customer** signs in by phone, picks the restaurant, orders, pays cash on
   delivery.
2. **Partner** hears the chime, sees the ticket, accepts with a prep time.
3. **Partner** marks it ready. **Rider** (on shift) receives the offer and
   claims it.
4. **Rider** collects, entering the **pickup code** the kitchen shows.
5. The customer's map now shows the rider moving. It stays dark until this
   moment, deliberately — before pickup, where the rider is is not the
   customer's business.
6. **Rider** delivers, entering the **4-digit doorstep OTP** the customer shows.
7. **Operations** sees all of it live, and the settlement ledger updates.

---

## Server settings

Every app points at the hosted API by default, so a tester never has to type a
URL. If you are testing against a local backend, the sign-in screen has a
**Server settings** panel — enter `http://<your-machine-ip>:5000/api`.
