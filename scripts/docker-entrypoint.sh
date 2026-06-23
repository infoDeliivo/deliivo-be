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
# Migration is idempotent — it is safe to run on every container start.
# If nothing is pending it completes in < 1 second.

set -e

echo "[entrypoint] Running database migrations..."
npx prisma migrate deploy
echo "[entrypoint] Migrations complete."

if [ "${SKIP_DB_SEED}" != "true" ]; then
  echo "[entrypoint] Running database seed..."
  npx prisma db seed
  echo "[entrypoint] Database seed complete."
fi

echo "[entrypoint] Starting: $*"
exec "$@"
