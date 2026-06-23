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

# Build
COPY tsconfig.json ./
COPY src ./src/
COPY docs ./docs/
COPY content ./content/
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

COPY --from=base /app/package.json /app/package-lock.json ./
COPY --from=base /app/node_modules ./node_modules/
COPY --from=base /app/dist ./dist/
COPY --from=base /app/prisma ./prisma/
COPY --from=base /app/prisma.config.ts ./
COPY --from=base /app/docs ./docs/
COPY --from=base /app/content ./content/
COPY --from=base /app/scripts ./scripts/

EXPOSE 3000

ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["npm", "start"]
