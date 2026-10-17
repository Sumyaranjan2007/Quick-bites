# Partner, Rider, Operations — Forgot password

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** get back in with a code sent to the account's own email; no phone call to operations needed.
**Built on:** Partner `SignInScreen.tsx` (modes signin/forgot/reset exist), Rider `LoginScreen.tsx`
(today: "Call Quick Bites operations", `:251`), Operations `LoginScreen.tsx`. Plan B6 (#12).

## Flow (same three steps in all three apps)

```
 Sign in
 Email     [__________]
 Password  [__________]  (show)
 [ Sign in ]
 Forgot password?                       link under the button

 1. Reset your password
    Enter the email on your account.
    Email [__________]  [ Send code ]
    → always answers "If this email has an account, we've sent a code." (never reveals which emails exist)

 2. Enter the code   [ ][ ][ ][ ][ ][ ]   Resend in 0:30

 3. New password     [__________]  (show)
    At least 10 characters, not your email.   live checklist ✓
    Repeat password  [__________]
    [ Change password ]
    → "Password changed. Sign in with your new password." Every other device is signed out.
```

**Admin-side reset** (Operations → a person's Record → Reset password): confirm sheet "Send a
temporary password to a••••@gmail.com? They'll be asked to change it at sign-in." The temporary
password is emailed, never shown on screen; logged in the person's History.

## States

| State | What shows |
|---|---|
| Too many codes | "Too many tries. Wait 15 minutes and try again." |
| Blocked account | same neutral answer as step 1 (no hint) |
| Weak password | checklist items stay unchecked; button disabled |

## Checks

Unknown and known emails get the identical answer; a used code fails the second time; all sessions
end after the change (`SESSION_REVOKED`).
