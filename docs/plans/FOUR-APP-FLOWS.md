# Four-app flows: every case, for the four people behind the apps

**Written 25 Sep 2026 by the review session ("Session A" in the owner's naming).**
Built from `docs/plans/CONNECTION-MAP.md` (every route called as the app's real
user), the HANDOFF, and the code on `main`. Menu names are the ones the apps show.

**How to read each step.** *Where* is the screen. *Told* is who hears about it and
how. **👤** marks a step a person has to do outside the app (a phone call, a bank
transfer, reading a statement). **⚠** marks what goes wrong and how it's handled.
**📱** marks something only a real phone can prove; each one is on the owner's
phone checklist.

Admin menus (bottom tabs, then sections): **Today** (Dashboard, Orders, Live) ·
**Money** (Finance, Inflation, Pay, Settlements, Bank) · **People** (People, KYC,
Profiles) · **Catalogue** (Menus, Marketing) · **Help** (Refunds, Support) ·
**System** (Access, Switches). Each section appears only for staff roles allowed
to use it.

---

## 1. Customer (customer app)

| # | Step | Where | What happens · Told | Goes wrong |
| --- | --- | --- | --- | --- |
| 1 | Sign in | Login | Phone number → 6-digit code. No password, no separate sign-up. | ⚠ Closed trial: one shared code (`OTP_FIXED_CODE`). **Launch blocker:** SMS provider. Too many tries → wait. |
| 2 | Add an address | Address book / checkout | New addresses need a **map pin** (new app). The server accepts unpinned ones while the switch "Accept addresses without a map pin" is on. | ⚠ Old app can't pin; leave the switch on until every phone updates. |
| 3 | Find food | Discovery | Search with suggestions after 2 letters, filters, veg mode, favourites. | Kitchen closed or outside hours: shown as closed, can't order. |
| 4 | Choose a dish | Restaurant | Dish with sizes (Half/Full): must pick one; extras optional up to the max. Price shows as picked. | ⚠ Old app shows only the first choice; a skipped required size takes the cheapest, and the bill and ticket show it. |
| 5 | Cart and bill | Cart | One restaurant per cart. The server prices it (`/orders/quote`), with coupon, tip, delivery fee, Gold discount. | Below the minimum order or beyond the furthest delivery (if the owner set them): refused with the reason. |
| 6 | Pay | Cart | Online (Razorpay: card, UPI), or cash on delivery. | ⚠ Paid twice by accident: the second is refunded automatically. Cash switched off for this customer (too many late cash cancels, or staff chose): online only. Razorpay is in **test mode** until live keys. |
| 7 | Track | Tracking | Live status; map from the moment the kitchen accepts; rider position while on the way. Told: one "kitchen has your order", "rider on the way", "out for delivery", "delivered". | Late: one "running late"; if contact with the rider is lost, one more message, never a third. |
| 8 | Chat | Tracking | Messages with the rider. | |
| 9 | Cancel | Tracking | Before the kitchen accepts: free. After: the fee is shown before confirming (only if the owner set one). **Not allowed once the rider has the food.** Refund goes back to the card or UPI. Told: "Your refund has been sent". | ⚠ If the refund can't go through automatically, admin is alerted (Help → Refunds) to settle it by hand 👤. |
| 10 | Receive | Door | Tell the rider the doorstep code, or pay cash / scan the rider's QR. | ⚠ Phone dead, can't read the code: staff mark it delivered (see Admin R3). |
| 11 | Rate, invoice | History | Rate after delivery; invoice for delivered orders; reorder. | |
| 12 | Complain / refund | Support | Raise a ticket or a refund request on an order. Told when it's decided. | Refunds never exceed what's left on the order. |
| 13 | Gold | Profile → Gold | Buy a plan (online payment). Delivery % off and food % off up to a cap. | ⚠ Needs live Razorpay keys for real money. |
| 14 | Delete account | Profile (bottom) | Behind the password. Refused while an order is live or a rider holds cash. | Old app: by email only (Support page). |
| 15 | Change password | Profile | This phone stays signed in (new app); other phones are signed out. | ⚠ Old app: this phone is signed out too; sign in again. |

---

## 2. Restaurant partner (partner app)

| # | Step | Where | What happens · Told | Goes wrong |
| --- | --- | --- | --- | --- |
| 1 | Apply | Sign in → register | Email, phone, password, restaurant details. Starts **pending approval**. Admin is alerted. | Can't take orders until approved. |
| 2 | Documents | Documents | Photograph FSSAI, GSTIN, PAN, bank proof. Admin is alerted per upload. | Rejected with a reason; upload again. |
| 3 | Bank account | Payout account | Add account or UPI. Admin verifies and applies it (Money → Bank). Told when it's applied. | Name mismatch: admin sees it before applying. |
| 4 | Menu | Menu | Add a dish, or **edit** one: sizes (2–4, each its real price, e.g. Half 120 / Full 200) and extras (price > 0). Goes to admin for approval (Catalogue → Menus). | Price changes need approval; a negative or zero price is refused. Free extras aren't possible. |
| 5 | Open / hours | Profile, Dashboard | Opening hours, holidays, pause. | |
| 6 | New order | Live orders | **Loud alarm** that keeps ringing until opened 📱; a countdown "accept within m:ss". | ⚠ Not accepted in time: cancelled automatically, the customer is refunded, and history says why. Rejecting often: admin is alerted (and the kitchen is closed automatically only if the owner switched that on). |
| 7 | Accept → cooking → ready | Live orders | Customer told once; riders offered the trip at "ready". The ticket shows the chosen size and extras. | Forgot to tap Ready: admin can move the step (Admin R4). |
| 8 | Hand over | Live orders | Show the rider the pickup code. | Wrong code 5 times locks it for a few minutes. |
| 9 | Money | Earnings, Settlements | Statement order by order; weekly payout. Told "You have been paid ₹…" on a quiet Payments notification 📱. | A refund on a delivered order takes the kitchen's share off the next payout. |
| 10 | Help | Help centre | Policies, support. | |

---

## 3. Rider (rider app)

| # | Step | Where | What happens · Told | Goes wrong |
| --- | --- | --- | --- | --- |
| 1 | Apply | Login → register | Details and vehicle; pending approval. Admin is alerted. | |
| 2 | Documents | Documents | Licence, RC, Aadhaar. Admin alerted. | |
| 3 | Bank account | Payout account | As for partners. | |
| 4 | Go online | Dashboard | Shift on. Location shared while on shift. | |
| 5 | Trip offer | Dashboard | **Loud alarm** with the trip 📱. Offered in widening waves to nearby riders. | Holding too much cash: cash trips aren't offered until it's handed in. |
| 6 | Take it | Offer card | Customer told "rider on the way". Other riders' alarms stop 📱 (new app). | Another rider took it first: "already claimed". |
| 7 | Can't make it | Trip → release | Before pickup only: the trip goes back on offer. | After pickup: not allowed; deliver it, or press SOS / call support 👤. |
| 8 | Collect | Trip | Enter the kitchen's pickup code. | Food not ready yet: refused with the reason. |
| 9 | Deliver | Trip | Enter the customer's doorstep code; take cash or show the QR. Earnings and cash recorded once. | ⚠ Delivered more than 300 m from the address: admin alerted once (not when GPS was stale). Paid by QR **and** cash: the QR payment is refunded automatically. |
| 10 | Reassigned | Trip | If staff hand the trip to them, a handover note shows. | |
| 11 | Hand in cash | Cash | Declare, then hand the cash in at the office 👤. Staff count it in (Money → Pay → Cash in). | Cash in hand blocks their payout until handed in. |
| 12 | Earnings | Earnings, Incentives | Statement; bonuses say "Earned" and go out with the next payout. Told "You have been paid ₹…" 📱. | |
| 13 | Safety | Safety, Trip | SOS reaches admin at once and can't be switched off. | |

---

## 4. Admin and operations staff (admin app)

Roles: **super admin** (everything, including staff and business registration),
**operations**, **finance**, **support**. Each sees only its sections.

| # | Step | Where | What happens | Goes wrong / notes |
| --- | --- | --- | --- | --- |
| R1 | Watch today | Today → Dashboard, Live | Live orders, riders, problems. | Alerts to the phone: no rider found, rider silent, overdue, no-show, auto-cancelled, far delivery, SOS. |
| R2 | Rider stuck before pickup | Order → "Take off rider" | Back on offer; the rider is told. Tick "no-show" only if it's their fault. | |
| R3 | Rider gone after pickup | Order → "Give to another rider" | Only riders who are free, approved, on shift and under their cash limit are listed; a handover note is required. | ⚠ **Owner decision:** the rider who delivers gets the whole trip pay; the first gets nothing and a no-show. |
| R4 | Customer can't read the code | Order → "Mark delivered" | A reason is required; on cash orders say who has the cash. "Customer refused" closes it as refused and opens a support case. | |
| R5 | Kitchen forgot a step | Order → "Kitchen step" | Moves accept / cooking / ready only, with a reason. | |
| R6 | Call someone | Order → Call customer / kitchen / rider | Real numbers, staff only 👤. | Masked calling needs a paid provider. |
| R7 | Cancel an order | Order → Cancel | Refund to the card or UPI; customer, kitchen and rider told. | |
| R8 | Refunds and complaints | Help → Refunds, Support | Decide cases; the money goes back the way it came. | Gateway failure: settle by bank transfer and record it 👤. |
| R9 | Approvals | People → KYC, Profiles · Catalogue → Menus · Money → Bank | Documents, profile edits, menu and price changes (sizes and extras shown), bank accounts. | |
| R10 | Cash desk | Money → Pay → Cash in | Count a rider's cash in; record the bank deposit with the slip 👤. | |
| R11 | Razorpay money | Money → Pay → Card & UPI in | Record each Razorpay settlement from its statement: amount, fees, tax 👤. | Money held more than 3 days: alert. |
| R12 | Payday | Money → Pay | Owed list → draft → approve → pay by bank transfer and record the UTR 👤. Payee told. Statements per payee. | Blocked with the reason: in the hold period, cash in hand, no account, below the minimum. |
| R13 | Prices and markup | Money → Inflation | Per-restaurant and per-dish markup, platform rates, Gold plans, rider bonuses. Also: least we keep per order, furthest delivery, minimum order, cash cancel limit, kitchen rejection alert, cancel fee (locked until "Customer app shows the cancel fee" = 1). | All the new ones are off (0) by default. |
| R14 | Losses | Money → Finance → "Orders that lost money" | Worst first, with the cause in words. | |
| R15 | One customer's cash | People → customer → Cash on delivery | Switch off / allow / automatic, with a reason. | |
| R16 | Switches | System → Switches | Feature switches, notification categories (SOS and "no rider found" always on), **Business registration (GSTIN)** — super admin. | |
| R17 | Staff | System → Access | Roles and staff accounts (super admin). | |

---

## 5. Needs a person, or a phone, before launch

- 👤 **Money outside the app:** bank transfers on payday, banking office cash,
  reading the Razorpay settlement statement, refunds the gateway couldn't do.
  RazorpayX (automatic payouts) needs reversal handling (S8) first.
- 👤 **Calls:** staff call from their own phones until masked calling is bought.
- 📱 **Only a real phone proves:** alarms on a locked phone, the quiet Payments
  and Order-updates channels, the rider's "trip taken" stop, the live map,
  installing as an update. All on the owner's phone checklist.
- **Launch blockers:** SMS login, live Razorpay keys, rotate the Mapbox secret
  token, Railway overlap 0.
