# Motion — Order tracking

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

Screen: `apps/customer-mobile/src/screens/OrderTrackingScreen.tsx` + `components/LiveOrderMap.tsx`. Tokens: [`README.md`](README.md).
Live tracking was not recorded in the study (no live order); this spec is ours.

| Element | Trigger | Motion | Haptic |
|---|---|---|---|
| Status header (Placed → Accepted → Preparing → Picked up → Arriving → Delivered) | status update on the socket | old title slides up and out, new slides in `standard`; header colour cross-fades | select (success on Delivered) |
| Progress steps | status update | the line to the next step fills `slow` with `easeOut`; the new dot does one `springBump` | – |
| Preparing | while cooking | small pulsing ring on the current step (scale 1→1.2, 1.4 s loop); stops on reduce motion | – |
| Rider marker | each GPS point | glides from the last point to the new one in a straight line over the time between updates (cap 3 s); turns to face the direction of travel `quick` | – |
| Map camera | rider moves out of view | eases to fit restaurant, rider, customer (`slow`); never jumps; stops following while the user is dragging the map, resumes after 8 s | – |
| Bottom sheet (order details) | drag | follows the finger; snaps to 35% / 85% with `springSheet` | select at each snap |
| ETA | changes | minutes roll (`quick`) | – |
| Delivery code card | appears at "Arriving" | slides up from under the sheet `standard` | tap |
| Delivered | final status | our own "delivered" animation once (Lottie, 1.5 s), then the rating card rises | success |
| Rating stars | tap | stars fill left→right 40 ms apart with one `springBump` each | select |

Rules: never use @rnmapbox `UserLocation` (`CLAUDE.md` §8). If maps move to Google, the marker glide
and camera ease stay the same; only the map component changes.
