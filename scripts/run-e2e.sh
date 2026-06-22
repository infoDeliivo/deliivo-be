#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-e2e.sh  —  Start the stack (if needed) and run the full E2E test suite.
#
# Usage:
#   bash scripts/run-e2e.sh                  # auto-start Docker, run tests
#   bash scripts/run-e2e.sh --no-docker      # skip Docker, server already running
#   bash scripts/run-e2e.sh --down-after     # stop containers when tests finish
#   bash scripts/run-e2e.sh --filter booking # run only specs matching "booking"
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
BASE_URL="${E2E_BASE_URL:-http://localhost:3000}"
HEALTH_URL="${BASE_URL}/health"
MAX_WAIT_SECONDS=60
FILTER=""
USE_DOCKER=true
DOWN_AFTER=false

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-docker)   USE_DOCKER=false ;;
    --down-after)  DOWN_AFTER=true ;;
    --filter)      FILTER="$2"; shift ;;
    --base-url)    BASE_URL="$2"; HEALTH_URL="${BASE_URL}/health"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[e2e]${NC} $*"; }
success() { echo -e "${GREEN}[e2e]${NC} $*"; }
warn()    { echo -e "${YELLOW}[e2e]${NC} $*"; }
error()   { echo -e "${RED}[e2e]${NC} $*"; }

# ── Step 1: Optionally start Docker Compose ───────────────────────────────────
if $USE_DOCKER; then
  info "Starting Docker Compose services..."
  docker compose up -d --build
else
  info "--no-docker: assuming server is already running at ${BASE_URL}"
fi

# ── Step 2: Wait for API health ───────────────────────────────────────────────
info "Waiting for API at ${HEALTH_URL} (max ${MAX_WAIT_SECONDS}s)..."
elapsed=0
until curl -sf --noproxy "*" "${HEALTH_URL}" > /dev/null 2>&1; do
  if [[ $elapsed -ge $MAX_WAIT_SECONDS ]]; then
    error "Server did not become healthy within ${MAX_WAIT_SECONDS}s."
    if $USE_DOCKER; then
      echo ""
      warn "Docker Compose logs:"
      docker compose logs --tail=30 api
    fi
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
  echo -n "."
done
echo ""
success "Server is healthy."

# ── Step 3: Run the E2E suite ─────────────────────────────────────────────────
info "Running E2E tests against ${BASE_URL} ..."
echo ""

JEST_ARGS=""
if [[ -n "$FILTER" ]]; then
  JEST_ARGS="--testPathPattern=${FILTER}"
  info "Filter: ${FILTER}"
fi

EXIT_CODE=0
# Bypass corporate proxy for localhost so axios requests reach the local server.
# DATABASE_URL is passed so globalTeardown can connect to Postgres directly.
E2E_BASE_URL="${BASE_URL}" \
  DATABASE_URL="${DATABASE_URL:-postgresql://carpooling:carpooling@localhost:5432/carpooling?schema=public}" \
  no_proxy="localhost,127.0.0.1" \
  NO_PROXY="localhost,127.0.0.1" \
  npx jest --config jest.e2e.config.js --runInBand --forceExit ${JEST_ARGS} \
  || EXIT_CODE=$?

# ── Step 4: Optionally tear down ──────────────────────────────────────────────
if $DOWN_AFTER && $USE_DOCKER; then
  info "Stopping Docker Compose services..."
  docker compose down
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  success "All E2E tests passed."
else
  error "E2E tests finished with failures (exit code ${EXIT_CODE})."
fi

exit $EXIT_CODE
