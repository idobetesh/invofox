# Worker Service Dockerfile
# Built from project root: docker build -f services/worker/Dockerfile .
#
# Why two stages?
# - builder: compile TypeScript (small node:24-slim image)
# - production: run the app + Playwright PDF generation (Chromium pre-installed)
#
# Why mcr.microsoft.com/playwright instead of "npx playwright install"?
# Installing Chromium during docker build hung CI/local builds (silent unzip after
# download). The official Playwright image ships browsers + OS libs — same result,
# reliable builds. Pin tag to match services/worker package.json playwright version.

# =============================================================================
# Stage 1: Build — compile TypeScript only
# =============================================================================
FROM node:24-slim AS builder

ARG APP_VERSION=development

WORKDIR /app

# Copy lockfiles first so dependency layer caches when only source changes
COPY services/worker/package.json services/worker/package-lock.json ./services/worker/

WORKDIR /app/services/worker

RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit

WORKDIR /app
COPY shared/ ./shared/

WORKDIR /app/services/worker
COPY services/worker/src ./src
COPY services/worker/tsconfig.json ./

RUN npm run build

# =============================================================================
# Stage 2: Production — run worker + Playwright (invoice/receipt PDF generation)
# =============================================================================
# Tag must match playwright version in package.json (e.g. v1.58.2-noble ↔ ^1.58.2)
# Includes: Node 24, Chromium, browser OS deps. Runs as pwuser by convention.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

ARG APP_VERSION=development

# Incoming invoice pipeline (NOT Playwright): HEIC/PDF → images via gm + ghostscript
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

WORKDIR /app

COPY --from=builder /app/services/worker/package.json \
                    /app/services/worker/package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production --prefer-offline --no-audit && \
    npm cache clean --force

COPY --from=builder /app/services/worker/dist ./dist

# npm ci runs as root — hand /app to pwuser (node_modules only, no browser tree)
RUN chown -R pwuser:pwuser /app

USER pwuser

ENV NODE_ENV=production \
    PORT=8080 \
    APP_VERSION=${APP_VERSION}

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

EXPOSE 8080

CMD ["node", "dist/services/worker/src/index.js"]
