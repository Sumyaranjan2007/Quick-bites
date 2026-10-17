# Operations — One record per person

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** everything about one restaurant, rider or customer in one place, arranged, viewable and
downloadable. **Built on:** Operations `PeopleScreen.tsx` (lists), `DocumentsScreen.tsx` (the KYC
queue stays, and links here), `StatementSheet.tsx`. Plan B7 (#11).

## Layout

```
 ← Asha Tiffins                         (⋯ actions)
 (photo) Asha Tiffins · Restaurant · Live      status pill
 Owner: Asha R. · a••••@gmail.com · 98•••••210 (reveal with permission, logged)
 FSSAI 1234… · GSTIN — · Joined 2 Oct 2026 · Created by Rahul (if admin-created)
 (Overview) (Documents) (Photos) (Orders) (Money) (Support) (History)    tabs, scroll
```

| Tab | Shows |
|---|---|
| Overview | key numbers (orders 30 days, rating, cancellations, dues), open issues, Pure Veg seal, recommended, COD |
| Documents | grouped by type (Licences, Tax, Identity, Bank), each: type, number, status pill (Pending / Approved / Rejected + reason), uploaded date, **View**, **Download**; **Download all (ZIP)** at the top |
| Photos | cover, gallery, dish photos in a grid; replace / reject (plan D4 photo rules) |
| Orders / Trips | list with status and date; tap → order detail (exists) |
| Money | dues, payouts, statement (existing sheet), cash in hand (riders) |
| Support | tickets and chats |
| History | audit log lines: who changed what, when (exists in `auditLogs`) |

**Actions menu (⋯):** Reset password · Remove · Block · Request/complete deletion · Pure Veg seal ·
Add to recommended. Each item shows only with its permission.

## States

| State | What shows |
|---|---|
| Loading a tab | skeleton for that tab only |
| No documents | "No documents yet." + **Upload for them** |
| Document file missing on the server | row shows "File missing" in red with **Ask to re-upload** |

**Web:** tabs become a left column; Documents show as a table with a preview pane.

## Checks

Every file uploaded by or for the person appears under its type with the right owner; Download all
returns every file; phone/email reveal is recorded in History.
