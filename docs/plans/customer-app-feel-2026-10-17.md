# Plan — the customer app feels like the market leader, in our own brand (17 Oct 2026)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

**Status:** plan only. **Nothing is built until the owner says "make".** No app code changed.
**Order of work and progress now live in [`master-plan-2026-10-18.md`](master-plan-2026-10-18.md)** (this file is its Stage D recipe).
Motion spec per screen: [`design/motion/`](../../design/motion/README.md). Engine work it depends on:
[`new-architecture-and-animations-2026-10-17.md`](new-architecture-and-animations-2026-10-17.md).
The competitor study (recordings, decoded app) is private, outside the repo
(`docs/FOLDER_MAP.md` §2); nothing from it is copied into our code or assets.

## Owner decisions (17 Oct 2026)

| # | Decision |
|---|---|
| 1 | The app must feel as polished as the market leader: same press feel, timing, image-led layout. Our colours (maroon/amber), our logo, our own images, our facts and policies. No generic "AI-made" look. |
| 2 | Food photos must look professional and consistent in every screen. |
| 3 | Font: **Lexend** family (free, SIL Open Font License, from Google Fonts), the same family the leader uses, in a slightly different cut: **Lexend Deca** (a little more letter spacing). Never take a font file out of another app. |
| 4 | Soft vibration on **Android and iPhone** (today: iPhone only, `src/lib/haptics.ts`). |
| 5 | Partner-app and rider-app competitor study skipped. The same motion system goes into our Partner, Rider and Operations apps after the Customer app. |

## Phases (each ends with a check on the owner's phone)

### 0. Engine (from the New Architecture plan, steps 1–5)

New Architecture on, Reanimated 4, Gesture Handler, expo-image, FlashList, Lottie, expo-haptics on
Android. Phone checklist from that plan must pass (maps, Razorpay, GPS, push) before any screen work.

### 1. The base every screen uses (Customer app)

| Piece | What it gives | Where |
|---|---|---|
| Tokens: motion, type scale, spacing, radius | one source for timing and sizes (`design/motion/README.md`) | `src/theme/tokens.ts` |
| Lexend Deca, 4 weights (400, 500, 600, 700) | the leader's type feel, ours; bundled with `expo-font` | `assets/fonts/`, `App.tsx` |
| `PressableScale` | every card/button squashes to 0.96 and springs back; soft haptic where the spec says | `src/components/` |
| Soft haptics on both platforms | `select` = selection tick, `tap` = light impact, success/warning; one switch in Profile to turn off | `src/lib/haptics.ts` |
| `FoodImage` | fixed shapes (card 16:10, dish 1:1, hero 4:3), rounded 16, fade-in, blurred placeholder, dark gradient where text sits on a photo, our own fallback art per cuisine when a photo is missing or broken | `src/components/` |
| Skeleton sweep, number roll, bottom sheet, cart bar | shared pieces named in the screen specs | `src/components/` |

### 2. Sign-in (first screen built)

Our own version of the leader's pattern (layout studied 17 Oct):

| Part | Ours |
|---|---|
| Top 55% of the screen | full-bleed rotating photos of food from **our** partner kitchens (3–4 slides, slow zoom 1→1.06 over 6 s, cross-fade 600 ms), dark gradient into the form |
| Top corners | language button and **"Browse first"** on frosted glass (iPhone already lets people browse before sign-in) |
| Title | our tagline on a divider line ("Harohalli's food, at your door" — wording for the owner) |
| Form | +91 and the phone field, email field (codes go by email today), maroon **Continue**; the field lifts with the keyboard |
| Code screen | 6 boxes, auto-advance, paste from the email/SMS, wrong code → boxes shake + warning haptic, resend countdown, success haptic → home with the screen change |
| Bottom | "By continuing you agree to our Terms and Privacy Policy" linking our live `/terms` and `/privacy` |

Phone-number codes by SMS (the owner's next change) is a separate server task (MSG91 DLT,
`OWNER_ACTIONS.md` Part 0) and Play Console "App access" must be updated with it.

### 3. Screens, in this order

Home feed → Search → Restaurant page → Add to cart + dish sheet → Cart and checkout → Order
tracking → Orders, Profile, Addresses, Help. Each follows its file in `design/motion/`.

### 4. Professional photos

| Step | Who |
|---|---|
| App shows every photo through `FoodImage` (fixed shapes, crop, gradient, fallback art) | build |
| Server makes each upload a standard size (compress, 1600 px max, WebP) so photos load fast | build (server) |
| Partner app: photo guide before upload (light, angle, plain plate, no text on image) + crop frame in the right shape | build |
| Operations: replace or reject a restaurant's photo | build |
| Hero photos for sign-in and the home banners: real photography of our partner kitchens' food | **owner** (a photographer, or the partners' best photos chosen by the owner) |
| Fallback art per cuisine, empty states, "placed"/"delivered" Lottie | **owner** (a designer; must be ours, not generated, not stock from another app) |

### 5. Features the leader has that we lack (same kinds of feature only, no wallet/booking/games)

Owner picks; full comparison was given in the chat on 17 Oct.

| Feature | Cost | Build? |
|---|---|---|
| Schedule an order for later | server + app, medium | owner |
| Delivery instructions as quick choices (leave at door, don't ring, avoid calling) | small | owner |
| "Goes well with" row after adding a dish | server rule + app, medium | owner |
| Dish detail sheet with a big photo | small (with the base) | owner |
| "Add ₹X more to unlock" offer progress | server + app, small | owner |
| "You saved ₹X" strip in the cart | small | owner |
| Search inside a restaurant's menu, floating "Menu" category jumper | small–medium | owner |

### 6. The other three apps

Partner, Rider, Operations get the same tokens, Lexend Deca, `PressableScale`, haptics, sheets and
images (one shared copy, `docs/OPTIMIZATION_BACKLOG.md` "Code shared by copy"). Their own flows keep
their layout; only feel and polish change.

## Checks for every phase

Gate and checks (`docs/TESTING.md`); phone test with motion on and with *Remove animations* on; Android
customer app `npx expo config --type introspect` diff reviewed (`CLAUDE.md` §8, the owner asked for
this change); no file from the private study folder in `git status`. Build only on "make APK".

## Costs and risks

| | |
|---|---|
| Time | Engine 3–5 days; base 1–2 days; sign-in 1 day; each main screen 1–2 days; other apps 3–5 days. Plus phone tests. |
| Store | One new build of every app (versionCode 34+), new review for each; fine during the closed test. |
| Risk | Maps, payment, GPS and push must be re-tested after the engine change. Real photos and illustrations are the biggest part of "professional": code cannot replace them. |
