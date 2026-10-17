# Notifications and live tracking

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. Server paths under `apps/backend-api/src/`.

## Push notifications

| Piece | Where |
|---|---|
| Apps register their token on launch and after sign-in | `apps/<app>/src/lib/pushRegistration.ts` → `POST /api/devices` (`routes/deviceRouter.ts:35`); stored in `deviceTokens` (one row per installed app, with `role` and `platform`) |
| Who gets what, which channel | `notifications/fcmDispatcher.ts` (`CHANNEL` ids `:56-72`, dispatcher instance `:737`) |
| Android sends through FCM | `notifications/fcmTransport.ts` (needs `FCM_SERVICE_ACCOUNT_JSON`) |
| iPhone sends through Apple (FCM rejects iPhone tokens) | `notifications/apnsTransport.ts` (`sendToApns` `:107`; needs `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, bundle `in.quickbites.app`) |
| Staff alerts, digest | `notifications/adminNotifier.ts`, `adminDigest.ts`, `adminNotificationPrefs.ts` |
| "You were paid" | `notifications/payeeNotifier.ts` |
| Is it configured? | `/health` → `services.pushNotifications.configured`, `services.applePush.configured` (`controllers/healthController.ts:85-87`) |

### Android channels (must match the apps exactly)

| Channel id | Created by | Server role (`forApp`) | Sound |
|---|---|---|---|
| `kitchen-orders` | `apps/restaurant-mobile/src/lib/orderAlert.ts:39,78` | `restaurant_owner` | MAX importance, `new_order.wav` |
| `new-orders` | `apps/delivery-mobile/src/lib/orderAlert.ts:20,64` | `rider` | looping alarm |
| `order-updates` | `apps/customer-mobile/src/lib/pushRegistration.ts:44` | `customer` | high importance |
| `payments` | Partner `orderAlert.ts:91`, Rider `orderAlert.ts:77` | – | quiet |
| `default` | none (system fallback) | – | – |

`forApp(devices, channelId)` (`fcmDispatcher.ts:88-91`) sends a channel's push only to devices
signed in with that channel's role, falling back to every device when none matches — so one
person with Customer and Partner apps gets kitchen alarms only in the Partner app. Renaming a
channel in an app means changing `CHANNEL` here too. Channel sound/importance is fixed when the
app first creates it; the custom alarm sound survives builds via `packages/config/expo-plugins/withKeptNotificationSound.js`.

## Live tracking: rider GPS → server → customer map

```
Rider app (background task while online)
  src/lib/shiftService.ts: expo-location startLocationUpdatesAsync (task 'quickbites-rider-shift-location', :23, :66)
  src/lib/api.ts:219  POST /api/riders/location
        ▼
Server  routes/riderRouter.ts:1322  (stores rider + order position, then)
        emitRiderLocation (sockets/socketServer.ts:544) → room order:<id> 'rider:location_update' (:561)
        (also a socket path: 'rider:location' event :273 → order room + admin:control_tower :293-294)
        ▼
Customer app  src/lib/useOrderSocket.ts: io(...) :60, emit 'join:order' :70, on 'rider:location_update' :76
              src/components/LiveOrderMap.tsx draws it; Operations sees it in admin:control_tower
```

- Who may join an order's room: `canJoinOrder` (`sockets/socketAuth.ts:60`). The rider's position is
  not shown to the customer before pickup (`orderMap` suite; `modules/orders/contactVisibility.ts`).
- Silent rider while carrying food → operations alert after `riderLocationSilentMinutes`
  (rates; `carryingWatch` suite, `modules/orders/orderSweeper.ts`).

## Maps (Mapbox)

| Rule | Where |
|---|---|
| One map wrapper per app | `apps/{customer,restaurant,delivery}-mobile/src/lib/nativeMap.ts` |
| **Use `LocationPuck`, never `UserLocation`** — on the old architecture `UserLocation` crashes the app on the first real GPS fix (v30, 16 Oct) | `nativeMap.ts:256-260` (customer), `:243-247` (rider) |
| Emulators never feed Mapbox a GPS fix: GPS crashes show only on a real phone | `CLAUDE.md` §5 |
| Tokens: build-time `MAPBOX_PUBLIC_TOKEN`, `MAPBOX_DOWNLOAD_TOKEN` (root `.env`; Expo env for iPhone); server `MAPBOX_ACCESS_TOKEN` | `apps/*/app.config.js`, `packages/config/expo-plugins/withMapboxToken.js` |
| Server road distance and address search | `modules/places/routingService.ts`, `placesService.ts`; routes `/api/places/*` |
