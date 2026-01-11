# Webhook Handler Dockerfile
# Built from project root: docker build -f services/webhook-handler/Dockerfile .
#
# Build cache optimization:
# - Package files copied first for dependency layer caching
# - BuildKit cache mounts for npm cache
# - Multi-stage build to minimize final image size

FROM node:25-slim AS builder

# Version passed at build time
ARG APP_VERSION=development

WORKDIR /app

# === LAYER 1: Package files (changes infrequently) ===
# Copy only package files first to maximize cache hits
COPY services/webhook-handler/package.json services/webhook-handler/package-lock.json ./services/webhook-handler/

WORKDIR /app/services/webhook-handler

# Install dependencies with cache mount for faster rebuilds
# The cache mount persists npm cache between builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit

# === LAYER 2: Shared types (changes occasionally) ===
WORKDIR /app
COPY shared/ ./shared/

# === LAYER 3: Service source code (changes frequently) ===
WORKDIR /app/services/webhook-handler
COPY services/webhook-handler/src ./src
COPY services/webhook-handler/tsconfig.json ./

# Build TypeScript
RUN npm run build

# ============================================================================
# Production stage - minimal runtime image
# ============================================================================
FROM node:25-slim

ARG APP_VERSION=development

# Add security: run as non-root user
RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

WORKDIR /app

# Copy package files
COPY --from=builder /app/services/webhook-handler/package.json \
                    /app/services/webhook-handler/package-lock.json ./

# Install production dependencies only with cache mount
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production --prefer-offline --no-audit && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app/services/webhook-handler/dist ./dist

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Set environment
ENV NODE_ENV=production \
    PORT=8080 \
    APP_VERSION=${APP_VERSION}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Expose port
EXPOSE 8080

# Run the application
CMD ["node", "dist/services/webhook-handler/src/index.js"]
