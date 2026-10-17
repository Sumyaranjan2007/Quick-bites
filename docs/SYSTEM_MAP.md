# System map — four apps, one server, how they talk

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. Where files live: `docs/FOLDER_MAP.md`.

## Who uses what

| App | Folder | Package | Users | Talks to |
|---|---|---|---|---|
| Quick Bites (Customer) | `apps/customer-mobile` | `in.quickbites.app` (Android + iPhone) | customers | REST `/api/*`, socket rooms `order:<id>`, `user:<id>` |
| Quick Bites Partner | `apps/restaurant-mobile` | `com.quickbite.partner` | restaurants | REST, rooms `restaurant:<id>`, `menu:<id>` |
| Quick Bites Rider | `apps/delivery-mobile` | `in.quickbite.rider` | riders | REST (`/api/riders/*`), room `riders:available`, background GPS |
| Quick Bites Operations | `apps/admin-mobile` | `com.quickbite.admin` (private APK) | owner / staff | REST `/api/admin/*`, room `admin:control_tower` |
| Websites | same code as Partner and Operations | – | partners, staff in a browser | served at `/partner`, `/admin` (`routes/webApps.ts:55-80`) |

## The server

| Piece | Where | Note |
|---|---|---|
| Start | `apps/backend-api/src/server.ts` | `node --experimental-strip-types src/server.ts` (`railway.json`, `Dockerfile`) |
| Middleware order | `src/app.ts:20-85` | correlation id → security headers → CORS → websites → body parsers → rate limit → `/health` → public pages → `/api/v1` and `/api` → 404 → error handler |
| API routers | `src/routes/apiRouter.ts` | prefixes and guards; full list `docs/generated/ROUTES.md`, overview `docs/BACKEND_MAP.md` |
| Sockets | `src/sockets/socketServer.ts:134-300` (connection, rooms), `src/sockets/socketAuth.ts` (who may join) | emit helpers `socketServer.ts:364-611` |
| Data | `src/db/client.ts` (in-memory `memoryStore`, 31 collections) persisted to Postgres table `store_documents` (`src/db/postgresStore.ts:144`) | `docs/DATA_MODEL.md` |
| Public pages | `src/routes/publicPages.ts`: `/`, `/privacy`, `/terms` (render `legal/*.md`, `:244-245`), `/delete-account` (`:247`), `/robots.txt`, `/sitemap.xml` | – |
| Health | `GET /health` and `/api/health` → `src/controllers/healthController.ts` (uptime, `services.*.configured`) | `docs/RUNBOOK.md` |

## Socket rooms

| Room | Joined by | Events (emit helper, `socketServer.ts`) |
|---|---|---|
| `user:<userId>` | everyone on connect (`:148`) | personal updates |
| `admin:control_tower` | ADMIN on connect (`:153`) or `join:admin` (`:243`) | `order:created` `:377`, `order:status_update` `:423`, `rider:location_update` `:294`, `rider:sos` `:491`, `ops:alert` `:535`, `kitchen:status_update` `:580`, `menu_request:submitted` `:597` |
| `order:<orderId>` | `join:order` (`:196`), checked by `canJoinOrder` (`socketAuth.ts:60`) | `order:status_update` `:422`, `order:message` `:541`, `rider:location_update` `:561` |
| `restaurant:<id>` | `join:restaurant` (`:210`), `canJoinRestaurant` (`socketAuth.ts:99`) | `order:created` `:374`, `kitchen:status_update` `:579`, `menu:updated` `:590`, `menu_request:reviewed` `:611` |
| `menu:<restaurantId>` | `join:menu` (`:229`) | `menu:updated` `:591` |
| `riders:available` | `join:riders` (`:253`) | `order:available` `:464` |

## Hosting and outside services

| Thing | Where | Set by |
|---|---|---|
| Server + Postgres | Railway project **endearing-ambition**, env **production**; `https://quick-bites-production.up.railway.app` | pushing `main` deploys (`railway.json`) |
| Payments, payouts | Razorpay, RazorpayX (`modules/payments/razorpayAdapter.ts`, `razorpayXAdapter.ts`) | Railway variables |
| Maps, road distance | Mapbox (`modules/places/*`; apps `src/lib/nativeMap.ts`) | Railway + build-time tokens |
| Search | Meilisearch, with built-in fallback (`modules/search/*`) | Railway |
| Push | FCM (Android), APNs (iPhone) (`notifications/*`) | Railway |
| Sign-in codes | Brevo email (`OTP_PROVIDER=email`), MSG91/2Factor SMS (`modules/auth/otpDrivers.ts`) | Railway |
| Menu from photo | Groq vision (`modules/menu/menuAi.ts`) | Railway |

Every variable by name: `docs/CONFIG_AND_SECRETS.md`.
