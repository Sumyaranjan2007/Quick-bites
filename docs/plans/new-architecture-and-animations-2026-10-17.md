# Plan: New Architecture + modern animations (ready to start, not started)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

**Written:** 17 Oct 2026 at commit `72e9657`. **Status:** researched and fully specified; **no app code
changed**. The owner asked for everything to be installed and written down so the work can start on
their word ("when I want I can do it"). Start by reading this file, `CLAUDE.md` §6 and §8, and
`docs/APPS_MAP.md`.

## For the owner (what it costs, earns and risks)

| | |
|---|---|
| **Earns** | Smooth, modern motion like the big food apps: springy buttons, sliding sheets, animated cart bar, shimmering loaders, swipe gestures, Lottie celebrations, fast image loading and long lists that never stutter. |
| **Costs** | About 3–5 working days of AI work plus your phone for testing; one new build of every app (versionCode 34+) uploaded to Play again. |
| **Risks** | Maps, Razorpay payment, background rider GPS and push must be re-tested on a real phone; the Customer app is in Google's review, so start after that review passes or accept a re-review. Nothing changes on the server. |
| **Cannot be bypassed** | Every app change needs a new build and store update, unless you reverse your "no over-the-air updates" decision (EAS Update; see the last section). |

## Why a migration is needed first

- The four apps run React Native's **old architecture** (`"newArchEnabled": false` in each `app.json`,
  e.g. `apps/customer-mobile/app.json:178`). It was never a deliberate choice: it came with the
  original project setup.
- **Reanimated 4**, the animation engine every modern React Native app uses, runs only on the **New
  Architecture** (official README). Reanimated 3.x still works on the old one, but is the end of the line.
- **Expo SDK 54 is the last SDK that supports the old architecture**; SDK 55 drops it. So this
  migration is needed for the next SDK upgrade anyway.
- The 16 Oct map crash (`CHANGELOG.md`, versionCode 31) happened *because* @rnmapbox 10.3 expects the
  New Architecture. Moving fixes that class of problem at the root.

## Readiness audit (17 Oct 2026)

Every native library in the four apps (from each `apps/*/package.json`):

| Library | Version now | New Architecture | Action |
|---|---|---|---|
| expo-* modules (av, constants, file-system, haptics, image-manipulator, image-picker, location, media-library, notifications, task-manager, build-properties) | SDK 54 | yes (Expo modules) | none; `expo-av` is deprecated in SDK 54 → plan `expo-audio` (used in `customer-mobile/src/lib/useNotifications.tsx`, `restaurant-mobile/src/lib/orderAlert.ts`, `delivery-mobile/src/lib/orderAlert.ts`) |
| @rnmapbox/maps | ^10.2.10 (resolves 10.3.8) | yes (built for it) | keep `LocationPuck`; `UserLocation` may become safe but do not switch without a phone test |
| react-native-razorpay | 2.3.0 (old bridge module) | **3.0.0 adds TurboModule support**, same `open(options, success, error)` API, falls back on old arch | upgrade to 3.0.0 (`customer-mobile/src/lib/nativePayments.ts:45`) |
| expo-speech-recognition | 3.1.3 | yes (Expo module) | none |
| @react-native-async-storage/async-storage | 2.2.0 | yes | none |
| react-native-svg | 15.12.1 | yes | none |
| react-native-safe-area-context | ~5.6.0 | yes | none |
| lucide-react-native, socket.io-client | JS only | n/a | none |
| Our config plugins (`packages/config/expo-plugins/*`) | – | check `withFmtCxx17`, `withRazorpayXcode26` (iPhone build fixes) still needed | test with a prebuild |

## Libraries to add (versions Expo SDK 54 pins, `node_modules/expo/bundledNativeModules.json`)

| Library | Version | What it gives |
|---|---|---|
| react-native-reanimated | ~4.1.1 | the animation engine (60/120 fps, runs off the JS thread) |
| react-native-worklets | 0.5.1 | required by Reanimated 4 |
| react-native-gesture-handler | ~2.28.0 | swipes, drags, pull-to-close sheets |
| expo-image | ~3.0.11 | fast cached images with fade-in and blurhash placeholders |
| @shopify/flash-list | 2.0.2 | menus and restaurant lists that never stutter |
| lottie-react-native | ~7.3.1 | designer-made animations (order placed, delivered, empty states) |
| expo-linear-gradient | ~15.0.8 | gradients on banners and cards |
| expo-blur | ~15.0.8 | frosted headers and sheets |
| @shopify/react-native-skia | 2.2.12 | optional: shimmer, custom drawing |
| expo-audio | (SDK 54 pin) | replaces deprecated expo-av |

Always add with `npx expo install <name>` from the app folder, so the SDK-matched version is chosen.
Every Expo plugin added to an `app.json` must also be a dependency of that app (`CLAUDE.md` §8).

## Steps (do in this order)

1. **Branch and baseline.** Start from a clean `main`; run the gate and save the four
   `npx expo config --type introspect` outputs (`docs/TESTING.md`). Do not edit app files while a build runs.
2. **Switch the architecture.** Set `"newArchEnabled": true` in all four `app.json`; upgrade
   `react-native-razorpay` to 3.0.0 (Customer only). `npx expo-doctor` must pass in all four apps.
3. **Add the libraries** above with `npx expo install` (Customer first, then Partner, Rider, Operations as
   screens need them). Reanimated 4's Babel plugin comes with `babel-preset-expo` on SDK 54, and no app has its
   own `babel.config.js` (checked 17 Oct), so nothing to add; if one is created later, do not add the old
   `react-native-reanimated/plugin` line.
4. **Prebuild and run on the emulator** (AVD `qb34`) and then on the owner's Vivo phone against the
   private QA server (`docs/TESTING.md`). Claude can drive both with **mobile-mcp**.
5. **Phone test checklist (must all pass):** Customer sign-in by email code; browse, search, restaurant,
   cart; **Razorpay payment page opens and returns success and failure**; cash order; live tracking map
   with the rider moving; "Choose on map" with my-location; push notification arrives with the app
   closed. Partner: sign-in, kitchen alarm sound, accept and ready, menu photo upload, map location.
   Rider: go online (background GPS keeps running with the screen off), full-screen offer, trip map,
   pickup and delivery codes, call customer. Operations: dashboard, order detail, payouts screen.
   Websites `/partner` and `/admin`: `node scripts/build-web.mjs` still builds.
6. **Only then add motion**, screen by screen (catalogue below), using the `expo:expo-animation`,
   Software Mansion `react-native-best-practices` (animations section) and `vercel-react-native-skills`
   skills. Respect the phone's "reduce motion" setting.
7. **Gate, docs, build.** Gate and checks as in `docs/TESTING.md`; update `docs/APPS_MAP.md`,
   `CLAUDE.md` §2 (architecture), §8 (the `UserLocation` rule if it changes), `CHANGELOG.md`.
   The APK/AAB build happens **only when the owner says "make APK"** (`bash scripts/build-apks.sh --aab`),
   then archive, then Play upload.
8. **iPhone:** the next iPhone build must be rebuilt and re-tested anyway (SDK 54, `CLAUDE.md` §7b);
   do it after Android passes.

## Motion catalogue (what "like the competitors" means, built in our own style)

| Where | Motion | Library |
|---|---|---|
| Every button and card | press-in scale + haptic tick | Reanimated, expo-haptics |
| Home feed | shimmer skeletons while loading; images fade in | Skia or Reanimated, expo-image |
| Home header | collapses and fades as you scroll; search bar sticks | Reanimated scroll handler |
| Category chips / offer carousel | snap scrolling with parallax | Reanimated, FlashList |
| Restaurant page | hero image stretches on pull, sticky menu sections | Reanimated |
| Add to cart | button morphs into − 1 + counter; floating cart bar slides up with a count bump | Reanimated layout animations |
| Dish options | bottom sheet with spring and swipe-to-close | Gesture Handler + Reanimated (or `@expo/ui` BottomSheet) |
| Checkout | pay button loading → tick | Lottie |
| Order placed / delivered | celebration animation | Lottie (our own or licensed files) |
| Tracking | rider marker glides between GPS points, progress steps fill | Mapbox + Reanimated |
| Partner/Rider new order | pulsing full-screen offer | Reanimated |

**Rule:** study competitors (screen recordings, the REA and Hermes tools below) for *patterns*, then
build them in our own code, colours and brand. Never copy another app's code, images, Lottie files,
fonts or logo: copyright, and Google Play's impersonation policy can reject the app.

## Tools installed for this work (17 Oct 2026, user level; `CLAUDE.md` §10)

| Tool | Use here |
|---|---|
| `expo` plugin (24 skills, incl. `expo-animation`, `expo-native-ui`, `expo-design-system`, `expo-ui`, `expo-upgrade`) | how to animate, native feel, SDK steps |
| Callstack `building-react-native-apps` + `testing-react-native-apps` | performance, upgrades, device testing (`agent-device`, `dogfood`) |
| `vercel-react-native-skills` | 38 rules incl. animation and list performance |
| Software Mansion `skills` (Reanimated authors) | `react-native-best-practices` with animation references, `pulsar-haptics` |
| `superpowers` | `writing-plans`, `systematic-debugging`, `verification-before-completion` |
| `frontend-design` | the `/partner` and `/admin` websites' look |
| MCP **mobile-mcp** | Claude taps through the emulator/phone, screenshots, crash logs |
| MCP **context7** | current docs for Reanimated 4, Expo 54, FlashList etc. |
| MCP **rea** + JADX | read a native (Kotlin/Java) APK's code |
| **hermes-dec** (`C:\Users\priya\AppData\Roaming\Python\Python312\Scripts\hbc-decompiler.exe`) | read a React Native app's compiled JS (`assets/index.android.bundle`); tested on our own Customer APK |
| Expo plugin's remote MCP | needs an Expo sign-in (`/mcp`) before use |

## The one limitation left: a new build per change

Every change to the apps reaches phones only through a new build and a store update. The only way
around it is **over-the-air updates (EAS Update / `expo-updates`)**, which push new JavaScript
(screens, animations) to installed apps without the store. The owner decided against OTA on 25 Sep
2026 (`docs/DECISIONS.md`); the `expo:eas-update` skill is installed if that decision changes. OTA cannot
deliver native changes (new libraries like the ones above), so this migration needs one store build
either way.
