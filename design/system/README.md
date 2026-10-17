# Design system — Quick Bites apps

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Status (18 Oct 2026):** spec for master plan Stage D1 (Customer app) and Stage E (Partner, Rider,
Operations). Nothing built. Motion: [`../motion/README.md`](../motion/README.md). Screens:
[`../screens/README.md`](../screens/README.md). Artwork: [`../ART_BRIEF.md`](../ART_BRIEF.md).

**Adopt, don't add.** The Customer app already has one token file,
`apps/customer-mobile/src/theme/tokens.ts`. Everything below **extends that file in its own names**
(`colors`, `spacing`, `radii`, `font`, `shadow`); no second theme. Screens import components;
components import tokens; a hex value or font size typed in a screen is drift.

**Drift found (needs a decision, see "One brand"):** the other three apps use their own tokens with a
different maroon and cream (`#641C32` / `#FFF7E8` in `delivery-mobile/src/theme.ts`,
`restaurant-mobile/src/theme.ts`, `admin-mobile/src/theme/tokens.ts`) against the Customer app's
`#4A0D1F` / `#F7F2ED`.

---

## 1. Colour

Roles stay as they are in `tokens.ts`; these values change so every text passes WCAG AA (4.5:1),
measured 18 Oct with the WCAG formula:

| Token | Today | Contrast today | New | Contrast new | Why |
|---|---|---|---|---|---|
| `text.muted` | `#9C948B` | 2.69 on app, 2.99 on card | `#766D64` | 4.56 / 5.07 | timestamps, hints were unreadable outdoors |
| `dietary.veg` | `#0F8A5F` | 3.93 on `vegBg` | `#0B7A52` | 4.84 | veg labels are read, not just seen |
| `dietary.nonveg` | `#D64545` | 4.38 on card | `#C0392B` | 5.44 | same red the other three apps already use |
| `rating.base` (white text on it) | `#1BA672` | 3.11 | `#12855A` | 4.64 | the rating number is the badge |
| `dietary.gold` | `#B4801A` | 3.15 on `goldBg` | `#8A6212` | 4.96 | Gold labels |
| `semantic.error` | `#D64545` | 3.94 on app | `#C0392B` | 4.89 | error text sits on the cream canvas |
| `semantic.success` | `#0F8A5F` | – | `#0B7A52` | 4.82 on app | match veg |
| new `accent.text` | – | – | `#A86400` | 4.68 on card | the only amber allowed as text, on white only |

Rules:
- **Maroon** (`primary.600`) = brand, headers, primary buttons, selected states. White on it: 15.3:1.
- **Amber** (`accent.500`) = offers, savings, the one call-to-action per screen when it is not maroon.
  Text on amber is always `text.onAccent` (maroon-black, 8.3:1). **Never white on amber** (2.0:1),
  never amber text on cream.
- `text.muted` only on `surface.app` or `surface.card` (4.2:1 on `sunken`: use `text.secondary` there).
- Colour never carries meaning alone: veg/non-veg keep the square/triangle mark (`DietMark`),
  errors keep an icon and words, the Pure Veg seal has its word.
- Light mode only (owner decision 5 Oct); no dark tokens yet.

### One brand across the four apps (decision for the main session / owner)

Recommended: the three staff apps move to the Customer app's maroon `#4A0D1F` and cream `#F7F2ED`
when they get the shared components in Stage E, via one shared token file (the "code shared by
copy" item in `docs/OPTIMIZATION_BACKLOG.md`). The staff apps keep their extra signal colours
(`go`, `money`, `warning`), re-checked for contrast on the new cream. Until then, no app changes.

## 2. Type

**Family: Lexend Deca** (Google Fonts, SIL Open Font License 1.1; download from Google Fonts,
never taken from another app). Weights: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold, one static
TTF each in `apps/<app>/assets/fonts/`, loaded with the `expo-font` **config plugin** (embedded at
build time, no loading flash; `vercel-react-native-skills` rule `fonts-config-plugin`). Ship the
`OFL.txt` next to the files. Weight is chosen by `fontFamily` name, never `fontWeight` (Android would
fake it).

**Hindi and Kannada (the Customer app ships en/hi/kn, `src/lib/i18n.tsx`): Lexend Deca has no
Devanagari or Kannada letters.** Pair it with **Noto Sans Devanagari** and **Noto Sans Kannada**
(both OFL, same 4 weights) and pick the family by the active language; Latin numbers and prices stay
in Lexend Deca. Without this, Hindi/Kannada text falls back to the phone's system font at random
weights.

Scale (extends `font.size`; minimum 12, no 11 any more; line height ≈ 1.4× for body):

| Style | Size / line | Family | Use |
|---|---|---|---|
| `display` | 30 / 36 | Bold | sign-in headline, "Order placed" |
| `title` | 24 / 30 | Bold | screen titles (iPhone keeps `iosLargeTitle`) |
| `heading` | 20 / 26 | SemiBold | section titles, restaurant name on its page |
| `subhead` | 17 / 24 | SemiBold | card titles, dish names |
| `body` | 15 / 22 | Regular | everything readable |
| `bodyStrong` | 15 / 22 | Medium | prices, totals, selected labels |
| `caption` | 13 / 18 | Regular | meta lines (time, distance), helper text |
| `micro` | 12 / 16 | Medium | badges, chips, the cart count |

- Prices, times, counts, codes: `fontVariant: ['tabular-nums']` so numbers don't jump while rolling.
- `allowFontScaling` stays on; no screen may cut text at 200% (no fixed heights on text rows).
- Sentence case everywhere; no ALL-CAPS labels (the kitchen ticket's order number is the only exception, for distance reading).

## 3. Spacing, radius, elevation

- **Spacing** keeps the 4-point scale in `tokens.spacing`. Screen edge 16, card padding 16, gap between
  cards 12, between sections 24, list row height ≥ 56.
- **Radius** keeps `tokens.radii`: chips/pills/stepper `full`; buttons and inputs `md` 12; cards and
  photos `lg` 16; sheets top corners `xl` 20; full-screen hero images 0. iPhone adds
  `borderCurve: 'continuous'`.
- **Elevation**, three levels only (warm-tinted, as today's `shadow`):

| Level | Today (old architecture) | After Stage C (`boxShadow`) | Use |
|---|---|---|---|
| `card` | `tokens.shadow.card` | `0 4px 14px rgba(91,58,34,0.08)` | cards on cream |
| `floating` | `tokens.shadow.floating` | `0 8px 18px rgba(42,7,16,0.22)` | cart bar, floating Menu button |
| `overlay` | – | `0 -8px 24px rgba(42,7,16,0.18)` | bottom sheets |

  Never animate shadow or `elevation`; fade a pre-shadowed layer instead.

## 4. Icons and images

- Icons: `lucide-react-native` (already installed), stroke 2, sizes 20 (inline) and 24 (buttons),
  colour from text tokens. No emoji as icons. Icon-only buttons carry an `accessibilityLabel`.
- Images: `expo-image` (Stage C) through **`FoodImage`** only (below). Photo rules: `../ART_BRIEF.md` §4.

## 5. Components

Extend before adding: existing pieces are in `apps/customer-mobile/src/components/ui.tsx` (`Card`,
`SectionHeader`, `Chip`, `DietMark`, `RatingBadge`, `Pill`, `Button`, `EmptyState`, `LoadingState`,
`Skeleton`) and `components/Modal.tsx` (must stay the base of every sheet, `CLAUDE.md` §8). New ones
are only those used on two or more screens.

| Component | New / extend | Variants · sizes | States | Notes |
|---|---|---|---|---|
| `PressableScale` | new | – | default, pressed (scale 0.97, 120 ms), disabled (opacity 0.4) | wraps any tappable card/row; `hitSlop` to reach 44×44 pt / 48 dp; optional `haptic` prop |
| `Button` | extend | primary (maroon), accent (amber + onAccent text), outline, ghost, destructive · sm 40 / md 48 / lg 56 high | + pressed via `PressableScale`, loading (spinner replaces label, width fixed) | one primary per screen; label is the action ("Place order", "Send code") |
| `Card` | extend | plain, pressable | – | `lg` radius, `card` elevation |
| `Chip` / `Pill` | extend | filter chip (toggle), info pill | selected (maroon fill, white text), disabled | 36 high, 44 touch area |
| `DietMark` | extend | veg / non-veg | – | square + dot (veg), square + triangle (non-veg), never colour only |
| `PureVegSeal` | **new** | sm (list cards) / md (restaurant page) | – | see §6 |
| `FoodImage` | **new** | `card` 16:10 · `dish` 1:1 · `hero` 4:3 · `thumb` 1:1 48 px | loading (blurhash/cream), loaded (fade 200 ms), missing/broken (our cuisine fallback art) | `contentFit="cover"`, gradient scrim only when text sits on it, fixed aspect so nothing jumps |
| `RestaurantCard` | **new** (home, search, favourites, recommended) | default, compact | open, **not delivering** (§6), favourite on/off | photo `card`, name, rating, time + distance, offer pill, seal |
| `Stepper` | **new** | sm (dish row) / md (sheet, cart) | ADD, `− n +`, disabled (out of stock), busy | fixed width so ADD→stepper never shifts the row |
| `NumberRoll` | **new** | – | – | digit rolls up/down `quick`; used by stepper, totals, ETA |
| `Sheet` | **new** on `components/Modal` + Gesture Handler | auto height / 85% | open, dragging, closing | backdrop 50%, grab handle, swipe-down closes, Android back closes |
| `CartBar` | **new** (home, restaurant) | – | hidden (empty), shown, updating | "2 items · ₹469" + "View cart"; `floating` elevation |
| `Skeleton` | extend | block, line, card | sweep (1.2 s), static under reduce motion | same shape as the content it stands for |
| `CodeInput` | **new** (all four apps) | 6 boxes | empty, typing, error (shake + message), done | paste fills all; `textContentType="oneTimeCode"`, `autoComplete="sms-otp"` |
| `Banner` | new | info, warning, success, offline | – | full-width strip with icon + one sentence + optional action |
| `EmptyState` | extend | – | – | our illustration + one sentence + one action |

## 6. Two badges the plan adds

**Pure Veg seal** (`pureVegSeal`, admin-given, master plan B5). A small round seal, not a pill:
veg green `#0B7A52` ring, cream centre, our leaf mark, the words **"Pure Veg"** beside it in
`micro` Medium green. `sm` 20 px seal on cards, `md` 28 px with the words "Pure Veg · verified by
Quick Bites" on the restaurant page under the name. Shown only from the seal, never from the partner's
own choice. The partner's choice (`cuisineType`) shows as plain text "Veg · Non-veg" / "Veg only" in
the meta line, no seal.

**Not delivering currently** (master plan B1). The card stays in the list, sorted after open ones:
photo desaturated to 30% saturation with a cream veil (opacity 0.55), a `Banner`-style strip across
the photo bottom "Not delivering currently" (+ "Opens 11:00 AM" when hours say so), name and rating
stay readable (text colours unchanged). Tapping opens the restaurant page in read-only mode (menu
visible, ADD disabled with the same message).

## 7. Accessibility (every screen)

- Contrast ≥ 4.5:1 text, ≥ 3:1 icons and input borders (§1 values).
- Touch targets ≥ 44×44 pt (iPhone) / 48×48 dp (Android), 8 px apart; small visuals get `hitSlop`.
- Every tappable has `accessibilityRole` and a label that says the action; state through
  `accessibilityState` (selected, disabled, busy). Countdowns announce at 60 s, 30 s, 10 s, not every second.
- Reduce motion respected (motion README rule 2). No information only in motion or only in a haptic.
- Text scales to 200% without clipping; forms keep the label above the field (never placeholder-only);
  errors sit under the field, in words that say how to fix it.
- Screen-reader order follows the visual order; decorative images `accessible={false}`.

## 8. Words (all apps)

Plain words from the user's side, sentence case, active verbs. A button says what happens ("Send
code", "Place order") and the result uses the same word ("Code sent", "Order placed"). Errors say
what happened and what to do, without apology. Customer-app copy goes through `src/lib/i18n.tsx`
(en/hi/kn) and `scripts/check-i18n.mjs`; every string in `../screens/` is the English source.
