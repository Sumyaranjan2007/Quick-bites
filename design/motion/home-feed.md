# Motion — Home feed

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

Screen: `apps/customer-mobile/src/screens/DiscoveryFeedScreen.tsx`. Tokens: [`README.md`](README.md).

| Element | Trigger | Motion | Haptic |
|---|---|---|---|
| Address row (top) | scroll 0→56 px | fades 1→0 and moves up 12 px, tied to scroll (no timer) | – |
| Search bar | scroll past the address row | sticks to the top; a soft shadow fades in over the last 8 px | – |
| Search hint text | idle | rotates through 3 dish names every 3 s: old slides up and out, new slides in from below, `quick` | – |
| Category chips | tap | selected underline slides to the new chip with `springPress`; chip label colour cross-fades `quick` | select |
| Filter chips (Pure Veg, rating…) | tap | chip fill grows from the tap point (scale 0.9→1, opacity) `quick`; results list cross-fades `standard` | select |
| Pure Veg switch | toggle | thumb moves with `springPress`; one green wash over the list (opacity 0→0.12→0, 400 ms) | select |
| Restaurant cards, first load | data arrives | skeleton (exists: `components/ui.tsx` `Skeleton`) gets a sweep: a light band crosses left→right in 1.2 s, loop; cards then fade in and rise 12 px, 40 ms apart, first 6 cards only | – |
| Card photo | image loaded | fades in over `standard` (no pop from grey) | – |
| Card | press | `press` scale, release `springPress` | – |
| Offer carousel | swipe | snaps to the card; dots: active dot widens 8→20 px `quick` | – |
| Floating cart bar | cart goes 0→1 item | slides up from below the screen with `springSheet` | – |
| Floating cart bar | count changes | number rolls (up for more, down for fewer) `quick`; bar does one `springBump` (scale 1→1.03→1) | – |
| Pull to refresh | pull | system refresh control in maroon | – |

Not doing: video tiles, autoplaying banners, confetti on the feed.
