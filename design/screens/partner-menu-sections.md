# Partner — Switch off a whole menu section

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** "no dosa after 7 pm" in one tap, without touching each dish. **Built on:** Partner
`screens/MenuScreen.tsx` (dish-by-dish stock switch, `restaurantRouter.ts:600-635`); admin
`RestaurantMenuTools.tsx` gets the same control. Plan B5.

## Layout

```
 Menu
 Dosa · 6 dishes                 [ On ●]   section header row: name, count, Switch
 ─────────────────────────────────
 Masala Dosa              ₹90    [ On ●]   each dish keeps its own switch
 …
 Biryani · 8 dishes              [ On ●]
```

Turning a section **off** opens a sheet:

```
 Turn off Dosa?
 6 dishes will show as "Not available now" to customers.
 ( ) Until I turn it back on
 (•) Until 7:00 AM tomorrow       time picker, default = next opening time
 ( ) For the rest of today
 [ Turn off ]   Cancel
```

While off, the header shows "Off · back at 7:00 AM" in amber text and the dish switches below are
dimmed but keep their own state (turning the section on restores each dish as it was).

## States

| State | What shows |
|---|---|
| Saving | switch shows a small spinner; on failure it flips back + "Couldn't change Dosa. Try again." |
| Turned back on automatically | push to the partner: "Dosa is back on the menu." |
| Admin turned it off | header note "Turned off by Quick Bites" (partner can turn it on unless the admin locked it — not in this plan) |

## Motion

Switch is the platform `Switch` (native feel, built-in haptic). Dishes dim with opacity `quick`.

## Checks

Turning off a section hides every dish in it from customers within one refresh and the server refuses
them in a cart; turning on restores dishes that were individually off as still off.
