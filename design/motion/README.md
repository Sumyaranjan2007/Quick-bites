# Motion — Quick Bites customer app

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Status (17 Oct 2026):** spec only, nothing built. Our own motion language, in our colours
(maroon `primary.600` `#4A0D1F`, amber `accent.500` `#F5A623`, `apps/customer-mobile/src/theme/tokens.ts`).
Benchmarked against a market-leading Indian delivery app. The study (recordings, timings) is kept
private, outside this public repo. No asset, code or Lottie file from another app is used.

Build plan: `docs/plans/master-plan-2026-10-18.md` Stage C (New Architecture + Reanimated 4) then
Stage D. Built with Reanimated 4: CSS transitions for state changes, shared values only where a finger
or scroll drives the value (`expo:expo-animation` skill). Design system: [`../system/README.md`](../system/README.md).

## Tokens (one place: `motion` in `theme/tokens.ts` when built)

Updated 18 Oct to the Expo animation rules: no ease-in on UI (exits use the ease-out curve, shorter),
springs in Reanimated 4's `{ duration, dampingRatio }` form, press scale 0.97.

| Token | Value | Use |
|---|---|---|
| `press` | 120 ms, scale 0.97, `easeOut` (CSS transition) | finger down on any card or button; back to 1 on release |
| `quick` | 160 ms | chip change, text swap, number roll |
| `standard` | 260 ms | screen enter, sheet content, cart bar |
| `slow` | 400 ms | progress fills, map camera |
| Exit | 70% of the enter time, same `easeOut` curve | anything leaving is faster than arriving |
| `easeOut` | cubic-bezier(0.23, 1, 0.32, 1) | default for everything without a finger on it |
| `easeInOut` | cubic-bezier(0.77, 0, 0.175, 1) | something moving across the screen (marker glide uses `linear`) |
| `easeSheet` | cubic-bezier(0.32, 0.72, 0, 1) | a sheet opened by a tap |
| `springSettle` | `{ duration: 400, dampingRatio: 1 }` | settle, no overshoot |
| `springSheet` | `{ duration: 300, dampingRatio: 0.8, velocity }` | sheet/cart bar released from a drag |
| `springBump` | `{ duration: 300, dampingRatio: 0.55 }` | count bump, "added" pop (one small overshoot; only on the user's own action) |

Older names used in the screen files: `springPress` = `press` (a transition, not a spring).

## Haptics (`src/lib/haptics.ts` exists, iPhone only today)

| Moment | Call |
|---|---|
| tab, filter chip, quantity −/+ | `haptic.select` |
| ADD (first item of a dish) | `haptic.tap` |
| order placed, order delivered, coupon applied | `haptic.success` |
| error, refused coupon, out of stock | `haptic.warning` |

**Approved by the owner (17 Oct): soft haptics on Android too** (master plan Stage D1). Fire in the
same frame as the visual, once per user action, never on scroll, never the only feedback.

## Rules

1. Motion explains a change (where it came from, where it went). No decoration loops except loaders.
2. Respect the phone's *Remove animations* / *Reduce motion* (`useReducedMotion`,
   `ReduceMotion.System`): fewer and gentler, not zero. Keep opacity and colour changes that explain a
   state; drop movement, scale, parallax, overshoot and loops (loaders become a static skeleton).
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
