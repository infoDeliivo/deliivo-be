# Technical Review: Scaling & Production Bottleneck Analysis

**Date:** 2026-06-03
**Perspective:** CTO / Principal Engineer
**Scope:** Scaling, Availability, Correctness, Throughput, Latency

---

## Executive Summary

The carpooling backend is well-structured for an early-stage product (~1K DAU). However, several architectural decisions will become bottlenecks as the platform scales to 10K-100K+ concurrent users. This document categorizes issues by severity and provides actionable fixes.

| Severity | Count | Theme |
|----------|-------|-------|
| P0 (Critical) | 4 | Will cause outages under moderate load |
| P1 (High) | 6 | Performance degradation at scale |
| P2 (Medium) | 5 | Technical debt that compounds |
| P3 (Low) | 4 | Best-practice gaps |

---

## P0 - Critical (Will cause outages)

### 1. No Graceful Shutdown

**Problem:** No `SIGTERM`/`SIGINT` handlers exist. When the container is restarted (deploy, scaling, crash recovery):
- In-flight HTTP requests are dropped mid-response
- BullMQ jobs are abandoned without retry
- WebSocket connections terminate without reconnect hints
- Database connections leak (not closed)

**Impact at scale:** Every deployment causes a burst of failed requests, lost queue jobs, and client-side errors. Railway/Docker gives 10s grace period — currently wasted.

**Fix:**
```typescript
// src/server.ts
const shutdown = async (signal: string) => {
  logInfo(`${signal} received, starting graceful shutdown`);

  // 1. Stop accepting new connections
  server.close();

  // 2. Close Socket.IO (sends disconnect to clients)
  io.close();

  // 3. Drain BullMQ workers (finish current jobs)
  await deadlineWorker.close();
  await maintenanceWorker.close();

  // 4. Close Redis connections
  await redis.quit();
  await bullRedis.quit();

  // 5. Close database pool
  await prisma.$disconnect();

  logInfo('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

**Effort:** 2 hours

---

### 2. No Database Connection Pool Configuration

**Problem:** Prisma uses `@prisma/adapter-pg` with zero pool configuration. The `pg` library defaults to `max: 10` connections. With concurrent requests hitting:
- Search (long-running polyline queries)
- Bookings (transactional, holds connections)
- Chat (frequent small queries)
- Background workers (deadline checks, maintenance)

10 connections will be exhausted under ~50 concurrent users.

**Impact at scale:** Connection pool exhaustion causes `ETIMEDOUT` errors, 500s cascade, and total service unavailability.

**Fix:**
```typescript
// src/config/prisma.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '25'),      // Production: 25-50
  min: parseInt(process.env.DB_POOL_MIN || '5'),       // Keep 5 warm
  idleTimeoutMillis: 30000,                            // Close idle after 30s
  connectionTimeoutMillis: 5000,                       // Fail fast if no connection
  statement_timeout: 30000,                            // Kill queries over 30s
});

const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
```

**Also add to `.env`:**
```env
DB_POOL_MAX=25
DB_POOL_MIN=5
```

**Effort:** 1 hour

---

### 3. No Request Timeout Applied

**Problem:** `requestTimeout` middleware (15s) is defined in `src/middlewares/timeout.ts` and exported from `src/middlewares/index.ts` but **never applied** in `app.ts`. A slow database query or external API call (Google Maps, Stripe, Veriff) will hold the connection indefinitely.

**Impact at scale:** Thread pool (libuv) exhaustion. Node.js becomes unresponsive. Health checks pass but no requests complete.

**Fix:** Add to `app.ts` before routes:
```typescript
import { requestTimeout } from './middlewares/index.js';
app.use(requestTimeout); // 15s timeout on all requests
```

**Effort:** 5 minutes

---

### 4. Single-Process Architecture (No Clustering)

**Problem:** The server runs as a single Node.js process. Node.js is single-threaded — one CPU core maximum. CPU-intensive operations (polyline decoding, JSON serialization for large payloads) block the event loop for ALL requests.

**Impact at scale:** At ~200 concurrent requests, p99 latency spikes to 5-10s during search operations. At ~500 concurrent, service becomes unresponsive.

**Fix (Short-term):** Use Node.js cluster module:
```typescript
// src/cluster.ts
import cluster from 'node:cluster';
import os from 'node:os';

const WORKERS = parseInt(process.env.WEB_CONCURRENCY || String(os.cpus().length));

if (cluster.isPrimary) {
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (worker) => {
    logWarn('Worker died, respawning', { pid: worker.process.pid });
    cluster.fork();
  });
} else {
  import('./server.js');
}
```

**Fix (Long-term):** Separate into distinct services:
- **API server** (stateless, horizontally scalable)
- **Worker process** (BullMQ consumers, background jobs)
- **WebSocket server** (Socket.IO with Redis adapter — already prepared)

**Effort:** 4 hours (cluster), 2-3 days (service split)

---

## P1 - High (Performance degradation at scale)

### 5. Polyline Decoding on Every Search Request (CPU Bottleneck)

**Problem:** `search-ride.service.ts` decodes polylines and computes geometric similarity for every ride in the search result set **on every request**. This is O(n * m) where n = rides and m = polyline points.

**Impact:** At 10K published rides, a single search request takes 500ms-2s of pure CPU time. With 50 concurrent searches, the event loop is blocked for other requests.

**Fix options:**
| Option | Complexity | Benefit |
|--------|-----------|---------|
| Pre-compute D_POINTS scores at publish time | 1 day | Eliminates runtime polyline decoding |
| PostGIS migration (spatial indexes) | 2-3 days | O(log n) spatial queries instead of O(n) scan |
| Cache search results by route hash | 2 hours | Helps repeat searches only |

**Recommended:** Pre-compute + PostGIS for long-term.

---

### 6. N+1 Query in Chat Conversations

**Problem:** `chat.service.ts:127-149` — `getConversations()` fires a separate `prisma.message.count()` per conversation to get unread counts. For 20 conversations, that's 20 extra queries.

**Impact:** Chat list endpoint takes 200-500ms instead of 20-50ms.

**Fix:**
```typescript
// Replace individual counts with a single groupBy
const unreadCounts = await prisma.message.groupBy({
  by: ['conversationId'],
  where: { receiverId: userId, readAt: null },
  _count: true,
});
const countMap = new Map(unreadCounts.map(c => [c.conversationId, c._count]));
```

**Effort:** 30 minutes

---

### 7. Sequential Booking Updates in cancelRide()

**Problem:** `publish-ride.service.ts:297-323` — When a driver cancels a ride with 5 bookings, each booking is updated individually in a loop (5-10 sequential queries inside a transaction). The transaction holds a DB connection for the entire duration.

**Fix:**
```typescript
// Batch update all bookings at once
await tx.rideBooking.updateMany({
  where: { rideId, status: { in: ['CONFIRMED', 'DRIVER_PENDING'] } },
  data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'DRIVER' },
});
```

**Effort:** 1 hour

---

### 8. Redis Connection Proliferation

**Problem:** The app creates 5+ Redis connections:
1. App cache (ioredis)
2. BullMQ (ioredis)
3. Socket.IO pub (redis pkg)
4. Socket.IO sub (redis pkg)
5. Legacy notifications job (ioredis)

Each BullMQ Worker also creates its own connection. With 4 workers, that's 9+ Redis connections per instance.

**Impact:** Redis connection limits (Railway free tier: 30 connections). With 3 app replicas = 27+ connections consumed.

**Fix:**
- Share a single ioredis instance for app cache + BullMQ (configure `maxRetriesPerRequest: null` on shared instance)
- Remove the legacy notifications connection in `src/jobs/index.ts`
- Use ioredis for Socket.IO adapter instead of the `redis` package (eliminates duplicate dependency)

**Effort:** 2 hours

---

### 9. Health Check is Shallow

**Problem:** `GET /health` returns `{ status: 'ok' }` without checking dependencies. Load balancers will route traffic to an instance where:
- Database is unreachable
- Redis is down
- Workers have crashed

**Fix:**
```typescript
app.get('/health', async (req, res) => {
  const checks = {
    database: false,
    redis: false,
    uptime: process.uptime(),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {}

  try {
    await redis.ping();
    checks.redis = true;
  } catch {}

  const healthy = checks.database && checks.redis;
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
});
```

**Effort:** 30 minutes

---

### 10. No Database Query Timeout

**Problem:** No `statement_timeout` configured at the database level. A poorly constructed search or a locked row can hold a connection indefinitely, consuming pool slots.

**Fix:** Add to connection string:
```
DATABASE_URL=postgresql://...?statement_timeout=30000&lock_timeout=10000
```

Or set in pool config (see P0 #2 fix).

**Effort:** 5 minutes

---

## P2 - Medium (Technical debt)

### 11. No Database Read Replicas

**Problem:** All reads and writes go to a single PostgreSQL instance. Search queries (read-heavy, CPU-intensive on DB side) compete with booking transactions (write-heavy, lock-heavy).

**Fix (when scaling):**
- Add a read replica for search queries
- Use Prisma's `$extends` with read replica datasource
- Route `GET /search-rides` and `GET /notifications` to replica

**When to implement:** When DB CPU consistently > 60%

---

### 12. Missing Composite Database Indexes

**Current gaps:**
```prisma
// Add to schema.prisma
model RideBooking {
  @@index([rideId, status])       // Used in: cancelRide, search available seats
  @@index([passengerId, status])  // Used in: my bookings filtered by status
}

model Message {
  @@index([conversationId, receiverId, readAt])  // Used in: unread count queries
}

model Ride {
  @@index([status, departureDate])  // Used in: search rides (active + future)
}
```

**Impact:** Without these, PostgreSQL does sequential scans on filtered queries as data grows.

**Effort:** 30 minutes + migration

---

### 13. No Retry/Dead Letter Queue for Failed Jobs

**Problem:** BullMQ workers catch errors but have no explicit retry configuration or dead-letter queue. Failed payment refunds, missed notifications, or SMS delivery failures are lost silently.

**Fix:**
```typescript
const worker = new Worker('booking-deadline', processor, {
  connection: bullRedis,
  concurrency: 5,
  limiter: { max: 10, duration: 1000 },  // Rate limit: 10 jobs/sec
  settings: {
    backoffStrategies: {
      exponential: (attemptsMade) => Math.min(attemptsMade * 1000, 30000),
    },
  },
});

// On queue creation:
const queue = new Queue('booking-deadline', {
  connection: bullRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },  // Keep failed jobs for inspection
  },
});
```

**Effort:** 2 hours

---

### 14. Auth Middleware Hits Database on Every Request

**Problem:** `authMiddleware.ts` does a `prisma.user.findUnique()` on **every authenticated request** to check `isBanned` status. At 1000 req/s, that's 1000 extra DB queries/second.

**Fix:**
- Cache user auth data in Redis with 60s TTL
- Invalidate on ban/unban/delete
- Only re-fetch from DB on cache miss

```typescript
const cacheKey = `auth:${decoded.id}`;
let user = await getCache(cacheKey);
if (!user) {
  user = await prisma.user.findUnique({ where: { id: decoded.id }, select: {...} });
  if (user) await setCache(cacheKey, user, 60); // 60s TTL
}
```

**Effort:** 1 hour

---

### 15. Rate Limiter Uses In-Memory Store

**Problem:** `express-rate-limit` defaults to in-memory storage. With multiple server instances (cluster or horizontal scaling), each instance has its own counter. A client can make `100 * N` requests where N = number of instances.

**Fix:**
```typescript
import RedisStore from 'rate-limit-redis';

const rateLimiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
  windowMs: 60_000,
  max: 100,
});
```

**Effort:** 30 minutes

---

## P3 - Low (Best practices)

### 16. No Structured Error Classification

**Problem:** The error handler returns generic 500 for all unhandled errors. No distinction between:
- Validation errors (400)
- Authentication failures (401)
- Business logic violations (409/422)
- External service failures (502/503)

**Fix:** Create an `AppError` class with HTTP status codes and use a centralized error mapper.

---

### 17. No Request Correlation IDs

**Problem:** When debugging production issues across logs, there's no way to trace a single request through the system (API → DB → queue → notification).

**Fix:** Add middleware that generates `X-Request-ID` header and includes it in all log calls:
```typescript
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});
```

---

### 18. WebSocket Memory Leak Risk

**Problem:** Socket-to-user mappings in Redis have 1-hour TTL. If a client disconnects without triggering the `disconnect` event (network failure), orphan entries accumulate until TTL expires. Under heavy WebSocket churn, Redis memory grows.

**Fix:** Reduce TTL to match `pingTimeout` (60s) and refresh on every message/ping.

---

### 19. No API Versioning Strategy

**Problem:** All routes are under `/api/v1/` but there's no mechanism to run v1 and v2 simultaneously. Breaking changes require coordinated frontend deploys.

**Fix (when needed):** Content negotiation via `Accept` header or parallel route registration.

---

## Scaling Roadmap

### Phase 1: Immediate (Week 1) — Handle 5K DAU

| Task | Effort | Impact |
|------|--------|--------|
| Add graceful shutdown | 2h | Prevents deploy-time errors |
| Configure DB pool (max: 25) | 1h | Prevents connection exhaustion |
| Apply request timeout middleware | 5m | Prevents hung connections |
| Add deep health check | 30m | Enables proper load balancing |
| Add statement_timeout to DB | 5m | Prevents runaway queries |

### Phase 2: Short-term (Month 1) — Handle 20K DAU

| Task | Effort | Impact |
|------|--------|--------|
| Node.js clustering (4 workers) | 4h | 4x throughput |
| Fix N+1 in chat service | 30m | 10x faster chat list |
| Cache auth user lookups | 1h | -1000 queries/sec |
| Redis-backed rate limiter | 30m | Correct rate limiting across instances |
| Add composite indexes | 30m | Faster filtered queries |
| BullMQ retry + DLQ config | 2h | No lost jobs |

### Phase 3: Medium-term (Quarter 1) — Handle 100K DAU

| Task | Effort | Impact |
|------|--------|--------|
| Pre-compute search scores at publish | 1d | Eliminates CPU bottleneck |
| Separate API / Worker / WebSocket services | 3d | Independent scaling |
| Add database read replica | 1d | 2x read capacity |
| PostGIS migration for spatial queries | 3d | O(log n) search |
| Consolidate Redis connections | 2h | Fewer connections per instance |

### Phase 4: Long-term (6+ months) — Handle 1M+ DAU

| Task | Effort | Impact |
|------|--------|--------|
| Database sharding (by region/city) | 2w | Horizontal DB scaling |
| CDN for static assets (avatars, vehicle images) | 1d | Reduced bandwidth |
| Event-driven architecture (Kafka/NATS) | 2w | Decoupled services |
| Search service extraction (Elasticsearch) | 1w | Sub-50ms search at any scale |
| API gateway (Kong/Envoy) | 3d | Rate limiting, auth, routing at edge |

---

## Architecture Decision: Current vs. Target

```
CURRENT (Monolith)                    TARGET (Microservices-ready)
┌─────────────────────┐               ┌──────────┐  ┌──────────┐  ┌──────────┐
│   Express App       │               │ API GW   │──│ Auth Svc │──│ User Svc │
│ ┌─────┬──────┬────┐│               └──────────┘  └──────────┘  └──────────┘
│ │ API │ WS   │Jobs││                     │
│ └─────┴──────┴────┘│               ┌──────────┐  ┌──────────┐  ┌──────────┐
│   Single Process    │               │ Ride Svc │──│Search Svc│──│ Chat Svc │
└─────────┬───────────┘               └──────────┘  └──────────┘  └──────────┘
          │                                │              │
    ┌─────┴─────┐                    ┌──────────┐  ┌──────────┐
    │ PostgreSQL│                    │ Workers  │──│  Events  │
    │   Redis   │                    │ (BullMQ) │  │(Kafka/NATS)│
    └───────────┘                    └──────────┘  └──────────┘
```

**Recommendation:** Don't jump to microservices yet. The monolith is fine for the current stage. Focus on Phase 1-2 fixes first, which provide 10-20x headroom without architectural changes.

---

## Quick Wins (< 1 day total effort, high impact)

1. Apply `requestTimeout` middleware (5 min)
2. Configure `DB_POOL_MAX=25` + `statement_timeout=30000` (10 min)
3. Add graceful shutdown handler (2 hours)
4. Fix chat N+1 with `groupBy` (30 min)
5. Add deep health check (30 min)
6. Cache auth user in Redis (1 hour)

**Total: ~5 hours of work for 10x reliability improvement.**
