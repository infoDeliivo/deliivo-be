# System Design Analysis: Carpooling Backend

A comprehensive analysis of system design concerns, potential issues, and recommendations for the carpooling backend service.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Concurrency & Race Conditions](#2-concurrency--race-conditions)
3. [Distributed Locking](#3-distributed-locking)
4. [Database Scaling & Locking](#4-database-scaling--locking)
5. [Caching Strategy](#5-caching-strategy)
6. [Message Queues & Async Flows](#6-message-queues--async-flows)
7. [Consistency Issues](#7-consistency-issues)
8. [Scaling & Throughput](#8-scaling--throughput)
9. [Redis Architecture](#9-redis-architecture)
10. [Real-time & Socket.IO](#10-real-time--socketio)
11. [Notifications & Delivery Guarantees](#11-notifications--delivery-guarantees)
12. [Security Concerns](#12-security-concerns)
13. [Payment System Reliability](#13-payment-system-reliability)
14. [Recommendations Summary](#14-recommendations-summary)

---

## 1. Architecture Overview

```
                     +------------------+
                     |   Load Balancer  |
                     +--------+---------+
                              |
              +---------------+---------------+
              |               |               |
     +--------v--+    +-------v---+    +------v----+
     | Express   |    | Express   |    | Express   |
     | Worker 1  |    | Worker 2  |    | Worker N  |
     | (cluster) |    | (cluster) |    | (cluster) |
     +-----+-----+    +-----+-----+    +-----+-----+
           |                 |                |
     +-----v-----------------v----------------v-----+
     |                   Redis                       |
     |  (cache, pub/sub, sockets, rate-limit, queues)|
     +-----+------------------+---------------------+
           |                  |
     +-----v------+    +-----v------+
     | PostgreSQL |    |  BullMQ    |
     | (Prisma)   |    |  Workers   |
     +-----------+    +------------+
```

**Stack:** Node.js, Express, TypeScript, Prisma, PostgreSQL, Redis (ioredis), BullMQ, Socket.IO, Stripe

**Process Model:** Node.js cluster mode (`src/cluster.ts`) spawning `min(CPU cores, 4)` workers with crash-loop detection (5 crashes in 60s halts respawning).

---

## 2. Concurrency & Race Conditions

### 2.1 Seat Overbooking (MITIGATED)

**The Problem:** Multiple passengers booking the last seat simultaneously.

**Current Mitigation:** Conditional atomic update inside a Prisma transaction:

```typescript
const seatUpdate = await tx.ride.updateMany({
  where: {
    id: rideId,
    availableSeats: { gte: seatsBooked },
    status: RideStatus.PUBLISHED,
  },
  data: { availableSeats: { decrement: seatsBooked } },
});
if (seatUpdate.count === 0) throw new Error('INSUFFICIENT_SEATS');
```

**Assessment:** This is an optimistic locking pattern. PostgreSQL's `READ COMMITTED` isolation ensures the `WHERE` clause is evaluated against committed data. Under high concurrency, only one transaction will succeed in decrementing -- others will see `count === 0` and rollback. **This is correct and sufficient.**

**Remaining Concern:** No `SELECT FOR UPDATE` means the ride data read earlier in the transaction (for validation) could be stale. The seat decrement is safe, but other fields (e.g., `status`) could change between the read and the conditional update. Low risk in practice since ride status transitions are infrequent.

---

### 2.2 Duplicate Booking (PARTIALLY MITIGATED)

**Current Mitigation:**
```typescript
const existingBooking = await tx.rideBooking.findFirst({
  where: { rideId, passengerId, status: { in: ACTIVE_BOOKING_STATUSES } },
});
if (existingBooking) throw new Error('BOOKING_ALREADY_EXISTS');
```

**Concern:** This is a check-then-act inside a transaction, but under `READ COMMITTED` isolation, two concurrent transactions could both pass this check before either commits. There is **no unique constraint** on `(rideId, passengerId)` filtered by active statuses at the database level.

**Risk Level:** MEDIUM. Two rapid requests from the same user could create duplicate bookings. The seat decrement would still work correctly (both would reserve seats), but the business invariant (one active booking per passenger per ride) could be violated.

**Recommendation:**
- Add a partial unique index: `CREATE UNIQUE INDEX ON "RideBooking" (rideId, passengerId) WHERE status IN ('PAYMENT_PENDING', 'DRIVER_PENDING', 'CONFIRMED', 'IN_PROGRESS');`
- Or use `SERIALIZABLE` isolation for this specific transaction.

---

### 2.3 Driver Decision + Deadline Race (CONCERN)

**The Problem:** Driver accepts a booking at the exact moment the deadline worker auto-cancels it.

**Current Mitigation:**
- Deadline handler checks `if booking.status !== DRIVER_PENDING` → skip.
- Driver acceptance updates status without re-checking deadline.

**Concern:** Both could read status as `DRIVER_PENDING` simultaneously:
1. Worker reads → still DRIVER_PENDING → proceeds with cancel
2. Driver endpoint reads → still DRIVER_PENDING → proceeds with accept

One will "win" the UPDATE (last-write-wins), but the loser's side-effects (refund vs. OTP generation, notifications) will still execute.

**Risk Level:** MEDIUM. Could result in a refund + acceptance simultaneously, or a cancellation notification after the driver already accepted.

**Recommendation:**
- Use a conditional UPDATE: `UPDATE ... SET status = 'CONFIRMED' WHERE id = ? AND status = 'DRIVER_PENDING'` and check `count`.
- Alternatively, use a Redis distributed lock keyed on `booking:{id}:transition`.

---

### 2.4 Rating Stats Calculation (LOW RISK)

**The Problem:** Two ratings for the same user submitted simultaneously could calculate stale averages.

**Current Pattern:** Read stats → compute new average → write stats (inside transaction).

Under `READ COMMITTED`, two concurrent rating transactions could read the same `totalRatings` value. Both would compute `totalRatings + 1` and write, resulting in one rating being "lost" from the count.

**Risk Level:** LOW. Ratings are infrequent per user and self-correcting on next rating.

**Recommendation:** Use `increment` for `totalRatings` and `totalStars`, then compute average via a DB trigger or scheduled reconciliation.

---

## 3. Distributed Locking

### 3.1 Current State: NO DISTRIBUTED LOCKS

The application does **not** implement distributed locking (no Redlock, no Redis-based mutex). It relies entirely on:
- PostgreSQL transaction isolation
- Conditional WHERE clauses (optimistic locking)
- BullMQ job ID deduplication

### 3.2 Where Distributed Locks Would Help

| Scenario | Current Risk | Impact |
|----------|-------------|--------|
| Booking state transitions (accept/reject/cancel/deadline) | Two processes could act on same booking | Inconsistent state, double refund |
| Stripe refund + webhook race | Refund initiated + webhook arrives simultaneously | Double credit or orphaned state |
| Socket user tracking across instances | Eventual consistency via Redis SET | Minimal (self-healing via TTL) |

### 3.3 Recommendation

Implement a lightweight distributed lock for **booking state transitions only**:

```typescript
// Pseudocode
const lockKey = `lock:booking:${bookingId}`;
const acquired = await redis.set(lockKey, instanceId, 'NX', 'PX', 5000);
if (!acquired) throw new ConflictError('Booking is being modified');
try {
  // perform state transition
} finally {
  await redis.del(lockKey); // or use Lua script for safe release
}
```

This prevents the driver-decision/deadline race and double-refund scenarios.

---

## 4. Database Scaling & Locking

### 4.1 Connection Pooling

```typescript
// src/config/prisma.ts
connection_limit: DB_POOL_MAX || 25
pool_timeout: 5 (seconds)
idle_timeout: 30 (seconds)
statement_timeout: 30 (seconds)
```

**Concern:** With cluster mode (4 workers) x 25 connections = **100 max connections** per server. If horizontally scaled to N servers, this becomes `N * 100`. PostgreSQL default `max_connections` is 100.

**Recommendation:**
- Use PgBouncer or Supavisor as a connection pooler in front of PostgreSQL.
- Set `DB_POOL_MAX` relative to `max_connections / (num_workers * num_servers)`.

### 4.2 Indexes (WELL COVERED)

The schema has comprehensive indexes on:
- `Ride`: `[status, departureDate]` (search queries)
- `RideBooking`: `[rideId, status]`, `[passengerId, status]`, `[driverDecisionDeadlineAt]`
- `Message`: `[conversationId, receiverId, read]` (unread message queries)

**Missing indexes to consider:**
- `RideBooking(paymentIntentId)` — for webhook lookups by payment intent
- `Ride(driverId, status, departureDate)` — for "my rides" + active filter

### 4.3 No Partitioning or Sharding

**Current state:** Single PostgreSQL instance, no table partitioning.

**When to consider partitioning:**
- `Message` table: Will grow fastest. Partition by `createdAt` (monthly) for efficient old-message cleanup.
- `Notification` table: Already has TTL-based cleanup via maintenance job. Partitioning could make deletes faster (drop partition vs DELETE).
- `Ride` / `RideBooking`: Only if exceeding 10M+ rows.

**Sharding:** Not needed at current scale. If multi-region deployment is planned, consider read replicas first.

### 4.4 Database Locking Behavior

**Current isolation level:** PostgreSQL default `READ COMMITTED`.

| Operation | Lock Type | Duration |
|-----------|-----------|----------|
| `ride.updateMany` (seat decrement) | Row-level exclusive | Transaction duration |
| `rideBooking.create` | Row-level exclusive (new row) | Transaction duration |
| `rideBooking.update` (status change) | Row-level exclusive | Transaction duration |
| Read queries | No lock (MVCC snapshot) | Instant |

**Hot Row Concern:** A popular ride with many simultaneous bookings will serialize on the `ride` row (all trying to decrement `availableSeats`). Under high load, this causes increased latency but NOT incorrectness.

**Recommendation for hot rides:** If a single ride gets 50+ concurrent booking attempts, consider a **seat reservation queue** pattern where bookings are serialized through BullMQ rather than competing on the same DB row.

---

## 5. Caching Strategy

### 5.1 Current Cache Keys & TTLs

| Key Pattern | TTL | Purpose | Invalidation |
|-------------|-----|---------|--------------|
| `user:{id}` | 5min | User profile | On update |
| `user:{id}:profile` | 5min | Extended profile | On update |
| `user:{id}:public-profile` | 5min | Public view | On update |
| `vehicle:{id}` | 5min | Vehicle data | On update |
| `user:{id}:vehicles` | 5min | User's vehicles list | On CRUD |
| `vehicleDraft:{userId}` | 5min | Draft vehicle | On save/discard |
| `unread:{userId}` | 60s | Notification count | On read/create |
| `banned:{userId}` | None (manual) | Ban flag | Admin action |
| `presence:user:{userId}` | 60s | Online status | Heartbeat refresh |
| `sockets:{userId}` | 1hr | Socket IDs | Connect/disconnect |

### 5.2 Cache Concerns

**1. No Cache-Aside for Ride Search Results**
- Every search hits the database directly (plus CPU-heavy polyline decoding).
- High-traffic searches for popular routes could overwhelm the DB.

**Recommendation:** Cache search results by normalized route hash with short TTL (30-60s). Invalidate on ride publish/cancel in that area.

**2. Stale Ban Cache**
- Ban status has no TTL — relies on admin explicitly setting/deleting the key.
- If Redis restarts, banned users regain access until next admin action.

**Recommendation:** Add TTL (e.g., 24h) and re-populate from DB on cache miss in auth middleware.

**3. No Cache Stampede Protection**
- Multiple concurrent requests for the same uncached key will all hit the DB.

**Recommendation:** For hot keys, use a mutex/singleflight pattern:
```typescript
async function getOrSet(key, fetchFn, ttl) {
  let value = await redis.get(key);
  if (value) return JSON.parse(value);
  const lockKey = `lock:cache:${key}`;
  if (await redis.set(lockKey, '1', 'NX', 'PX', 5000)) {
    value = await fetchFn();
    await redis.setex(key, ttl, JSON.stringify(value));
    await redis.del(lockKey);
    return value;
  }
  // Wait and retry
  await sleep(50);
  return getOrSet(key, fetchFn, ttl);
}
```

**4. No Write-Through or Write-Behind**
- Caches are invalidated on writes (delete pattern), not updated.
- This is fine for the current scale but means a brief window of cache misses after every write.

---

## 6. Message Queues & Async Flows

### 6.1 Queue Architecture

| Queue | Concurrency | Retry | Backoff | Purpose |
|-------|-------------|-------|---------|---------|
| `booking-deadline` | 5 | removeOnFail: 1000 | None (delayed job) | Auto-cancel unresponsive bookings |
| `push-notifications` | 10 | 3 attempts | Exponential (2s base) | FCM/APNs delivery |
| `mail-queue` | Separate worker | 3 attempts | Exponential | Email delivery |
| `sms-queue` | Separate worker | Configured per env | Configured | Twilio SMS |
| `route-optimization` | 5 | Default | Default | Google Maps API calls |
| `maintenance` | 1 | removeOnFail: 100 | Cron (02:00 UTC) | Nightly cleanup |

### 6.2 Concerns

**1. No Dead Letter Queue (DLQ)**
- Failed jobs are kept in the failed set (`removeOnFail: 1000` or `5000`).
- No alerting or manual retry mechanism for permanently failed jobs.
- Critical failures (refund failed, payment webhook missed) could go unnoticed.

**Recommendation:** Implement a DLQ pattern with alerting:
```typescript
deadlineWorker.on('failed', (job, err) => {
  if (job.attemptsMade >= job.opts.attempts) {
    alertingService.critical('Deadline job permanently failed', { bookingId: job.data.bookingId, error: err });
  }
});
```

**2. Job Ordering Not Guaranteed**
- BullMQ processes jobs concurrently (concurrency: 5-10).
- For booking deadlines, this is fine (each job is independent).
- For notifications, out-of-order delivery is possible but acceptable.

**3. Queue Backpressure**
- No explicit backpressure mechanism. If push notification service is down, queue will grow unbounded.
- `removeOnFail` limits the failed set size, but active queue can grow.

**Recommendation:** Add queue size monitoring and pause/resume logic:
```typescript
const jobCounts = await pushQueue.getJobCounts();
if (jobCounts.waiting > 10000) {
  logger.warn('Push queue backlog exceeding threshold');
  // Alert ops team
}
```

**4. Exactly-Once Processing**
- BullMQ guarantees at-least-once delivery. If a worker crashes mid-processing, the job will be retried.
- For deadline jobs: the handler checks booking status before acting (idempotent).
- For push notifications: duplicate push is acceptable (user sees notification twice).
- For refunds: Stripe idempotency key prevents double-refund.

**Assessment:** Current idempotency handling is adequate.

---

## 7. Consistency Issues

### 7.1 Eventual Consistency Points

| Operation | Consistency Model | Window | Impact |
|-----------|------------------|--------|--------|
| Unread notification count | Eventual (60s TTL) | 0-60s | Minor UX issue |
| User online presence | Eventual (60s TTL) | 0-60s | Minor UX issue |
| Ban enforcement | Strong (checked every request) | 0ms | None |
| Seat availability in search results | Strong (DB query) | 0ms | None |
| Socket mapping cleanup | Eventual (1hr TTL) | 0-3600s | Orphaned socket refs |
| Rating averages | Eventual (concurrent writes) | Transaction duration | Negligible |

### 7.2 Critical Consistency Gaps

**1. Payment Status vs. Booking Status**

```
Timeline:
  T0: Booking created (PAYMENT_PENDING)
  T1: Stripe charges card (async)
  T2: Webhook arrives: payment_intent.succeeded
  T3: Booking moves to DRIVER_PENDING
```

**Gap:** Between T1 and T2 (webhook delay), the booking is in `PAYMENT_PENDING`. If the user refreshes, they see "payment pending" even though Stripe has charged them.

**Current mitigation:** Frontend polls or uses client-side Stripe SDK confirmation.

**Concern:** If webhook delivery fails or is delayed (Stripe retries for up to 72h), booking stays in `PAYMENT_PENDING` indefinitely.

**Recommendation:** Add a reconciliation job that checks `PAYMENT_PENDING` bookings older than 15 minutes against Stripe API.

---

**2. Seat Count vs. Actual Active Bookings**

The `availableSeats` field is denormalized (decremented/incremented on booking/cancel). If any code path fails to properly adjust seats (crash between booking creation and seat update), the count drifts.

**Current mitigation:** Both operations are in the same transaction, so they succeed or fail atomically.

**Remaining risk:** Manual admin interventions or direct DB edits could desync.

**Recommendation:** Add a periodic reconciliation:
```sql
UPDATE "Ride" r SET "availableSeats" = r."totalSeats" - (
  SELECT COALESCE(SUM(rb."seatsBooked"), 0)
  FROM "RideBooking" rb
  WHERE rb."rideId" = r.id AND rb.status IN ('PAYMENT_PENDING','DRIVER_PENDING','CONFIRMED','IN_PROGRESS')
);
```

---

**3. Refund Amount vs. Actual Stripe Refund**

Refund is initiated inside a DB transaction, but the Stripe API call is external. Possible scenarios:
- DB updates succeed, Stripe call fails → booking marked cancelled but money not returned.
- DB updates succeed, Stripe call succeeds, but response times out → booking in ambiguous state.

**Current mitigation:** Stripe webhooks (`charge.refunded`) update refund metadata.

**Recommendation:** Track refund state explicitly:
- `refundStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED'`
- Reconciliation job for `refundStatus = 'PENDING'` older than 10 minutes.

---

### 7.3 Split-Brain Scenarios

With multiple cluster workers and no distributed consensus:
- Two workers could process the same Stripe webhook (mitigated by unique constraint on `stripeEventId`).
- Two deadline jobs for the same booking could fire (mitigated by BullMQ `jobId` deduplication).

**Assessment:** The current approach is sound for single-server deployment. For multi-server deployment, BullMQ's Redis-backed coordination handles job deduplication correctly.

---

## 8. Scaling & Throughput

### 8.1 Current Bottlenecks

| Component | Bottleneck | Limit | Mitigation |
|-----------|-----------|-------|------------|
| Ride search | Polyline decoding CPU | ~20 req/s per core | Rate limit (20/min), backlog item COST-6 |
| PostgreSQL connections | Pool exhaustion | 25 per worker | PgBouncer |
| Redis (single instance) | Memory + ops/sec | ~100K ops/s | Redis Cluster (if needed) |
| Google Routes API | External rate limit | Quota-based | Circuit breaker + route queue |
| Stripe API | External rate limit | 100 req/s | Idempotency keys |
| Socket.IO | Per-connection memory | ~10K concurrent | Horizontal scaling via Redis adapter |

### 8.2 Horizontal Scaling Readiness

| Component | Ready? | Notes |
|-----------|--------|-------|
| Express API | YES | Stateless, cluster mode |
| Socket.IO | YES | Redis adapter handles cross-instance |
| BullMQ workers | YES | Shared Redis, distributed by design |
| Rate limiting | YES | Redis-backed store |
| Session/auth | YES | JWT (stateless), ban check via Redis |
| File uploads | PARTIAL | Depends on storage backend (not analyzed) |
| Cron/scheduled jobs | YES | BullMQ repeatable jobs (single execution guaranteed) |

### 8.3 Vertical Scaling Limits

- **Node.js single-thread:** CPU-bound operations (polyline decoding, bcrypt) block the event loop. Cluster mode helps but each worker is still single-threaded.
- **PostgreSQL:** Single primary for writes. Read replicas can offload search queries.
- **Redis:** Single instance. If ops/sec exceeds capacity, need Redis Cluster.

### 8.4 Throughput Estimates

Assuming 4-worker cluster on a 4-core machine:

| Operation | Est. Throughput | Limiting Factor |
|-----------|----------------|-----------------|
| Ride search | 80/min (rate-limited to 20/min/user) | CPU (polyline) |
| Booking creation | 200/min | DB transaction serialization on hot rides |
| Chat messages | 1000/min | Redis + DB writes |
| Notifications | 2000/min | BullMQ worker throughput |
| Socket connections | ~10K concurrent | Memory (per-connection overhead) |

---

## 9. Redis Architecture

### 9.1 Current Setup: Single Redis Instance

All subsystems share one Redis instance:
- Cache (profiles, vehicles, unread counts)
- Pub/Sub (Socket.IO adapter)
- Queues (BullMQ: deadline, push, mail, SMS, maintenance, route)
- Rate limiting
- Socket tracking
- Presence

### 9.2 Concerns

**1. Single Point of Failure**
- Redis down = rate limiting fails open (by design), but:
  - Socket.IO cross-instance messaging breaks
  - BullMQ workers stall
  - Presence tracking fails
  - Ban checks fail (users could access while banned)

**Recommendation:** Redis Sentinel (HA) or Redis Cluster for production.

**2. Memory Pressure**
- BullMQ stores job data in Redis. High-volume queues (push notifications) could accumulate.
- `removeOnComplete: 1000` means up to 1000 completed jobs retained per queue.

**Recommendation:** Monitor Redis memory. Set `maxmemory-policy` to `noeviction` (BullMQ requires this). Alert at 80% capacity.

**3. Pub/Sub Scalability**
- Socket.IO Redis adapter publishes every event to all instances. With many instances, this creates O(N) fan-out.
- At <10 instances, this is fine. Beyond that, consider Socket.IO with Redis Streams adapter or dedicated pub/sub (e.g., NATS).

**4. Key Namespace Collision**
- No global prefix. Keys from different subsystems could theoretically collide.
- Example: if a user ID happens to match a queue name, unlikely but possible.

**Recommendation:** Use prefixes: `cache:`, `socket:`, `presence:`, `rl:`, `bull:` (BullMQ already prefixes).

### 9.3 Redis Cluster Migration Path

If scaling beyond single Redis:

1. **Phase 1:** Redis Sentinel (automatic failover, same API)
2. **Phase 2:** Separate Redis instances per concern:
   - Redis A: Cache + rate limiting (can tolerate data loss)
   - Redis B: BullMQ queues (persistent, AOF enabled)
   - Redis C: Socket.IO pub/sub (ephemeral)
3. **Phase 3:** Redis Cluster (if single instance can't handle ops/sec)

---

## 10. Real-time & Socket.IO

### 10.1 Architecture

```
Client → Socket.IO → JWT Auth → Redis Socket Tracking → Event Handlers
                                       ↓
                              Redis Pub/Sub Adapter
                                       ↓
                              All Server Instances
```

### 10.2 Multi-Device Support

- User can connect from multiple devices simultaneously.
- `sockets:{userId}` is a Redis SET containing all active socket IDs.
- Events emitted to ALL sockets of a user: `for (const sid of socketIds) io.to(sid).emit(...)`.

### 10.3 Concerns

**1. Socket Leak on Ungraceful Disconnect**
- If a client disconnects without triggering the `disconnect` event (network failure, process crash), the socket ID remains in Redis until TTL expiry (1 hour).
- During this window, the server will attempt to emit to a dead socket (no-op via Redis adapter, but wasted work).

**Recommendation:** Reduce socket TTL to 5-10 minutes. Rely on presence heartbeat (60s) for actual online status.

**2. Message Ordering**
- Chat messages are emitted directly on `chat:send` event.
- If two messages are sent rapidly, they arrive in order on the same connection but could be reordered across reconnections.

**Current mitigation:** Messages have timestamps and `clientMsgId`. Frontend should sort by timestamp.

**3. Reconnection & Offline Sync**
- `chat:sync` event on reconnect fetches last 100 messages.
- If user was offline for a long time with >100 messages, older ones are lost from sync.

**Recommendation:** Use cursor-based pagination for sync (send last seen message ID, fetch everything after).

**4. No Room-Based Architecture**
- Events are sent to individual socket IDs, not Socket.IO rooms.
- For 1:1 chat this is fine. If group features are added, rooms would be more efficient.

---

## 11. Notifications & Delivery Guarantees

### 11.1 Delivery Flow

```
Event Occurs → createNotification()
                    ↓
            Save to DB (persistent record)
                    ↓
            Check user online? ─── YES → WebSocket emit (immediate)
                    |
                    NO
                    ↓
            Enqueue to push-notifications queue
                    ↓
            BullMQ Worker → Firebase FCM / APNs
                    ↓
            Multi-device multicast
```

### 11.2 Delivery Guarantees

| Channel | Guarantee | Failure Mode |
|---------|-----------|--------------|
| Database record | Durable | DB down = notification lost |
| WebSocket | At-most-once | Socket dead = missed (no retry) |
| Push (FCM) | At-least-once | 3 retries with backoff |
| Email | At-least-once | 3 retries with backoff |
| SMS | At-least-once | Configured retries |

### 11.3 Concerns

**1. WebSocket Delivery Without Acknowledgement**
- Server emits `notification:new` but doesn't verify client received it.
- If emit happens during a brief disconnect, notification is lost from real-time channel.
- DB record exists, so user sees it on next page load, but misses the real-time alert.

**Recommendation:** For critical notifications (booking accepted/rejected, payment), implement client-side ACK with server-side retry:
```typescript
io.to(sid).emit('notification:new', payload, (ack) => {
  if (!ack) enqueueRetry(userId, payload);
});
```

**2. Push Notification Token Staleness**
- Device tokens can become invalid (app uninstall, token refresh).
- Current handling: removes invalid tokens on FCM error response.
- No proactive token refresh mechanism.

**3. No Notification Priority Levels**
- All notifications go through the same pipeline.
- A "booking accepted" notification has the same priority as a "new chat message."

**Recommendation:** Add priority levels to the push queue for critical vs. informational notifications.

---

## 12. Security Concerns

### 12.1 Authentication & Authorization

| Aspect | Implementation | Concern |
|--------|---------------|---------|
| JWT Access Token | 30-day expiry | Very long-lived; if stolen, attacker has 30 days |
| JWT Refresh Token | 1-year expiry, DB-backed revocation | Good revocation support |
| Ban check | Every request via Redis | Fast, but no TTL = stale if Redis restarts |
| Role-based access | `authorize(...roles)` middleware | Good |
| Socket auth | JWT in handshake | Good |

**Recommendation:** Reduce access token expiry to 15-60 minutes. Use refresh token rotation.

### 12.2 Rate Limiting

| Endpoint | Limit | Concern |
|----------|-------|---------|
| General API | 100/min | Per-IP; doesn't account for authenticated user |
| OTP | 5/15min | Good, prevents brute force |
| Search | 20/min | Good, protects CPU |
| Booking | 10/min | Good, prevents spam |

**Concern:** Rate limiting is IP-based. Behind a shared NAT or proxy, legitimate users could be rate-limited together.

**Recommendation:** Use composite key (IP + userId for authenticated routes).

### 12.3 Input Validation

- Zod schemas on all endpoints (body, params, query).
- `.strict()` on sensitive endpoints.
- JSON body limit: 50KB.

**Assessment:** Good. No SQL injection risk (Prisma ORM). XSS mitigated by not rendering user input as HTML.

### 12.4 Webhook Security

- Stripe webhook signature verification via `stripe.webhooks.constructEvent()`.
- Raw body parsing before JSON middleware.
- Event deduplication via unique constraint on `stripeEventId`.

**Assessment:** Solid implementation.

---

## 13. Payment System Reliability

### 13.1 Payment Flow

```
Booking Created → Payment Intent (Stripe) → Client Confirms → Webhook → Status Update
       ↓                                                          ↓
  PAYMENT_PENDING                                          DRIVER_PENDING
       ↓                                                          ↓
  (if PI fails)                                          Deadline Timer Starts
  PAYMENT_FAILED + seat release
```

### 13.2 Idempotency

| Operation | Idempotency Key | Mechanism |
|-----------|----------------|-----------|
| Payment Intent creation | `booking-payment-intent:{bookingId}` | Stripe idempotency |
| Webhook processing | `stripeEventId` unique constraint | DB constraint |
| Refund | Stripe handles via PI reference | Stripe-native |

### 13.3 Failure Scenarios & Handling

| Scenario | Current Handling | Gap |
|----------|-----------------|-----|
| PI creation fails | Mark PAYMENT_FAILED, release seats | None |
| Webhook never arrives | Booking stays PAYMENT_PENDING forever | **CRITICAL** |
| Refund API call fails mid-transaction | Transaction rolls back | Booking not cancelled, user retries |
| Double webhook delivery | Unique constraint catches duplicate | None |
| Stripe outage during refund | Exception thrown, transaction rolls back | User stuck in non-refunded state |

**Critical Gap:** No reconciliation for stuck `PAYMENT_PENDING` bookings.

**Recommendation:**
```typescript
// Add to maintenance queue or separate job
const stuckBookings = await prisma.rideBooking.findMany({
  where: {
    status: 'PAYMENT_PENDING',
    createdAt: { lt: subMinutes(new Date(), 30) },
  },
});
for (const booking of stuckBookings) {
  const pi = await stripe.paymentIntents.retrieve(booking.paymentIntentId);
  if (pi.status === 'succeeded') await moveToDriverPending(booking);
  else if (pi.status === 'canceled' || pi.status === 'requires_payment_method') {
    await markPaymentFailed(booking);
  }
}
```

### 13.4 Stripe Connect Concerns

- Platform fee calculation: `PLATFORM_FEE_PERCENT * amount`.
- Transfer to driver's connected account via `transfer_data`.
- If driver's Stripe account gets restricted/closed after payment: funds held by Stripe, no automatic re-routing.

**Recommendation:** Monitor `account.updated` webhooks for connected account status changes.

---

## 14. Recommendations Summary

### Priority 1: Critical (Data Integrity / Money)

| # | Issue | Recommendation | Effort |
|---|-------|---------------|--------|
| 1 | Stuck PAYMENT_PENDING bookings | Add reconciliation job (check Stripe API) | 2-4h |
| 2 | Duplicate booking race condition | Add partial unique index on (rideId, passengerId) for active statuses | 1h |
| 3 | Driver decision + deadline race | Add conditional UPDATE with status check (return count) | 2h |
| 4 | Refund failure leaves booking in limbo | Track refundStatus explicitly, add reconciliation | 4h |
| 5 | Redis SPOF | Deploy Redis Sentinel for HA | 4-8h ops |

### Priority 2: High (Reliability / Scale)

| # | Issue | Recommendation | Effort |
|---|-------|---------------|--------|
| 6 | No DLQ / alerting for failed jobs | Add monitoring + alerting on BullMQ failures | 2-4h |
| 7 | Connection pool exhaustion risk | Add PgBouncer, tune pool sizes | 4h ops |
| 8 | Access token 30-day expiry | Reduce to 15-60 min, rely on refresh flow | 2h |
| 9 | Ban cache no TTL | Add 24h TTL, populate on cache miss | 1h |
| 10 | Queue backpressure monitoring | Add queue depth alerts | 2h |

### Priority 3: Medium (Performance / UX)

| # | Issue | Recommendation | Effort |
|---|-------|---------------|--------|
| 11 | Search hits DB every time | Cache search results by route hash (30-60s TTL) | 4h |
| 12 | Cache stampede on hot keys | Implement singleflight/mutex pattern | 2h |
| 13 | Socket leak (1hr TTL too long) | Reduce to 5-10min, rely on presence heartbeat | 1h |
| 14 | Chat sync limited to 100 messages | Cursor-based sync with last-seen ID | 2h |
| 15 | Seat count drift possibility | Nightly reconciliation query | 1h |

### Priority 4: Low (Future-Proofing)

| # | Issue | Recommendation | Effort |
|---|-------|---------------|--------|
| 16 | Single Redis for all concerns | Separate Redis instances per concern | 1d ops |
| 17 | No table partitioning | Partition Message/Notification by month | 1d |
| 18 | Polyline CPU cost (COST-6) | Pre-compute scores on ride publish | 1-2d |
| 19 | Rate limit IP-only | Composite key (IP + userId) | 2h |
| 20 | No read replicas | Add PG read replica for search/list queries | 1d ops |

---

## Appendix: Architecture Decision Records

### ADR-1: Optimistic Locking over Pessimistic Locking
**Decision:** Use conditional WHERE clauses instead of SELECT FOR UPDATE.
**Rationale:** Simpler, less deadlock-prone, sufficient for current concurrency levels.
**Trade-off:** Under extreme contention, more transaction retries needed.

### ADR-2: BullMQ over node-cron
**Decision:** Migrated deadline timers from node-cron to BullMQ delayed jobs.
**Rationale:** BullMQ survives server restarts, supports multi-instance, has built-in retry.
**Trade-off:** Redis dependency; if Redis is down, deadlines don't fire.

### ADR-3: Redis Adapter for Socket.IO
**Decision:** Use @socket.io/redis-adapter for horizontal scaling.
**Rationale:** Enables multi-instance deployment without sticky sessions.
**Trade-off:** All events published to all instances (O(N) fan-out).

### ADR-4: Fail-Open Rate Limiting
**Decision:** If Redis is unavailable, allow the request through.
**Rationale:** Availability over security; rate limiting is defense-in-depth, not primary auth.
**Trade-off:** During Redis outage, no rate limiting protection.

### ADR-5: Event-Driven Notifications with Push Fallback
**Decision:** Try WebSocket first, fall back to push notification queue.
**Rationale:** Instant delivery when online, reliable delivery when offline.
**Trade-off:** If socket appears connected but is actually dead, notification delayed until push retry.
