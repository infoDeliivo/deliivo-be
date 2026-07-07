#!/bin/sh
# docker-entrypoint.sh
#
# Runs Prisma migrations then hands off to the command passed as arguments.
# Using `exec` replaces this shell process with the app process, so signals
# (SIGTERM from Docker/Railway) are delivered directly to the app and it can
# shut down gracefully.
#
# Usage:
#   ENTRYPOINT ["docker-entrypoint.sh"]
#   CMD ["node", "dist/cluster.js"]          <- API (clustered)
#   CMD ["node", "dist/server.js"]          <- API (single process)
#   CMD ["node", "dist/modules/mail/mail.worker.js"]  <- mail worker
#
# Migration is idempotent â€” it is safe to run on every container start.
# If nothing is pending it completes in < 1 second.

set -e

RECOVERABLE_MIGRATION="${PRISMA_RECOVERABLE_MIGRATION:-}"

echo "[entrypoint] Running database migrations..."
if MIGRATION_OUTPUT=$(npx prisma migrate deploy 2>&1); then
  printf '%s\n' "$MIGRATION_OUTPUT"
else
  MIGRATION_STATUS=$?
  printf '%s\n' "$MIGRATION_OUTPUT" >&2

  if [ -n "$RECOVERABLE_MIGRATION" ] && \
     printf '%s\n' "$MIGRATION_OUTPUT" | grep -q "Error: P3009" && \
     printf '%s\n' "$MIGRATION_OUTPUT" | grep -q "$RECOVERABLE_MIGRATION"; then
    echo "[entrypoint] Recovering failed migration: $RECOVERABLE_MIGRATION"
    npx prisma migrate resolve --rolled-back "$RECOVERABLE_MIGRATION"
    echo "[entrypoint] Retrying database migrations..."
    npx prisma migrate deploy
  else
    echo "[entrypoint] Migration failed and is not eligible for automatic recovery." >&2
    exit "$MIGRATION_STATUS"
  fi
fi
echo "[entrypoint] Migrations complete."

if [ "${SKIP_DB_SEED}" != "true" ]; then
  echo "[entrypoint] Running database seed..."
  if node dist/scripts/seed.js; then
    echo "[entrypoint] Database seed complete."
  else
    echo "[entrypoint] Database seed failed; continuing startup."
  fi
fi

echo "[entrypoint] Starting: $*"
exec "$@"
