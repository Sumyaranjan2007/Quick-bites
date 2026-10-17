# Screen specs — Stage D and Stage E

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Status (18 Oct 2026):** specs only, nothing built. One file per screen of
`docs/plans/master-plan-2026-10-18.md` Stages D and E. Built from the components and tokens in
[`../system/README.md`](../system/README.md); motion from [`../motion/`](../motion/README.md).

Every file has the same parts: **Job** (what the screen is for), **Built on** (the existing file it
extends), **Layout**, **States** (loading, empty, error, offline and the screen's own), **Words**
(English source; Customer-app strings go through `src/lib/i18n.tsx`), **Motion**, **Checks** (what
the QA script must see). ASCII layouts are for phone width (360 dp).

Shared state rules (not repeated in each file):
- **Loading:** skeletons in the shape of the content, never a lone spinner on an empty page.
- **Offline:** an `offline` banner under the header "You're offline. We'll update when you're back.";
  what was loaded stays visible; actions that need the server are disabled with that reason.
- **Server error:** the message from the server when it is written for people (`error.message`),
  else "Something went wrong. Try again." + a **Try again** button. Never an error code alone.
- **Session expired** (`INVALID_TOKEN`, `SESSION_REVOKED`): back to sign-in with one message (exists).

## Customer app (Stage D)

| Screen | Plan step | File |
|---|---|---|
| Sign in + code | D2 | [`customer-sign-in.md`](customer-sign-in.md) |
| Where should we deliver? (location first) | D3, B1 | [`customer-location-first.md`](customer-location-first.md) |
| Home, search, Favourites, Recommended, not delivering | D3, D4 | [`customer-home.md`](customer-home.md) |
| Restaurant page (seal, section off, dish sheet) | D4 | [`customer-restaurant.md`](customer-restaurant.md) |
| Cart and checkout | D4 | [`customer-cart-checkout.md`](customer-cart-checkout.md) |
| Order tracking (bike on the map, ahead of time) | D5 | [`customer-tracking.md`](customer-tracking.md) |
| Profile and contact change with a code | D6 | [`customer-profile-edit.md`](customer-profile-edit.md) |
| Help chat (all three public apps) | D6, E | [`help-chat.md`](help-chat.md) |

## Partner, Rider, Operations (Stage E)

| Screen | App | Plan step | File |
|---|---|---|---|
| Location consent before going online | Rider | E, #22 | [`rider-tracking-consent.md`](rider-tracking-consent.md) |
| Trip offer with 108 s countdown | Rider | B4, E | [`rider-offer.md`](rider-offer.md) |
| Kitchen ticket (80 / 58 mm, no prices) | Partner | B10 | [`partner-kitchen-ticket.md`](partner-kitchen-ticket.md) |
| Switch off a whole menu section | Partner, Operations | B5 | [`partner-menu-sections.md`](partner-menu-sections.md) |
| Forgot password (email code) | Partner, Rider, Operations | B6 | [`staff-forgot-password.md`](staff-forgot-password.md) |
| Create an account for them | Operations | B6 | [`admin-create.md`](admin-create.md) |
| One record per person | Operations | B7 | [`admin-record.md`](admin-record.md) |
| Remove, Block, deletion requests | Operations | B6 | [`admin-remove-block.md`](admin-remove-block.md) |
| Pure Veg seal and Recommended list | Operations | B5 | [`admin-seal-recommended.md`](admin-seal-recommended.md) |

The `/partner` and `/admin` websites get the same screens from the same code (master plan item 10);
they keep the simple Glass Kitchen web look, so web-only layout notes are marked **Web**.
