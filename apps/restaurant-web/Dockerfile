# Multi-Stage Dockerfile for Quick Bite Restaurant Partner Web Portal
# Stage 1: Build & Bundle
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat

# Copy monorepo configurations
COPY package.json package-lock.json* turbo.json tsconfig.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/design-system/package.json ./packages/design-system/
COPY apps/restaurant-web/package.json ./apps/restaurant-web/

RUN npm ci

# Copy sources
COPY packages/shared-types ./packages/shared-types
COPY packages/design-system ./packages/design-system
COPY apps/restaurant-web ./apps/restaurant-web

# Build dependencies and Vite application
RUN npm --prefix packages/shared-types run build
RUN npm --prefix packages/design-system run build
RUN npm --prefix apps/restaurant-web run build

# Stage 2: Nginx Alpine Static Server
FROM nginx:alpine AS runner

COPY --from=builder /app/apps/restaurant-web/dist /usr/share/nginx/html

# Custom SPA Nginx configuration
RUN printf 'server {\n\
    listen 80;\n\
    server_name localhost;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    location /health {\n\
        return 200 "OK";\n\
        add_header Content-Type text/plain;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
