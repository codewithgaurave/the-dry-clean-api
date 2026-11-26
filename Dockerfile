# ==============================================================================
# The Dry Cleaner - Atelier Garment Care: Master NestJS Backend API Dockerfile
# Production-hardened multi-stage container build with Node.js LTS (Alpine)
# Source of truth: TECH_STACK.md §11.1, §11.2; TODO.md TASK-048
# ==============================================================================

# Stage 1: Build & Prune
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install native build tools for sharp & native bindings
RUN apk add --no-cache python3 make g++ vips-dev

# Copy package manifests first to leverage Docker layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for Nest CLI build)
RUN npm ci

# Copy configuration and TypeScript source code
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/

# Compile TypeScript to production JavaScript dist
RUN npm run build

# Remove development dependencies to keep production footprint minimal
RUN npm prune --omit=dev

# ==============================================================================
# Stage 2: Production Minimal Runtime
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Runtime libraries for sharp image processing and health check probing
RUN apk add --no-cache vips curl

ENV NODE_ENV=production
ENV PORT=3000

# Copy production dependencies and compiled artifacts from builder stage
COPY --chown=node:node --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=builder /usr/src/app/dist ./dist
COPY --chown=node:node --from=builder /usr/src/app/package*.json ./

# Non-root secure execution
USER node

# Expose standard application port
EXPOSE 3000

# Healthcheck probe using liveness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

# Start NestJS application
CMD ["node", "dist/main.js"]

