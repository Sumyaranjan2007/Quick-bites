# Quick Bite Platform -- UI Design Prompts & Visual Specs (UI_DESIGN_PROMPTS)

**Version:** 1.0.0  
**Date:** September 5, 2026  
**Status:** Approved / Active  
**Design Direction:** High-energy modern food discovery, ultra-clean typography, deep dark mode, high contrast.  
**Strict Rule:** NO emojis anywhere. Use Lucide icons exclusively.  

---

## 1. Global Visual Aesthetics

- **Primary Color:** Crimson Red (`#E23744`), communicating urgency, culinary excitement, and appetitive drive.
- **Accent Color:** Warm Saffron (`#FF8A00`), used for ratings, badges, and high-conversion micro-actions.
- **Dietary Identifiers:** 
  - Pure Vegetarian: Solid square with green inner dot (`#0F8A3C`).
  - Non-Vegetarian: Solid square with red inner triangle (`#E23744`).
- **Surface Elevation:** Subtle border lines (`1px solid var(--border-subtle)`) combined with low-blur elevation shadows.

---

## 2. Component Design Prompts & Specs

### Component: RestaurantFeedCard
- **Layout:** Vertical card on mobile (width 100%), flex row on desktop.
- **Visuals:** 16:9 aspect ratio food photo with subtle 12px border radius. Floating rating badge in top-right corner with saffron background and white bold score (e.g. "4.8").
- **Metadata:** Dish cuisine tags separated by middle dots, delivery ETA pill (e.g. "25-30 mins"), and distance indicator.
- **Hover & Active States:** Scales up smoothly (`transform: translateY(-2px)`) with shadow elevation transition over 200ms.
- **Icon Usage:** `Lucide: Clock` for ETA, `Lucide: MapPin` for distance, `Lucide: Star` for rating.

### Component: DishItemCard
- **Layout:** Flex row with text details on left (title, description, price, veg badge) and photo with CTA on right.
- **Add Button:** Floating white pill button overlapping the bottom of the dish photo with crimson text "ADD" and subtle shadow.
- **Stepper State:** When item quantity > 0, button expands into crimson pill with white "-" stepper, count, and "+" stepper.
- **Out of Stock State:** Photo greyscale filter (60%), Add button replaced with muted text badge: "NOT AVAILABLE".

### Component: OrderTerminalCard (Partner Portal)
- **Layout:** High-density card with bold order number (e.g. "#QB-8921") and pulsing status indicator.
- **Timer Badge:** Prominent countdown badge showing elapsed time since placement in high-contrast amber.
- **Item Summary:** High-legibility bulleted list of dishes with variant tags highlighted in bold.
- **Primary CTAs:** Full-width green "ACCEPT ORDER" button and secondary outline "DECLINE" button.

---

## 3. Seasonal Theme Configurations

The platform supports seamless seasonal theme variations by overriding CSS variables without modifying component markup:

| Seasonal Theme | Primary Accent Token | Banner Background Token | Festive Badge Color |
|----------------|----------------------|-------------------------|---------------------|
| **Default** | `#E23744` (Crimson) | `#0F172A` (Dark Navy) | `#FF8A00` (Saffron) |
| **Diwali Festival** | `#D97706` (Deep Gold) | `#1A120B` (Warm Midnight) | `#F59E0B` (Marigold) |
| **Holi Festival** | `#EC4899` (Vibrant Pink) | `#180A22` (Deep Violet) | `#06B6D4` (Cyan Splash) |
| **Monsoon Season** | `#0284C7` (Rain Azure) | `#082F49` (Deep Ocean) | `#10B981` (Fresh Mint) |
