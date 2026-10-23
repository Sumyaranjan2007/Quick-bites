# Round 7 — fair delivery distance, help chat that works, no passwords in the Customer app (23 Oct 2026)

**Status:** BUILT 23 Oct 2026 (build 48). Owner's answers (23 Oct): the cap is **1.25 × the straight line** ("800 m costs at most 1 km"; the owner raises the per-km rate instead), plus two new parts: E (new-kitchen rates) and F (kitchen sound in every scenario). **Who tests:** the owner. This file stands alone: the problems, the
root cause of each (with the evidence), the fix, what does not change, and how each fix is checked. Project overview:
`CLAUDE.md`; money rules: `CLAUDE.md` §4. Earlier route work: [`round5-route-time-ticket-2026-10-21.md`](round5-route-time-ticket-2026-10-21.md) §A.

## For the owner, in one screen

| | |
|---|---|
| **What is wrong** | (1) A home 800 m from the kitchen is billed as ~5 km, so the delivery fee and rider pay are too high. (2) In Help, the keyboard covers the message box and Send; in the Partner app "Talk to a person" fails with "That order could not be found". (3) The Customer app shows "Change password", although customers sign in only with a code. |
| **Why** | (1) Google already gives us its **shortest legal** motorbike route (round 5). Around Harohalli, Kanakapura Road and the Harohalli Bypass are **divided roads with a median** and some streets are **one-way**: a legal route must ride to the next U-turn and back. A local rider cuts across instead. **No map service (Google, Mapbox, OSM routers, HERE) will ever route the illegal shortcut**, so "find a shorter route" cannot fix it. (2a) A one-word mistake in the chat code (20 Oct) sends the *help topic's* name where the *order number* belongs, so the server looks for an order called "PAYOUTS" and refuses. (2b) The chat lifts itself by a hand-made screen-position calculation that is wrong on the phones tested. (3) Saving your name in Profile makes the app forget that the account has no password, so the row appears (and "Delete account" then asks for a password the customer never had). |
| **What changes** | (1) **Fair-distance rule:** the billed distance is never more than **1.25 × the straight-line distance** (owner, 23 Oct; one number, changeable on Railway). The 800 m case becomes ≤ 1 km → the ₹30 minimum. Normal routes are untouched. (2a) Fixed on the server at once (every installed app works again after a push), and in the apps. (2b) The message box sits on top of the keyboard in all four apps, measured on a phone first. (3) "Change password" removed from the Customer app; deleting the account and changing the email always use a code. |
| **Cost** | (1) Nothing to run; it **lowers** fees and rider pay on the detour orders only. (2), (3) nothing. One app build (48) for (2b), (2a in-app) and (3). |
| **Not changed** | Rider pay rates (₹12 → ₹8/km, ₹30 minimum, pickup pay), the delivery radius, cash limit, orders already placed (fees are frozen), live tracking, the Partner and Rider password screens. |
| **Only you** | Answer the three questions at the end (defaults are written there; work starts with the defaults if you say nothing). |

---

## A. The route: why 800 m became 5 km, and the fair-distance rule

### A1. What the code does today (verified 23 Oct)

`apps/backend-api/src/modules/places/routingService.ts` `callGoogleRoute`: Google Routes API, `travelMode: 'TWO_WHEELER'`,
`requestedReferenceRoutes: ['SHORTER_DISTANCE']`, keep the shortest (`shortestRoute`), car only if no motorbike route.
Every money path goes through `roadDistance()`: the quote and checkout (`modules/orders/orderService.ts:455`, `:738`),
pickup pay (`modules/riders/tripPayout.ts:76`), and the map line (`roadPath`). Live `/health` on 23 Oct:
`roadDistance.provider = GOOGLE`, `lastRefusal = null`, breaker closed — **Google is answering, and the 5 km is its answer.**

### A2. Research: is there a "shortest route" model that gets 800 m?

- **Google's own rule:** the shorter-distance route "can use local roads, dirt tracks or parking lots, but not maneuvers
  Google Maps considers illegal" ([Google: shorter-distance routes](https://developers.google.com/maps/documentation/routes/shorter-distance-routes);
  two-wheeler mode is still beta: [Google: two-wheeled vehicle route](https://developers.google.com/maps/documentation/routes/route_two_wheel)).
  Riding against a one-way street or across a median is exactly what it will not do.
- **The roads (OpenStreetMap, 23 Oct):** within 900 m of the Harohalli kitchens there are 140 mapped roads, among them
  Kanakapura Road mapped as **one-way pairs** (a dual carriageway) and **10 one-way pieces of the Harohalli Bypass**.
- **Measured on the live kitchens** (positions from the public `/api/restaurants`): 48 homes about 800 m from the four
  live kitchens, each snapped onto a real road, routed four ways with free OSM routers (method: the public OSRM and
  Valhalla demo servers, a few requests, research only):

  | Model | Typical (median) road ÷ straight line | Worst |
  |---|---|---|
  | Fastest car route (what we used before round 5) | 1.71 | **5.50** |
  | Shortest **legal** scooter route (≈ what Google gives today) | 1.67 | **4.11** |
  | Shortest scooter route **ignoring one-way rules** (what a local rider rides) | 1.39 | 2.51 |

  Worst single case, "Food nest hotel" → a home 0.91 km away: fastest car **4.98 km** (up Kanakapura Road, U-turn, back),
  shortest legal **3.56 km**, ignoring one-way **2.27 km**. That is the owner's symptom.
- **Normal ratios elsewhere:** published road-vs-straight-line ("circuity") averages sit around 1.2–1.4 (about 1.34
  across ~300 European cities; 1.18–1.25 country medians in a 2026 sample), higher for very short trips
  ([route-factor studies summary](https://communities.springernature.com/amp/posts/how-efficient-is-tehran-s-transport-network-a-route-factor-perspective-on-accessibility-urban-form-and-comparisons-with-european-cities-and-greater-london),
  [crow-flies vs road sample](https://mapatlas.eu/pt/blog/distance-as-the-crow-flies)). This code already uses 1.3 for its estimate (`ROAD_DISTANCE_FACTOR`).

**Conclusion:** the options are a pricing rule (A3), or running our own router that is allowed to ignore one-way rules
(A5). A different commercial map API changes nothing.

### A3. Fix — the fair-distance rule (one function, every money path)

`routingService.ts`, applied inside `roadDistance()` on every path it returns (cache hit, Google, Mapbox), **after**
the cache so the raw Google answer stays cached and the rule can change without a stale cache:

```ts
/**
 * FAIR DISTANCE (owner, 23 Oct 2026, round 7 A). Google's shortest route is the shortest LEGAL one: across a divided
 * road or a one-way street it rides to the next U-turn (800 m became 5 km in Harohalli); a rider cuts across. A route
 * longer than ROAD_DETOUR_CAP x the straight line is priced at the cap, its time scaled, and its line dropped.
 * seniordev: a ratio, not a rider-realistic router; self-hosted Valhalla (ignore_oneways) if the cap bites often (A5).
 */
export function fairDistance(road: RoadDistance, from: Coordinates, to: Coordinates): RoadDistance {
  const capKm = round2(calculateDistanceKm(from.latitude, from.longitude, to.latitude, to.longitude) * config.ROAD_DETOUR_CAP);
  if (road.source === 'ESTIMATED' || road.distanceKm <= capKm) return road;
  console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), event: 'ROUTE_DETOUR_CAPPED', roadKm: road.distanceKm, cappedKm: capKm }));
  return { distanceKm: capKm, durationMinutes: Math.max(1, Math.ceil((road.durationMinutes * capKm) / road.distanceKm)), source: road.source };
}
```

- `config/env.ts`: `ROAD_DETOUR_CAP: numberFromEnv(process.env.ROAD_DETOUR_CAP, 1.25, 1.1, 5)` (owner chose 1.25; 2 was the first proposal) next to `ROAD_DISTANCE_FACTOR`
  (5 = effectively off). Railway variable; changing it restarts the server. No customer location goes into the log.
- **Why 1.25 (owner, 23 Oct):** "an 800 m trip costs at most 1 km". It sits near the normal road-vs-straight ratio (1.2–1.4), so most trips are billed close to 1.25 × the straight line and every U-turn detour (4–6×) is cut. Riders on genuinely winding roads are paid for slightly less than they ride; the owner raises the per-km rate in Operations to keep pay fair. The ₹30 minimum still covers every trip up to 2.5 km.
- **What it touches:** the quote and checkout fee, the frozen `riderPay`, `routeMinutes` (arrival time), the cash
  limit (15 km), pickup pay. The restaurant list (straight × 1.3) and the radius (straight line) are already below it.
- **Map line when capped:** no polyline is returned, so `roadPath` gives `null` and the tracking map draws its
  existing straight-line fallback (as when Google is down). This keeps "the line is the priced route" honest and
  stops the off-route re-draw (`orderRouter.ts:355-365`) from asking Google again and again for the same detour.

**Check (one, in `src/test/routing.test.ts`):** Google mocked to return a single 4 960 m route for two points 0.88 km
apart → `roadDistance` returns `round2(0.88 × 2)` km, no `polyline`, minutes scaled; a 1.2 km route for the same pair
is returned unchanged. Mutation: set the cap to 5 and watch the first assertion fail.

### A4. What the owner can do with it

`ROAD_DETOUR_CAP` on Railway: 1.6 = stricter (customer-friendly), 2.5 = more generous to riders, 5 = off. Railway logs
show every `ROUTE_DETOUR_CAPPED` line with the Google km and the billed km, so how often it bites is visible.
Also worth a look once: each kitchen's map pin should sit on the side of the road where its entrance is — a pin on the
far carriageway makes every order from that kitchen a U-turn trip.

### A5. Not now (named so nobody re-researches it): our own "rider router"

Valhalla (open source) with `costing: motor_scooter`, `shortest: true`, `ignore_oneways: true` gave 2.26 km on the worst
pair above (Google-like legal: 3.55 km). Running it means a second Railway service (roughly $5–15 a month, estimate),
an OpenStreetMap extract of Ramanagara/Bengaluru Rural refreshed monthly, and OSM's village roads are thinner than
Google's. Price would then be `min(Google, Valhalla, cap)`. Worth it only if the `ROUTE_DETOUR_CAPPED` log shows the
cap biting on many real orders. The public demo servers are for light testing, not production.

---

## B. Help chat

### B1. "That order could not be found" (Partner, and every app after picking a topic) — root cause certain

`SupportChat.tsx` (identical file in `apps/customer-mobile`, `apps/restaurant-mobile`, `apps/delivery-mobile`
`src/components/`), function `connect()`:

```ts
const about = asked[asked.length - 1];          // the last HELP TOPIC, e.g. { id: 'PAYOUTS', ... }
...
...(about ? { orderId: about.id } : {})          // added 20 Oct (6c653b1, R3-9) meaning the ORDER card `about` state
```

The local `about` hides the component's `about` state (the order Help was opened from), so after a person taps a
topic or types a matching question and then "Talk to a person", the app sends `orderId: 'PAYOUTS'`. The server
(`routes/supportRouter.ts:110-112`) looks it up and answers 404 "That order could not be found". Partners almost always
go through a topic, so for them the chat can never reach a person. Typing a question that matches no topic works,
which is why it looked partner-only.

**Fix, server first (works for every app already installed, no update needed), `supportRouter.ts` POST `/tickets`:**
before the order lookup, ignore an `orderId` that is one of this app's topic ids:
`if (req.body.orderId && topicsFor(asker.audience).some(t => t.id === req.body.orderId)) req.body.orderId = undefined;`
with a comment naming builds 42–47 (remove once no phone runs them). Real order ids are `ord_<uuid>`, topic ids are
words like `PAYOUTS`, so they never collide.

**Fix, apps (×3 identical files):** rename the local to `topic` (`topic?.label`, `topic?.category`) so
`...(about ? { orderId: about.id } : {})` refers to the order card again.

**Check:** a case in `src/test/helpLiveChat.test.ts`: a partner raises a ticket with `helpTopics: ['PAYOUTS']` and
`orderId: 'PAYOUTS'` → 200, ticket created with no order; a customer with a real `ord_` id still gets it attached;
a stranger's real order id still gets 403. Then on the emulator: Partner → Help → Chat → tap a topic → Talk to a
person → the chat connects and Operations sees it.

### B2. The keyboard covers the message box — measure first, then fix

**What is there:** every chat lifts itself with `react-native-keyboard-controller` 1.18.5's `KeyboardAvoidingView`
plus our own `useKeyboardOffset()` (`src/lib/keyboardOffset.ts`, one copy per app), which measures the chat's position
on screen and hands the library the difference. Users: `SupportChat` (Customer, Partner, Rider), Operations' `Sheet`
(`admin-mobile/src/components/ui.tsx`, the support chat sheet), `OrderChat` (Customer), `TripChat` (Rider), the
Customer `Screen` wrapper. Round 3 (20 Oct) introduced it and round 4 adjusted the chat; build 47 still shows the fault,
so this time the numbers are read on a phone before anything is changed.

**Research:** the library's author added `automaticOffset` in 1.21 (March 2026) because a hand-passed offset is
"either over-pushed or under-pushed, and the right value changes depending on navigation structure"
([release notes](https://github.com/kirillzyusko/react-native-keyboard-controller/blob/main/docs/blog/2026-03-16-release-1-21/index.mdx));
for chats the docs now point to `KeyboardChatScrollView` (1.21+, still getting fixes in Oct 2026). Our offset depends
on three numbers agreeing — the library's window height, its keyboard height (minus the navigation bar unless it
detects edge-to-edge) and `measureInWindow` (whose origin differs between the old and the New Architecture, on since
18 Oct). One of them disagrees on the tested phone; which one decides nothing about the fix below, but it is logged
so the fix is proven, not guessed.

**Step 1 — reproduce (emulator, build from `D:\qbx`, private QA server):** gesture navigation and 3-button navigation,
Customer / Partner / Rider Help, Operations chat sheet, Customer order chat, Rider trip chat. A temporary
`console.log` of `keyboardVerticalOffset`, the library's window height and keyboard height, and the chat's bottom;
screenshot with the keyboard open. Record by how many points the Send row is covered (≈ status bar 24–48, navigation
bar 16–48, or tab bar ≈ 70 tells which number is wrong).

**Step 2 — fix with no position maths (shared chat file ×3):** drop `KeyboardAvoidingView` + `useKeyboardOffset` in
`SupportChat` and put a spacer under the message box as tall as the part of the keyboard that overlaps the chat:

```tsx
const { height } = useReanimatedKeyboardAnimation();             // 0 → −keyboard height, already in 1.18.5
const insets = useSafeAreaInsets();                               // the chat ends insets.bottom above the screen edge
const lift = useAnimatedStyle(() => ({ height: Math.max(0, -height.value - insets.bottom) }));
// <View style={s.root}>{tabs}<ScrollView …/>{inputRow}<Reanimated.View style={lift} /></View>
```

The list shrinks and stays scrolled to the newest message (`onContentSizeChange → scrollToEnd` already does that), the
box rides on the keyboard. It assumes nothing sits under the chat except the safe-area pad, which holds for Customer
(no bottom bar on Support) and Rider (no tab bar on sub-screens). **Partner:** its bottom tab bar sits under the
Help screen; hide it while the keyboard is open (`useKeyboardState(s => s.isVisible)` in `restaurant-mobile/App.tsx`,
the usual "tab bar hides on keyboard"), which also helps every Partner form.
Operations' sheet, Customer `OrderChat` and Rider `TripChat` get the same spacer if step 1 shows them covered too.

**Fallback if step 1 shows the library's keyboard height itself is wrong:** upgrade
`react-native-keyboard-controller` to 1.22.x in all four apps and use `<KeyboardAvoidingView behavior="padding"
automaticOffset>`; then delete the four `keyboardOffset.ts` copies. Bigger: it is a native module used by ~40 form
screens (`KeyboardAwareScrollView`), Expo SDK 54 ships 1.18.5, so every app needs a full keyboard walk-through.

**Check:** the same emulator pass after the fix, both navigation modes, keyboard open: the whole message box and Send
visible, the last message visible above it, typing a long message grows the box upward; on iOS (customer app) the
spacer uses the same numbers, checked on the next iPhone build.

---

## C. Customer app: no password anywhere

**Root cause:** `ProfileScreen.tsx:211` decides "this account has no password" from `user.hasPassword === false`.
The phone-code sign-in sends `hasPassword` (`authRouter.ts:1390`), but saving the name/phone/language (`PATCH /auth/me`,
`ProfileScreen.tsx:361`, `:384`) and confirming a new email (`/auth/contact/confirm`, `:177`) return the user **without**
it (`publicUser`), and `App.tsx:537` replaces the stored user. From then on the app treats a code-only customer as a
password account: the "Change password" row appears, and **Delete account asks for a password they never had** (a Play
Store requirement that then fails). Accounts that are also a partner or rider do have a password, so the row shows for
them from the start — a password that is never used to sign in to the Customer app.

**Fix (deletion, not a new flag):**
1. `customer-mobile/src/screens/ProfileScreen.tsx`: remove the "Change password" row, its modal and `changePassword`
   with its state; Delete account always uses the emailed/SMS code (`sendDeleteCode` + `{ code }`, which the server
   already accepts for any account with a phone, `authRouter.ts:354`); the email change never shows a password field;
   `passwordless` and every `hasPassword` read go.
2. Server `routes/authRouter.ts` `/contact/request`: `const ownerByCode = !user.passwordHash || req.user!.scope === 'customer';`
   so a Customer-app session proves it owns the account with a code to the current email, exactly as code-only
   accounts already do. Partner and Rider apps keep the password check.

**Check:** a case in `src/test/contactChange.test.ts`: an account with a password and a `scope: 'customer'` token asks to change
its email without a password → code sent and `needsOwnerCode: true`; the same account with a partner token and no
password → 401. On the emulator: sign in with a code, save the name, open Profile → no "Change password", Delete
account asks for a code.

---

## E. New-kitchen rates (owner, 23 Oct 2026) — BUILT

Every kitchen that registers (`openRestaurant`, `authRouter.ts`, the only place one is created) gets its own rates row:
food markup 10 %, platform fee ₹5, commission 2 %, GST on food 5 %, packaging markup 0, extra charge 0, no GST on our
charges (no GSTIN); the packaging fee the kitchen declares stays theirs. `NEW_KITCHEN_CHARGES` in
`modules/payments/restaurantCharges.ts`. Kitchens registered before keep their rates (changed one by one in Operations
→ Money → Inflation → Per restaurant). Check: `onboarding` suite.

## F. Kitchen sound in every scenario (owner, 23 Oct 2026) — BUILT

| Scenario | Before | Now |
|---|---|---|
| App open, any tab | looping chime + vibration + notification | unchanged |
| App closed / phone locked | one chime (single push), order auto-cancelled at 8 min | re-rung **every minute** until accepted (`ringKitchenAgain`, one notification replaced each time; works on installed builds) |
| Phone on silent / vibrate / Do Not Disturb | push silent (notification volume) | build 48+: channel `kitchen-alarm` on the **alarm volume** (DND lets alarms through) |
| Partner website, page never clicked | browser blocks the sound | bar "Click here to turn on the new-order sound" until clicked (`useSoundLocked.web.ts`) |

The server sends the alarm channel only to phones whose registration says build ≥ 48 ("1.4.0 (48)"); older builds keep
`kitchen-orders`, which they have. Not covered (phone settings, only the kitchen can change): the app's notifications
switched off, "New orders" muted in Android settings (the Phone permissions card shows "Muted"), alarm volume at zero,
the battery saver killing the app (the card's battery row). Check: `kitchenPush` suite.

## D. Order of work and release

1. **Server (push = live, helps installed apps at once):** A3 (`fairDistance`, `ROAD_DETOUR_CAP`), B1 server guard,
   C2 scope rule → their three checks → `node scripts/run-backend-tests.mjs` gate → `node scripts/check-secrets.mjs`.
   Docs in the same commit: `CHANGELOG.md` (top, "For the owner"), `CLAUDE.md` §4 (new money rule: fair distance),
   `docs/CONFIG_AND_SECRETS.md` (`ROAD_DETOUR_CAP`), this Tracker, master plan START HERE.
   Push `main`; confirm `/health` uptime reset; one quote on the QA server for a known detour pair shows the capped km.
2. **Apps:** B1 rename (×3), B2 step 1 then step 2 (×3 + Partner tab bar, + others if covered), C1 → `npx turbo typecheck`,
   `node scripts/check-i18n.mjs`, `node scripts/check-apk-secrets.mjs` → emulator pass (B1, B2 both navigation modes, C1).
3. **Build 48** (APK + AAB, all four apps) from `D:\qbx` per `CLAUDE.md` §6; archive
   `quick-bites-release-archive/v48-fair-distance-help-chat-2026-10-XX/`; commit `release/version.json` + four `app.json`.

## Questions for the owner (defaults used if no answer)

1. **Fair-distance cap = 2 × the straight line?** Lower (1.6) charges customers less on detours; higher (2.5) pays riders
   more. Default **2.0**, changeable on Railway any time.
2. **When an order is capped, the tracking map shows a straight line** (default) — or Google's long legal road?
3. **Remove "Change password" from the Customer app for everyone**, including people who are also partners or riders
   (they change it in their Partner/Rider app)? Default **yes**.

## Tracker

| # | Item | Part | Status |
|---|---|---|---|
| 1 | Fair-distance rule (800 m billed as 5 km), cap 1.25 | A | ✅ 23 Oct |
| 2 | Help: "That order could not be found" (topic id sent as order id) | B1 | ✅ 23 Oct (server fix verified on build 47 on the emulator) |
| 3 | Help: keyboard covers the message box | B2 | ✅ 23 Oct: reproduced on build 47 (≈150 px under the keyboard, Partner, 3-button navigation); spacer in `SupportChat` (×3), Partner tab bar hidden on Help while typing. Operations' sheet and the order/trip chats (modals) already fit: unchanged |
| 4 | Customer app: no "Change password"; delete/email by code | C | ✅ 23 Oct |
| 5 | New-kitchen rates | E | ✅ 23 Oct |
| 6 | Kitchen sound in every scenario | F | ✅ 23 Oct |
| — | Build 48 (APK + AAB) | D | see CHANGELOG |
