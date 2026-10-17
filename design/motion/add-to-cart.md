# Motion — Add to cart and the dish sheet

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

Where: `RestaurantDetailScreen.tsx` (ADD button, options), floating cart bar, dish sheet (new). Tokens: [`README.md`](README.md).

## ADD → stepper

| Step | Motion | Haptic |
|---|---|---|
| Finger down on ADD | `press` scale | – |
| First add | the outlined ADD fills maroon from the centre out and becomes `− 1 +`: width stays fixed (no layout jump), "ADD" fades out while `−`, `1`, `+` fade in, `quick` | tap |
| Same moment | one light sheen crosses the button left→right (white 25% band, 500 ms, once) | – |
| `+` | the number rolls up: old moves up and out, new comes in from below, `quick` | select |
| `−` | the number rolls down (the reverse) | select |
| `−` to 0 | stepper shrinks back to ADD (reverse of the first add) | select |
| Dish has options | ADD opens the options sheet instead (below) | – |

## Floating cart bar (same bar as on the home feed)

| Trigger | Motion |
|---|---|
| first item in the cart | slides up from below with `springSheet` |
| count or total changes | number rolls (`quick`) + one `springBump` on the bar |
| a restaurant offer gets unlocked by this add | the offer strip above the bar fills its progress bar `slow`, then the text cross-fades to "Unlocked" with `haptic.success` |

## Dish sheet (tap on a dish photo; options sheet uses the same frame)

| Element | Motion | Haptic |
|---|---|---|
| Backdrop | fades to 50% black, 200 ms | – |
| Sheet | rises from the bottom with `springSheet` | – |
| Close button | round ×, floats 16 px above the sheet; fades in 100 ms after the sheet lands | – |
| Swipe down | sheet follows the finger; released past 30% or fast → closes at exit speed; otherwise springs back | – |
| Option choice (size, extras) | radio/checkbox fills `quick`; price on the button rolls to the new total | select |
| Required option missing | the group shakes 3× sideways (6 px, 300 ms total) and scrolls into view | warning |
| "Add item" | sheet closes, then the cart bar bumps | tap |

Must use `src/components/Modal` (never React Native's `Modal` directly; `CLAUDE.md` §8).
