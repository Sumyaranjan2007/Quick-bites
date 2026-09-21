# Quick Bites — Restaurant identity, notifications and the experience gaps: the complete plan

**Version:** 1.0.0
**Date:** 22 September 2026
**Status:** AWAITING OWNER APPROVAL — no code written against this yet
**Author:** Claude Opus 5, Session 32
**Companion to:** `PAYMENTS_PLAN.md` (Session 31). That plan owns every rupee. This one owns everything else.

---

## 0. What this document is

Everything a customer, partner, rider or administrator sees and does that is
**not money**, and what the platform does when each of those goes wrong.

It was written after auditing the code that already exists, not from a blank
page. **Five of the items below are defects found during that audit, not
features.** They are in §2, separately, because a plan that quietly fixes a
defect while calling it a feature is a plan you cannot check.

Nothing here is built yet. It is for approval first, by explicit instruction.

---

## 1. Decisions taken (do not re-litigate)

| Question | Decision | Decided by |
| --- | --- | --- |
| What a partner may edit | Cover photo, gallery, name, description, cuisines, opening hours, address, map pin, phone | Owner, Session 32 |
| Approval | **Everything the customer sees needs admin approval** before it goes live | Owner |
| Urgent closures | Stay instant via the existing Online toggle. Never queued | Derived — nothing operational may sit behind a queue |
| Photo storage | **Data URIs in the store, capped, resized on the device.** No new service, no new key, no signup | Owner ("secure, no extra effort") |
| Gallery size | Cover + up to 4 | Owner |
| No cover photo | Slideshow of that restaurant's own dish photos | Owner |
| No photos at all | **Generated placeholder** from the restaurant's own identity | Owner |
| Opening hours | **Auto-close outside hours; the partner can override** with the toggle | Owner |
| Reviews | **Stars only.** No written reviews | Owner |
| Push notifications | **Yes — real Firebase**, all four apps | Owner |
| Test data | **Start empty.** No seeded demo restaurants in production | Owner |
| Two sessions | `SESSION_COORDINATION.md` in the repo. **Both commit to `main`, sequentially, staged by explicit path** — one working tree cannot hold two branches. APKs built only when neither session has uncommitted work and the gate is green | Owner, corrected by Session A |
| Google Maps billing | Everything must improve **automatically** when billing is enabled. **Zero code changes at the flip** | Owner |
| Money | Out of scope. Owned by `PAYMENTS_PLAN.md` | Both sessions |
| Customer wallet | **Removed.** The payments session removes the endpoint and the screen together | Owner |
| Plan precedence | Where the two plans disagree, **`PAYMENTS_PLAN.md` wins** | Owner |

---

## 2. What the audit found

Five defects. All five are in scope.

### 2.1 A restaurant's photo can be displayed but can never be set

`Restaurant.bannerUrl` exists in `packages/shared-types/src/index.ts` line 128.
The customer app renders it in two places — the feed card
(`DiscoveryFeedScreen.tsx` line 641) and the detail hero
(`RestaurantDetailScreen.tsx` line 218) — and `customerRouter.ts` line 42 serves
it.

**The only thing on this platform that has ever set it is `db/seed.ts`**, with
four Unsplash URLs.

There is no partner route that writes it. There is no admin field that writes it.
So every restaurant a real person registers has `bannerUrl: undefined` forever,
and the card falls to this:

```tsx
) : (
  <View style={[styles.banner1, { backgroundColor: c.surface.sunken }]} />
)}
```

An empty grey rectangle. That is the reported problem, and the cause is exact:
**the display half was built and the input half never was.** The same shape as
`goldExpiresAt`, which was read by nothing, and the dish `imageUrl` that no
partner app could send until Session 30.

### 2.2 Every restaurant advertises 50% off, and none of them have an offer

`DiscoveryFeedScreen.tsx` line 660:

```tsx
<View style={styles.offerBadge}>
  <Text style={styles.offerBadgeText}>50% OFF</Text>
</View>
```

Hardcoded. Not conditional, not data-driven — **no offer data reaches the feed at
all.** Line 554 repeats it as a hero banner reading "UP TO 50% OFF".

So the home screen tells every customer that every restaurant is half price, and
the checkout then charges full price. This is the same class of defect as the
"25 MINS" that once appeared on every card — and there is a comment twenty lines
below this one explaining why that was removed. The badge survived the cleanup.

It is also, unlike the ETA, a **false price claim**, which is a different kind of
problem from a wrong estimate.

### 2.3 A partner cannot change one word about their own restaurant

Every mutation `restaurantRouter.ts` offers a partner: menu item create, menu
item update, stock toggle, kitchen status, menu request, document upload.

There is **no profile endpoint**. A restaurant that changes its phone number,
corrects a misspelled name, moves premises, or wants to describe itself has
exactly one route: ask an administrator to do it from the admin app. Nothing in
the partner app can express any of it.

### 2.4 The platform has no concept of opening hours

No field, no type, no route, nowhere. `grep` for `openingHours`, `openTime`,
`closeTime` across the backend and shared types returns nothing.

A kitchen is either Online or Closed, by a manual switch somebody must remember
to press twice a day. A customer cannot be told "opens at 6pm" because nothing
knows. An order placed at 3am is accepted if the partner forgot to flip the
toggle before going home.

### 2.5 Push notifications do not exist, and nine places believe they do

`notifications/fcmDispatcher.ts` is a stub that was never replaced:

```ts
this.dispatchHistory.push(record);
console.log(JSON.stringify({ ..., event: 'FCM_PUSH_DISPATCHED', ... }));
```

It appends to an in-memory array and writes a log line. It does not contact
Firebase. It does not know what a device token is. **No device token is stored
anywhere in this platform** — `grep` for `deviceToken`, `fcmToken`, `pushToken`
returns nothing at all.

And it is called from **nine sites** in `modules/orders/orderService.ts` and
`orderSweeper.ts`, across the entire order lifecycle: placed, preparing, ready
for pickup, out for delivery, delivered, cancelled.

So the server believes it is telling customers where their food is at every
milestone, and not one notification has ever reached a phone. The in-memory array
is also lost on every restart, so even the record of the fiction is temporary.

This is the largest single gap between what this platform appears to do and what
it does.

### 2.6 What is already right — do not rewrite these

- **The four-state discipline.** Every data component has loading, success, error
  and empty. It is honoured across the apps; new screens join it rather than
  reinventing it.
- **`lib/photo.ts` in the partner app.** Resize, compress, cap, data URI, honest
  failure messages. Built in Session 30 for documents. The cover photo uses it.
- **The menu-request approval model** in `catalogRoutes.ts`. Submit → queue →
  approve/reject with a reason → partner is told why. Profile edits copy this
  shape exactly rather than inventing a second one.
- **`hasRealLocation` / `locationPending`.** The guard that stops an unset pin
  being treated as a location in Cubbon Park. Hours and address edits must not
  break it.
- **The verification gate from Session 30.** Documents approved → restaurant
  ACTIVE → may go online. Profile editing must not become a way around it.
- **`placesService` degradation.** Already returns nothing gracefully when Google
  refuses, reports the refusal in `/health`, and no longer caches a failure for
  24 hours. This is what makes §3.9 possible.

---

## 3. Architecture

### 3.1 The restaurant profile — draft and published, never one value

"Everything needs approval" has one hard consequence: **a restaurant must have
two versions of itself at once.** What customers see, and what the partner has
asked to change.

A new entity `profileEdits`:

```ts
interface ProfileEdit {
  id: string;
  restaurantId: string;
  submittedByUserId: string;
  submittedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  /** Only the fields actually changed. Never a whole-record overwrite. */
  changes: Partial<EditableProfile>;
  /** What each field was at submission, so a reviewer sees before and after. */
  previous: Partial<EditableProfile>;
  reviewedByUserId?: string;
  reviewedAt?: string;
  rejectionReason?: string;
}
```

Rules, each for a reason:

- **The live record is never touched until approval.** Customers keep seeing the
  approved values while an edit is pending. There is no window in which a
  half-reviewed restaurant is on the home screen.
- **Only changed fields are stored.** A partner editing their phone number does
  not resubmit their name for review, and two edits to different fields do not
  collide.
- **A new submission supersedes the previous pending one** for the same field
  rather than queueing behind it. A reviewer approves the partner's current
  intention, not a stale one.
- **`previous` is captured at submit.** The reviewer sees "Sunrise Kitchen →
  Sunrise Kitchen & Grill", which is the only way to review a name change
  sensibly.
- **Approval applies field by field.** A reviewer can approve the hours and
  reject the photo, in one pass, with a reason on the rejected part only.

`EditableProfile` — and nothing outside this list is editable by a partner:

| Field | Notes |
| --- | --- |
| `bannerUrl` | Cover photo. Data URI |
| `galleryUrls` | Up to 4. New field |
| `name` | Trading name |
| `description` | New field. Max 400 chars |
| `cuisineTags` | Max 8, from a controlled vocabulary plus free text |
| `openingHours` | New. See §3.5 |
| `addressLine`, `city`, `pincode` | |
| `coordinates` | Map pin, bounded exactly as at registration |
| `phone` | |

**Explicitly not editable by a partner:** `packagingFee`, `commissionPercent`,
`status`, `kycStatus`, `serviceRadiusKm`, `isPureVeg`, `fssaiLicenseNumber`,
`gstin`. The first two are money and belong to the payments session. The next two
are the verification gate. The rest are claims an administrator verified against
a document, and a partner who could edit them could undo their own KYC.

### 3.2 Images — what is accepted, and what is refused

The partner app already has the pipeline. What is new is applying it to a cover.

| Property | Value | Why |
| --- | --- | --- |
| Longest edge | 1280px | A cover is shown full-width on a phone and as a hero on the detail page |
| Compression | 0.6 | |
| Aspect | 16:9, cropped on the device | Every card is the same shape. An uncropped portrait photo in a landscape slot is what makes a feed look broken |
| Ceiling | 400,000 characters | About 300KB. Cover + 4 gallery ≈ 1.5MB per restaurant worst case |
| Accepted | `data:image/jpeg`, `data:image/png`, or `https://` | Same rule as documents and dishes |
| Refused | Anything else, including prose | Server-side, in the schema |

**The server re-validates rather than trusting the client.** A data URI is checked
for its prefix, its length, and that its base64 decodes. A client that skips the
resize is refused, because the client is the part a determined partner can modify.

**Moderation.** Every image passes a human before a customer sees it — that is
what "everything needs approval" buys, and it is why no automated NSFW service is
needed on day one. The reviewer sees the image full-size in the approval inbox,
which the admin app already does for KYC documents and the web console now does
too (Session 30).

### 3.3 The placeholder — generated, never a stock photo

A restaurant with no cover and no dish photos gets a card built from what it
already is:

- A background colour derived deterministically from `restaurant.id` — the same
  restaurant is always the same colour, so the feed does not shimmer between
  loads.
- The first letter of its name, large, in a contrasting weight.
- Its primary cuisine tag beneath.

No network request, no asset, no failure mode. It cannot 404 and it cannot be
someone else's photo of someone else's food. A new kitchen looks deliberate
rather than broken on the day it is approved, which matters because that is the
day it is least able to withstand looking unfinished.

### 3.4 The dish slideshow — free, because the photos already exist

A restaurant with no cover but with dish photos rotates its own dish images on
the card and the detail hero.

- Source: `menu.categories[].items[].imageUrl`, which Session 30 gave partners a
  way to set. **No new storage, no new upload, no new field.**
- Up to 5 images, in menu order — the partner's own idea of what to lead with.
- 3.5 seconds each, cross-faded, paused when the card is off screen.
- Respects `prefers-reduced-motion`: with motion reduced it shows the first image
  and does not animate.
- Unavailable dishes are excluded. A slideshow advertising something you cannot
  order is worse than one image fewer.

**Precedence:** cover photo → dish slideshow → generated placeholder. Each step
is a fallback for the one before, so every restaurant always has something
deliberate.

### 3.5 Opening hours

```ts
interface OpeningHours {
  /** 0 = Sunday. Absent day = closed all day. */
  [dayOfWeek: number]: Array<{ opens: string; closes: string }>; // "18:00"
}
```

An array per day, because a kitchen that serves lunch and dinner and shuts in
between is the normal case, not an edge case. A window where `closes` is earlier
than `opens` crosses midnight and is stored as such — a place that shuts at 1am
must be expressible.

**Auto-close, with an override.** Two independent facts decide whether a customer
may order:

- `isOpen` — the partner's switch. Unchanged, still instant, still theirs.
- `withinOpeningHours(now)` — computed from the schedule.

A kitchen accepts orders when **both** are true, *unless* the partner has set
`forceOpenUntil` — a timestamp, set by pressing Online outside hours, that says
"I am working late tonight". It expires on its own so nobody has to remember to
turn it off. The card reads **"Opens at 6pm"** rather than "Closed", which is the
difference between a customer leaving and a customer waiting.

All of it is computed in **Asia/Kolkata**, fixed, on the server. Deriving open
hours from a phone's clock means a customer whose timezone is wrong orders from a
closed kitchen.

### 3.6 The approval inbox — one screen, nothing mixed

You asked for one place, with nothing getting mixed up. Those pull in opposite
directions and the resolution is: **one inbox, three clearly separated sections,
one badge.**

```
Approvals                                        [ 7 ]
──────────────────────────────────────────────────────
  Documents            3    ← KYC, unchanged
  Menu & dishes        2    ← unchanged
  Restaurant profiles  2    ← new
```

Each section keeps its existing dedicated screen for deep work; the inbox is
where you see that something is waiting and route to it. Counts never merge into
one undifferentiated list, so a document is never approved with the muscle memory
of a dish photo.

A profile edit renders as a **before/after diff**, field by field, with the image
full-size and the approve/reject control per field.

### 3.7 Making the offer badge true

The badge is not deleted — offers are real on this platform, `coupons` exist and
work end to end. It becomes **driven by data**:

- The feed returns, per restaurant, the best currently-valid public offer, or
  nothing.
- The badge renders only when there is one, and says what it actually is.
- The hero banner likewise, or it is removed.

A restaurant with no offer shows no badge. That is a less busy home screen and a
true one.

### 3.8 Push notifications — replacing the stub

The nine call sites are correct and stay. What changes is what they reach.

**Device token registry.** A new `deviceTokens` store: `userId`, `token`,
`platform`, `appId`, `createdAt`, `lastSeenAt`. One user may hold several — a
partner with a phone and a tablet — and a token is removed when Firebase reports
it invalid, which is the only reliable way to learn a device is gone.

**Registration.** Each app asks permission at the moment the notification is
worth having, not on first launch: the customer after placing their first order,
the partner at sign-in, the rider at going on shift. A refusal is remembered and
not asked again on the next launch.

**Transport.** FCM HTTP v1 with a service-account credential held in the backend
environment. The dispatcher keeps its current interface exactly, so the nine call
sites do not change; only its body does.

**Degradation is the point.** With no Firebase credential configured the
dispatcher does what it does today — logs and returns — and everything else keeps
working. That is what makes this safe to ship before you finish the Firebase
setup, and it is the same discipline as §3.9.

**What is never in a push body:** the doorstep OTP, the customer's phone number,
the delivery address. A lock screen is visible to whoever is holding the phone.

### 3.9 Google Maps — nothing to change when billing is enabled

Your requirement: turn billing on and everything improves, with no code change
and no deployment. This is **already close to true** and the plan's job is to
prove it and close the gaps.

Already true (Sessions 27–29): the Android key is baked into the manifests and
renders maps regardless of billing; the server key degrades to `estimateByRoad`
when Google refuses; `/health` reports Google's own last refusal; and a failed
lookup is no longer cached for 24 hours, which was the one thing that would have
hidden the fix for a day after you enabled billing.

What this plan adds:

- A **verification pass**, on the live deployment, the moment you enable billing:
  address search, pin-to-address, and a road distance that differs from the
  straight-line estimate. Reported as evidence, not assumed.
- **No feature in this plan is gated on billing.** Address entry keeps its manual
  path, and the map picker keeps working, so a restaurant can be onboarded today
  and its distances simply get better later.
- A check in the gate that **fails if any new code calls a Google API without a
  fallback**, so the property survives me.

---

## 4. Flows, case by case

### 4.1 Partner sets their restaurant up for the first time

1. Registers. Restaurant is `PENDING_APPROVAL`, invisible, cannot go online
   (Session 30).
2. New **Profile** tab: name and address pre-filled from registration, everything
   else empty, with a completeness meter — "Add a cover photo, your hours and a
   description to finish your listing".
3. Photographs the shopfront. Cropped 16:9 on the device, previewed, submitted.
4. Sets hours. Sunday closed, the rest 11:00–15:00 and 18:00–23:00, copied across
   days in one tap because typing seven identical schedules is how hours end up
   wrong.
5. Submits. Everything enters the approval inbox as one edit.
6. The Profile tab shows **In review** with what was sent, and the live values
   beside it.

### 4.2 Admin reviews it

1. Approvals inbox shows `Restaurant profiles 1`.
2. Opens it: before/after per field, cover photo full-size.
3. Approves the photo, hours and description. Rejects the name — it does not
   match the FSSAI licence — with that as the reason.
4. Approved fields are written to the live record immediately. The rejected field
   is returned to the partner with the reason, and the old name stands.
5. Audit log records who approved what, field by field.

### 4.3 Customer opens the app

1. Feed. Each card: cover photo if approved, else the dish slideshow, else the
   generated placeholder. Never an empty grey rectangle.
2. Offer badge only where an offer exists.
3. Hours: "Opens at 6pm" on a closed kitchen. It is still listed, still
   browsable, and the basket refuses checkout with the reason.
4. Detail page: hero, description, hours for the week, the address, and the
   gallery if one was approved.

### 4.4 A kitchen closes for a day

The partner switches Online off. Instant, no queue, no approval — unchanged from
today. Hours describe the normal week; the toggle describes today.

### 4.5 A kitchen works late

At 23:30, outside hours, the partner presses Online. The app explains that they
are outside their hours and asks for how long — the default is until 02:00.
`forceOpenUntil` is set and expires on its own.

### 4.6 An order moves and everyone is told

Placed → the customer's phone shows "Order confirmed" on the lock screen, and the
kitchen's phone rings (Session 30, whichever tab it is on). Accepted → "Sunrise
Kitchen is preparing your order, 25 mins". Out for delivery → "Arjun is on the
way". Delivered → "Enjoy your meal", with the rating prompt.

Every one of those already has a call site. None of them currently leaves the
building.

---

## 5. Security, and what a partner must not be able to do

| Risk | Control |
| --- | --- |
| Partner edits another restaurant | `assertOwnsRestaurant` on every profile route, as on every existing partner route |
| Partner escalates their own status to ACTIVE | `status` and `kycStatus` are not in `EditableProfile`. Rejected by the schema, not hidden in the UI |
| Partner changes money | `packagingFee` and `commissionPercent` are not editable here. Payments session owns them |
| Obscene or impersonating image reaches customers | Nothing is published without a human approving it |
| Oversized image exhausts the request body | 400,000-character ceiling in the schema, ahead of the handler; resize happens on the device so the honest failure is local |
| A data URI that is not an image | Prefix, length and base64 validity checked server-side |
| Partner moves their pin to a city they do not serve | Coordinates bounded as at registration; an approved move is an audit entry |
| Blocked partner edits their listing | The Session 30 live account check refuses every authenticated request |
| Push notification leaks the doorstep OTP | OTP, phone and address are never in a notification body. Asserted in tests |
| Device token belonging to another user | Tokens are written against the authenticated user only, never a body-supplied id |

---

## 6. Work by app

**Partner app** — new Profile tab: cover and gallery upload, name, description,
cuisines, hours editor with copy-across, address and map pin, phone. Pending-edit
state with before/after. Completeness meter. Online toggle gains the
outside-hours override.

**Customer app** — cards and hero use the cover → slideshow → placeholder chain.
Offer badge becomes real. Hours shown, "Opens at 6pm", checkout refuses a closed
kitchen with a reason. Detail page gains description, hours and gallery. Push
registration and permission prompt.

**Admin app** — approvals inbox with three sections and one badge. Profile edit
review with per-field approve/reject and full-size images. Existing screens keep
working.

**Admin web** — the same inbox and profile review, so operations is not
phone-only.

**Rider app** — push registration only. Nothing else in this plan touches it.

**Backend** — `profileEdits` store and repository; partner profile routes; admin
review routes; `openingHours` type, storage and evaluation; offers on the feed;
`deviceTokens` store; a real FCM transport behind the existing dispatcher
interface.

---

## 7. Build order

Each chunk ends with the full gate and is independently shippable.

| # | Chunk | Depends | Ships |
| --- | --- | --- | --- |
| **F1** | `profileEdits` model, partner profile routes, admin review routes, audit | — | A partner can submit; an admin can approve. No UI yet |
| **F2** | Partner Profile tab: photos, text, cuisines, map pin, completeness | F1 | **A restaurant can give itself a face.** The reported problem |
| **F3** | Admin approvals inbox + per-field profile review, mobile and web | F1 | Nothing reaches a customer unreviewed |
| **F4** | Customer: cover → slideshow → placeholder, on card and hero | F2 | **The grey rectangle is gone.** Visible to every customer |
| **F5** | Opening hours: model, editor, evaluation, auto-close, override, "Opens at 6pm" | F1 | A kitchen keeps its own hours |
| **F6** | Offer badge becomes real; hero banner truthful or removed | — | The home screen stops making a false price claim |
| **F7** | Device tokens, real FCM transport, registration in all four apps | — | **Notifications actually reach phones** |
| **F8** | Maps verification once billing is on; gate check for un-fallbacked Google calls | — | Proof, not assumption |

F6 and F7 have no dependency on F1 and can be built first if you would rather
have notifications before photos. F4 is the one you will see.

---

## 8. Working alongside the payments session

**Owned exclusively by this plan** — `profileEdits` and `deviceTokens` and their
repositories, `notifications/**`, the partner Profile screen, the customer feed
and detail screens, the admin approvals inbox, `routes/restaurantRouter.ts`
profile section, `routes/admin/catalogRoutes.ts`.

**Shared — additive only, coordinate first** — `packages/shared-types/src/index.ts`,
`db/client.ts`, `modules/orders/orderService.ts` (notification call sites only),
`routes/admin/peopleRoutes.ts`, `CHANGELOG.md`, `build/MANIFEST.md`,
`STORE_RELEASE.md`. New fields and new functions only. No renames, no signature
changes.

**Never touched by this plan** — `modules/payments/**`, `financeRoutes.ts`, the
payout, settlement, refund and wallet repositories, `packages/pricing-engine/**`,
`pricingConfig.ts`, `ledger.ts`, `money.ts`, `RatesScreen.tsx`. If a customer or
partner screen needs a number from any of those, it reads it — it does not
compute it.

**The customer wallet — settled.** The owner has decided it is removed, and the
payments session removes it: the endpoint, the screen
(`apps/customer-mobile/src/screens/WalletScreen.tsx`) and every entry point to
it, in one change. It is a customer screen and therefore normally this plan's
ground, but it is deleted for a payments reason, and the screen and its server
must not disagree for even one commit. **This plan does not touch it, and does
not replace it with anything.** Recorded in `SESSION_COORDINATION.md` §2.

**Where the two plans disagree, `PAYMENTS_PLAN.md` wins.** Owner's instruction.
That plan is foundational — versioned rates, the integer-paise ledger, frozen
per-order snapshots — and everything about what a customer *sees* rests on
numbers it owns. If a screen in this plan needs a figure, it reads it from there
rather than computing its own.

**Committing.** Both sessions commit to `main`, sequentially, staging by explicit
path and never `git add -A`. A branch per session was this plan's first proposal
and it was wrong — Session A caught it: we share one working directory, and one
directory holds one checked-out branch, so `git checkout -b` in either session
switches the folder under the other one mid-edit. That is a worse failure than
the one branches were meant to prevent.

**APKs** are built only when `git status` shows no uncommitted work from either
session and the full gate passes. That is the consent mechanism — a condition
that can be checked rather than something either session has to remember to ask
about.

---

## 9. Assumptions I am making, and what I need confirmed

Defaults are in place for all of these, so the plan is executable as written.

1. **A pending edit does not block ordering.** A restaurant under review for a
   photo keeps trading on its approved values.
2. **Rejecting a field does not reject the submission.** The rest still applies.
3. **Cuisine tags come from a controlled list** with free text allowed, so search
   and filters keep working. A partner typing "Biriyani" should still be found
   under "Biryani".
4. **The gallery is detail-page only.** It does not appear on the feed card, which
   stays one image for scroll performance.
5. **Existing restaurants keep their seeded Unsplash banners** until a partner
   replaces one. In production there are none — the database is empty.
6. **Hours are optional.** A restaurant with none behaves exactly as today: the
   toggle is the only gate. Nothing breaks for a partner who ignores the feature.
7. **Push permission refused once is not re-asked** automatically. There is a
   button in settings.

---

## 10. What only you can do

| When | What | Why |
| --- | --- | --- |
| Before F7 | Create a Firebase project and add four Android apps — `com.quickbite.app`, `.partner`, `.rider`, `.admin` | Push cannot exist without it |
| Before F7 | Download `google-services.json` for each and tell me where they are | Each app needs its own. They are not secret, but they are per-app |
| Before F7 | Generate a service-account JSON for FCM and put it in Railway as one environment variable | This one **is** a secret. It never enters the repo — the repo is public |
| Before F8 | Enable billing on the Google Cloud project | Address search, pin-to-address and road distances are dead until then |
| Before F8 | Enable **Places API (legacy)** and **Distance Matrix API** | You currently have Places API (New) and Routes API, which this code does not call. This is a real mismatch and will still fail after billing is on |
| ~~Done~~ | ~~Tell the payments session to commit~~ | Landed 22 Sep as `955d79d` |

---

## 11. How this will be verified

Nothing in this plan is reported as working because it compiles.

- **Every chunk ends with the full gate**: backend suites, nine workspaces
  typechecked, secret, URL and translation scans.
- **New suites**: `profileEdits.test.ts` — a partner cannot edit another
  restaurant, cannot set `status`, cannot publish without approval, a rejected
  field does not apply, an approved field does, a superseded edit does not
  resurrect. `notifications.test.ts` — a token is stored against the
  authenticated user only, an invalid token is removed, no OTP or address appears
  in any notification body.
- **Mutation testing on every new guard.** A check that has never failed is not
  evidence. Each new refusal is broken deliberately and must fail a check.
- **On hardware**: a partner photographs a shopfront, an admin approves it, and
  it appears on a customer's home screen on a different phone. That is the
  feature, and it is the test.
- **The APK is inspected, not assumed** — as in Session 30, where the notification
  sound was proven present by reading the resource table rather than trusting the
  build.

---

## 12. Explicitly out of scope

- Written reviews. Stars only, by decision (§1).
- Anything involving money.
- Seeded demo restaurants in production. Starting empty, by decision.
- An external image host. Revisit if the store grows past comfort.
- Automated image moderation. Every image passes a human.
- Scheduled orders, group ordering, loyalty, referrals. Not asked for.
- iOS. No iOS build has ever been run.
