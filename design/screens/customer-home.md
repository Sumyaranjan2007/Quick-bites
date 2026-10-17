# Customer — Home, search, Favourites, Recommended

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** show what can be ordered here, now, best first. **Built on:**
`screens/DiscoveryFeedScreen.tsx` (feed, filters incl. Pure Veg, favourites heart `/customers/favourites`,
search, voice). Plan D3–D4, B1, B5. Motion: `../motion/home-feed.md`, `../motion/search.md`.

## Layout

```
┌──────────────────────────────────┐
│ ⌂ Home ▾                    (P)  │  address row: label + 1-line address; tap → location sheet
│ Near Sweet Land Bakery, Harohalli│
│ ┌──────────────────────────────┐ │
│ │ 🔍 Search "biryani"       🎙 │ │  sticky after scroll; hint rotates every 3 s
│ └──────────────────────────────┘ │
│ (Pure Veg) (Rating 4+) (Offers) (Under 30 min)   chips, horizontal
│ Your favourites                  │  only if any; horizontal compact RestaurantCards
│ [card][card][card] →             │
│ Recommended by Quick Bites       │  admin list (B5), horizontal
│ [card][card] →                   │
│ All restaurants near you         │  `heading` + count "24"
│ ┌──────────────────────────────┐ │
│ │ FoodImage card 16:10   ♡     │ │  RestaurantCard default
│ │ Bangalore Biryani House (seal)│ │
│ │ ★ 4.3 · 35–40 min · 2.1 km   │ │
│ │ (50% off up to ₹100)         │ │
│ └──────────────────────────────┘ │
│ …open restaurants, then not delivering ones…
├──────────────────────────────────┤
│ 2 items · ₹469        View cart ›│  CartBar, only with items
└──────────────────────────────────┘
```

**No address chosen:** the list is only "Recommended by Quick Bites", with a banner on top:
"Set your location to see every restaurant near you." + **Set location**.

**Search page** (tap the bar): recent searches (chips, Clear), "What's on your mind" dish grid (our
own dish photos, ART_BRIEF §3), suggestions while typing (restaurants and dishes, matched letters
bold), results reuse RestaurantCard and a dish row.

## States

| State | What shows |
|---|---|
| First load | 1 skeleton chip row + 3 skeleton cards |
| No restaurants within reach | our illustration + "No restaurants deliver here yet." + **Change address** |
| All closed now | list shows them as not delivering; top banner "Restaurants near you are closed right now. Opening times are on each card." |
| Restaurant not delivering | RestaurantCard "not delivering" treatment (system README §6), sorted last |
| Filters leave nothing | "Nothing matches these filters." + **Clear filters** |
| Favourite tap | heart fills (`springBump`) + `haptic.select`; offline → reverts with a toast "Couldn't save. Try again." |

## Checks

Favourites row appears after the first heart and disappears after the last; recommended order matches
the admin list; a not-delivering kitchen can be opened but not ordered.
