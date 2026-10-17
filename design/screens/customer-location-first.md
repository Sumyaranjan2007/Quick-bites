# Customer — Where should we deliver? (location first)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** before showing restaurants, know exactly where the food goes, so the list (35 km, B1) and
the times are true. **Built on:** `AddressBookScreen.tsx`, `components/MapAddressPicker.tsx`,
`AddressSearchField.tsx` (search goes through our server, `/api/places/*`). Plan D3 + B1.

**When it shows:** after sign-in when the account has no chosen address; from the home header
address row at any time (as a sheet, same content).

## Layout

```
┌──────────────────────────────────┐
│ Where should we deliver?         │  `title`
│ We'll show restaurants that      │  `body` secondary
│ deliver to you.                  │
│ ┌──────────────────────────────┐ │
│ │ ◎  Use my current location   │ │  Button outline lg, location icon
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 🔍 Search area, street, place │ │  AddressSearchField (icon is lucide, not emoji)
│ └──────────────────────────────┘ │
│ Saved addresses                  │  `heading`, only if any
│  ⌂ Home   2nd floor, near…   ›   │  rows 64 high
│  ▣ Work   …                  ›   │
│                                  │
│      Browse without an address   │  ghost button, bottom
└──────────────────────────────────┘
```

**Confirm the pin** (after current location or a search result): full-screen Google map, a fixed
maroon pin in the centre; the person moves the map, not the pin. Bottom sheet (fixed):

```
 Deliver to                      
 Near Sweet Land Bakery, Harohalli      ← reverse-geocoded line, updates as the map stops
 House / flat no.   [__________]  required
 Floor / building   [__________]
 Landmark           [__________]
 Save as  (Home) (Work) (Other ___)
 [ Save and continue ]
```

## States

| State | What shows |
|---|---|
| Permission not asked | our sentence first: "Allow location so we can find your address. We only use it while you choose an address." → system prompt |
| Permission refused | "Location is off for Quick Bites. Search instead, or turn it on in Settings." + Open settings |
| GPS slow | button shows "Finding you…" spinner; after 10 s, offer search |
| Pin outside every restaurant's reach | sheet note: "No restaurants deliver here yet. You can still save it." |
| Search no results | "No places match. Try a street or area name." |
| Browse without an address | goes to home with the Recommended list (customer-home) |

## Motion

Sheet content cross-fades as the address resolves (`quick`); the pin lifts 8 px while the map moves
and drops back with `springSettle` when it stops + `haptic.select`. Save: screen change to home.

## Checks

New account → this screen first; skip → recommended home with the banner; saved address → full
list within 35 km; "House / flat no." required before Save.
