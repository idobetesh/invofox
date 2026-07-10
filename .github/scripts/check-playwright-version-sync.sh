#!/usr/bin/env bash
# Verify Docker-related versions stay aligned with repo config.
#
# CHECKED (can silently break prod if they drift):
#   1. Playwright — npm package embeds browser paths; must match mcr.microsoft.com/playwright tag.
#      Deploy passes PLAYWRIGHT_VERSION from package-lock at build time; this script guards the
#      Dockerfile ARG default used for local builds.
#   2. Node major — .nvmrc / CI node-version must match `FROM node:MAJOR-slim` in Dockerfiles.
#
# NOT CHECKED (no npm↔Docker pin, or low risk):
#   - graphicsmagick, ghostscript — apt packages in worker Dockerfile; no npm version to match.
#   - Most npm deps — installed via npm ci inside the image; no separate Docker tag.
#   - Playwright image's bundled Node — managed by Microsoft; only Playwright semver matters.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKER_LOCKFILE="$ROOT/services/worker/package-lock.json"
WORKER_DOCKERFILE="$ROOT/services/worker/Dockerfile"
NVMRC="$ROOT/.nvmrc"

fail() {
  echo "❌ $1" >&2
  exit 1
}

# --- 1. Playwright (worker) ---
NPM_PW="$(node -p "require('$WORKER_LOCKFILE').packages['node_modules/playwright'].version")"
DOCKER_PW_DEFAULT="$(grep -E '^ARG PLAYWRIGHT_VERSION=' "$WORKER_DOCKERFILE" | sed 's/ARG PLAYWRIGHT_VERSION=//')"

[[ -n "$NPM_PW" ]] || fail "Could not read playwright version from $WORKER_LOCKFILE"
[[ -n "$DOCKER_PW_DEFAULT" ]] || fail "Could not read ARG PLAYWRIGHT_VERSION from $WORKER_DOCKERFILE"

if [[ "$NPM_PW" != "$DOCKER_PW_DEFAULT" ]]; then
  fail "Playwright mismatch: package-lock=$NPM_PW, Dockerfile ARG default=$DOCKER_PW_DEFAULT"
fi

echo "✅ Playwright in sync ($NPM_PW)"

# --- 2. Node major (.nvmrc vs Dockerfile builder stages) ---
[[ -f "$NVMRC" ]] || fail "Missing $NVMRC"
NVMRC_MAJOR="$(tr -d '[:space:]' < "$NVMRC")"
[[ "$NVMRC_MAJOR" =~ ^[0-9]+$ ]] || fail ".nvmrc must be a major version number, got: $NVMRC_MAJOR"

for dockerfile in "$ROOT/services/worker/Dockerfile" "$ROOT/services/webhook-handler/Dockerfile"; do
  found=0
  while IFS= read -r from_line; do
    found=1
    docker_major="$(sed -E 's/^FROM node:([0-9]+)-slim.*/\1/' <<<"$from_line")"
    if [[ "$docker_major" != "$NVMRC_MAJOR" ]]; then
      fail "Node major mismatch: .nvmrc=$NVMRC_MAJOR, $dockerfile has $from_line"
    fi
  done < <(grep -E '^FROM node:[0-9]+-slim' "$dockerfile" || true)

  if [[ "$found" -eq 0 ]]; then
    fail "No 'FROM node:MAJOR-slim' in $dockerfile"
  fi
done

echo "✅ Node major in sync (.nvmrc=$NVMRC_MAJOR)"
