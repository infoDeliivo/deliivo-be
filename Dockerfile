# ── Stage 1: Build ────────────────────────────────────────────────────────────
# Installs all dependencies (including devDeps) and compiles TypeScript.
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests, Prisma schema, and Prisma config before npm ci
# so that prisma generate (run by postinstall) can find prisma.config.ts
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install all deps (devDeps needed for tsc)
# postinstall runs `prisma generate`
# Use cache mount to speed up subsequent builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy source and compile
COPY . .
RUN npm run build

# Bundle the OpenAPI spec (reads docs/openapi/openapi.yaml → docs/openapi/dist/openapi.json)
# Redocly CLI is a devDep, so it is available in the builder stage.
RUN npm run openapi:bundle

# ── Stage 2: Runner ────────────────────────────────────────────────────────────
# Lean image with only production dependencies and the compiled output.
FROM node:20-alpine AS runner

WORKDIR /app

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create logs directory with proper permissions
RUN mkdir -p /app/logs && chown -R appuser:appgroup /app/logs

# Copy manifests, Prisma schema, and Prisma config before npm ci
# so that prisma generate (run by postinstall) can find prisma.config.ts
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install production deps only.
# postinstall runs `prisma generate`
# Use cache mount to speed up subsequent builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

# Copy bundled OpenAPI spec (served by /docs and /openapi.json endpoints)
COPY --from=builder /app/docs/api/openapi/dist ./docs/api/openapi/dist

# Copy entrypoint script (must be done as root, before USER switch)
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Run as non-root
USER appuser

EXPOSE 3000

# docker-entrypoint.sh runs `prisma migrate deploy` then execs CMD
ENTRYPOINT ["docker-entrypoint.sh"]

# Default command — single process mode (recommended for containers)
# Container orchestrators (Railway, K8s, Docker Compose) handle horizontal scaling
CMD ["node", "dist/server.js"]
