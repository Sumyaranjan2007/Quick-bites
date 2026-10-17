# Customer — Profile and changing phone or email

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** keep name, photo, phone and email right; a contact change is proven with a code. **Built
on:** `screens/ProfileScreen.tsx` (name, photo, language, delete account), `AddressBookScreen.tsx`.
Plan D6, B6 (#18, #20). The same pattern serves Partner and Rider profile screens (Stage E).

## Layout

```
 Profile
 (photo)  Priya S.           Edit photo
 Name          [Priya S.      ]  saves on Done
 Mobile        98765 43210   Change ›
 Email         a••••@gmail.com Change ›
 Language      English ›
 Addresses ›   Favourites ›   Orders ›   Help ›
 Gold ›
 Sign out
 Delete account                 (destructive text, bottom)
```

**Change mobile / email** (sheet, 3 steps):
1. "New mobile number" field → **Send code**
2. CodeInput "Code sent to the new number/email" + Resend countdown
3. "Mobile number changed" + the old email gets a notice (B6); `haptic.success`

Today codes go by email for both (owner, 17 Oct); after MSG91 the mobile code goes by SMS. Only
the wording "sent to" changes.

## States

| State | What shows |
|---|---|
| New number used by another account | "This number is already on another Quick Bites account." |
| Blocked identifier (B6 Block) | "This number can't be used on Quick Bites." (no more detail) |
| Wrong / expired code | as sign-in |
| Name empty | under the field: "Enter your name" |

## Checks

A contact change never saves without the code sent to the NEW address; the old email is told;
Delete account flow unchanged (customers delete at once, `CLAUDE.md` §4).
