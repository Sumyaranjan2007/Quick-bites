# Customer — Restaurant page

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** decide and add to cart fast. **Built on:** `screens/RestaurantDetailScreen.tsx` (menu, dish
options, add to cart). Plan D4, B5 (seal, section switch). Motion: `../motion/restaurant-page.md`,
`../motion/add-to-cart.md`.

## Layout

```
┌──────────────────────────────────┐
│ (←)                  (🔍) (♡) (⤴) │  44 px frosted circles over the photo
│        FoodImage hero 4:3        │  restaurant's cover photo
│                                  │
│ ┌──────────────────────────────┐ │  info card overlaps the photo by 24
│ │ Bangalore Biryani House      │ │  `heading`
│ │ (seal) Pure Veg · verified   │ │  PureVegSeal md — only if the seal is set
│ │ Biryani, North Indian · Veg & non-veg │  cuisineType as text
│ │ ★ 4.3 (2.1k) · 35–40 min · 2.1 km      │
│ │ (50% off up to ₹100) (Free delivery over ₹199) │ offer pills, scroll
│ └──────────────────────────────┘ │
│ (Veg) (Non-veg) (Bestseller)     │  sticky under the header when scrolled
│ Biryani · 8                      │  section header `heading` + count
│ ▣ Chicken Dum Biryani        ┌──┐│  dish row: DietMark, `subhead`
│ ₹249                         │img││  FoodImage dish 1:1, 112 px
│ Slow-cooked, served with…    └──┘│  2 lines, "more"
│                         ( ADD + ) │  Stepper overlaps the photo bottom
│ Dosa · 6   Not available now · back at 7:00 PM   section switched off (B5)
│ ▣ Masala Dosa  (greyed 50%)  (Unavailable) │
│                         (☰ Menu)  │  floating button → category sheet
├──────────────────────────────────┤
│ 1 item · ₹249         View cart ›│  CartBar
└──────────────────────────────────┘
```

**Section switched off:** header gets a `micro` amber-text note "Not available now" (+ "· back at
7:00 PM" when set); its dishes show at 50% opacity, Stepper replaced by an "Unavailable" pill; the
section stays in place (so people learn it exists) and moves to the end of the Menu sheet.

**Dish sheet** (tap a dish photo or name): `Sheet` auto height — FoodImage dish full width, name,
DietMark, price, full description, option groups (radio for one, checkbox for many, "Required" pill),
quantity Stepper md + **Add item · ₹298** (price rolls with options). Close × floats above the sheet.

## States

| State | What shows |
|---|---|
| Loading | hero skeleton + 6 dish-row skeletons |
| Kitchen not delivering | banner under the info card "Not delivering currently · Opens 11:00 AM"; every ADD disabled with that reason |
| Dish out of stock (partner's switch) | as a switched-off section, single dish |
| Cart from another restaurant | sheet "Start a new cart? Your cart from X will be cleared." **Start new cart** / Cancel |
| Required option missing | group shakes + scrolls into view + `haptic.warning` |

## Checks

Seal shows only when an admin set it; a switched-off section's dishes cannot reach the cart (server
refuses too); Menu sheet lists sections with counts and jumps to them.
