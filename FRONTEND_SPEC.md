# Quick Bite Platform -- Frontend Engineering Specification (FRONTEND_SPEC)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Project:** Quick Bite (Multi-Portal Food Delivery Platform)  
**Author:** Quick Bite Frontend Architecture Team  

---

## 1. The 4-State Component Rule & Inventory

Every data-dependent component across the Customer App, Restaurant Portal, and Admin Dashboard must explicitly implement all four UI states:

| Component Name | 1. Loading State (Skeleton) | 2. Success State | 3. Error State (With Retry) | 4. Empty State (With CTA) |
|----------------|-----------------------------|------------------|-----------------------------|---------------------------|
| **RestaurantCard** | Shimmer rectangle for image + 2 lines for title/rating | High-res food photo, title, cuisine tags, distance, rating badge | Card border turns subtle red with "Failed to load. [Retry]" | "No restaurant found in this area. [Change Location]" |
| **MenuSection** | Shimmer list with 4 dish card placeholders | Categorized dish list with Add buttons, price, and veg icons | Red banner at top: "Unable to load menu. [Tap to Reload]" | "No dishes listed under this category." |
| **CartSheet** | Shimmer rows for items and fee breakdown | Itemized list, price tally, delivery note, and Checkout CTA | "Error recalculating prices. [Retry Calculation]" | Empty cart graphic with "Your cart is empty. [Explore Food]" |
| **OrderTerminalCard** | Pulsing border skeleton with placeholder lines | Order ID, items list, customer name, prep timer buttons | "Unable to fetch order details. [Reconnect]" | "No incoming orders right now. [View Past Orders]" |
| **TrackingMap** | Gray map placeholder with animated radar pulse | Interactive Leaflet/RN map with polyline and rider pin | "GPS signal interrupted. [Retry Map Connection]" | "Delivery partner not yet assigned." |
| **AnalyticsChart** | Pulsing SVG skeleton outline of bar/line chart | Populated SVG chart with tooltips and trend line | "Analytics data unavailable. [Refresh Dashboard]" | "No order volume recorded for this period." |

### Skeleton Loader Shimmer CSS
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-surface-elevated) 25%,
    var(--border-subtle) 37%,
    var(--bg-surface-elevated) 63%
  );
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
  border-radius: var(--radius-md);
}
```

---

## 2. Optimistic UI Rendering & Rollback Protocol

To make the app feel instantaneous, certain user actions must render the expected state immediately before server confirmation:

1. **Cart Item Increment / Decrement:**
   - **Optimistic Action:** Quantity updates in UI instantly; total price adjusts immediately on client.
   - **Server Call:** Dispatches `POST /api/v1/cart/validate` in background.
   - **Rollback Policy:** If server responds with an error (e.g. max quantity exceeded or price changed), quantity reverts with an inline alert: *"Item price updated by restaurant."*
2. **Restaurant Stock Toggle:**
   - **Optimistic Action:** Toggle switch flips to "Out of Stock" immediately on click.
   - **Server Call:** `PUT /api/v1/restaurant/menu/stock`.
   - **Rollback Policy:** If server fails, toggle reverts with toast: *"Failed to update stock. Check connection."*
3. **Veg Mode Global Switch:**
   - **Optimistic Action:** Non-veg items disappear instantly using client-side memory filtering.
   - **Server Call:** Saves preference to user profile in background. Zero rollback needed.

---

## 3. Error Boundary Architecture

```
[Global Error Boundary (Root)]
  |-- Catches fatal bootstrap crashes
  |-- Displays full-screen recovery screen: "Something went wrong. [Restart Quick Bite]"
  |
  +---> [Route-Level Error Boundary]
  |       |-- Wraps each individual page/screen (e.g. RestaurantDetail, Checkout, Terminal)
  |       |-- Fallback: Displays standard card with error explanation and "Go Back" button
  |
  +---> [Component-Level Error Boundary]
          |-- Wraps high-risk dynamic components (e.g. Tracking Map, SVG Charts)
          |-- Fallback: Isolates crash to the widget; rest of page remains fully usable
```

---

## 4. Form Data Persistence Strategy

To guarantee that users never lose data due to accidental tab refreshes or network drops:
- **Storage Target:** `AsyncStorage` (React Native) / `localStorage` (Web).
- **Key Convention:** `draft:<form_name>:<user_id_or_guest>`.
- **Save Trigger:** Every `onChange` event, debounced by 300ms.
- **Restore Trigger:** On component mount (`useEffect`), if draft key exists, form pre-populates and notifies user via subtle pill: *"Restored unsaved draft."*
- **Purge Trigger:** Removed strictly upon verified HTTP 200/201 response from server.

---

## 5. Timing, Debounce & Throttle Specifications

| Event / Action | Technique | Delay | Purpose |
|----------------|-----------|-------|---------|
| **Search Input** | Debounce | 300ms | Prevents firing excessive Meilisearch API requests on each keystroke |
| **Form Auto-Save** | Debounce | 500ms | Batches local storage writes to minimize disk I/O |
| **Map Pan & Zoom** | Throttle | 100ms | Smooth coordinate updates without freezing UI thread |
| **Rider GPS Emitter** | Throttle | 5000ms | Conserves mobile battery and limits WebSocket packet flood |
| **Window Resize** | Throttle | 150ms | Recalculates chart dimensions efficiently |

---

## 6. Design System Tokens & Responsive Breakpoints

### Responsive Breakpoints
- **Mobile (sm):** < 640px (Default for Customer Mobile App)
- **Tablet (md):** 640px - 768px (Optimized for kitchen iPad terminals)
- **Laptop (lg):** 768px - 1024px (Standard desktop web portal)
- **Desktop (xl):** > 1024px (Admin control tower high-density views)

### Typography Scale
- **Display 1:** 36px / Line Height: 44px / Bold (800)
- **Heading 1:** 28px / Line Height: 36px / Bold (700)
- **Heading 2:** 22px / Line Height: 28px / Semi-Bold (600)
- **Body Large:** 16px / Line Height: 24px / Regular (400)
- **Body Regular:** 14px / Line Height: 20px / Regular (400)
- **Caption / Meta:** 12px / Line Height: 16px / Medium (500)
