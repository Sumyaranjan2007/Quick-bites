# Quick Bite Platform -- 100% Free Complete Deployment & Runbook Guide

**Version:** 2.0.0  
**Repository:** [https://github.com/Sumyaranjan2007/Quick-bites](https://github.com/Sumyaranjan2007/Quick-bites)  
**Live Production API:** [https://quick-bites-production-9f45.up.railway.app](https://quick-bites-production-9f45.up.railway.app)  
**Cost:** $0.00 / ₹0.00 (100% Free Forever Stack)

---

## 1. Project Analysis & Ecosystem Topology

Quick Bite is an enterprise-grade, multi-portal food delivery ecosystem engineered to benchmark against Zomato and Blinkit. The codebase is organized as a unified **Turborepo monorepo** operating across 7 applications and 3 shared packages:

```
                                  [ Global Public Internet ]
                                              |
                     +------------------------+------------------------+
                     |                                                 |
             [ HTTPS Traffic ]                                  [ Static HTTPS ]
                     |                                                 |
                     v                                                 v
        +--------------------------+                      +--------------------------+
        |   Quick Bite Backend     |                      |   Vercel & GitHub Pages  |
        |  Railway (Node 22 / TS)  |                      |   Free Web Hosting       |
        |  - Express REST API      |                      |   - restaurant-web       |
        |  - Socket.IO WebSockets  |                      |   - admin-web            |
        |  - JSON Data Store       |                      |   - docs landing page    |
        +------------+-------------+                      +--------------------------+
                     |
       +-------------+-------------+-------------+
       |                           |             |
       v                           v             v
[ Device 1: Customer ]    [ Device 2: Partner ]  [ Device 3: Rider ]   [ Device 4: Admin ]
apps/customer-mobile      apps/restaurant-mobile apps/delivery-mobile  apps/admin-mobile
(Release APK compiled)    (React Native / Expo)  (React Native / Expo) (React Native / Expo)
```

### The Component Breakdown

| Directory | Type | Purpose | Production Hosting | Free Tier Boundary |
| :--- | :--- | :--- | :--- | :--- |
| `apps/backend-api` | Node.js / Express | Core REST API, Auth, Sockets, Pricing | **Railway.app** | $5 free monthly credit / 500 hours |
| `apps/restaurant-web` | React 18 + Vite | Live Kitchen KOT terminal & Menu Catalog | **Vercel** | 100% Free (Unlimited bandwidth) |
| `apps/admin-web` | React 18 + Vite | Admin Control Tower & KYC Approval Queue | **Vercel** | 100% Free (Unlimited bandwidth) |
| `docs/` | Static HTML | Public Documentation & Showcase Landing | **GitHub Pages** | 100% Free (Unlimited hosting) |
| `apps/customer-mobile`| React Native | Customer Discovery, Cart, OTP Tracking | **Android APK** | Standalone unsigned APK |
| `apps/restaurant-mobile`| React Native | Mobile Kitchen Order Terminal | **Android APK / Expo**| Standalone unsigned APK |
| `apps/delivery-mobile`| React Native | Rider Shift, Telemetry, Doorstep Delivery| **Android APK / Expo**| Standalone unsigned APK |
| `apps/admin-mobile` | React Native | Mobile Ops Control & Dispute Refunds | **Android APK / Expo**| Standalone unsigned APK |
| `packages/pricing-engine`| TS Library | 5% GST, Gold discount, Platform fee, 15% fee| Monorepo Shared | Local / zero cloud cost |
| `packages/design-system`| CSS / React | Pure CSS Zero-Emoji badges, Stitch tokens | Monorepo Shared | Local / zero cloud cost |
| `packages/shared-types` | TS Types | Universal interfaces across all 4 apps | Monorepo Shared | Local / zero cloud cost |

---

## 2. Current State (Already Done & Live)

1. **Git Repository**: Synced on `main` branch at `https://github.com/Sumyaranjan2007/Quick-bites`.
2. **Backend Deployed on Railway**: 
   - Public URL: `https://quick-bites-production-9f45.up.railway.app`
   - Node 22 runner with native type stripping enabled.
   - Host bound to `0.0.0.0` with dynamic `$PORT` routing.
   - Root welcome route `GET /` and universal `/api` & `/api/v1` routes active.
3. **Mobile Apps Configured**:
   - All 4 mobile apps updated to point to `https://quick-bites-production-9f45.up.railway.app/api`.
4. **Customer Mobile APK Compiled & Hardened**:
   - Output binary: `build/apk/QuickBite-Customer.apk` (33.0 MB).
   - Dual-ABI architecture support: `armeabi-v7a` (32-bit) + `arm64-v8a` (64-bit).
   - Bundled clean Hermes bytecode targeting Android SDK 34+ with isolated React Native tokens (no web DOM conflicts).

---

## 3. Step-by-Step Next Steps: 100% Free Deployment

### Step A: Deploy the Web Dashboards to Vercel (100% Free)

You already have Vercel authorized on your GitHub account! Follow these exact steps to launch both web dashboards online:

#### 1. Deploy the Restaurant Kitchen Web Portal (`restaurant-web`):
1. Go to [https://vercel.com/new](https://vercel.com/new).
2. Click **Import** next to your repository `Sumyaranjan2007/Quick-bites`.
3. In the project configuration:
   - **Project Name**: `quickbites-partner`
   - **Framework Preset**: `Vite` (auto-detected)
   - **Root Directory**: Click **Edit**, select `apps/restaurant-web`, and click **Continue**.
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Click **Deploy**.
   *In ~45 seconds, you will get a live URL like `https://quickbites-partner.vercel.app`.*

#### 2. Deploy the Operations Admin Web Portal (`admin-web`):
1. Go back to [https://vercel.com/new](https://vercel.com/new).
2. Click **Import** next to `Sumyaranjan2007/Quick-bites`.
3. In the project configuration:
   - **Project Name**: `quickbites-admin`
   - **Root Directory**: Click **Edit**, select `apps/admin-web`, and click **Continue**.
4. Click **Deploy**.
   *In ~45 seconds, you will get a live URL like `https://quickbites-admin.vercel.app`.*

---

### Step B: Deploy the Landing Page to GitHub Pages (100% Free Forever)

Your project contains an interactive landing page in `docs/index.html`.

1. Open your GitHub repository: [https://github.com/Sumyaranjan2007/Quick-bites](https://github.com/Sumyaranjan2007/Quick-bites).
2. Click **Settings** (top right of GitHub repo) &rarr; **Pages** (left sidebar).
3. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: Select `main`
   - **Folder**: Select `/docs`
4. Click **Save**.
5. Wait ~60 seconds. Your live public showcase page will be live at:  
   👉 **`https://sumyaranjan2007.github.io/Quick-bites/`**

---

### Step C: Install the Customer Mobile App on Your Android Phone

The APK has been compiled and is ready at:  
`d:\my all projects\quick bites\build\apk\QuickBite-Customer.apk`

#### Option 1: Send via WhatsApp Web / Google Drive
1. Open Google Drive or WhatsApp Web on your PC.
2. Drag and drop `build/apk/QuickBite-Customer.apk`.
3. On your Android phone, download the file from Drive/WhatsApp.
4. Tap the APK file and select **Install**.  
   *(If prompted: "Install unknown apps" &rarr; Toggle "Allow from this source")*.

#### Option 2: USB Cable Transfer
1. Connect your phone to your PC via USB cable.
2. Select **File Transfer / MTP** on your phone.
3. Copy `QuickBite-Customer.apk` into your phone's **Download** folder.
4. On your phone, open the **Files** app &rarr; **Downloads** &rarr; Tap to install.

---

### Step D: How to Build APKs for the Other 3 Mobile Apps

If you want to install the Restaurant Partner, Delivery Rider, or Admin app on separate Android phones, run these commands in your terminal:

```powershell
# 1. To build Restaurant Partner APK:
cd "d:\my all projects\quick bites\apps\restaurant-mobile\android"
.\gradlew.bat assembleRelease
# Output will be at: apps\restaurant-mobile\android\app\build\outputs\apk\release\app-release.apk

# 2. To build Delivery Partner APK:
cd "d:\my all projects\quick bites\apps\delivery-mobile\android"
.\gradlew.bat assembleRelease
# Output will be at: apps\delivery-mobile\android\app\build\outputs\apk\release\app-release.apk

# 3. To build Admin Operations APK:
cd "d:\my all projects\quick bites\apps\admin-mobile\android"
.\gradlew.bat assembleRelease
# Output will be at: apps\admin-mobile\android\app\build\outputs\apk\release\app-release.apk
```

---

## 4. End-to-End Multi-Device Testing Runbook

Once your web portals and mobile APK are running, test the complete multi-persona loop:

### Verified Test Credentials

| Persona | App | Email | Password | Pre-Configured State |
| :--- | :--- | :--- | :--- | :--- |
| **Customer** | Customer Mobile / APK | `customer@quickbite.app` | `pass123` | Gold Member, Indiranagar, ₹500.00 wallet balance |
| **Restaurant**| Restaurant Web / Mobile | `partner@quickbite.app` | `pass123` | Bangalore Biryani House, KOT terminal |
| **Rider** | Delivery Mobile | `rider@quickbite.app` | `pass123` | Vikram Singh, Active Shift, KA-03-EQ-8812 |
| **Admin** | Admin Web / Mobile | `admin@quickbite.app` | `pass123` | Super Admin, KYC queue, dispute arbitration |

### The 5-Minute Demonstration Walkthrough

1. **Place Order as Customer**:
   - Open **Customer Mobile**. Sign in as `customer@quickbite.app`.
   - Select **Bangalore Biryani House**.
   - Customize "Special Chicken Dum Biryani" (Portion: Large, Add extra Raita).
   - Go to Cart &rarr; Apply coupon &rarr; Tap **Place Order & Pay with Wallet**.
   - Note the **4-digit Delivery OTP** generated on the tracking screen (e.g. `9946`).

2. **Accept Order on Restaurant Terminal**:
   - Open your deployed **Restaurant Web** portal on your laptop/browser.
   - Switch to **Kitchen Queue**.
   - Hear the audio chime alert and see the incoming order card with the 120s timer.
   - Click **Accept Order** &rarr; Select prep time (20 mins) &rarr; Click **Mark Ready for Pickup**.
   - The screen shows the **4-digit Pickup Code** (e.g. `5869`).

3. **Fulfill as Delivery Partner**:
   - Open **Delivery Mobile**. Sign in as `rider@quickbite.app`.
   - Tap **Check-in to Shift**.
   - Accept the broadcast assignment.
   - Reach restaurant &rarr; Enter pickup code `5869` &rarr; Tap **Pickup Verified**.
   - Ride to customer &rarr; Ask customer for their Doorstep OTP (`9946`).
   - Enter OTP &rarr; Tap **Complete Delivery**.

4. **Verify on Admin Control Tower**:
   - Open your deployed **Admin Web** portal.
   - Watch the platform pulse: Gross Merchandise Value (GMV) increments, active orders update, and wallet transaction ledgers reflect payout.

---

## 5. Free Cloud Services Configuration Reference

Your backend runs completely free on Railway with local file persistence (`data/store.json`). If you ever want to connect external cloud databases, here are the 100% free providers supported out of the box:

| Service | Provider | Free Plan Specs | Environment Variable in `.env` |
| :--- | :--- | :--- | :--- |
| **PostgreSQL + PostGIS** | Supabase | 500MB DB, 50,000 MAU free | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| **Redis Cache** | Upstash | 10,000 requests/day free | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Full-Text Search** | Meilisearch Cloud | Free tier / In-Memory Fallback | `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` |
| **Payments Sandbox** | Razorpay | Unlimited test mode sandbox | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |

---

## 6. How to Push Updates in the Future (1-Command Sync)

Whenever you edit files locally on your machine, deploy updates to both Railway and Vercel simultaneously:

```powershell
# 1. Stage all changes
git add -A

# 2. Commit with a message
git commit -m "feat: your new feature or fix"

# 3. Push to GitHub
git push origin main
```
Both **Railway** and **Vercel** listen to the `main` branch and will automatically trigger new builds and deployments within seconds!
