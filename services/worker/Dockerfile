# Worker Service Dockerfile
# Built from project root: docker build -f services/worker/Dockerfile .
#
# Build cache optimization:
# - Package files copied first for dependency layer caching
# - BuildKit cache mounts for npm cache
# - Multi-stage build to minimize final image size

FROM node:24-slim AS builder

# Version passed at build time
ARG APP_VERSION=development

WORKDIR /app

# === LAYER 1: Package files (changes infrequently) ===
# Copy only package files first to maximize cache hits
COPY services/worker/package.json services/worker/package-lock.json ./services/worker/

WORKDIR /app/services/worker

# Install dependencies with cache mount for faster rebuilds
# The cache mount persists npm cache between builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit

# === LAYER 2: Shared types (changes occasionally) ===
WORKDIR /app
COPY shared/ ./shared/

# === LAYER 3: Service source code (changes frequently) ===
WORKDIR /app/services/worker
COPY services/worker/src ./src
COPY services/worker/tsconfig.json ./

# Build TypeScript
RUN npm run build

# ============================================================================
# Production stage - minimal runtime image
# ============================================================================
FROM node:24-slim

ARG APP_VERSION=development

# Install GraphicsMagick for PDF processing, Ghostscript for PDF reading, and Hebrew fonts
# Playwright will install its own Chromium browser
RUN apt-get update && \
    apt-get install -y \
        graphicsmagick \
        ghostscript \
        fonts-noto-cjk \
        fonts-freefont-ttf \
        fonts-dejavu-core \
        --no-install-recommends && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Configure Playwright to use system dependencies
# Playwright handles browser installation and crashpad internally
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Add security: run as non-root user
RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

WORKDIR /app

# Copy package files
COPY --from=builder /app/services/worker/package.json \
                    /app/services/worker/package-lock.json ./

# Install production dependencies only with cache mount
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production --prefer-offline --no-audit && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app/services/worker/dist ./dist

# Install Playwright Chromium browser (as root, before switching to nodejs user)
# Playwright handles all browser setup including crashpad
RUN npx playwright install chromium --with-deps

# Change ownership to non-root user (including Playwright browsers, if present)
RUN chown -R nodejs:nodejs /app && \
    if [ -d "/ms-playwright" ]; then chown -R nodejs:nodejs /ms-playwright; fi

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
CMD ["node", "dist/services/worker/src/index.js"]
