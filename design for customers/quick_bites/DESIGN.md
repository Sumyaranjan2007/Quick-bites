---
name: Quick Bites
colors:
  surface: '#f9f9ff'
  surface-dim: '#d3daef'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3ff'
  surface-container: '#e9edff'
  surface-container-high: '#e1e8fd'
  surface-container-highest: '#dce2f7'
  on-surface: '#141b2b'
  on-surface-variant: '#5c4038'
  inverse-surface: '#293040'
  inverse-on-surface: '#edf0ff'
  outline: '#916f67'
  outline-variant: '#e5beb3'
  surface-tint: '#b12d00'
  primary: '#ad2c00'
  on-primary: '#ffffff'
  primary-container: '#d83900'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb5a0'
  secondary: '#b7122a'
  on-secondary: '#ffffff'
  secondary-container: '#db313f'
  on-secondary-container: '#fffbff'
  tertiary: '#006b2c'
  on-tertiary: '#ffffff'
  tertiary-container: '#00873a'
  on-tertiary-container: '#f7fff2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbd1'
  primary-fixed-dim: '#ffb5a0'
  on-primary-fixed: '#3b0900'
  on-primary-fixed-variant: '#872000'
  secondary-fixed: '#ffdad8'
  secondary-fixed-dim: '#ffb3b1'
  on-secondary-fixed: '#410007'
  on-secondary-fixed-variant: '#92001c'
  tertiary-fixed: '#7ffc97'
  tertiary-fixed-dim: '#62df7d'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#005320'
  background: '#f9f9ff'
  on-background: '#141b2b'
  surface-variant: '#dce2f7'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 34px
    fontWeight: '800'
    lineHeight: 40px
    letterSpacing: -0.03em
  display-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '800'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '500'
    lineHeight: 22px
    letterSpacing: 0em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-base: 1rem
  space-lg: 1.25rem
  space-xl: 1.5rem
  space-2xl: 2rem
  space-3xl: 3rem
  screen-padding-mobile: 1rem
  screen-padding-tablet: 1.5rem
  gutter-mobile: 0.75rem
  gutter-desktop: 1.5rem
---

## Brand & Style

This design system delivers an energetic, culinary-driven, high-conversion hyperlocal food ordering experience. The aesthetic balances intense visual appetite stimulation with editorial clarity, avoiding clutter while accommodating dense transactional flows.

### Aesthetic Movement & Personality
- **Style Mix:** Contemporary Mobile Fluidity with Tactile Culinary Warmth. It combines clean, high-density iOS/Android ergonomic surfaces with organic, rounded containers and rich food imagery.
- **Tone:** Appetizing, immediate, premium, and reassuringly precise.
- **Target Audience:** Urban convenience seekers, office lunchers, late-night snackers, and premium diners who prioritize rapid checkout and reliable delivery tracking.
- **Emotional Response:** Craving activation via rich chromatic contrast, cognitive ease through disciplined typographic hierarchy, and confidence via crisp transactional status indicators.

## Colors

The color palette is calibrated for high sensory stimulation and instantaneous comprehension of food classifications, discounts, and order urgency.

### Primary Palette & Roles
- **Primary Saffron Orange (`#FF4F18`):** The engine of the interface. Reserved for primary conversion hooks, main action CTAs ("Place Order", "View Cart"), real-time order tracking markers, and active tab highlights.
- **Secondary Deep Ruby Tomato (`#E23744`):** Expressive brand accent, flash deals, countdown timers, favorite states, and urgent alerts.
- **Tertiary Fresh Emerald (`#16A34A`):** Pure Veg indicators, verified kitchen checks, positive ratings (`4.0+`), and percentage savings tags.
- **VIP Gold Gradient Accent (`#F59E0B` to `#D97706`):** Exclusively utilized for the VIP pass/membership tier, priority delivery unlocks, and premium gourmet tags.

### Surfaces & Neutrals
- **Background Base (`#FBFBF9`):** A soft, buttery off-white that minimizes harsh glare while enhancing photograph warmth.
- **Surface Elevation 1 (`#FFFFFF`):** Crisp pure white for cards, bottom sheets, sticky bars, and search inputs.
- **Text & Hierarchy:**
  - `Text Primary`: Deep Charcoal Slate (`#111827`) for titles, dish titles, and prices.
  - `Text Secondary`: Muted Slate (`#374151`) for restaurant metadata, delivery distance, and ingredient lists.
  - `Text Tertiary / Placeholder`: Cloud Slate (`#9CA3AF`) for subtle timestamps, de-emphasized disclaimers, and empty input values.
  - `Divider / Border Subdued`: Ultra-soft warm outline (`#F0EFEA`).

## Typography

Plus Jakarta Sans is utilized uniformly across headlines, body, and labels to produce a clean, human, and balanced visual flow. Its geometric foundation provides legibility in dense product cards, while its warm apertures suit culinary lifestyle branding.

### Hierarchy & Typesetting Guidelines
- **Numbers & Currency:** Prices always employ `Plus Jakarta Sans` with `fontWeight: 700` or `800` using tabular figure styling where available to prevent jitter in live cart tallies.
- **Editorial Dish Titles:** Set to `headline-sm` or `headline-md` with tight tracking (`-0.01em`) to maintain legibility when wrapped to two lines.
- **Badges & Micro-tags:** Always render with `label-sm`, all-caps or title-case, with elevated letter spacing (`0.04em`) to ensure instant legibility over photography or vibrant tints.

## Layout & Spacing

The layout is built for native mobile ergonomics, anchored by single-thumb zone mechanics and vertical content feeds.

### Layout Mechanics
- **Mobile First Framework:** Fixed screen padding of `1rem` (16px) with contextual card gutters of `0.75rem` (12px).
- **Sticky Zones:** Bottom navigation, order summaries, and filter rails are locked with hardware-safe area insets (`env(safe-area-inset-bottom)`).
- **Horizontal Carousels:** Category rails, story bubbles, and featured curations snap to column edges using peek ratios (exposing 15% of the next card to invite horizontal swipe gestures).
- **Responsive Adaptations:**
  - **Mobile (< 640px):** Single-column stacked restaurant feeds, 2-column dish grids where applicable.
  - **Tablet (641px - 1024px):** 2-column restaurant grids, sticky split-screen order/cart review layout.
  - **Desktop (> 1024px):** Max container width capped at `1180px` with central positioning and multi-column catalog layouts.

## Elevation & Depth

This system avoids heavy, muddy drop shadows in favor of ambient, tinted diffusion that lets imagery float above the warm surface base.

### Elevation Hierarchy
- **Level 0 (Flat):** Surface flush with background (`#FBFBF9`). Used for page canvas and segment track backgrounds.
- **Level 1 (Cards & Containers):** Rested cards over the base canvas.
  - `box-shadow: 0px 4px 16px -2px rgba(17, 24, 39, 0.04), 0px 1px 2px rgba(17, 24, 39, 0.02);`
  - Border: 1px solid `#F0EFEA`.
- **Level 2 (Active States, Steppers, Chips):** Interactive elements that require focus.
  - `box-shadow: 0px 8px 24px -4px rgba(255, 79, 24, 0.12), 0px 2px 6px rgba(17, 24, 39, 0.04);`
- **Level 3 (Floating Bars, Cart Sheets, Popovers):** Elevated utility elements.
  - `box-shadow: 0px 16px 36px -6px rgba(17, 24, 39, 0.14), 0px 4px 12px rgba(17, 24, 39, 0.05);`
- **Backdrop Blur Layers:** Sticky navigation headers and category bars use frosted blur (`backdrop-filter: blur(16px); background: rgba(251, 251, 249, 0.88);`) with a hairline bottom border.

## Shapes

The interface embraces a unified curvature logic that communicates friendliness, ease of touch, and food-centric indulgence.

### Curvature Tokens
- **Standard Cards & Banners:** `1rem` (16px) to `1.25rem` (20px) outer border-radius, framing imagery without sharp corners.
- **Modals & Bottom Sheets:** `1.5rem` (24px) top-left and top-right radii for sheets docked to the screen bottom.
- **Buttons, Steppers, & Filter Chips:** Full-pill execution (`9999px`) or softened interactive blocks (`0.75rem` / 12px).
- **Dietary Badges (Veg / Non-Veg):** Precision micro-squares (`4px` radius) encasing the iconic centered circle.

## Components

### 1. Buttons & Steppers
- **Primary CTA ("Add to Cart" / "Pay Now"):** Saffron Orange background (`#FF4F18`), text pure white, full-pill or 16px radius, bold tracking. Includes haptic feedback trigger on tap.
- **Tactile Stepper Button ("ADD" / `[-] 1 [+]`):**
  - Default: White pill container with `#FF4F18` outline, bold primary text, centered "+".
  - Active / Counted: Solid white pill elevated with Level 2 shadow containing a minus button, bold quantity text in slate, and plus button in `#FF4F18`.
- **Secondary Actions:** Ultra-pale saffron tint (`#FFF3ED`) background with `#FF4F18` text, flat elevation.

### 2. Dish & Restaurant Cards
- **Restaurant Feed Card:** Outer radius `16px`, subtle `#F0EFEA` outline, containing a 16:9 hero image, absolute positioned delivery time pill top-left (e.g. "24 mins"), and an emerald rating chip top-right. Bottom zone features restaurant name, culinary tags, and average price for two.
- **Item Listing Card (Catalog):** Horizontal orientation. Left side houses item name, dietary marker, description, and price. Right side displays a squared `110x110px` rounded image with the Stepper Button overlapping the bottom edge.

### 3. Dietary Indicators & Badges
- **Pure Veg Indicator:** 14x14px square, white background, `1.5px` solid `#16A34A` border, containing an inner filled circle (`6px` diameter) in `#16A34A`.
- **Non-Veg Indicator:** Identical geometry with deep ruby red (`#E23744`) border and filled triangle icon.
- **Rating Chip:** Emerald green badge (`#16A34A`) with white bold text accompanied by a miniature gold star icon.

### 4. VIP Gold Pass Component
- Gradient backdrop from `#F59E0B` to `#D97706`, accented with subtle gold metallic sheen overlay.
- Text rendered in deep espresso (`#451A03`) for readable contrast.
- Includes golden crown glyph and high-contrast claim badge.

### 5. Filter Chips & Pill Tabs
- Height `36px`, rounded `9999px`.
- Inactive: Surface white, hairline border (`#E5E7EB`), text `#374151`.
- Active: Background `#111827`, text `#FFFFFF`, icon accent `#FF4F18`.

### 6. Sticky Floating Cart Pill
- Floats 16px above bottom screen margin.
- Background `#111827`, text `#FFFFFF`, 16px padding. Left side displays item count and total price; right side features "View Cart" with directional arrow icon colored in primary `#FF4F18`.