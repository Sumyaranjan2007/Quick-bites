# Owner decisions — settled, do not re-ask

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](README.md).

One line each, dated, with where it is recorded. Newest at the top of each section. Add a line
when the owner decides something; money rules also go in `CLAUDE.md` §4.

## Accounts and sign-in

| Date | Decision | Source |
|---|---|---|
| 17 Oct 2026 | One account, several roles: partners/riders may order from the Customer app; a Customer-app email can become a partner/rider (emailed confirm link) | `CHANGELOG.md` 17 Oct, `docs/AUTH_AND_ROLES.md` |
| 11 Oct 2026 | Customer sign-in codes go by **email** (Brevo); the phone is kept for calls | `OWNER_ACTIONS.md` Part 0 step 0 |
| 6 Oct 2026 | Sign-ins last 7 days (how long it *should* be is still an open question) | `CLAUDE.md` §4 |
| 2 Oct 2026 | Customers delete their account at once; partners/riders request, admin completes after dues | `CLAUDE.md` §4 |

## Money

| Date | Decision | Source |
|---|---|---|
| 6 Oct 2026 | Restaurant invoices: PDF per period/order + ZIP; "Not a GST tax invoice"; 5% food GST booked to `TAX_GST_PAYABLE` | `CLAUDE.md` §4 |
| 2 Oct 2026 | Rider pay ₹12/km (raised from ₹10), minimum ₹30/trip, frozen on the bill; ₹/km also per city | memory `owner-money-and-launch-decisions`, `CLAUDE.md` §4 |
| 2 Oct 2026 | Delivery fee = rider pay + markup %; platform fee GST only with a GSTIN | same |
| 2 Oct 2026 | Payouts: no hold (0 days), ₹100 minimum, admin pays whenever (hand + UTR or RazorpayX); super admin may approve own large payout; tip 100% to rider | same |
| 2 Oct 2026 | Cash on delivery per restaurant, admins only | same |
| 1–2 Oct 2026 | Partners request menu changes, admins approve; admins can edit live dishes and upload whole menus; menus from photos as drafts | same |

## Scope and launch

| Date | Decision | Source |
|---|---|---|
| 17 Oct 2026 | Never delete old files: keep them, file them in a proper folder, label them | `docs/ORGANIZATION_PLAN.md` |
| 16 Oct 2026 | Google-managed app signing; our keystores are upload keys; no PEPK | `CLAUDE.md` §6 |
| 16 Oct 2026 | Final packages: `in.quickbites.app`, `com.quickbite.partner`, `in.quickbite.rider`, `com.quickbite.admin` | `CLAUDE.md` §1 |
| 11 Oct 2026 | Launch from an individual Play account (closed test, 12+ testers × 14 days), switch to Organization after D-U-N-S | `CLAUDE.md` §7 |
| 6 Oct 2026 | The old Vite consoles deleted; Partner/Admin websites are the apps built for the web | `CLAUDE.md` §1 |
| 5 Oct 2026 | iPhone: customer app only; Gold stays on Razorpay; light mode only at launch; browse before sign-in on iPhone; Android customer app unchanged unless asked | memory, `docs/app-store/IOS.md` |
| 2 Oct 2026 | Customer, Partner, Rider public on Play; Operations private (APK) | memory |
| 25 Sep 2026 | Four phone apps only; no extra features; no over-the-air updates; every APK installs as an update; finish all work before "make APK" | memory `owner-scope-decisions` |
| 25 Sep 2026 | Only the owner runs `scripts/reset-live.mjs`; never sign in to live with the owner's password | `CLAUDE.md` §8 |

## Waiting for the owner

Partner payout wording ("weekly run", `docs/KNOWN_ISSUES.md` K4); how long a sign-in should
last; GST without a GSTIN and record retention (for a CA).
