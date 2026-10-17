# Operations — Create an account for them

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** staff build a complete, verified restaurant or rider account for someone who asks, using the
same rules as self sign-up. **Built on:** Operations `PeopleScreen.tsx`, `DocumentsScreen.tsx`,
`BusinessCard.tsx`; server uses the self-sign-up repositories (plan B6, permission `accounts.create`).
Also on the `/admin` website (**Web**: steps shown as a left rail instead of a top bar).

## Flow (one screen, 6 steps, progress at the top "Step 2 of 6")

| Step | Fields | Notes |
|---|---|---|
| 1. What are you creating? | (Restaurant) (Rider) | big choice cards |
| 2. Owner / rider | full name, email, mobile | checked live as typed: "Already on Quick Bites", "Can't be used (blocked)" |
| 3a. Restaurant | name, address + map pin (Google), city, pincode, phone, cuisine type (Veg / Non-veg / Both), hours, packaging fee, COD on/off | Pure Veg seal is NOT here (separate admin action) |
| 3b. Rider | vehicle type and number, city, emergency contact | – |
| 4. Documents | per type: number + file (photo or PDF): FSSAI, GSTIN (optional), PAN, bank proof / rider: licence, RC, ID | each row: Upload, preview, status "Will be approved" |
| 5. Bank or UPI | payee account (existing payee flow, full number encrypted) | optional, can be added later |
| 6. Review | every field in groups with Edit links | **Create and approve** (primary) |

**Result:** "Asha Tiffins is live. A temporary password was emailed to a••••@gmail.com." + **Open
their record** / **Create another**. The partner/rider must change the password at first sign-in.

## States

| State | What shows |
|---|---|
| Leaving mid-way | draft kept on this device; "Continue the draft for Asha Tiffins?" on return |
| A document fails upload | that row only: "Upload failed. Try again." |
| Server refuses on Create | jumps to the step with the problem, message under the field |
| No permission | the Create entry is not shown at all |

## Checks

An account created here signs in on the Partner/Rider app with the emailed password, is forced to
change it, and its documents show as approved in its Record with "created by <staff name>".
