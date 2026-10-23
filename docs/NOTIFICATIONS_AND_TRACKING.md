# Notifications and live tracking

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. Server paths under `apps/backend-api/src/`.

## Push notifications

| Piece | Where |
|---|---|
| Apps register their token on launch, after sign-in and (since 22 Oct, round 6) whenever the app comes back to the front (re-posted at most every 12 h; the permission window is asked at most once per app start) | `apps/<app>/src/lib/pushRegistration.ts` → `POST /api/devices` (`routes/deviceRouter.ts:35`); stored in `deviceTokens` (one row per installed app, with `role` and `platform`) |
| Who gets what, which channel | `notifications/fcmDispatcher.ts` (`CHANNEL` ids `:56-72`, dispatcher instance `:737`) |
| Android sends through FCM | `notifications/fcmTransport.ts` (needs `FCM_SERVICE_ACCOUNT_JSON`) |
| iPhone sends through Apple (FCM rejects iPhone tokens) | `notifications/apnsTransport.ts` (`sendToApns` `:107`; needs `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, bundle `in.quickbites.app`) |
| Staff alerts, digest | `notifications/adminNotifier.ts`, `adminDigest.ts`, `adminNotificationPrefs.ts` |
| "You were paid" | `notifications/payeeNotifier.ts` |
| Is it configured? | `/health` → `services.pushNotifications.configured`, `services.applePush.configured` (`controllers/healthController.ts:85-87`) |

### Android channels (must match the apps exactly)

| Channel id | Created by | Server role (`forApp`) | Sound |
|---|---|---|---|
| `kitchen-alarm` | `apps/restaurant-mobile/src/lib/orderAlert.ts` (build 48+) | `restaurant_owner` | MAX importance, `new_order.wav` on the ALARM volume (silent/vibrate/DND); deletes `kitchen-orders` |
| `kitchen-orders` | Partner builds up to 47 | `restaurant_owner` | MAX importance, `new_order.wav`, notification volume; the server sends it only to phones whose registration has no build ≥ 48 (`channelFor`, `buildOf` in `fcmDispatcher.ts`) |
| `new-orders` | `apps/delivery-mobile/src/lib/orderAlert.ts:20,64` | `rider` | looping alarm |
| `order-updates` | `apps/customer-mobile/src/lib/pushRegistration.ts:44` | `customer` | high importance |
| `payments` | Partner `orderAlert.ts:91`, Rider `orderAlert.ts:77` | – | quiet |
| `default` | none (system fallback) | – | – |

**Kitchen re-ring (23 Oct 2026):** while an order is ORDER_PLACED the sweeper (`ringKitchenAgain`, `orderSweeper.ts`) sends `remindRestaurantNewOrder` once a minute, tag `kitchen:<orderId>` (replaces the order's notification and rings again), until accepted or auto-cancelled. The Partner website shows "Click here to turn on the new-order sound" until the page has been clicked (`useSoundLocked.web.ts`).

`forApp(devices, channelId, appRole?)` (`fcmDispatcher.ts:88-91`) sends a channel's push only to devices
signed in with that channel's role (or the payload's `appRole`, round 6: help-chat pushes ring only in the app the chat is in), falling back to every device when none matches — so one
person with Customer and Partner apps gets kitchen alarms only in the Partner app. Renaming a
channel in an app means changing `CHANNEL` here too. Channel sound/importance is fixed when the
app first creates it; the custom alarm sound survives builds via `packages/config/expo-plugins/withKeptNotificationSound.js`.

### Permission order and the permissions card (round 6, 22 Oct 2026)

- Partner and Rider `orderAlert.ts` `prepareOrderAlerts()` create their channels FIRST, then ask permission (only if
  `!granted && canAskAgain`): Android 13+ shows the window only once a channel exists. The Rider registers for pushes only
  after `prepareOrderAlerts()` (`delivery-mobile/App.tsx`). Checked by `helpLiveChat`.
- `src/components/AppPermissions.tsx` (identical in all four apps): each permission's real state (Allowed / Off / Blocked /
  Muted channel) and one button; a blocked one shows our dialog and opens the app's notification page
  (`android.settings.APP_NOTIFICATION_SETTINGS`) or the muted channel's page; phones never re-show their own window once
  blocked. Placed in Customer Profile → Phone permissions, Partner Help Centre, Rider Profile, Operations Profile.
- Help chat pushes: `SUPPORT_REPLY`, `SUPPORT_RESOLVED` (to the person, their app only), `ADMIN_SUPPORT_MESSAGE` (to staff
  with `support.tickets.manage`, one per chat per 10 min), `ADMIN_CHARGEBACK`, `ADMIN_REFUND_STUCK` from a failed Razorpay refund.

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

- Every fix is KEPT on the order and the rider with heading and speed by `recordRiderFix` (`modules/riders/liveLocation.ts`), from the socket and from `POST /api/riders/telemetry` (B11, 18 Oct); `GET /api/orders/:id/tracking` adds `riderSpeed` and `riderLocationStale` (over 30 s) and is readable only by the customer, the trip's rider and staff.
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
