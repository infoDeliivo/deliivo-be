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
RUN npm ci

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

# Copy manifests, Prisma schema, and Prisma config before npm ci
# so that prisma generate (run by postinstall) can find prisma.config.ts
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install production deps only.
# postinstall runs `prisma generate`
RUN npm ci --omit=dev

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

# Copy bundled OpenAPI spec (served by /docs and /openapi.json endpoints)
COPY --from=builder /app/docs/openapi/dist ./docs/openapi/dist

# Copy entrypoint script (must be done as root, before USER switch)
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Run as non-root
USER appuser

EXPOSE 3000

# docker-entrypoint.sh runs `prisma migrate deploy` then execs CMD
ENTRYPOINT ["docker-entrypoint.sh"]

# Default command — uses cluster mode for multi-core utilization
# Override with "node dist/server.js" for single-process mode or worker services
CMD ["node", "dist/cluster.js"]
