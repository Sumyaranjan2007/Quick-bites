# Chunk 08: Real-Time Engine, WebSockets & Push Notifications

**Goal:** Implement Socket.io real-time event distribution (room partitioning, heartbeat ping-pong, reconnection backoff) and Firebase Cloud Messaging (FCM) push notification dispatcher.  
**Estimated Time:** 60 minutes  
**Dependencies:** Chunk 04, Chunk 07  
**Unlocks:** Chunk 09 (Production Hardening)  

---

## 1. Real-Time Rooms & Events
- Room `order:<orderId>`: Emits `order:status_update` on state transitions.
- Room `restaurant:<restaurantId>`: Emits `order:created` on new orders.
- Heartbeat: 25s ping / 20s timeout / exponential backoff (1s - 30s).
- Push Alerts: Background FCM notifications on Order Placed, Preparing, Ready, Delivered.

---

## 2. Verification Commands

```bash
# Run WebSocket integration test suite
npm --prefix apps/backend-api run test:sockets
```

---

## 3. Rollback Instructions
Revert socket handlers in `apps/backend-api/src/sockets` and client hooks.
