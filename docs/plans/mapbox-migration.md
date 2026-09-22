# Google Maps → Mapbox

Owner decision 2026-09-22. Replace Google Maps everywhere, in all four apps
and on the server.

---

## 0. What is NOT in scope, and must not be touched

`pushRegistration.ts` (×4 apps), `fcmTransport.ts` and `fcmDispatcher.ts` are
**Firebase Cloud Messaging**. They are Google, they match a search for
"google", and they are the reason a notification can reach a closed phone.
Removing them would delete the notification system the owner has just paid to
set up. Maps and push are separate products that happen to share a vendor.

---

## 1. The seam that makes this safe

The server already hides the provider behind its own interface:

| Module | Exports | Provider detail |
|---|---|---|
| `modules/places/placesService.ts` | `suggestAddresses`, `resolvePlace`, `reverseGeocode`, `isPlacesConfigured`, `placesStatus` | `GOOGLE` const + key |
| `modules/places/routingService.ts` | `roadDistance`, `roadDistanceMatrix`, `estimateByRoad`, `routingStatus` | `GOOGLE` const + key |

Every caller — `placesRouter`, `eta.ts`, order pricing, the health controller —
goes through those exports. **The provider can be swapped without changing a
single caller.** That is the whole reason this migration is tractable.

The apps have no such seam: they import `react-native-maps`, whose components
are the provider. That half is a real rewrite.

---

## 2. Endpoint mapping

| What we need | Google (now) | Mapbox (after) |
|---|---|---|
| Address autocomplete | Places Autocomplete | Search Box API `/search/searchbox/v1/suggest` |
| Resolve a suggestion | Place Details | `/search/searchbox/v1/retrieve/{id}` |
| Reverse geocode | Geocoding | Geocoding v6 `/search/geocode/v6/reverse` |
| Distance + duration | Distance Matrix | Matrix API `/directions-matrix/v1/mapbox/driving/` |
| Route line on a map | Directions | Directions API `/directions/v5/mapbox/driving-traffic/` |
| Map rendering (apps) | `react-native-maps` | `@rnmapbox/maps` |

Two properties to preserve, both already built and both easy to lose in a
rewrite:

- **The cache.** `placesService` and `routingService` cache aggressively
  because these are billed per call. Mapbox is billed per call too.
- **The fallback.** `estimateByRoad()` computes a straight-line estimate with a
  road factor when the network call fails. Delivery pricing depends on a
  distance, so a failed API call must never mean a failed order.

---

## 3. Session split

### Session A (money) — the server
- `placesService.ts` → Mapbox Search Box + Geocoding v6
- `routingService.ts` → Mapbox Matrix
- `config/env.ts`: drop `GOOGLE_MAPS_SERVER_KEY`, add `MAPBOX_ACCESS_TOKEN`
- `healthController.ts` status fields renamed honestly
- `routing.test.ts`, `platform.test.ts` updated
- Delivery-fee and ETA behaviour must not change: same distances in, same
  prices out

### Session B (experience) — the apps
- `customer-mobile`: `MapAddressPicker`, `LiveRiderMap`, `AddressSearchField`,
  `nativeMap.ts`
- `delivery-mobile`: `TripMap`, `maps.ts`, `nativeMap.ts`
- `restaurant-mobile`: `KitchenLocationPicker`
- Swap `react-native-maps` for `@rnmapbox/maps`, native config in
  `AndroidManifest.xml` / `Info.plist`, token wiring
- The APK build: `@rnmapbox/maps` needs a native rebuild, so this cannot be an
  OTA update

---

## 4. Which "premium features" actually earn their place

The owner asked to use everything because the API is paid. Most of it would
cost performance and help nobody. What is worth using:

- **`driving-traffic` profile** — ETAs that account for real traffic. This is
  the one that visibly improves the product: a customer told 35 minutes at 7pm
  gets 35 minutes, not an off-peak 22.
- **Vector tiles** — smooth pinch-zoom and rotation, which is what makes a map
  feel good rather than like an image.
- **A custom style** in the brand's colours, built once in Mapbox Studio and
  referenced by URL in all four apps.
- **Map matching** for the rider trail, so the moving marker follows the road
  instead of cutting across buildings.

What to skip: 3D terrain and building extrusions (cost frame rate, add nothing
to finding a doorway), isochrones (no feature needs them), and satellite tiles
(heavier, and harder to read for navigation).

---

## 5. What the owner changes in Railway

**Add:**

    MAPBOX_ACCESS_TOKEN = pk.<their token>

**Remove:** `GOOGLE_MAPS_SERVER_KEY`, and any `GOOGLE_MAPS_*` variable.

**Keep, untouched:** every `FIREBASE_*` / FCM variable. Those are push
notifications, not maps.

The public `pk.` token is designed to ship inside apps, so using it server-side
works. It should still be URL-restricted in the Mapbox account, and a separate
token for the server is better practice than one token everywhere.

Google Maps billing can be switched off once both halves are deployed and
verified — not before, or address search stops working on the live app.
