# Motion — Restaurant page

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

Screen: `apps/customer-mobile/src/screens/RestaurantDetailScreen.tsx`. Tokens: [`README.md`](README.md).

| Element | Trigger | Motion | Haptic |
|---|---|---|---|
| Hero photo | page opens | fades in `standard`; the info card below rises 16 px with it | – |
| Hero photo | pull down at the top | stretches (scale up to 1.15, anchored at the bottom), springs back on release | – |
| Hero photo | scroll up | moves at half speed (parallax) and darkens to 40% | – |
| Restaurant name | scrolled past the info card | header bar fades in; the name cross-fades into the bar `quick` | – |
| Category tabs | scrolled to the menu | stick under the header; the active tab follows the section on screen, underline slides `springPress` | select on tap |
| Veg / Non-veg / Bestseller filters | tap | as home filter chips; the menu re-lays with a layout animation `standard` | select |
| "Menu" floating button | tap | category sheet grows from the button (scale 0.85→1 from its corner, opacity) `springSheet`; backdrop fades to 50%; picking a category closes it and scrolls the menu with `easeOut` | select |
| Dish row | press | `press` scale on the photo only | – |
| Closed / not delivering banner | page opens | slides down from under the header `standard` | warning (once) |
