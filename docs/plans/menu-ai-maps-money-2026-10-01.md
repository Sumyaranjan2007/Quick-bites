# Plan — bulk menu, AI menu, document downloads, maps, delivery money (1 Oct 2026)

Owner's request, in seven parts. Every item says what is wrong or missing today (found in the
code or on the live server), what changes, and what must NOT change. Built as v12; every APK
installs as an update over v11.

Owner decisions (1 Oct): rider pay counts **restaurant → customer road km**; **a minimum per
trip stays**; the **per-km rate is editable globally**; the customer's delivery fee becomes
**rider pay + a markup %**.

---

## 1. Delivery distance is not measured — it is guessed (root cause found)

**Today.** The live server's health report shows the road-distance service refused:
*"Not enough input sources and destinations given, resulting in only 1 matrix element;
minimum is 2"* (Mapbox, 27 Sep). The code asks Mapbox's **Matrix** service for one
restaurant→door pair, and Matrix refuses one pair. Every refusal falls back to
`straight line × 1.3`. So every order's distance — and with it the delivery fee and the
rider's pay — has been a guess.

**Change.** One pair uses Mapbox **Directions** (driving, real roads); two or more keep the
Matrix. Same cache, same circuit breaker, same fallback if Mapbox is down. The measured
distance, and where it came from (ROAD or ESTIMATED), is frozen on the order.

**Unchanged.** The address lookup, the cache, the fallback.

## 2. Rider pay and the customer's delivery fee

**Today.** Two unrelated formulas: the customer pays Rs 30 for 3 km + Rs 10 per extra
started km (+ markup %); the rider earns Rs 25 + Rs 6 per km beyond 2 km, minimum Rs 30.
The platform's margin on delivery changed from trip to trip.

**Change (one function, used by the quote, checkout, the rider's offer and the payout):**

- **Rider pay** = road km × *Rider pay per km* (Rs 10), rounded to the rupee, never below
  *Rider minimum per trip* (Rs 30). Tips go to the rider on top, untouched.
- **Customer delivery fee** = rider pay × (1 + *Delivery markup %*). Gold's delivery
  discount, free-delivery coupons and the "least we keep" floor apply after, as today.
- The rider's pay is **frozen on the order at checkout**, so the offer card, the trip, the
  statement and the payout all show the same figure the customer's fee was built from.
- Inflation → *Rider pay & defaults* shows **Rider pay per km**, **Rider minimum per trip**
  and **Delivery markup %**, each with a worked example (2 km / 5 km / 8 km). The old
  base-fee / base-km fields stop affecting new orders and are hidden.

**Unchanged.** Orders already placed keep their frozen figures; old orders' payouts are not
recalculated. Tips, cash limits, cash collection.

## 3. "I set 10 and the customer sees 11" — fixed, and it was also a tax problem

**Today.** The bill adds **18% GST to the platform fee** using a global rate, ignoring the
per-restaurant *GST on our charges* field, which is locked until a GSTIN exists. A Rs 10
platform fee became Rs 11.80 — and GST was charged although the business has no GSTIN.

**Change.** Platform-fee GST applies **only when a GSTIN is set**, at the restaurant's own
rate. With no GSTIN: Rs 10 set = Rs 10 on the bill. Every customer-facing charge in
Inflation shows **"Customer pays: Rs X"**, computed by the same code as the bill.

**Unchanged.** GST on food (5%), which is the restaurant's tax and is printed separately.

## 4. Maps open at the whole of India

**Today.** The tracking map passes Mapbox a "fit these two points" box on its first draw.
On Android that box is often dropped before the map has loaded, and the camera stays at its
default — the country view the owner sees, for the customer after acceptance and for the
rider after pickup.

**Change.** Both apps measure the map's real size and set the **exact centre and zoom**
that frames both points with padding (`fitZoom`, already in the code but unused). The
camera re-frames on every rider location update. Applies to: customer tracking (restaurant
→ door, then rider → door) and the rider's trip map (to kitchen, then to customer).

**Unchanged.** Pins, route line, live updates, the address picker.

## 5. Bulk menu for restaurants (and for admins, on their behalf)

**Today.** A restaurant adds one dish per form; the admin "add dish" tool predates sizes,
extras and options.

**Change — one Menu Builder, in both apps:**

- Sections → dishes, each dish with name, description, price, **Veg / Non-veg (required)**,
  **sizes** (2–4, real prices), **extras**, photo.
- Partner: *Menu → Build my menu*. Draft saved on the phone as it is typed (nothing is lost
  if the app closes). *Send whole menu for approval* sends it in small batches as ordinary
  menu requests sharing one batch id — so it lands in the existing Catalogue review, where
  "Review N dishes" approves it all in one tap, with every existing check (option rules,
  margin hold, markup) applying unchanged.
- Admin: Catalogue → restaurant → *Upload menu*. Same builder, for any restaurant, recorded
  as uploaded by that administrator, then *Approve all* or review per dish.

## 6. AI menu from photos (Groq)

- Partner and admin: *Build my menu → From photos*. Clear guidance first: flat, well-lit,
  whole page, one page per photo, up to 8 photos.
- The photos go to **our server**, which calls Groq (model `qwen/qwen3.8-27b`, tested
  1 Oct: it read sections, prices and Half/Full sizes correctly). **The Groq key is never
  in any app**: it lives only in the server's environment as `GROQ_API_KEY`.
- The AI fills sections, dish names, descriptions, prices, sizes, extras and Veg/Non-veg.
  It **saves nothing**: the result opens in the Menu Builder for the partner to check, fix,
  add photos, and send for approval as in §5. Anything the AI was unsure of is flagged.
- Limits: 8 photos per scan, 30 scans a day per restaurant, so a mistake cannot run up a bill.

## 7. Downloads in the admin app

Every document an administrator verifies gets **Download**: KYC documents (restaurant and
rider), bank-account proofs where attached, refund photos, profile-edit photos. The file
is saved through Android's share/save sheet (Files, Drive, WhatsApp…) with a readable name
(e.g. `BBH-FSSAI-2026-10-01.jpg`, or `.pdf` for a PDF).

## 8. Also in v12

- V11-1 (already fixed, uncommitted): a pushed trip offer is counted for acceptance.
- V11-2: spacing in the partner dish form.

## Owner to-do

1. **Rotate the Groq key** — it was pasted in chat. Create a new one at console.groq.com.
2. Add it to Railway → Variables as `GROQ_API_KEY`. Until then the AI button says
   "AI menu reading is not switched on" and everything else works.
3. In Inflation → Rider pay & defaults, confirm Rs 10/km, the minimum and the markup %.

## How it is checked before you install

Server tests for: rider pay (2 km, 5 km, below minimum, decimals), fee = pay + %, frozen on
the order and paid exactly at payout (paid twice), Directions used for one pair (mocked),
platform fee with and without GSTIN, bulk batches landing in review and approving with
sizes/extras, AI draft shape (mocked Groq) and limits, downloads' file naming. Then the
whole gate, then v12 on the emulator against a private server, every new screen used as
partner and admin, maps checked visually at close and far distances, money traced from bill
to payout. Fix and repeat until clean.
