# Motion — Quick Bites customer app

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Status (17 Oct 2026):** spec only, nothing built. Our own motion language, in our colours
(maroon `primary.600` `#4A0D1F`, amber `accent.500` `#F5A623`, `apps/customer-mobile/src/theme/tokens.ts`).
Benchmarked against a market-leading Indian delivery app. The study (recordings, timings) is kept
private, outside this public repo. No asset, code or Lottie file from another app is used.

Build plan: `docs/plans/new-architecture-and-animations-2026-10-17.md`. Everything here works on
Reanimated 3 (old architecture, SDK 54); Reanimated 4 only makes it smoother.

## Tokens (one place: add `motion` to `theme/tokens.ts` when built)

| Token | Value | Use |
|---|---|---|
| `press` | 100 ms, scale 0.96 | finger down on any card or button; release is a spring |
| `quick` | 160 ms | chip/tab change, text swap, number roll |
| `standard` | 260 ms | screen enter, sheet content, cart bar |
| `slow` | 400 ms | progress fills, map camera |
| Exit | 70% of the enter time | anything leaving is faster than arriving |
| `easeOut` (enter) | cubic-bezier(0.2, 0, 0, 1) | things arriving |
| `easeIn` (exit) | cubic-bezier(0.4, 0, 1, 1) | things leaving |
| `springPress` | damping 18, stiffness 420 | release after press |
| `springSheet` | damping 24, stiffness 230 | bottom sheets, cart bar |
| `springBump` | damping 9, stiffness 320 | count bump, "added" pop (one small overshoot) |

## Haptics (`src/lib/haptics.ts` exists, iPhone only today)

| Moment | Call |
|---|---|
| tab, filter chip, quantity −/+ | `haptic.select` |
| ADD (first item of a dish) | `haptic.tap` |
| order placed, order delivered, coupon applied | `haptic.success` |
| error, refused coupon, out of stock | `haptic.warning` |

**Change needed (owner to approve):** turn haptics on for Android too (expo-haptics supports it).
Today Android users feel nothing.

## Rules

1. Motion explains a change (where it came from, where it went). No decoration loops except loaders.
2. Respect the phone's *Remove animations* / *Reduce motion*: durations go to 0, springs become a
   plain set, loaders become static (`AccessibilityInfo.isReduceMotionEnabled`).
3. Only animate `transform` and `opacity` (cheap, on the UI thread). Never width/height except in
   Reanimated layout animations.
4. A list animates its first appearance only, never on every scroll or refresh.
5. Lottie only for moments (placed, delivered, empty states), our own files, under 60 KB, never on a list row.
6. Every screen keeps working with motion off: no logic waits for an animation to finish.

## Screens

| Screen | Spec |
|---|---|
| Home feed | [`home-feed.md`](home-feed.md) |
| Search | [`search.md`](search.md) |
| Restaurant page | [`restaurant-page.md`](restaurant-page.md) |
| Add to cart + dish sheet | [`add-to-cart.md`](add-to-cart.md) |
| Cart and checkout | [`checkout.md`](checkout.md) |
| Order tracking | [`order-tracking.md`](order-tracking.md) |

Screen change (all screens, `App.tsx` switch): new screen fades 0→1 and rises 6% of its height
over `standard` with `easeOut`; going back reverses at exit speed. Android system back follows the same.
