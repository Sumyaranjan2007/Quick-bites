# Quick Bites — Android downloads

Four apps make up the platform. Install the customer app to order; install the
partner and rider apps on other phones to watch an order travel end to end.

| App | Who it is for | File |
| --- | --- | --- |
| **Quick Bites** | Customers ordering food | [`QuickBites-Customer.apk`](build/apk/QuickBites-Customer.apk) |
| **Quick Bites Partner** | Restaurant kitchen screen | [`QuickBites-Partner.apk`](build/apk/QuickBites-Partner.apk) |
| **Quick Bites Rider** | Delivery partners | [`QuickBites-Rider.apk`](build/apk/QuickBites-Rider.apk) |
| **Quick Bites Operations** | Platform admin | [`QuickBites-Admin.apk`](build/apk/QuickBites-Admin.apk) |

All four are version 1.2.0 (versionCode 5), signed with the Quick Bites upload
keys, and built for `arm64-v8a` and `armeabi-v7a`.

### What is new in 1.2.0

The admin app is a full operations console rather than a four-tab monitor. It now
carries a platform dashboard, every order with its complete file, live
deliveries, directories for customers, delivery partners and restaurants, return
and refund case handling, menu and category management, coupons, reviews,
payments, revenue and driver payouts, support complaints, and role-based access
control with an audit log.

Every one of those permissions is enforced by the server, not only hidden in the
app: a restricted administrator who types a URL or replays a request is refused
by the API. Sign in as `ops@`, `finance@` or `support@quickbite.app` to see a
narrower console than `admin@`.

All four apps also gained password recovery (forgot, reset and change), and the
customer app can now raise a complaint or a refund request from inside the app —
both land in the administrator's queue.

## Installing

Android blocks apps from outside the Play Store until you allow it, once, per
browser:

1. Open the link on the phone and let the download finish.
2. Tap the downloaded file. Android will say installing unknown apps is not
   permitted — tap **Settings**, turn on **Allow from this source**, then go back.
3. Tap **Install**.

## Signing in

`pass123` works only when the API is run locally. The hosted deployment
deliberately refuses it — this repository is public, so a password written in
the source would be an open administrator login on the live server. The hosted
password is whatever `SEED_DEFAULT_PASSWORD` is set to in the deployment's
environment variables.

Accounts, in both cases:

| App | Email |
| --- | --- |
| Customer | `customer@quickbite.app` |
| Partner | `partner@quickbite.app` |
| Rider | `rider@quickbite.app` |
| Operations | `admin@quickbite.app` |

## Seeing the whole journey

With the customer, partner and rider apps installed on three phones (or one
phone plus the two web portals), an order moves like this, with no refreshing
anywhere:

1. The customer places an order — it appears on the partner's kitchen screen.
2. The partner accepts it — the customer's tracker moves to *preparing*.
3. The partner marks it ready — every rider on shift is offered the pickup.
4. A rider claims it — the customer and the kitchen both see *rider assigned*.
5. The rider quotes the restaurant's pickup code and collects the food.
6. The customer watches the rider move on a live street map.
7. The rider enters the customer's 4-digit doorstep OTP to complete delivery.

Orders survive restarts and redeploys when the deployment has a Postgres
database attached (`DATABASE_URL`). Without one it falls back to a local JSON
file, which is fine for development and loses everything on a hosted restart.

## The apps need a backend

All four ship pointing at the hosted API. If that deployment is down or has no
`JWT_SECRET` set, the apps will sign in with an error — the binaries are fine,
the server is not. The customer app's **Server settings** on the sign-in screen
can be pointed at any other instance, including one on your own machine.

A build can now actually reach a backend on your own machine: releases permit
cleartext HTTP for `10.0.2.2`, `10.0.3.2` and `localhost` only, which is the
Android emulator's route to the host. Every other destination stays TLS-only, so
this does not weaken the app against a real network.
