# Operations — Remove, Block, and deletion requests

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** close an account safely, with the difference between Remove and Block impossible to miss;
review deletion requests with everything that matters on one page. **Built on:** account blocking
(`accountBlocking` suite), People → Deletion requests (`PeopleScreen.tsx:935`,
`modules/platform/staffDeletion.ts`). Plan B6, owner decisions Q1 and Q2 (18 Oct).

## Remove or Block (from a Record's ⋯ menu)

```
 Close Asha Tiffins's account
 (•) Remove
     They can't sign in to any Quick Bites app. Their kitchen is hidden.
     They can register again later as a new account.
 ( ) Block
     Same as Remove, and their email, mobile and documents
     (FSSAI, GSTIN, PAN, licence) can never be used on Quick Bites again.
 Reason (required)  [_______________________]
 Type ASHA TIFFINS to confirm  [___________]
 [ Remove account ]     destructive button; label follows the choice ("Block account")
```

Blocked: **Can't continue** card instead of the form when there are open orders or unpaid dues:
"Asha Tiffins has 2 open orders and ₹1,240 unpaid. Settle these first." + links.

After: the Record shows a grey "Removed" or red "Blocked" pill, reason, who and when; Block also lists
the blocked identifiers (masked) with **Unblock** (permission `accounts.block`).

## Deletion requests (partner and rider asked to delete)

List rows: name, role, requested date, dues, open orders. Detail page:

```
 Ravi K. · Rider · asked to delete on 18 Oct
 While waiting: can sign in, no new trips (Q2)
 Dues to them        ₹860       Cash they hold  ₹420
 Open trips          0          Last trip       17 Oct
 Documents  4 ›   Trips 212 ›   Money ›   Support 1 open ›
 Reason they gave: "Moving city"
 [ Approve deletion ]   Approve is disabled until dues and cash are settled:
                        "Pay ₹860 and collect ₹420 first."
 [ Reject ]  → reason required, they're told in the app
```

## Checks

Remove then register again with the same email works; Block then register with the same email,
phone or FSSAI is refused in every app and the website; Approve stays disabled while anything is owed.
