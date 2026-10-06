# Multi-Stage Dockerfile for Quick Bites Backend API
# Stage 1: Build & Dependencies
FROM node:22-alpine AS builder

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache libc6-compat

# Copy monorepo configuration files
COPY package.json package-lock.json* turbo.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/pricing-engine/package.json ./packages/pricing-engine/
COPY packages/design-system/package.json ./packages/design-system/
COPY packages/config/ ./packages/config/
COPY apps/backend-api/package.json ./apps/backend-api/

# Install all monorepo dependencies (including devDependencies for tsx)
RUN npm ci --include=dev

# Copy source trees
COPY packages/shared-types ./packages/shared-types
COPY packages/pricing-engine ./packages/pricing-engine
COPY apps/backend-api ./apps/backend-api
# The privacy policy and terms, served as public pages (Play Store, 2 Oct 2026).
COPY legal ./legal

# Stage 1b: the Partner and Admin websites (/partner, /admin).
# The phone apps' own code built for the web, on every deploy, so the sites
# always match the apps. Only the finished files reach the runner; React Native
# and Expo stay in this stage. Package manifests first, so npm ci is cached
# until a dependency changes.
FROM node:22-alpine AS web

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* turbo.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/pricing-engine/package.json ./packages/pricing-engine/
COPY packages/design-system/package.json ./packages/design-system/
COPY packages/config/ ./packages/config/
COPY apps/admin-mobile/package.json ./apps/admin-mobile/
COPY apps/restaurant-mobile/package.json ./apps/restaurant-mobile/

RUN npm ci --include=dev

COPY packages ./packages
COPY apps/admin-mobile ./apps/admin-mobile
COPY apps/restaurant-mobile ./apps/restaurant-mobile
COPY scripts/build-web.mjs ./scripts/build-web.mjs

RUN node scripts/build-web.mjs

# Stage 2: Production Runner
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install runtime utilities
RUN apk add --no-cache libc6-compat wget

# Copy dependencies and source from builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/backend-api ./apps/backend-api
COPY --from=builder /app/legal ./legal
COPY --from=web /app/apps/backend-api/web ./apps/backend-api/web

# Create persistent data directory with correct permissions
RUN mkdir -p /app/apps/backend-api/data && chown -R node:node /app

# Switch to non-root user after directory setup
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'wget --no-verbose --tries=1 --spider http://localhost:${PORT:-5000}/health || exit 1'

# Use node with experimental-strip-types for TypeScript execution in production
CMD ["node", "--experimental-strip-types", "apps/backend-api/src/server.ts"]
