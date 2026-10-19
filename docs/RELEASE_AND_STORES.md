# Releases, signing and the stores

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. Signing detail: `SIGNING_KEYS.md`. Play Store
step-by-step: `docs/play-store/STORE_RELEASE.md`, listings `docs/play-store/listings.md`.
iPhone: `docs/app-store/IOS.md`. What the owner must do: `OWNER_ACTIONS.md` Part 0.

## Building (only when the owner says "make APK", after all agreed work is finished)

| Rule | Where |
|---|---|
| All four signed APKs → `build/apk/`; `--aab` adds Play bundles → `build/aab/`; `--only <folder>` one app | `bash scripts/build-apks.sh` |
| Every APK installs as an **update**: same package, same key, rising versionCode — the script enforces all three and refuses the debug key | `scripts/build-apks.sh`, `scripts/release/releaseGuards.mjs` |
| Pinned certificates (never edit to make a build pass) | `release/signing-certificates.json` |
| Last versionCode (next build takes +1) — **commit it and the four `app.json` files after a build** | `release/version.json` (33, 16 Oct) |
| Keys restored from the vault on every build | `D:\dev-data\quickbites-keystores\` → `apps/<app>/android/keystore.properties` |
| Check the signature, not the exit code (`apksigner verify --print-certs`, must read `CN=Quick Bites`) | `SIGNING_KEYS.md` |
| Never edit app files during a build, never two builds at once; `./gradlew --stop` if `EBUSY`; stopping a build leaves Gradle running | `CLAUDE.md` §6, memory |
| Archive each release (contents never edited afterwards) | `D:\my all projects\quick-bites-release-archive\vNN-<what>-YYYY-MM-DD\` (`docs/FOLDER_MAP.md` §2) |
| iPhone builds | Xcode on the Mac (build 10 on SDK 52); EAS: `cd apps/customer-mobile && npx eas-cli build -p ios --profile production` (never EAS for Android) |
| No over-the-air updates | owner decision |

## Packages and versions (final; a Play Console app's package can never change)

| App | Package | app.json versionCode | Store state (17 Oct) |
|---|---|---|---|
| Customer | `in.quickbites.app` (Android + iPhone bundle id) | 32 | Play closed test **sent for review** 16 Oct; App Store build 10 uploaded, waiting for a real partner restaurant and the owner's Submit |
| Partner | `com.quickbite.partner` | 32 | release saved; send once the test kitchen exists on live |
| Rider | `in.quickbite.rider` (no "s") | 33 | release ready; foreground-service declaration + video, then send |
| Operations | `com.quickbite.admin` | 32 | private, APK only |

Old packages (`com.quickbite.app`, `com.quickbite.rider`, `in.quickbites.rider`) were replaced on
16–17 Oct; phones with them must uninstall once. Keep their Firebase entries until no phone has them.

## Play Console

- Individual account first: closed test with **12+ testers opted in for 14 consecutive days per app**, then "Apply for production"; switch to Organization when the D-U-N-S number arrives.
- Signing: **Google-managed app signing key**; our keystores are the upload keys (16 Oct decision). (`SIGNING_KEYS.md`'s PEPK paragraph predates this decision.)
- Testers: India, list "Quick Bites testers" (15 people; CSV in `build/play-store/testers.csv`, gitignored).
- Gotcha: App content → **Advertising ID → No** blocks "Send changes for review" though it is not on the Dashboard list.
- Before reviewers look: `OTP_REVIEW_PHONE`/`OTP_REVIEW_CODE` on Railway; "Quick Bites Test Kitchen" and test rider approved on live; real business phone in Operations → Settings → Business registration.
- Graphics and screenshots: `python scripts/play-store/make-graphics.py`, `compose-screenshots.py` → `build/play-store/`.
- Owner guides (private artifacts): launch guide https://claude.ai/artifact/JPXk1ZvcLnQC9xgyiXRy9F, staff guide https://claude.ai/artifact/7WMWotXGyeB3RquM9kU5zR.

## Release history (short)

v8 (25 Sep) → v9, v11 (26 Sep, QA) → v12 (1 Oct) → v16–v18 (2 Oct) → v20 (4 Oct, 1.4.0) →
v21/22/23 (6 Oct) → v28 customer (11 Oct) → v29 SDK 54 (16 Oct) → v30 new customer package →
v31 map crash fix → v32 rider package → v33 rider `in.quickbite.rider` (17 Oct). versionCode 19
was consumed by a failed build. Full detail: `CHANGELOG.md`.
