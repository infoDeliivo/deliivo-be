FROM node:20-alpine AS base

WORKDIR /app

ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

# Install dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY scripts ./scripts/

# bash and curl are needed only to refresh the GeoLite2 snapshot below. They stay in this build
# stage — the production stage starts from a clean alpine and copies just node_modules and dist.
RUN apk add --no-cache bash curl

RUN npm ci
RUN sh -n scripts/docker-entrypoint.sh

# Refresh the GeoLite2 tables that back country detection (src/utils/geoip.ts). The snapshot
# geoip-lite bundles is already stale the day the package is published, and a stale table does not
# fail — it reports the country an address used to be in. The refreshed data lands in
# node_modules/geoip-lite/data, which the production stage copies wholesale.
#
# The licence key arrives as a BuildKit secret, never an ARG or ENV: those are recorded in the
# image history and would ship the key inside the image. Build with:
#   DOCKER_BUILDKIT=1 docker build --secret id=maxmind_license_key,env=MAXMIND_LICENSE_KEY .
# A build with no secret mounted keeps the bundled tables and carries on, so CI without MaxMind
# credentials still succeeds.
RUN --mount=type=secret,id=maxmind_license_key \
    if [ -s /run/secrets/maxmind_license_key ]; then \
      MAXMIND_LICENSE_KEY="$(cat /run/secrets/maxmind_license_key)" bash scripts/update-geoip.sh; \
    else \
      echo 'No MaxMind key mounted — keeping the GeoLite2 snapshot bundled with geoip-lite.'; \
    fi

# Build
COPY tsconfig.json ./
COPY src ./src/
COPY docs ./docs/
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

# One-time runtime recovery for the known failed production migration.
ENV PRISMA_RECOVERABLE_MIGRATION=20260707113000_localize_content_slugs

COPY --from=base /app/package.json /app/package-lock.json ./
COPY --from=base /app/node_modules ./node_modules/
COPY --from=base /app/dist ./dist/
COPY --from=base /app/prisma ./prisma/
COPY --from=base /app/prisma.config.ts ./
COPY --from=base /app/docs ./docs/
COPY --from=base /app/scripts ./scripts/

EXPOSE 3000

ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["npm", "run", "start:all"]
