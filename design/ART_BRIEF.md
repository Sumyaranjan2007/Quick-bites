# Art brief — illustrations, animations, map icons, photos

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../docs/README.md).

**For:** the owner's designer, or AI drafting finished by hand (owner decision Q5, 18 Oct:
illustrations AI-drafted then hand-finished in our colours; **food photos are always real**).
**Status:** brief only; no artwork exists yet. Specs that use each piece: [`screens/`](screens/README.md).

## 0. Look and rules (all pieces)

| Swatch | Hex | Use in art |
|---|---|---|
| Maroon | `#4A0D1F` | main shapes, outlines |
| Maroon light | `#A83E58` | secondary shapes |
| Amber | `#F5A623` | highlights, steam, accents (max ~15% of a picture) |
| Cream | `#F7F2ED` | backgrounds (art sits on the app's cream) |
| White | `#FFFFFF` | plates, light |
| Veg green | `#0B7A52` | leaves, veg cues only |

- **Style:** flat shapes, soft rounded corners, 2–3 tones of our palette + amber, no outlines thicker
  than 2 px at 1×, no gradient mesh, no 3D, no photo textures. Everyday local India: steel tiffins,
  banana leaf, auto-rickshaw, scooter riders, small street-side kitchens — warm, not touristy.
- **People:** simple figures, varied skin tones, no faces with detail; riders always with a helmet.
- **Never:** another app's colours (bright red), characters, logos, layouts or fonts; text inside an
  image (all words stay in the app, translatable); stock clip-art; AI artefacts (melted hands, wrong
  plates, garbled letters) — a human checks every piece.
- **Licence:** we must own commercial rights. If an AI tool drafts, check its terms allow commercial
  use; keep the tool name, date and the hand-finished source file for every piece.
- **Files:** source (SVG / design file) kept by the owner outside the repo; delivered assets go into
  `apps/<app>/assets/` by the main session. Names lowercase-with-dashes.

## 1. Illustrations

| Piece | App / screen | Size delivered | Notes |
|---|---|---|---|
| Sign-in hero (animated, §2) | Customer sign-in | Lottie, 1080×1000 artboard | our scene: a scooter with a tiffin bag riding past local kitchens |
| Location | Customer location-first | SVG, 240×200 | a map pin over rooftops |
| No restaurants here yet | Customer home | SVG, 240×200 | empty street at night, one closed shutter |
| No results | Customer search | SVG, 200×160 | an empty plate with a spoon |
| No orders yet | Customer orders | SVG, 200×160 | a tiffin waiting to be opened |
| No favourites yet | Customer favourites | SVG, 200×160 | an outlined heart on a plate |
| Offline | all apps | SVG, 200×160 | a scooter waiting under a tree, no signal |
| Something went wrong | all apps | SVG, 200×160 | spilled chai, calm |
| Rider location consent | Rider | SVG, 280×220 | rider + phone + a soft pin trail |
| Help chat header | all three | SVG, 120×120 | two speech bubbles |
| Cuisine fallbacks (10) | everywhere a dish/restaurant photo is missing | PNG 1200×1200 and 1600×1000 each | Biryani, South Indian, North Indian, Chinese, Pizza & burgers, Rolls & wraps, Thali, Snacks & chaat, Desserts, Beverages — flat art of the dish on cream, recognisable at 96 px |

PNG exports at @1x/@2x/@3x for SVGs that become images; keep SVGs under 30 KB each.

## 2. Animations (Lottie, made by us)

| Piece | Length | Loop | Size cap | Ends on |
|---|---|---|---|---|
| Sign-in hero | 6 s | yes, seamless | 60 KB | – (reduce motion: frame 0 as a still) |
| Order placed | 1.2 s | no | 40 KB | a tick in a maroon circle, held |
| Delivered | 1.5 s | no | 40 KB | the tiffin opened with steam, held |
| Coupon applied burst | 0.9 s | no | 15 KB | nothing (transparent) |

Rules: shapes only (no embedded images), 60 fps, our swatches only, no text layers, transparent
background, starts and ends on a calm frame, one clear moment (no fireworks). Test in the LottieFiles
preview at 1× and on a mid-range Android before delivery.

## 3. Map icons (Google map, Customer tracking + Rider trip)

| Icon | Size (dp) | Delivered as | Drawing |
|---|---|---|---|
| **Bike marker** | 40×40 | PNG 120×120 (@3x) + SVG | **top-down** scooter with rider, maroon body, amber helmet, 2 dp white outline for any map; drawn **pointing straight up (north = 0°)** so the app rotates it to the heading; centre of rotation = the middle of the image |
| Kitchen pin | 36×44 | PNG @3x + SVG | maroon pin, white cooking-pot glyph, point at bottom centre |
| Home pin | 36×44 | PNG @3x + SVG | maroon pin, white house glyph |
| Rider (offer map, Rider app) | 32×32 | PNG @3x | small amber dot with white ring |

Flat, no shadow drawn in (the map draws none); readable on both the default and a light map style.

## 4. Photos (partners and our own)

**Restaurant and dish photos are always real photos of that kitchen's food.** Never AI, never stock,
never another restaurant's. Guide shown to partners before upload (Partner app, plan D4/E):

| Rule | Detail |
|---|---|
| Shapes | dish **1:1**; restaurant card **16:10**; restaurant page hero **4:3** (the app crops to these; the upload screen shows the frame) |
| Size | at least 1200 px on the short side; up to 10 MB; the server stores ≤ 1600 px WebP |
| Light | daylight from a window or soft white light; no flash, no coloured lights |
| Angle | straight from the top for thalis and plates; 45° for bowls, biryani, burgers, drinks |
| Frame | the dish fills about 70%; plain plate and table; nothing else in the shot |
| Never | text, prices, logos, watermarks, people, collages, filters that change the food's colour |
| Truth | the photo shows what the customer gets (portion and garnish) |

**Our own photos** (sign-in is illustrated, not photographed; owner decision Q4): the home
"What's on your mind" dish grid needs 12 dish cut-outs (transparent PNG 600×600, same lighting and
45° angle for all) — shot by a photographer from partner kitchens' real dishes, with their permission.

## 5. Delivery checklist (designer → owner → main session)

- [ ] every piece in our swatches; checked at 1× on a phone
- [ ] no text in images; no competitor look-alikes
- [ ] sizes and caps above met; Lottie tested at 1× and with reduce motion
- [ ] bike marker points north and rotates cleanly at 0/90/180/270°
- [ ] licence/source note kept for each piece
