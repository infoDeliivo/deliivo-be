# Technical Review v2 — Post-Fixes Assessment

**Date:** 2026-06-04
**Scale Target:** 50K users, 5–10K DAU, 2,000 rides+bookings/day
**Reviewer Lens:** CTO — scaling, availability, correctness, latency, security, cost

---

## Executive Summary

After the P0/P1 fixes (graceful shutdown, connection pooling, clustering, Redis-backed rate limiting, deep health check), the system is **production-viable for the stated 5–10K DAU target** with known limitations. The architecture will hold through ~20K DAU before requiring the first significant redesign (search service extraction or PostGIS migration).

**Risk Matrix at 5–10K DAU:**

| Area | Risk | Verdict |
|------|------|---------|
| Database | LOW | Pool configured, indexes added, 2K rides/day well within capacity |
| Redis | LOW | Single instance handles 100K+ ops/sec; current load is <1K ops/sec |
| Search | MEDIUM | CPU-bound polyline decoding per query — viable up to ~50 concurrent searches |
| Payments | LOW | Stripe handles scale; webhook idempotency is correct |
| Chat | LOW | N+1 fixed, groupBy in place |
| WebSocket | MEDIUM | Redis adapter works, but presence logic has edge cases |
| Notifications | MEDIUM | Synchronous push delivery inside API request path |
| Security | LOW-MEDIUM | JWT-only auth is fast, but token revocation gap exists |

---

## 1. SCALING

### 1.1 Database (PostgreSQL)

**Current State:** Pool max=25, min=5, statement_timeout=30s, composite indexes on hot paths.

**At 5–10K DAU (2K rides/day):**
- Peak concurrent DB connections: ~15–20 (well within 25 pool max)
- Table sizes: ~50K users, ~500K rides/year, ~1M bookings/year, ~5M messages/year
- **No issue** for 12–18 months

**Watch Points:**
| Concern | When | Mitigation |
|---------|------|------------|
| `searchRidesAdvanced` full table scan on Ride | >100K published rides | Add `@@index([status, departureDate, originLat, originLng])` or move to PostGIS |
| `Notification` table growth (no partition) | >10M rows (~2 years) | Add time-based partitioning or archive to cold storage |
| `Message` table growth | >5M rows | Already has `conversationId` index; consider partitioning by date |
| `deleteCachePattern` uses `KEYS *` | Any scale | **FIX NOW** — replace with `SCAN` (blocks Redis event loop) |

### 1.2 Redis

**Current State:** Single ioredis instance (app) + BullMQ instance. Socket.IO uses `redis.duplicate()`.

**At 5–10K DAU:**
- Rate limit keys: ~10K keys at peak (trivial)
- Socket presence: ~3–5K keys at peak
- Cache keys: ~50K total
- BullMQ jobs: ~5K/day throughput
- **Total memory:** <100MB — single Redis instance is fine

**Watch Points:**
| Concern | When | Mitigation |
|---------|------|------------|
| Single Redis = SPOF | If Redis goes down, rate limiting fails open, cache misses, sockets disconnect | Add Redis Sentinel or use managed Redis (Railway Redis, AWS ElastiCache) |
| `redis.keys(pattern)` in `deleteCachePattern` | >50K keys | **FIX NOW** — O(N) blocking command |
| No Redis maxmemory policy configured | Memory grows unbounded | Set `maxmemory-policy allkeys-lru` in Redis config |

### 1.3 BullMQ / Job Queues

**Current State:** 3 queues (booking-deadline concurrency:5, maintenance concurrency:1, notifications stub).

**At 5–10K DAU (2K bookings/day):**
- Deadline jobs: ~2K/day (each fires 2 delayed jobs) = ~4K jobs/day
- Maintenance: 1 nightly job
- **No issue** — BullMQ handles millions/day easily

**Issue Found:** The `src/jobs/index.ts` notification queue is a **dead stub** — it imports `bullRedis`, creates a worker that sleeps for 1 second, and does nothing. Meanwhile `createNotification()` dispatches synchronously. This is wasted resources.

**Recommendation:** Delete `src/jobs/index.ts` or convert it into the actual notification dispatch queue (see §3 Latency).

### 1.4 Clustering

**Current State:** `cluster.ts` forks up to 4 workers. Railway typically provides 2–4 vCPUs.

**At 5–10K DAU:**
- 4 workers × 25 DB pool = 100 max DB connections (PostgreSQL default limit is 100!)
- **ISSUE:** Each worker creates its own pg Pool. With 4 workers, you need `max_connections >= 100 + overhead`.

**Fix Required:**
```
DB_POOL_MAX = floor(pg_max_connections / WEB_CONCURRENCY) - 2
```
For Railway's managed Postgres (default max_connections=97):
- `WEB_CONCURRENCY=2`, `DB_POOL_MAX=20` → 40 connections (safe)
- `WEB_CONCURRENCY=4`, `DB_POOL_MAX=10` → 40 connections (safe)

**Add to docs:** "With clustering, set `DB_POOL_MAX = floor(max_connections / WEB_CONCURRENCY) - 5`"

---

## 2. AVAILABILITY

### 2.1 Single Points of Failure

| Component | SPOF? | Impact | Mitigation |
|-----------|-------|--------|------------|
| PostgreSQL | Yes (single instance) | Total outage | Use managed PostgreSQL with replicas (Railway, RDS) |
| Redis | Yes | Degraded (no cache, no rate limiting, sockets disconnect) | Managed Redis with failover |
| Stripe | External | Bookings fail, but retry works | Circuit breaker exists (`circuitBreaker.ts`) |
| SMTP | External | OTP delivery fails | SMS fallback exists |
| Google Maps API | External | Route calculation fails | Circuit breaker + cached routes |
| FCM/APNs | External | Push notifications fail | WebSocket fallback exists |

**Verdict at 5–10K DAU:** Managed PostgreSQL + managed Redis = sufficient HA. No need for multi-region until >50K DAU.

### 2.2 Graceful Shutdown

**Status: FIXED** — SIGTERM/SIGINT handlers drain HTTP, Socket.IO, BullMQ, Redis, Prisma within 10s.

**Gap:** Workers respawn indefinitely in cluster mode. If a worker crashes in a loop (e.g., OOM), it thrashes. Consider adding crash rate detection:
```typescript
// Track crashes per minute, stop respawning if >5 deaths in 60s
```

### 2.3 Health Check

**Status: FIXED** — `/health` checks DB + Redis, returns 503 on failure.

**Gap:** No readiness vs. liveness distinction. Load balancers should:
- `/health` → readiness (can it serve traffic?)
- `/alive` → liveness (is the process alive?) — just return 200

For Railway this doesn't matter (single health check URL), but for Kubernetes deployments later, split them.

---

## 3. LATENCY

### 3.1 Hot Path Analysis (p95 targets)

| Endpoint | Current p95 | Target | Status |
|----------|-------------|--------|--------|
| `POST /auth/otp/request` | ~200ms (OTP gen + email/SMS) | <500ms | OK |
| `GET /search-rides` (basic) | ~50ms (bounding box + haversine) | <200ms | OK |
| `GET /search-rides/advanced` | **~200–800ms** (polyline decode + D-points) | <500ms | WATCH |
| `POST /bookings` | ~300ms (Stripe PaymentIntent + DB) | <1s | OK |
| `POST /chat/send` | ~50ms (DB + WebSocket emit) | <100ms | OK |
| `GET /chat/conversations` | ~30ms (groupBy fixed) | <100ms | OK |
| `POST /notifications` (internal) | **~100–500ms** (DB + WebSocket + push) | <50ms | ISSUE |

### 3.2 Notification Delivery is Synchronous (MEDIUM Priority)

`createNotification()` does:
1. `prisma.notification.create()` — 5–10ms
2. `redis.exists()` + `redis.incr()` — 2ms
3. `getUserSocketIds()` — 2ms
4. If online: `io.to(socketId).emit()` — 1ms
5. If offline: **`sendPushToUser()`** — 100–300ms (FCM HTTP call)

The push delivery happens **inside the calling request's lifecycle**. When a driver accepts a booking (`acceptBooking`), the response is delayed by the push notification's FCM roundtrip.

**Fix:** Move push delivery to the notification BullMQ queue:
```typescript
// Instead of:
await sendPushToUser(userId, payload);

// Do:
await notificationQueue.add('push', { userId, payload });
```

This makes `createNotification()` always <20ms regardless of FCM latency.

### 3.3 Search — Polyline CPU Cost

The advanced search decodes polylines (potentially 1000+ points each) for every candidate ride. At 200 candidates × 1000 points = 200K coordinate pairs decoded per search request.

**At 5–10K DAU:** ~50 concurrent searches worst case. With 4 workers, each handles ~12 concurrent requests. Polyline decoding is pure CPU — it blocks the event loop for 5–50ms per ride.

**Current Impact:** Acceptable. Each search takes ~200–800ms total.

**When it breaks:** >100 concurrent search requests (probably >30K DAU).

**Deferred fix:** Pre-compute route scores on ride publish (store decoded waypoints in DB or cache).

---

## 4. CORRECTNESS

### 4.1 Race Conditions

| Scenario | Risk | Current Protection |
|----------|------|-------------------|
| Two passengers book last seat simultaneously | **HIGH** | No row-level lock on `availableSeats` |
| Driver accepts booking while passenger cancels | LOW | Transaction isolation handles this |
| Deadline fires while driver is accepting | LOW | `DRIVER_PENDING` status check in both paths |
| Concurrent webhook + manual cancel | LOW | Idempotent webhook processing |

**CRITICAL FIX NEEDED — Seat Booking Race Condition:**

In `createBooking`, the code does:
```typescript
// 1. Check ride has enough seats (SELECT)
const ride = await prisma.ride.findFirst({ where: { availableSeats: { gte: seatsRequested } } });
// 2. Later inside transaction...
await tx.ride.update({ data: { availableSeats: { decrement: seatsRequested } } });
```

Between step 1 and step 2, another request can book the same seats. The `decrement` can go **negative** because there's no `WHERE availableSeats >= N` constraint on the UPDATE.

**Fix:**
```typescript
// Inside the transaction:
const updated = await tx.ride.updateMany({
  where: { id: rideId, availableSeats: { gte: seatsRequested } },
  data: { availableSeats: { decrement: seatsRequested } },
});
if (updated.count === 0) throw new Error('Not enough seats available');
```

This is an atomic compare-and-decrement — no race possible.

### 4.2 Eventual Consistency Gaps

| Gap | Impact | Acceptable? |
|-----|--------|-------------|
| Redis unread count vs. DB truth | Minor UI inconsistency (off by 1–2) | Yes, with 60s TTL |
| Cache invalidation on profile update | Stale profile for 5 min max | Yes |
| Socket presence vs. actual connectivity | Ghost "online" for up to 1 hour (TTL) | Yes — ping/disconnect handles it |

### 4.3 Data Integrity

| Concern | Status |
|---------|--------|
| Referential integrity (FKs) | OK — all models have proper relations |
| Cascade deletes | OK — UserReport/UserBlock cascade on user delete |
| Soft deletes for vehicles | OK — `deletedAt` field used |
| OTP plaintext storage | KNOWN — stored for verification; hashes also stored |
| Stripe webhook idempotency | OK — `StripeWebhookEvent` table checked before processing |

### 4.4 Pagination Bug in Basic Search

```typescript
// Line 388-395 in search-ride.service.ts
return {
  rides: ridesWithDistance,
  pagination: {
    page,
    limit,
    total: ridesWithDistance.length,  // ← BUG: this is the filtered count, not total
    totalPages: Math.ceil(ridesWithDistance.length / limit),
  },
};
```

The basic search does DB-level `skip/take` pagination, then applies an **additional Haversine filter** in JS. This means:
- DB returns `limit` results
- JS filter removes some (outside exact radius)
- `total` reports the filtered count, not the true total
- User may get fewer results than `limit` per page, with wrong `totalPages`

**Fix:** Either:
1. Remove the post-filter (trust bounding box alone — slight inaccuracy)
2. Fetch more than `limit` from DB and trim (2× overfetch)
3. Use PostGIS `ST_DWithin` for exact radius at DB level

For 5–10K DAU: option 2 (overfetch 2×) is simplest.

---

## 5. SECURITY

### 5.1 Authentication

| Aspect | Status | Notes |
|--------|--------|-------|
| JWT verification | OK | No DB call per request |
| Token revocation | GAP | If user is banned, existing JWTs remain valid until expiry |
| Refresh token rotation | OK | Old tokens deleted on refresh |
| OTP brute-force | OK | Redis-backed rate limiter (5/15min) |

**Token Revocation Fix:**
For a 50K user app, a simple approach:
```typescript
// In protect middleware:
const cachedBan = await redis.get(`banned:${decoded.id}`);
if (cachedBan === '1') return sendError(res, { message: 'Account suspended', status: 403 });
```
Set `banned:{userId}` key when user is banned. Cost: 1 Redis GET per request (~0.1ms). Only needed if ban enforcement is time-critical.

### 5.2 Input Validation

| Layer | Status |
|-------|--------|
| Request body (Zod schemas) | OK — all routes validated |
| SQL injection | OK — Prisma parameterized queries |
| XSS | OK — JSON API, no HTML rendering; Helmet headers set |
| Path traversal | OK — no file serving from user input |
| Request size | OK — `express.json({ limit: '50kb' })` |

### 5.3 Sensitive Data Exposure

| Concern | Status | Fix |
|---------|--------|-----|
| Error messages leak stack traces | RISK | `errorHandler` returns `err.message` — could expose internals |
| Health check exposes uptime | LOW | Acceptable for internal use |
| Booking OTP in logs | OK | Not logged since logging cleanup |
| Stripe keys in env | OK | Not exposed in responses |

**Fix for error handler:**
```typescript
// Production: never return raw error message
const message = process.env.NODE_ENV === 'production'
  ? 'Internal Server Error'
  : err.message;
```

### 5.4 Rate Limiting Gaps

| Endpoint | Limiter | Concern |
|----------|---------|---------|
| `POST /auth/otp/*` | `otpLimiter` (5/15min) | OK |
| `POST /bookings` | `rateLimiter` (100/min) | Too generous — 100 booking attempts/min? |
| `POST /chat/send` | `rateLimiter` (100/min) | OK for chat |
| `GET /search-rides/advanced` | `rateLimiter` (100/min) | CPU-heavy — should be tighter |

**Recommendation:** Add endpoint-specific limiters for expensive operations:
```typescript
export const searchLimiter = rateLimit({ windowMs: 60000, max: 20, store: new RedisStore('rl:search') });
export const bookingLimiter = rateLimit({ windowMs: 60000, max: 10, store: new RedisStore('rl:booking') });
```

---

## 6. COST CONSIDERATIONS (Early-Stage Startup)

### 6.1 Infrastructure Cost at 5–10K DAU

| Service | Provider | Estimated Monthly Cost |
|---------|----------|----------------------|
| PostgreSQL (managed) | Railway / Supabase | $20–50 |
| Redis (managed) | Railway / Upstash | $10–20 |
| App hosting (2 vCPU, 1GB) | Railway | $20–40 |
| Stripe | Per-transaction | 2.9% + 30¢ per booking |
| Google Maps API | Per-request | ~$200–500/month at 2K rides/day |
| FCM/APNs | Free | $0 |
| S3 (profile images) | AWS | $5–10 |
| **Total** | | **$250–620/month** |

### 6.2 Cost Optimization Opportunities

| Optimization | Savings | Effort |
|-------------|---------|--------|
| Cache Google Maps route results (already has polyline) | 50–70% Maps cost | Done |
| Batch FCM notifications (multi-device send) | Minimal | Low |
| Use Upstash Redis (pay-per-request) instead of always-on | 50% Redis cost at low traffic | Config change |
| Set `WEB_CONCURRENCY=2` (not 4) for small traffic | 30% memory | Config change |

### 6.3 What NOT to Spend On Yet

- **Don't:** Multi-region deployment, read replicas, Kubernetes, service mesh
- **Don't:** Elasticsearch for search (PostGIS is enough when needed)
- **Don't:** Dedicated message broker (BullMQ/Redis is fine to 100K jobs/day)
- **Don't:** CDN (no static assets served from this API)

---

## 7. PRIORITIZED FIX LIST

### P0 — Fix Before Launch (Correctness/Security)

| # | Issue | Impact | Status |
|---|-------|--------|--------|
| 1 | **Seat booking race condition** — no atomic seat decrement | Double-booking | **ALREADY FIXED** (atomic `updateMany` + count check exists) |
| 2 | **Error handler leaks internal messages** in production | Security info disclosure | **FIXED** |
| 3 | **`redis.keys()` in deleteCachePattern** — blocks event loop | Redis unresponsive | **FIXED** (SCAN-based) |

### P1 — Fix Within First Month (Performance/Reliability)

| # | Issue | Impact | Status |
|---|-------|--------|--------|
| 4 | **Async notification push delivery** — move FCM to queue | 100–300ms latency on booking accept/reject | **FIXED** (pushQueue) |
| 5 | **DB pool sizing for cluster mode** — document/enforce `max_connections / workers` | Connection exhaustion at 4 workers | **FIXED** (docs + env defaults) |
| 6 | **Endpoint-specific rate limiters** for search/booking | CPU exhaustion on search spam | **FIXED** (searchLimiter + bookingLimiter) |
| 7 | **Ban check in auth middleware** — Redis lookup for revoked users | Banned users can operate until token expires | **FIXED** (Redis `banned:{id}` key) |
| 8 | **Search pagination bug** — incorrect total after Haversine filter | UX confusion, missing results | **FIXED** (overfetch + JS pagination) |
| 9 | **Delete dead notification queue stub** (`src/jobs/index.ts`) | Wasted BullMQ connection + confusing code | **FIXED** (replaced with real push worker) |
| 10 | **Cluster crash-loop protection** — stop respawning after 5 deaths/min | Runaway resource consumption | **FIXED** |

### P2 — Fix Within Quarter (Scale Prep)

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| 11 | Replace `deleteCachePattern` with targeted key deletion | Eliminates need for SCAN entirely | 1 hour |
| 12 | Add Notification table partitioning (by month) | Query perf at >10M rows | 2 hours |
| 13 | Pre-compute route D-points scores on ride publish | Eliminate CPU-bound search | 1 day |
| 14 | Add `maxmemory-policy` to Redis config | Prevent OOM | **FIXED** (docker-compose) |

### Not Needed Now (>50K DAU Problems)

- Read replicas for PostgreSQL
- Redis Cluster (sharding)
- Service extraction (search, chat, notifications)
- Kubernetes / auto-scaling
- PostGIS spatial indexes
- Event sourcing for bookings

---

## 8. ARCHITECTURE HEALTH SCORECARD

| Dimension | Score (1–5) | Notes |
|-----------|-------------|-------|
| **Correctness** | 3.5/5 | Seat race condition is the main gap |
| **Availability** | 4/5 | Graceful shutdown + health check; single-instance DB is the risk |
| **Scalability** | 4/5 | Cluster + pool + indexes; good to 20K DAU |
| **Latency** | 3.5/5 | Sync push delivery adds 100–300ms to critical paths |
| **Security** | 4/5 | Solid input validation + rate limiting; error leakage and ban gap |
| **Operability** | 4/5 | Structured logging, health checks, Docker compose |
| **Cost Efficiency** | 4.5/5 | Lean stack, no over-provisioning |
| **Code Quality** | 4/5 | Clean TypeScript, good separation of concerns |

**Overall: 3.9/5 — Production-ready for stated scale with 3 critical fixes.**

---

## 9. RECOMMENDED IMMEDIATE ACTIONS

```
Week 1: Fix P0 (#1 seat race, #2 error handler, #3 redis.keys)
Week 2: Fix P1 #4-#6 (async push, pool docs, rate limiters)
Week 3: Fix P1 #7-#10 (ban check, pagination, cleanup)
Month 2-3: P2 items as needed based on traffic growth
```

After these fixes, the system supports **50K users / 10K DAU / 2K rides-per-day** comfortably with a single Railway instance (2 vCPU, 1GB RAM) running 2 cluster workers.
