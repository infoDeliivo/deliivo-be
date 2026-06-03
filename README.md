# Carpooling Backend

A production-ready Node.js/TypeScript REST + WebSocket API for a carpooling platform.
Covers the full ride lifecycle: publish a ride, search, book, OTP-verified pickup/drop, payments, ratings, push notifications, and real-time chat.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [Database](#database)
- [API Reference](#api-reference)
- [Running Tests](#running-tests)
- [Production Deployment (PM2)](#production-deployment-pm2)
- [Project Structure](#project-structure)
- [Key Design Decisions](#key-design-decisions)
- [Documentation Files](#documentation-files)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ with ESM (`"type": "module"`) |
| Language | TypeScript 5 (strict mode) |
| Framework | Express 5 |
| ORM | Prisma 7 on PostgreSQL |
| Cache / Pub-Sub | Redis (ioredis) |
| Queue / Workers | BullMQ (mail worker + SMS worker) |
| Real-time | Socket.IO 4 with Redis adapter |
| Payments | Stripe PaymentIntents + Webhooks |
| Push Notifications | Firebase Admin (FCM / APNs) |
| SMS / OTP | Twilio |
| File Storage | AWS S3 (multer-s3) |
| KYC / DL Verification | Veriff |
| Route Computation | Google Maps Directions API |
| Validation | Zod |
| Security | Helmet, CORS, express-rate-limit, bcryptjs |
| API Docs | OpenAPI 3 (Redocly) + Swagger UI |
| Process Manager | PM2 (`ecosystem.config.cjs`) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Express API Server              │
│  /api/v1/*  ──  JWT protect  ──  Controllers    │
│  /health    ──  public                          │
│  /docs      ──  Swagger UI                      │
│  /api/v1/payments  ──  raw body (Stripe webhook)│
└─────────────┬───────────────┬───────────────────┘
              │               │
        PostgreSQL          Redis
        (Prisma 7)     ┌─────┴──────────┐
                       │                │
                   Socket.IO       BullMQ Queues
                 (Redis adapter)  mail-worker / sms-worker
```

Three processes run in production:

| Process | Entry Point | Purpose |
|---|---|---|
| `api-server` | `dist/server.js` | HTTP API + WebSocket |
| `mail-worker` | `dist/modules/mail/mail.worker.js` | BullMQ email queue processor |
| `sms-worker` | `dist/modules/sms/sms.worker.js` | BullMQ SMS/Twilio queue processor |

---

## Prerequisites

- **Node.js** >= 20
- **npm** >= 10
- **PostgreSQL** >= 14
- **Redis** >= 6
- A `.env` file (copy from `.env.example`)

---

## Local Development Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd carpooling-be
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and REDIS_URL

# 3. Run database migrations
npm run prisma:migrate:dev

# 4. Start all processes together (API + mail worker + SMS worker)
npm run dev
```

Individual processes:

```bash
npm run dev:server       # API server only
npm run dev:worker       # Mail worker only
npm run dev:sms-worker   # SMS worker only
```

The API will be available at `http://localhost:3000`.
Swagger UI is at `http://localhost:3000/docs`.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in values. The table below lists every variable.

### Required for any environment

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string (preferred over HOST/PORT) |
| `ACCESS_TOKEN_SECRET` | JWT access token signing secret (min 32 chars) |
| `REFRESH_TOKEN_SECRET` | JWT refresh token signing secret |

### Optional / service-specific

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `production` | `production` / `staging` |
| `LOG_LEVEL` | `info` | Winston log level |
| `BOOKING_PAYMENT_MODE` | `bypass` | `bypass` (skip Stripe) or `stripe` |
| `EXPOSE_OTP_IN_RESPONSE` | `false` | Return OTP in signup response — **enable only for testing** |
| `GOOGLE_MAPS_API_KEY` | — | Required for route computation in publish-ride |
| `MAIL_HOST / MAIL_PORT / MAIL_USER / MAIL_PASS` | — | SMTP credentials |
| `TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN` | — | Twilio for OTP SMS |
| `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID` | — | Twilio sender |
| `SMS_MOCK_MODE` | `false` | Log SMS instead of sending — **never true in production** |
| `STRIPE_SECRET_KEY` | — | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret |
| `AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION / AWS_S3_BUCKET_NAME` | — | S3 for vehicle documents and avatars |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | — | Firebase service account (one of several accepted formats) |
| `VERIFF_API_KEY / VERIFF_SHARED_SECRET / VERIFF_CALLBACK_URL` | — | Driving licence KYC |

See `.env.example` for all variables with inline documentation.

---

## Running the Application

### Development (hot reload)

```bash
npm run dev
```

### Production (compiled)

```bash
npm run build           # tsc + prisma generate
npm start               # NODE_ENV=production node dist/server.js
```

### Staging

```bash
npm run start:staging
```

### Health check

```
GET /health  →  { "status": "ok" }
```

---

## Database

```bash
# Apply pending migrations (development)
npm run prisma:migrate:dev

# Apply migrations without prompts (CI / production)
npm run prisma:migrate:deploy

# Reset database (destroys all data — development only)
npm run prisma:migrate:reset

# Open Prisma Studio (GUI)
npm run prisma:studio

# Push schema without migration file (prototyping only)
npm run db:push

# Regenerate Prisma client after schema changes
npm run prisma:generate
```

> **Important:** `DATABASE_URL` must be set in `.env` before running any Prisma command.

---

## API Reference

Interactive Swagger UI is served at runtime:

```
http://localhost:3000/docs
```

Raw OpenAPI JSON:

```
http://localhost:3000/openapi.json
```

### OpenAPI tooling

```bash
npm run openapi:lint       # Validate source spec with Redocly
npm run openapi:bundle     # Bundle docs/openapi/openapi.yaml → docs/openapi/dist/openapi.json
npm run openapi:coverage   # Check all mounted routes are documented
npm run openapi:check      # lint + bundle + coverage in sequence
```

### Route summary

All routes are prefixed with `/api/v1`.

| Prefix | Auth | Module |
|---|---|---|
| `/auth` | Public | Signup, verify email, login, refresh token, logout |
| `/users` | JWT | Profile get/update |
| `/travel-preferences` | JWT | Ride preferences (chattiness, pets, etc.) |
| `/vehicles` | JWT | Add, list, delete vehicles |
| `/publish-ride` | JWT | 10-step ride publishing wizard |
| `/search-rides` | JWT | Search available rides by location + date |
| `/bookings` | JWT | Create booking, list, cancel, extend-wait |
| `/driver/bookings` | JWT | Accept, reject, cancel, verify pickup/drop OTP |
| `/maps` | JWT | Google Maps route computation |
| `/chat` | JWT | Chat history for a booking |
| `/notifications` | JWT | List, unread count, mark read, register FCM token |
| `/ratings` | JWT | Submit and view ratings |
| `/dl-verification` | Mixed | Veriff KYC session create + webhook callback |
| `/payments` | Raw body | Stripe webhook (no JWT, signature verified) |
| `/docs` | Public | Swagger UI |
| `/health` | Public | Health check |

### WebSocket

Connect to the root server URL with a valid JWT as the Socket.IO `auth.token`:

```js
const socket = io('http://localhost:3000', {
  auth: { token: '<access_token>' },
  transports: ['websocket'],
});
```

Events: `join_booking_chat`, `send_message`, `new_message`, `user_typing`, `chat_joined`

---

## Running Tests

### Unit tests

```bash
# Run once
npx jest

# Watch mode
npx jest --watch
```

Unit test files live alongside source code in `src/` and follow the `*.test.ts` naming convention.

### End-to-end tests

The E2E suite runs against a **live server**. It creates real users, rides, and bookings through the API.

**Step 1 — Configure the server for testing**

Add these to your server `.env` before starting it:

```env
EXPOSE_OTP_IN_RESPONSE=true
BOOKING_PAYMENT_MODE=bypass
SMS_MOCK_MODE=true
```

**Step 2 — Start the server**

```bash
npm run dev:server
```

**Step 3 — Run the suite**

```bash
E2E_BASE_URL=http://localhost:3000/api/v1 npm run test:e2e
```

Or set `E2E_BASE_URL` permanently in your shell / CI environment.

```bash
# Run a specific spec
npm run test:e2e -- --testPathPattern=06-booking

# Watch mode
npm run test:e2e:watch
```

The suite automatically:
- Creates `driver_a`, `passenger_a`, `passenger_b` test users in `globalSetup`
- Writes shared state to `tests/e2e/.test-state.json`
- Deletes all `*@test.local` users (and cascaded data) in `globalTeardown`

See `tests/e2e/README.md` for the full guide.

---

## Docker

The repository ships with a multi-stage `Dockerfile` and a `docker-compose.yml` that starts every service, runs migrations, and manages dependencies between containers.

### Start everything

```bash
# Copy and fill in your secrets
cp .env.example .env

# Build images and start all services
docker compose up --build
```

This brings up six containers in dependency order:

| Container | Image | Purpose |
|---|---|---|
| `postgres` | postgres:16-alpine | Database |
| `redis` | redis:7-alpine | Cache + pub-sub + queues |
| `migrate` | app runner | Runs `prisma migrate deploy`, then exits |
| `api` | app runner | HTTP API + WebSocket (waits for migrate) |
| `mail-worker` | app runner | BullMQ email processor (waits for migrate) |
| `sms-worker` | app runner | BullMQ SMS processor (waits for migrate) |

The `migrate` service must exit with code 0 before any application service starts — enforced via the `service_completed_successfully` condition in `depends_on`.

### Useful commands

```bash
# Start in detached mode
docker compose up --build -d

# View logs
docker compose logs -f
docker compose logs -f api

# Restart only the API (e.g. after a config change)
docker compose restart api

# Stop everything
docker compose down

# Stop and remove volumes (wipes the database)
docker compose down -v

# Rebuild a single service
docker compose build api
docker compose up -d --no-deps api

# Run a one-off Prisma command against the running postgres
docker compose run --rm migrate npx prisma studio
docker compose run --rm migrate npx prisma migrate status
```

### Configuration

`docker-compose.yml` applies `env_file: - .env` to every application service and then overrides the infrastructure connection strings:

```
DATABASE_URL  →  postgresql://...@postgres:5432/carpooling
REDIS_URL     →  redis://redis:6379
```

This means your `.env` file is the single source of truth for API keys, Stripe, Twilio, Firebase, etc. Only the host names change inside Docker.

Customisable via shell environment or a `.env` file at the project root:

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `carpooling` | Database username |
| `POSTGRES_PASSWORD` | `carpooling` | Database password — **change in production** |
| `POSTGRES_PORT` | `5432` | Host port mapped to postgres |
| `REDIS_PORT` | `6379` | Host port mapped to redis |
| `PORT` | `3000` | Host port mapped to the API |
| `NODE_ENV` | `production` | Passed to all app containers |

### Dockerfile stages

```
builder  →  installs all deps (including devDeps) + runs tsc
runner   →  installs prod deps only + copies dist/
```

The `runner` stage is used for all three application services and the `migrate` one-shot container. The non-root user `appuser` is created inside the image for security.

---

## Production Deployment (PM2)

```bash
# Build
npm run build

# Start all three processes
pm2 start ecosystem.config.cjs

# Monitor
pm2 status
pm2 logs

# Restart
pm2 restart all

# Stop
pm2 stop all
```

The `ecosystem.config.cjs` defines three apps: `api-server`, `mail-worker`, `sms-worker`.
Logs are written to `logs/api-out.log`, `logs/mail-worker-out.log`, `logs/sms-worker-out.log`.

### Notes for production

- Set `BOOKING_PAYMENT_MODE=stripe` to enable real Stripe charges
- Set `SMS_MOCK_MODE=false`
- Set `EXPOSE_OTP_IN_RESPONSE=false`
- Set `STRIPE_SECRET_KEY` to a live key (not `sk_live_replace_me`)
- Register your public URL with Stripe as a webhook endpoint and update `STRIPE_WEBHOOK_SECRET`
- Register `VERIFF_CALLBACK_URL` as a publicly reachable HTTPS URL
- Set `TWILIO_STATUS_CALLBACK_URL` to an HTTPS URL

---

## Project Structure

```
carpooling-be/
├── src/
│   ├── server.ts                  # HTTP + Socket.IO server bootstrap
│   ├── app.ts                     # Express app, route mounting, middleware order
│   ├── socket/                    # Socket.IO connection handler
│   ├── middlewares/               # auth (JWT), errorHandler, rateLimit
│   ├── jobs/                      # node-cron: booking deadline checker
│   ├── services/                  # Shared services (deadline checker)
│   ├── docs/                      # Swagger UI route + OpenAPI YAML source
│   └── modules/
│       ├── auth/                  # Signup, email OTP, login, refresh, logout
│       ├── user/                  # Profile
│       ├── travel-preferences/    # Ride preference settings
│       ├── vehicles/              # Vehicle CRUD
│       ├── publish-ride/          # 10-step publish wizard
│       ├── search-ride/           # Ride search with bounding box
│       ├── ride-booking/          # Passenger booking lifecycle
│       ├── driver-booking/        # Driver accept/reject/OTP verify
│       ├── payments/              # Stripe webhook handler
│       ├── chat/                  # Chat message store + REST history
│       ├── notification/          # WebSocket + FCM push + DB notifications
│       ├── ratings/               # Ratings + UserRatingStats aggregation
│       ├── dl-verification/       # Veriff KYC session + webhook
│       ├── maps/                  # Google Maps route proxy
│       ├── mail/                  # BullMQ mail worker + templates
│       ├── sms/                   # BullMQ SMS worker (Twilio)
│       ├── otp/                   # OTP generation + verification helpers
│       └── token/                 # JWT helpers, refresh token rotation
├── prisma/
│   ├── schema.prisma              # Database schema
│   └── migrations/                # Migration history
├── tests/
│   └── e2e/                       # Automated E2E test suite
│       ├── README.md
│       ├── helpers/               # api.client, auth.helper, ride.helper, state
│       ├── setup/                 # globalSetup + globalTeardown
│       └── specs/                 # 01-auth through 13-chat
├── docs/
│   └── openapi/                   # openapi.yaml source + bundled dist/
├── postman/                       # Postman collection
├── ecosystem.config.cjs           # PM2 process definitions
├── jest.config.js                 # Unit test config
├── jest.e2e.config.js             # E2E test config
├── tsconfig.json
├── .env.example
├── MANUAL_TEST_PLAN.md            # Full manual QA test plan (100+ test cases)
├── PRODUCTION_READINESS.md        # Pre-launch checklist and fix plan
└── NESTJS_MIGRATION_PLAN.md       # NestJS migration blueprint
```

---

## Key Design Decisions

**Stripe webhook raw body ordering**
The `/api/v1/payments` route is mounted before `express.json()` to receive the raw request body required for Stripe signature verification. All other routes use `express.json()`.

**Three separate processes**
Mail and SMS are processed by dedicated BullMQ workers rather than inline in the API process. This means a mail failure never blocks an HTTP response and workers can be scaled independently.

**Booking deadline checker**
A `node-cron` job runs every minute inside the API process to auto-expire bookings where the driver did not respond within the deadline. For multi-instance deployments, this should be extracted to a separate worker with a distributed lock.

**Socket.IO with Redis adapter**
The `@socket.io/redis-adapter` is used so events emitted on one API instance are broadcast to clients connected to other instances. The in-process `userSockets` Map is a known limitation for multi-instance deployments (see `PRODUCTION_READINESS.md`).

**Payment bypass mode**
`BOOKING_PAYMENT_MODE=bypass` (the default) skips Stripe charge and confirms bookings immediately. Switch to `stripe` in production after configuring Stripe keys and webhook endpoint.

---

## Documentation Files

| File | Purpose |
|---|---|
| `MANUAL_TEST_PLAN.md` | 100+ manual test cases across all modules with exact HTTP steps and expected results |
| `PRODUCTION_READINESS.md` | CTO-level pre-launch checklist: security gaps, cost risks, missing features, fix phases |
| `NESTJS_MIGRATION_PLAN.md` | 8-phase blueprint for migrating to NestJS with CI/CD and OpenTelemetry APM |
| `tests/e2e/README.md` | E2E suite setup guide, env vars, test file index, troubleshooting |
