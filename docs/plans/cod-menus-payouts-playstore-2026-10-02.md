# COD switch, admin menus, payouts, rider pay by city, Play Store — plan (2 Oct 2026)

The owner's request of 2 Oct, the answers they gave, and the order the work is
done in. Nothing that already works may break: the gate (80 suites) runs after
every block, and every money change is tested by paying the same payee twice.

## Owner's decisions (2 Oct)

| Topic | Decision |
|---|---|
| COD | On/off **per restaurant**, set only by admins. "The main thing of this update." |
| Admin menus | From the restaurant's profile: upload, and edit **live** dishes with every partner feature (photo, sizes, extras, veg, description, section). The partner is notified. |
| Rider pay | ₹12 per road km by default, minimum ₹30 unchanged. Editable globally and **per city** (₹/km only). |
| Hold period | None (0 days, riders and restaurants). ₹100 minimum payout kept. Admin pays whenever. |
| Paying | By hand (UPI/bank + UTR) **and** RazorpayX when configured. |
| Razorpay | Owner adds **live** keys on Railway (live is on `rzp_test_` today). |
| Play Store | Customer, Partner, Rider public. Admin private (APK / internal track). |
| Account deletion | Partner and Rider get "Delete account" = request; account closes at once, admin completes after dues are settled. |
| Staff guide | One shareable web page covering all 4 apps. |

## 1. COD switch per restaurant (main item)

**Server**
- `restaurant.acceptsCash` (absent = true, so every existing restaurant keeps COD).
- Set only through `PATCH /api/admin/restaurants/:id` (`users.restaurants.manage`), audited "COD turned off/on for X". The partner's own profile route must not accept it.
- `POST /orders` and the quote refuse `CASH_ON_DELIVERY` for a restaurant with COD off: `COD_NOT_ACCEPTED`, "This restaurant takes online payment only."
- Restaurant reads (list, detail, menu) carry `acceptsCash` so the app knows before checkout.
- With COD off and online payment not configured, the restaurant can't take orders: the customer sees why, and the admin switch warns before turning COD off.

**Customer app:** checkout hides "Cash on delivery" for that restaurant, preselects Pay now and says "This restaurant accepts online payment only". The restaurant page shows "Online payment only".

**Admin app:** a switch on the restaurant's profile (People → Restaurants → the restaurant): "Cash on delivery: On/Off", with a confirmation and a warning when online payment isn't live.

**Tests:** COD refused when off (order and quote); online still accepted; another restaurant unaffected; the partner can't set it; non-admin refused; the audit entry is written.

## 2. Admin menu management from the restaurant profile

- The restaurant profile gets **Menu** actions: "Upload a menu (or read it from photos)" (the existing builder) and "Edit the live menu" (the existing menu sheet).
- **Full dish editor for live dishes**: name, price, section, description, veg/non-veg, **photo** (camera/gallery), **sizes** (2–4), **extras** (≤10), in stock. It's the partner's DishEditor form, sharing its rules (`dishProblems`).
- Server: `PATCH/POST /admin/menus/:id/items` accept `sizes` and `extras` and turn them into option groups exactly as approval does (`optionGroupsFromChoices`). A changed price clears the typed customer price (existing backstop).
- The partner is notified ("Quick Bites updated Paneer Tikka on your menu"), and the change is listed in the partner's Recent decisions.
- Fix: the Admin app blocks the CAMERA permission, so "Take a photo" can't work. Unblock it.

**Tests:** admin edit with sizes/extras/photo becomes the same option groups as an approved request; the customer price follows the markup; the partner is notified; a partner can't call the admin route.

## 3. Rider pay ₹12/km, global and per city

- One-time rates version on boot: `riderPerKmFee` 12 (guard flag `rates:rider-per-km-12-2026-10-02`). Default in shared-types → 12.
- **City rates**: `{ city → ₹/km }`, stored server-side, versioned in the audit log, edited on Rates → "Rider pay by city". An order uses its restaurant's city rate, else the global rate. Same minimum and markup.
- Applied wherever rider pay is priced (quote, checkout, legacy fallback), then frozen on the bill as now.
- Rates screen: the examples card shows the global rate; the city list shows each city's own examples.

**Tests:** city rate applies to that city only; other cities use global; changing the city rate after checkout doesn't change frozen pay; same rider paid twice.

## 4. Payouts: no hold, honest status, smoother paying

- One-time rates version: `partnerHoldDays` 0, `riderHoldDays` 0 (flag `rates:no-hold-2026-10-02`); defaults → 0. `minPayoutAmount` stays 100.
- **Status words**: "Blocked" only for a real blocker someone must act on (no account, cash in hand). Nothing owed → "Settled" (neutral). Under ₹100 → "Under ₹100 minimum" (info). Held (if a hold is ever set again) → "In hold until …".
- Settlements rows get **Pay now** straight from the row. Manual: the app shows their UPI/bank, the admin enters the UTR, and it's recorded. RazorpayX: sends.
- **Money → Finance → Rider settlements** tab (new), matching Restaurant settlements: each rider's earned, paid, owed, cash in hand, and a statement per rider.
- Real figures: replace the fixed "Commission (15%)" label with the actual rate. Check every Finance/Settlements total against the ledger (two payees, paid twice).

**Tests:** zero hold makes earnings payable at once; NOTHING_OWED isn't "blocked"; the rider settlements endpoint agrees with the ledger and Pay; second payout correct.

## 5. Play Store readiness (Customer, Partner, Rider)

- **App bundles**: Play needs `.aab`. Add `--aab` to `build-apks.sh` (bundleRelease, same signing key; the APK flow is unchanged for staff installs).
- **Account deletion** in Partner and Rider (request → closed at once → admin completes after dues). Customer has it already. Admin: People → "Deletion requests".
- **Privacy policy URL** reachable on the web (served by the backend), plus an account-deletion web page (Play requires a link outside the app).
- **Permissions** checked against what each app uses. Rider's foreground location gets the Play declaration text; Customer's microphone (voice search) gets a purpose string.
- Store listing pack per app: short/full description, Data safety answers, content rating notes, the foreground-location declaration. Written in the staff guide's appendix.
- Version names → 1.4.0 for this release.

## 6. Full test pass, then build

- Gate (all suites + new ones), typecheck, secrets, i18n, mutation checks.
- Build v17 (all four), signing check, APK secret scan, install as updates on the emulator.
- End-to-end on the emulator, every app, every feature: sign-in, ordering (COD on and off), live map, rider trip and pay, partner menu builder and AI, admin menu edits with photo, COD switch, city rates, settlements and payouts by hand, downloads, account deletion, Rates.
- Fix anything found, rebuild, retest.

## 7. Staff guide

A shareable web page: one section per app (Customer, Partner, Rider, Admin) with step-by-step tasks, plus a Play Store appendix.

## Owner to-dos

1. Run `node scripts/reset-live.mjs`, then set `ALLOW_PLATFORM_RESET=false`.
2. Change the admin password (`ADMIN_PASSWORD` on Railway, redeploy).
3. Add live Razorpay keys before launch; RazorpayX keys if you want automatic payouts.
4. Play Console: create the three apps and upload the `.aab` files. Answer Data safety from the appendix.
