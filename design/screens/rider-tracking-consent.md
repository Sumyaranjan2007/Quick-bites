# Rider — Location consent before going online

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** the prominent disclosure Google Play requires before background location, and a rider who
understands when they are tracked. **Built on:** `apps/delivery-mobile/src/lib/shiftService.ts`
(background task, foreground permission today), `screens/DashboardScreen.tsx` (Go online). Plan E,
item #22. The Play Console declaration video records this screen.

**When:** the first tap on **Go online**, and again whenever the permission is missing.

## Layout — step 1 (our screen, before any system prompt)

```
┌──────────────────────────────────┐
│     our illustration: rider +    │  ART_BRIEF §1 (rider set)
│     map pin, maroon/amber        │
│ Share your location while        │  `title`
│ you're online                    │
│ Quick Bites uses your location   │  `body` — this sentence is required by Google Play:
│ while you are online, even when  │  must say "location", "even when the app is closed",
│ the app is closed or the screen  │  and what it is for
│ is off, to give you nearby orders│
│ and show customers where their   │
│ food is. It stops when you go    │
│ offline.                         │
│ ✓ Only while you're online       │  3 rows, check icons
│ ✓ Customers see you only after   │
│   you pick up their order        │
│ ✓ Stops the moment you go offline│
│ [        Continue         ]      │  Button primary lg → system prompt
│          Not now                 │  ghost: stays offline
└──────────────────────────────────┘
```

**Step 2** (Android 10+, after "While using the app" is granted): "One more step: choose **Allow
all the time** so orders reach you with the screen off." + an illustration of that setting row +
**Open settings**. iPhone: not applicable (rider app is Android).

**While online:** the persistent notification reads "You're online · Quick Bites is using your
location". The dashboard shows a status chip: **Online** (go-green), **Updating…** (amber text,
no fix for 30 s), **GPS off** (red, with **Fix** → settings).

## States

| State | What shows |
|---|---|
| Refused | "You can't go online without location. Orders are matched to riders nearby." + Open settings |
| Precise location off | "Turn on precise location so customers see the right spot." + Open settings |
| Battery saver blocking | "Your phone may stop location to save battery. Allow Quick Bites to run in the background." + Open settings |

## Checks

Disclosure shows before any system prompt (Play rule); "Not now" never asks the system; going offline
stops updates (server stops relaying, notification gone).
