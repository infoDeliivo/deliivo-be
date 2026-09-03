FROM node:20-alpine AS base

WORKDIR /app

ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

# Install dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY scripts ./scripts/
RUN npm ci
RUN sh -n scripts/docker-entrypoint.sh

# Build
COPY tsconfig.json ./
COPY src ./src/
COPY docs ./docs/
RUN npm run build

# Refresh the GeoLite2 tables that back country detection (src/utils/geoip.ts). The snapshot
# geoip-lite bundles is already stale the day the package is published, and a stale table does not
# announce itself — it simply reports the country an address used to be in.
#
# This is a stage of its own for one reason: the licence key is a secret. Railway's builder accepts
# no mount type but cache, so `RUN --mount=type=secret` is not available and the key has to arrive
# as a build ARG — which is recorded in the layer history of whatever stage declares it. Declaring
# it here confines that record to a stage nobody ships: the production image below copies only the
# converted .dat files out, so the key appears in no layer of the pushed image.
#
# With no key set the stage is a no-op passthrough and the bundled tables travel on unchanged, so a
# build without MaxMind credentials still succeeds.
FROM base AS geoip

ARG MAXMIND_LICENSE_KEY

# bash and curl exist only for this script, and only in this discarded stage.
#
# Deliberately non-fatal. The refresh talks to MaxMind over the network, and a deploy must not fail
# because a third party was slow or reset a connection — a ECONNRESET here once already killed an
# otherwise good build. The script puts the previous tables back if it cannot finish, so failing
# means shipping data that is merely older, never data that is wrong.
RUN if [ -n "$MAXMIND_LICENSE_KEY" ]; then \
      apk add --no-cache bash curl \
      && (bash scripts/update-geoip.sh \
          || echo 'WARNING: GeoLite2 refresh failed — shipping the previous snapshot.'); \
    else \
      echo 'No MAXMIND_LICENSE_KEY set — keeping the GeoLite2 snapshot bundled with geoip-lite.'; \
    fi

# Production image
FROM node:20-alpine AS production

WORKDIR /app

# One-time runtime recovery for the known failed production migration.
ENV PRISMA_RECOVERABLE_MIGRATION=20260707113000_localize_content_slugs

COPY --from=base /app/package.json /app/package-lock.json ./
COPY --from=base /app/node_modules ./node_modules/
# Only the converted country/city tables come out of the geoip stage — never its environment.
COPY --from=geoip /app/node_modules/geoip-lite/data ./node_modules/geoip-lite/data/
COPY --from=base /app/dist ./dist/
COPY --from=base /app/prisma ./prisma/
COPY --from=base /app/prisma.config.ts ./
COPY --from=base /app/docs ./docs/
COPY --from=base /app/scripts ./scripts/

EXPOSE 3000

ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["npm", "run", "start:all"]
