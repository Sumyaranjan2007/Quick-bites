# Operations — Pure Veg seal and the Recommended list

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** let staff (with permission) mark verified pure-veg kitchens and choose which restaurants
customers see first. **Built on:** People → restaurant (`isPureVeg` admin field today,
`peopleRoutes.ts:604`). Plan B5 (`restaurants.pureVegSeal`, `restaurants.recommend`).

## Pure Veg seal (Record → Overview, and the ⋯ menu)

```
 Pure Veg seal                         [ Off ●]
 The partner says: Veg & non-veg       their own choice, read-only
 Customers will see the seal and this
 kitchen in Pure Veg filters.
```
Turning on asks: "Give Asha Tiffins the Pure Veg seal? Only do this after checking their kitchen
serves no meat or egg." **Give seal** / Cancel. A preview of the seal (system README §6) shows how it
will look on the card. Turning off: "Remove the seal?" Both logged in History.

## Recommended list (Operations → Catalogue → Recommended)

```
 Recommended                              (+ Add restaurant)
 Shown first on every customer's home, and as the whole list
 when they haven't set a location.
 1  ≡ Bangalore Biryani House   Live    (Remove)
 2  ≡ Asha Tiffins              Not delivering now   (Remove)
 3  ≡ …
```
Drag handle to reorder on phones; **Web** and screen readers get Move up / Move down buttons.
Add opens a search of live restaurants. A restaurant that is removed/blocked drops off the list.

## States

| State | What shows |
|---|---|
| Empty list | "No recommended restaurants. Customers without a location will see the nearest open ones." (fallback rule for the main session to confirm) |
| Save failed | order reverts + "Couldn't save the order. Try again." |

## Checks

Seal only via this switch (partner's choice never shows it); recommended order on the customer home
matches this list exactly.
