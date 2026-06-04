# NestJS Migration Plan

Migration from Express 5 to NestJS 10, addressing all identified codebase gaps, with proper CI/CD, observability, and APM.

---

## Summary

| Area | Current | After Migration |
|---|---|---|
| Framework | Express 5 (manual) | NestJS 10 |
| Validation | Zod (manual middleware) | class-validator + class-transformer (Pipes) |
| Auth | 2 duplicate middlewares | Single JwtGuard + Passport strategy |
| Logging | console.log + Winston (mixed) | Pino (structured, JSON) + correlation IDs |
| Background jobs | node-cron in web process | BullMQ workers (separate process) |
| Error handling | 9-line catch-all | NestJS exception filters + custom AppException |
| Money types | Float | Decimal (Prisma) |
| Roles | Hardcoded USER everywhere | DB role field + RolesGuard |
| Health checks | `{status: 'ok'}` | Terminus (DB + Redis + Queue liveness/readiness) |
| APM | None | OpenTelemetry -> Grafana/Datadog |
| CI/CD | Build twice, no tests, direct-to-prod | Test -> Staging -> Production (gated) |
| Socket.IO | Module-level globals + circular import | NestJS WebSocket Gateway |
| OpenAPI | Hand-written YAML | Auto-generated from decorators via @nestjs/swagger |

---

## Phase 0 — Database Fixes

These schema changes must land before the NestJS code references them.

### Migration 1: Fix monetary types (Float -> Decimal)

```sql
ALTER TABLE "RideBooking"     ALTER COLUMN "totalPrice"          TYPE DECIMAL(10,2);
ALTER TABLE "RideBooking"     ALTER COLUMN "paymentAmount"        TYPE DECIMAL(10,2);
ALTER TABLE "RideBooking"     ALTER COLUMN "refundAmount"         TYPE DECIMAL(10,2);
ALTER TABLE "RideBooking"     ALTER COLUMN "refundPercent"        TYPE DECIMAL(5,2);
ALTER TABLE "RideBooking"     ALTER COLUMN "driverPenaltyValue"   TYPE DECIMAL(10,2);
ALTER TABLE "Ride"            ALTER COLUMN "basePricePerSeat"     TYPE DECIMAL(10,2);
ALTER TABLE "RideWaypoint"    ALTER COLUMN "pricePerSeat"         TYPE DECIMAL(10,2);
ALTER TABLE "UserRatingStats" ALTER COLUMN "averageRating"        TYPE DECIMAL(4,2);
```

### Migration 2: Add role to User

```sql
CREATE TYPE "UserRole" AS ENUM ('PASSENGER', 'DRIVER', 'ADMIN');
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'PASSENGER';
```

### Migration 3: Persist luggageCount on RideBooking

```sql
ALTER TABLE "RideBooking" ADD COLUMN "luggageCount" INT NOT NULL DEFAULT 0;
```

### Migration 4: Add DATABASE_URL to prisma.schema datasource

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

---

## Phase 1 — NestJS Project Scaffold

### New directory structure

```
src/
├── main.ts                         <- Bootstrap
├── app.module.ts                   <- Root module
│
├── common/
│   ├── decorators/                 <- @CurrentUser(), @Roles(), @ApiAuth()
│   ├── filters/                    <- AllExceptionsFilter
│   ├── guards/                     <- JwtAuthGuard, RolesGuard
│   ├── interceptors/               <- LoggingInterceptor, CorrelationIdInterceptor
│   ├── pipes/                      <- ZodValidationPipe
│   └── exceptions/                 <- AppException hierarchy
│
├── config/
│   ├── app.config.ts
│   ├── database.config.ts
│   ├── redis.config.ts
│   └── business.config.ts          <- LUGGAGE_FEE, MAX_SEATS, PENALTY_PERCENT, etc.
│
├── infrastructure/
│   ├── prisma/                     <- PrismaModule, PrismaService
│   ├── redis/                      <- RedisModule, RedisService
│   ├── queue/                      <- BullMQ module setup
│   ├── s3/                         <- S3Module, S3Service
│   └── firebase/                   <- FirebaseModule, PushService
│
├── modules/
│   ├── auth/
│   ├── users/
│   ├── vehicles/
│   ├── travel-preferences/
│   ├── publish-ride/
│   ├── search-ride/
│   ├── ride-booking/
│   ├── driver-booking/
│   ├── payments/
│   ├── chat/
│   ├── notification/
│   ├── ratings/
│   ├── dl-verification/
│   └── maps/
│
├── workers/
│   ├── mail.worker.ts              <- BullMQ processor (separate entry point)
│   ├── sms.worker.ts               <- BullMQ processor (separate entry point)
│   └── booking.worker.ts           <- Deadline jobs (separate entry point)
│
└── socket/
    └── chat.gateway.ts             <- NestJS WebSocket Gateway
```

### Express vs NestJS module comparison

```typescript
// Before (Express)
router.post('/accept', protect, validate({ body: schema }), controller.accept);

// After (NestJS)
@Post('accept')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DRIVER)
async accept(@CurrentUser() user: JwtPayload, @Body() dto: AcceptBookingDto) {
  return this.driverBookingService.accept(user.id, dto);
}
// Validation, auth, roles — all declarative, zero boilerplate
```

---

## Phase 2 — Auth & Security

### What changes

- `@nestjs/passport` + `passport-jwt` for `JwtAuthGuard`
- `RolesGuard` reads `@Roles()` decorator + JWT payload role
- Single `JwtStrategy` — replaces both `auth.ts` and `authMiddleware.ts`
- Refresh token rotation with token family detection (stolen token protection)
- Rate limiting via `@nestjs/throttler` (per-user limit on OTP endpoints)

### AppException hierarchy

```typescript
class AppException extends HttpException { }
class UnauthorizedException extends AppException { }
class ForbiddenException extends AppException { }
class NotFoundException extends AppException { }
class ConflictException extends AppException { }
class PaymentException extends AppException { }
```

### AllExceptionsFilter mapping

| Error type | HTTP status |
|---|---|
| `AppException` | Its own code |
| `PrismaClientKnownRequestError P2002` | 409 Conflict |
| `PrismaClientKnownRequestError P2025` | 404 Not Found |
| `ZodError` / `ValidationError` | 422 Unprocessable Entity |
| Anything else | 500 (message hidden in production) |

---

## Phase 3 — Config Layer

Replaces all hardcoded business constants scattered across service files.

```typescript
// config/business.config.ts
registerAs('business', () => ({
  luggageFeePerItem:    parseFloat(process.env.LUGGAGE_FEE_PER_ITEM    ?? '5.00'),
  maxSeatsPerBooking:   parseInt(process.env.MAX_SEATS_PER_BOOKING      ?? '4'),
  driverPenaltyPercent: parseInt(process.env.DRIVER_PENALTY_PERCENT     ?? '50'),
  extendedDeadlineHours: parseInt(process.env.EXTENDED_DEADLINE_HOURS   ?? '1'),
  pickupOtpTtlHours:    parseInt(process.env.PICKUP_OTP_TTL_HOURS       ?? '6'),
  dropOtpTtlHours:      parseInt(process.env.DROP_OTP_TTL_HOURS         ?? '24'),
  maxOtpAttempts:       parseInt(process.env.MAX_OTP_ATTEMPTS            ?? '5'),
}));
```

All env vars validated at startup via Joi schema — app refuses to start if misconfigured.

---

## Phase 4 — Background Jobs (BullMQ, replacing node-cron)

### Why node-cron must go

The current `startBookingDeadlineChecker()` is called in `app.ts`. It runs in every web server instance. On horizontal scaling, every instance runs the cron simultaneously causing double-cancellations and duplicate notifications.

### New flow with BullMQ delayed jobs

```
Booking reaches DRIVER_PENDING
  -> Enqueue: "driver-decision-deadline"     delay = DRIVER_DECISION_WINDOW_MS
  -> Job fires if driver doesn't act
  -> Send "deadline expired" notification to passenger
  -> Enqueue: "driver-decision-extended"     delay = EXTENDED_DEADLINE_HOURS
  -> Job fires if still no action
  -> Auto-cancel booking + process refund
```

BullMQ guarantees exactly-once execution across any number of instances.

### Worker entry points (separate processes)

```
workers/mail.worker.ts     <- NestJS standalone app, BullMQ mail processor
workers/sms.worker.ts      <- NestJS standalone app, BullMQ SMS processor
workers/booking.worker.ts  <- NestJS standalone app, BullMQ deadline processor
```

---

## Phase 5 — WebSocket Gateway

The current `socket/index.ts` (369 lines, module-level globals, circular import via dynamic `import()`) becomes a typed NestJS Gateway.

```typescript
@WebSocketGateway({ cors: true })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(
    private chatService: ChatService,
    private presenceService: PresenceService,
    private jwtService: JwtService,
  ) {}

  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() dto: SendMessageDto,
  ) { ... }
}
```

### Improvements over current implementation

- No circular import — the dynamic `import()` in `notification.service.ts` is eliminated
- Presence and chat services are injected, not referenced via globals
- Fully testable via NestJS `@nestjs/testing`
- Socket auth handled by a proper WsJwtGuard, not inline `jwt.verify`

---

## Phase 6 — Observability Stack

### Structured Logging (Pino)

```typescript
// main.ts
const app = await NestFactory.create(AppModule, {
  logger: new Logger(), // configured with nestjs-pino
});
```

Every log line includes: `requestId`, `userId`, `method`, `path`, `durationMs`, `statusCode`.

### Correlation ID Middleware

```
Incoming request
  -> Read X-Request-Id header (or generate uuid)
  -> Store in AsyncLocalStorage
  -> Attach to every log line within that request context
  -> Return as X-Request-Id response header
```

### Health Checks (@nestjs/terminus)

```
GET /health/live
  -> 200 if process is running (liveness probe)

GET /health/ready
  -> 200 if Postgres + Redis + BullMQ queues are reachable (readiness probe)
  -> 503 if any dependency is down
```

### OpenTelemetry (APM)

Instrumentation loaded before app bootstrap. Covers:
- HTTP requests (auto-instrumented)
- Prisma queries (auto-instrumented via prisma-otel)
- BullMQ jobs (manual spans)
- Socket.IO events (manual spans)

Packages required:
```
@opentelemetry/sdk-node
@opentelemetry/auto-instrumentations-node
@opentelemetry/exporter-trace-otlp-http
@opentelemetry/exporter-metrics-otlp-http
```

Exporter target options (choose one):
- **Grafana Cloud** — free tier, good for self-hosted VMs
- **Datadog** — best DX, paid
- **Self-hosted Jaeger + Prometheus** — free, runs on your VM

### OpenAPI (auto-generated)

No more hand-written YAML. Decorators on DTOs generate the spec at runtime.

```typescript
@ApiProperty({ example: 'London', description: 'Origin city address' })
originAddress: string;
```

---

## Phase 7 — CI/CD Pipeline

### Full pipeline (`.github/workflows/ci-cd.yml`)

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run lint && npm run typecheck

  unit-test:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run test:unit -- --coverage

  integration-test:
    needs: lint
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: test, POSTGRES_DB: carpooling_test }
        options: --health-cmd pg_isready
      redis:
        image: redis:7
        options: --health-cmd "redis-cli ping"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx prisma migrate deploy
        env: { DATABASE_URL: postgresql://postgres:test@localhost:5432/carpooling_test }
      - run: npm run test:e2e
        env: { DATABASE_URL: postgresql://postgres:test@localhost:5432/carpooling_test }

  build:
    needs: [unit-test, integration-test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  deploy-staging:
    needs: build
    if: github.ref == 'refs/heads/develop'
    environment: staging
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { name: dist, path: dist/ }
      - uses: webfactory/ssh-agent@v0.9.0
        with: { ssh-private-key: '${{ secrets.STAGING_SSH_KEY }}' }
      - name: Rsync + restart
        run: |
          rsync -az --delete dist/ ${{ secrets.STAGING_USER }}@${{ secrets.STAGING_HOST }}:${{ secrets.PROJECT_PATH }}/dist/
          ssh ${{ secrets.STAGING_USER }}@${{ secrets.STAGING_HOST }} "
            cd ${{ secrets.PROJECT_PATH }}
            npm ci --production
            npx prisma migrate deploy
            pm2 restart all
          "

  deploy-production:
    needs: build
    if: github.ref == 'refs/heads/main'
    environment: production              # Requires manual approval in GitHub UI
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { name: dist, path: dist/ }
      - uses: webfactory/ssh-agent@v0.9.0
        with: { ssh-private-key: '${{ secrets.VM_SSH_KEY }}' }
      - name: Rsync + restart
        run: |
          rsync -az --delete dist/ ${{ secrets.VM_USER }}@${{ secrets.VM_HOST }}:${{ secrets.PROJECT_PATH }}/dist/
          ssh ${{ secrets.VM_USER }}@${{ secrets.VM_HOST }} "
            cd ${{ secrets.PROJECT_PATH }}
            npm ci --production
            npx prisma migrate deploy
            pm2 restart all
          "
```

### Key improvements over current pipeline

| Issue | Fix |
|---|---|
| No tests before deploy | Tests are required gates before build job |
| Build runs twice (runner + VM) | Build once on runner, artifact uploaded and reused |
| Deploys directly to production on every push | `develop` -> staging, `main` -> production with manual approval |
| `prisma migrate deploy` not automated | Runs automatically in deploy step |
| Typo in filename (`deploye.yml`) | Renamed to `ci-cd.yml` |
| Single environment | Separate staging and production environments with separate secrets |

---

## Migration Execution Order

| Phase | What | Notes |
|---|---|---|
| 0 | DB schema fixes (Decimal, roles, luggageCount, datasource url) | Must be done first |
| 1 | NestJS scaffold + PrismaModule + ConfigModule + common layer | Foundation for everything else |
| 2 | Auth module + JwtGuard + RolesGuard + AllExceptionsFilter | Unlocks protected route migration |
| 3 | Business config layer | Do before migrating service files |
| 4 | Feature modules (auth -> users -> vehicles -> travel-preferences -> publish-ride -> search-ride -> ride-booking -> driver-booking -> payments -> ratings -> dl-verification -> maps) | One module at a time |
| 5 | BullMQ workers (replace node-cron + mail/sms workers) | After ride-booking and payments modules |
| 6 | WebSocket Gateway (chat + notification) | After chat and notification modules |
| 7 | Observability (Pino + OpenTelemetry + Terminus health checks) | Can overlay during module migration |
| 8 | CI/CD pipeline rewrite | Independent of app code, can be done anytime |

---

## Open Questions

1. **Branching** — Migrate on a `nestjs-migration` branch while keeping `main` deployable? (Strongly recommended)

2. **Validation library** — Keep Zod via a custom `ZodValidationPipe`, or switch to `class-validator`? Zod is more type-safe; class-validator integrates more naturally with NestJS decorators.

3. **APM target** — Grafana Cloud, Datadog, or self-hosted Jaeger + Prometheus?

4. **Staging VM** — Is there an existing staging VM, or does one need to be provisioned?
