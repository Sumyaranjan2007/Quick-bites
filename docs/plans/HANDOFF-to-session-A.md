# Handoff to Session A (session1): everything Session C built, and what the owner asks next

> **FINAL, 25 Sep, from the owner via Session C:**
> - **Everything is merged to `main`:** Session C's whole branch, including the work that was
>   already on `main` from you and the builder.
> - **Session C is retired.** From now on Session A runs this project, with Session B's help.
>   Session C will not work on it again.
> - **Session A, the owner asks you to:**
>   1. Check all the merged code on `main`.
>   2. Update `CHANGELOG.md`.
>   3. Write the full four-app flow for every case, starting from `docs/plans/CONNECTION-MAP.md`.
>   4. Confirm each case works in real life.
>   5. Do the last check, then build the four APKs with your keystores. Fix the open items in
>      CONNECTION-MAP §3 as you see fit.

**From:** Session C (cloud, "Quick Bite"), 25 Sep 2026
**Code:** merged to `main` (branch `claude/nice-lamport-vxf4yf`, fast-forward).
**The owner's instruction, in their words (paraphrased faithfully):** don't wait
to review the code line by line. Session C informs you of everything, merges to
`main`, and pushes. You then:

1. **Update `CHANGELOG.md`** for everything below. Session C added its own two
   entries at the top; fold them into the project's version history however you
   keep it.
2. **Write a full end-to-end flow of all four apps, covering every case,** from
   the beginning to the end, for each of the four people behind them:
   - the customer
   - the restaurant partner
   - the rider
   - the admin / operations staff
3. **Check that every case can easily be done by those four people in real
   life.** Walk each flow against the actual screens and routes, not the plan.
   Anything a person cannot do from their app is a gap to fix before building.
4. **Only if all cases work:** do one last check of all changes and all code,
   then **build the four APKs** with `scripts/build-apks.sh` on your machine.
   The release keystores are in your vault (`~/quickbites-keystores`). Session C
   cannot sign release APKs, and a debug-signed APK would not install as an
   update over the apps already on phones.

---

## 0. Last check (the owner asked for it): read `docs/plans/CONNECTION-MAP.md`

Session C called **every route each of the four apps uses, signed in as that
app's real user** (220 calls), and every admin call again as ops, finance and
support.

- All calls reach a working route. There are no server errors and no
  wrong-role refusals.
- Every screen or button a staff role cannot use is hidden from it.

The map lists each action app by app, and the live links between the apps.
**Section 3 of the map lists the issues found.** Two are fixed (an
unauthenticated owner lookup, and a red pricing test on `main`). The rest are
one low item and things only your build machine or a real phone can verify
(including the `MAPBOX_DOWNLOAD_TOKEN` the APK build needs). Rerun the probe
any time:

`PROBE_OUT=/tmp/probe.json node --experimental-strip-types apps/backend-api/src/test/connectionProbe.ts`

Use the map as the starting skeleton for the full four-app flow document the
owner asked you to write.

## 1. State at handoff

- `npm run verify` is green: secrets, hardcoded URLs, i18n, 34/34 diagnostics,
  typecheck of all 9 workspaces, all tests.
- `scripts/check-production-boot.mjs`: 17/17. `scripts/check-apk-secrets.mjs`: clean.
- Backend: **69 suites** (`npm test` in apps/backend-api).
- **Not verified here:** the Android JS bundle and the native build (no Android
  SDK or keystores in the cloud container). `build-apks.sh` does both; watch its
  output. Two apps gained code that runs at startup and is worth a first-launch
  look:
  - `delivery-mobile/src/lib/tripWithdrawn.ts`, a `TaskManager.defineTask` at
    import plus `Notifications.registerTaskAsync`
  - the new `payments` and `order-updates` notification channels
- One pre-existing red test on `main` was fixed: `packages/pricing-engine`'s
  "Gold free delivery" test predated `3cbe959` (Gold is a percentage off
  delivery). It now tests 0%, 50% and 100%.

Every item was reported in `docs/plans/brain-sync.md` before it landed, with
what it changes and the check that proves it. Most have a check that fails on
the old code.

## 2. What was built (all on `main` now)

### Server only (safe on the next deploy)

| Item | What |
| --- | --- |
| N1–N13, N21–N23 (part 1) | Payment replay, rider cancel, per-role steps, code lockout, refund stacking, IDOR, idempotency, distance, coupons, cancel fee, tax flag, rejection count. See the first Session C changelog entry. |
| S1 | Saves write only changed rows; a full-diff backstop (10 min, boot, shutdown, money routes) logs `DIRTY_MISS`. |
| S2, S5, S13 | Money routes wait for the database; body-shape contract suite; validation on unvalidated routes. |
| S4 | Rate limit per account (100/min), per address 1,500/min, anonymous 300/min. |
| S6 | Rate "Least we keep per order" trims coupons so no order goes below it (0 = off). |
| S10 | Every order's options are checked (unknown, repeated, over-limit refused; a negative price counts as 0). |
| S11 | Block, password change or deletion closes open sockets. |
| N24 | A door-QR payment on top of cash is refunded. |
| A6 | Rates "Alert when a kitchen rejects" (%) and "Also close that kitchen automatically" (0/1, default 0). |
| A9 | A cancel fee can't be set until "Customer app shows the cancel fee" = 1. |
| Bugs | The rider no-show push went to nobody (wrong id and channel). The admin status route could skip to DELIVERED or CANCELLED. |

### App changes (need the new APKs)

| App | What |
| --- | --- |
| **Admin** | Take trip off rider (A1); give to another rider, with handover note and cash-ceiling check (A2); mark delivered, with cash refusal closing as refused plus a support case (A3); kitchen step for a forgetful kitchen (A4); call customer, kitchen or rider (A5); orders that lost money (A7); cash on/off per customer (A8); GSTIN and business registration in Settings, super admin only (A31); payee statement from Payouts (A32); sizes and extras shown in menu review and order items. |
| **Partner** | Edit an existing dish; sizes (Half/Full, real price each) and extras (F05); chosen size on the kitchen ticket and in history; accept-by countdown (P7); quiet payments channel (R2). |
| **Customer** | All option groups (sizes as radio, extras as checkboxes) (F05); map pin required on new addresses, plus a map picker at checkout (U3); cancel fee shown before cancelling (U1); search suggestions (U4); order-updates channel (U5); delete account, behind the password, refused mid-order (U6); password change keeps this phone signed in (U2). |
| **Rider** | A trip another rider took stops ringing (R1); quiet payments channel (R2); incentives say "Earned" (R3); handover note on a reassigned trip; password change keeps this phone signed in (U2). |

### New owner settings (admin → Rates / Settings), all off or safe by default

- **Least we keep per order**, **Furthest delivery**, **Minimum order**, **Cash cancels before cash is switched off**: 0 = off.
- **Cancel fee after accept / ready**: locked until **Customer app shows the cancel fee** = 1. Set that only after the new customer APK is on phones.
- **Alert when a kitchen rejects** (0 = off), and **Also close that kitchen automatically** (0 = off).
- Switch **Accept addresses without a map pin**: turn it OFF after the new customer APK is on phones.

## 3. Owner to-dos before launch (not code)

- SMS for login codes (the fixed code is fine only for the closed trial).
- Enter the GSTIN in admin Settings before charging GST on platform fees.
- Masked calling needs a provider; staff see real numbers until then.
- RazorpayX live payouts wait on S8 (payout reversed/failed webhook).

## 4. Deferred or struck by agreement

Deferred: S3 (set Railway overlap to 0), S8, P2, P3, P4/P5 (the owner's N7
decision), P19. Struck: S9 (OTA), P6 (partner staff logins), R4/R5, and P1 (the
owner said no review replies).

## 5. Suggested shape for the flow document (point 2 above)

For each person, from install to the end of a working day, including what goes
wrong:

- **Customer:** sign up or log in → address (pin) → browse or search → dish
  options → cart and quote → coupon → pay (online / cash / door QR) → track →
  chat → cancel (fee shown) → delivered → rate → refund or support → Gold
  membership → delete account.
- **Partner:** apply → KYC → bank account → menu requests (sizes, extras,
  edits) → go live → new order (ring, countdown) → accept / reject → cooking →
  ready → handover code → history → statement and payouts → support.
- **Rider:** apply → documents → bank account → go online → offer (ring) → claim
  → pickup code → deliver (OTP / cash / door QR) → trip taken by another →
  reassigned to or from them → cash deposit → earnings and incentives → payouts
  → SOS.
- **Admin:** each role (super, ops, finance, support) → approvals (KYC, menus,
  bank accounts, profile edits) → live deliveries → rescue (A1–A4) → refunds and
  cases → cash desk → payouts and statements → rates and switches → losses →
  business registration → staff and roles.

Mark every step that needs a person to call someone, or cannot be done from
the phone.
