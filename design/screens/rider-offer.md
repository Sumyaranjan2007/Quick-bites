# Rider — Trip offer with the 108-second countdown

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

**Job:** one rider, one offer, 108 seconds to decide, everything needed to decide on one screen.
**Built on:** `apps/delivery-mobile/src/components/NewOrderModal.tsx`, the looping `new-orders`
alarm (`src/lib/orderAlert.ts`). Plan B4: offer `{ riderId, expiresAt, round }` on the order; the
countdown is drawn from the server's `expiresAt`, never a local guess.

## Layout (full screen, over anything)

```
┌──────────────────────────────────┐
│ New trip                  1:48   │  time left, tabular `heading`
│        ╭───────────╮             │
│        │   ₹62     │             │  ring around the earning; ring empties over 108 s
│        │ you earn  │             │  `display` amount (rider pay + tip if known)
│        ╰───────────╯             │
│ ● Pickup  Bangalore Biryani House│
│   1.2 km from you · 4 min        │
│ ○ Drop    Harohalli, 3.4 km      │  area only, no house number or name before accepting
│ 3 items · Collect cash ₹420      │  cash line only for cash orders, amber text
│ ┌──────────────────────────────┐ │
│ │         Accept trip          │ │  go-green, 64 high, bottom thumb zone
│ └──────────────────────────────┘ │
│              Skip                │  ghost
└──────────────────────────────────┘
```

## States

| State | What shows |
|---|---|
| Last 20 s | ring and time turn amber; alarm continues |
| Time up | "Offer moved to another rider" for 2 s, then closes; counts as a pass (no penalty wording) |
| Accepted | `haptic.success`, alarm stops, straight to the trip screen |
| Someone/ops reassigned meanwhile | "This trip is no longer available." closes |
| Skip | asks once: "Skip this trip?" Skip / Back; then next offer can arrive |
| Offline mid-offer | "Reconnecting…" over the buttons; Accept retries when back if time remains |

## Motion

Ring drains linearly from `expiresAt` (UI-thread, not a per-second state update); the amount pulses
once on open (scale 0.97→1, `springBump`); no other motion so the decision is calm.

## Checks

Countdown matches the server within 1 s after reopening the app; an expired offer cannot be
accepted (server refuses); screen reader announces time at 60, 30, 10 s.
