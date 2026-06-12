FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.mjs ./
RUN npm ci

# Build
COPY tsconfig.json ./
COPY src ./src/
COPY docs ./docs/
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

COPY --from=base /app/package.json /app/package-lock.json ./
COPY --from=base /app/node_modules ./node_modules/
COPY --from=base /app/dist ./dist/
COPY --from=base /app/prisma ./prisma/
COPY --from=base /app/prisma.config.mjs ./
COPY --from=base /app/docs ./docs/

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
