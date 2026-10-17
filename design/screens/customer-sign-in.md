# Customer — Sign in and code

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** get a person from opening the app to a signed-in session in under 30 seconds, or let them
browse first. **Built on:** `apps/customer-mobile/src/screens/LoginScreen.tsx` (phone + email, code to
the email, `/auth/otp/request`, `/auth/otp/verify`). Plan D2. When SMS codes go live (MSG91), the email
field and the "sent to" line change; the layout does not.

## Layout — step 1

```
┌──────────────────────────────────┐
│ (EN ▾)                (Browse first) │  frosted pills, 44 high, safe-area top
│                                  │
│      our animated Quick Bites    │  top 45% of the screen,
│      illustration (ART_BRIEF §1) │  cream → maroon gradient behind
│                                  │
├──────── Log in or sign up ───────┤  `caption` on a hairline, centred
│ Mobile number                    │  label above the field
│ ┌─────┬────────────────────────┐ │
│ │ +91 │ 98765 43210            │ │  number pad, formats 5+5
│ └─────┴────────────────────────┘ │
│ Email                            │
│ ┌──────────────────────────────┐ │
│ │ you@example.com              │ │  email keyboard
│ └──────────────────────────────┘ │
│ We'll email you a 6-digit code.  │  `caption` muted
│ ┌──────────────────────────────┐ │
│ │          Continue            │ │  Button primary lg, disabled until both valid
│ └──────────────────────────────┘ │
│ By continuing you agree to our   │  `caption`; Terms and Privacy Policy are links
│ Terms and Privacy Policy.        │  to the live /terms and /privacy
└──────────────────────────────────┘
```
The form lifts with the keyboard (`KeyboardLift`); the illustration shrinks to 25%, never scrolls off the Continue button.

## Layout — step 2 (code)

```
 ←  Enter the code
    Sent to a••••@gmail.com · Change
    [ ][ ][ ][ ][ ][ ]          CodeInput, autofocus, paste fills all
    Resend code in 0:30         becomes a link at 0:00
```
The 6th digit submits on its own (no button). Success → location first (new account or no saved
address) or home.

## States

| State | What shows |
|---|---|
| Sending code | Continue shows a spinner in place, fields locked |
| Number/email invalid | message under that field: "Enter a 10-digit mobile number", "Check the email address" |
| Staff account email (`STAFF_ACCOUNT`) | under email: the server's sentence (exists) |
| Wrong code | boxes shake (300 ms, 6 px) + warning haptic, clear, "That code didn't match. 4 tries left." |
| Code expired / too many tries | "This code has expired. Send a new one." + Resend enabled |
| Email didn't arrive | after 30 s: "Can't find it? Check spam, or Change the email." |
| Offline | Continue disabled, offline banner |

## Motion

Illustration loops gently (≤ 6 s loop, stops under reduce motion). Step 1 → 2: content slides left
`standard` `easeOut`; back reverses at exit speed. Code boxes: the active box border is maroon,
each typed digit pops in (`quick`, opacity + scale 0.9→1). Success: `haptic.success`, screen change.

## Checks

Paste a 6-digit code → submits once; wrong code shake + haptic; 200% text still shows Continue
without scrolling on a 360×640 screen; Hindi and Kannada render in Noto (system README §2).
