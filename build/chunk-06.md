# Chunk 06: Frontend Design System, Themes & i18n Shell

> **HISTORICAL — not kept up to date (banner added 6 Oct 2026).** True when written; parts describe things since removed or replaced (a Cloudflare tunnel, seeded `pass123` accounts, wallets, Google Maps, the old `apps/admin-web` and `apps/restaurant-web`). For the current state read **`CLAUDE.md`** (start here), then `OWNER_ACTIONS.md` and `CHANGELOG.md`.

**Goal:** Build the shared design system package (`packages/design-system`), initialize CSS custom property tokens, Dark/Light mode theme provider, Lucide icon library setup, and internationalization (i18n) for English, Hindi, and Kannada.  
**Estimated Time:** 60 minutes  
**Dependencies:** Chunk 01  
**Unlocks:** Chunk 07 (Frontend Screens)  

---

## 1. Deliverables in this Chunk
- Complete CSS custom property tokens imported across mobile and web.
- `ThemeProvider` supporting System, Dark, and Light themes.
- `react-i18next` configuration with JSON translation files for `en`, `hi`, and `kn`.
- Shared UI primitives: `Button`, `Badge`, `Card`, `Skeleton`, `Input`.
- Error Boundary wrapper component for routes and widgets.

---

## 2. Verification Commands

```bash
# Build shared design system package
npm --prefix packages/design-system run build
```

---

## 3. Rollback Instructions
Revert changes in `packages/design-system`.
