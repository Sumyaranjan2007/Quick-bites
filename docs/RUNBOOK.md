# Runbook — deploy, check, roll back, fix

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

Verified on 17 Oct 2026 at commit `3caa076`. Live: `https://quick-bites-production.up.railway.app`.

## Deploy

1. Run the gate (`docs/TESTING.md`). Stage files by explicit path (never `git add -A`).
2. `git push origin main` — Railway builds `apps/backend-api/Dockerfile` (`railway.json`) and restarts.
3. Check it is the new server: `GET /health` → `uptimeSeconds` small (`controllers/healthController.ts:9-15`).
   "Deployed" (uptime reset) and "observed working" (the feature tried on live) are different claims.

## Check health

`GET /health` (or `/api/health`) returns uptime and `services.*` (search, rate limit store, payments,
`pushNotifications.configured`, `applePush.configured`, ...; `healthController.ts:18-87`). Railway's
own health check calls `/health` (`railway.json`, Dockerfile `HEALTHCHECK`).

## Roll back

`git revert <bad commit>` → gate → push. Railway deploys the reverted code. Never `git reset --hard`
or force-push `main`. Data is in Postgres and survives deploys; pending emailed confirm links do not.

## Read errors

Railway → backend service → Logs. Lines are JSON with `level`, `event`, `correlationId`
(`middlewares/correlationId.ts`, `middlewares/errorHandler.ts`). Useful events: `OTP_REQUESTED …
deliveryAccepted`, `OTP_VERIFY_FAILED`, `DIRTY_MISS` (a write saved by the backstop), CORS errors.
Phone crashes the owner hit: `adb shell dumpsys dropbox --print data_app_crash` (`docs/TESTING.md`).

## Rotate a key

New key at the provider → Railway variable → Deploy → `/health` → delete the old key. Names:
`docs/CONFIG_AND_SECRETS.md`. Only the owner signs in to Railway and provider accounts.

## Sign-in codes stopped arriving

| Symptom | Check | Fix |
|---|---|---|
| Customer gets no email code | Railway log `OTP_REQUESTED … provider: email deliveryAccepted:` | `false` → `BREVO_API_KEY` / `EMAIL_FROM` wrong or Brevo daily limit (300 free); `true` → look in spam; long term a sending domain with SPF/DKIM (`OWNER_ACTIONS.md` Part 0 step 0) |
| Everyone blocked, need a stopgap | – | `OTP_PROVIDER=fixed` + `OTP_ALLOW_FIXED_IN_PRODUCTION=true` + a private `OTP_FIXED_CODE` (not a repeat or run), then back (`OWNER_ACTIONS.md` Part 0 J) |
| SMS (old app versions) | MSG91 log "DLT Template id not found" | owner finishes DLT (`OWNER_ACTIONS.md` A) |
| Store reviewer cannot sign in | `OTP_REVIEW_PHONE`/`OTP_REVIEW_CODE` on Railway match Play Console → App access | set both, Deploy |
| Confirm link "expired" after a deploy | links are in memory (`routes/authRouter.ts:714`) | register again for a new link |

## Never

Run `scripts/reset-live.mjs` (owner only), sign in to live with the owner's password, run
`scripts/build-apks.sh` unasked, touch the keystore folder, or put a secret in a tracked file.
