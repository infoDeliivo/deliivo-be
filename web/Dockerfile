FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY src ./src/
COPY public ./public/
COPY next.config.ts tsconfig.json ./
COPY postcss.config.mjs ./

ENV NEXT_TELEMETRY_DISABLED=1

# Build-time args for NEXT_PUBLIC_ vars (baked into client JS bundle)
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:3000

ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL

RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=base /app/package.json ./
COPY --from=base /app/node_modules ./node_modules/
COPY --from=base /app/.next ./.next/
COPY --from=base /app/public ./public/

EXPOSE 3001

ENV PORT=3001
CMD ["npx", "next", "start", "-p", "3001"]
