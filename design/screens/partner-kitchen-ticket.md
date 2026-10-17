# Partner — Kitchen ticket (print, no prices)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** a ticket the kitchen prints on its receipt printer the moment it accepts: what to cook, how
many, which order, no money. **Built on:** server PDF builder `modules/payments/statementPdf.ts`
(reuse its PDF writer), Partner `screens/LiveOrdersScreen.tsx` (Accept), `OrderHistoryScreen.tsx`.
Plan B10. Printing: `expo-print` (Android print dialog) or share the PDF to a Bluetooth printer app.

## Page

| | 80 mm roll (default) | 58 mm roll |
|---|---|---|
| Page width | 80 mm, margins 4 mm → 72 mm print | 58 mm, margins 3 mm → 52 mm |
| Body text | 10 pt | 9 pt |
| Item lines | 12 pt bold | 11 pt bold |
| Order number | 26 pt bold | 22 pt bold |
| Height | grows with the items (one long page, no page breaks) | same |

Black only (thermal). Lexend Deca Bold/Regular embedded in the PDF. Logo as a 1-bit image, 40 mm wide.

## Layout (80 mm, characters approximate)

```
        [ Quick Bites logo ]
       BANGALORE BIRYANI HOUSE         restaurant name, 12 pt bold, centred
 ─────────────────────────────────
           QB-427294                   order number, 26 pt bold, centred
      Delivery · Placed 7:31 PM        10 pt
      18 Oct 2026                      
 ─────────────────────────────────
 Customer: Priya                        first name only, never phone/address
 ─────────────────────────────────
 2 x  Chicken Dum Biryani               qty first, bold
      • Large                           chosen options, 10 pt, indented
      • Extra raita
 1 x  Masala Dosa
 1 x  Gulab Jamun (2 pc)
 ─────────────────────────────────
 Items: 4                               total quantity
 Cutlery: No                            only if the order has it
 Note: Less spicy                       only if the order has one
 ─────────────────────────────────
       Pickup code  5 3 7                big, for the rider handover
           [ QR: order number ]          25 mm
 Not a bill · No prices on this ticket  8 pt, centred
```

Never printed: any price, total, payment method, customer phone, address, delivery code (OTP).

## Where the button appears

- Live orders card: right after **Accept**, an outlined **Print ticket** button (also in the card's
  menu later). Accept itself never waits for printing.
- Order history and order detail: **Print ticket** for any order of the last 30 days.
- Partner settings: "Ticket width: 80 mm / 58 mm" (default 80).
- **Web** (`/partner`): the same button opens the PDF in a new tab for the browser's print dialog.

## States

| State | What shows |
|---|---|
| Building | button spinner "Preparing ticket…" |
| No printer found | Android dialog handles it; our hint under the button: "Connect your printer in Android settings, or Share to your printer app." |
| Order cancelled | ticket still prints with a big "CANCELLED" line under the order number |

## Data needed (for the main session)

The order keeps only option IDs (`selectedOptions: { groupId, optionId, priceDelta }`); store each
chosen option's **name** on the order at checkout so the ticket prints what the customer chose even
after the menu changes. "Note" and "Cutlery" exist only if the plan adds them (no field today).

## Checks

PDF page width exactly 80 / 58 mm; no digit sequence on it equals a price; prints from a phone to a
real 80 mm printer and a 58 mm one (owner's).
