# Multi-Stage Dockerfile for Quick Bite Backend API
# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache libc6-compat

# Copy monorepo configuration files
COPY package.json package-lock.json* turbo.json tsconfig.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/pricing-engine/package.json ./packages/pricing-engine/
COPY packages/design-system/package.json ./packages/design-system/
COPY apps/backend-api/package.json ./apps/backend-api/

# Install all monorepo dependencies
RUN npm ci

# Copy source trees
COPY packages/shared-types ./packages/shared-types
COPY packages/pricing-engine ./packages/pricing-engine
COPY apps/backend-api ./apps/backend-api

# Build shared packages and backend
RUN npm --prefix packages/shared-types run build
RUN npm --prefix packages/pricing-engine run build
RUN npm --prefix apps/backend-api run build

# Stage 2: Production Minimal Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install runtime utilities
RUN apk add --no-cache libc6-compat wget

# Create non-root user and group
USER node

# Copy built dependencies and source trees from builder
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages ./packages
COPY --chown=node:node --from=builder /app/apps/backend-api ./apps/backend-api

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

CMD ["npm", "--prefix", "apps/backend-api", "run", "dev"]
