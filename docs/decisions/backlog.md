# Production Readiness — Remaining Backlog

> All Phase A–E items from `PRODUCTION_READINESS.md` are complete.
> The items below were documented in the assessment but intentionally deferred.
> Updated: 2026-05-25

---

## COST-6: Polyline Decoding CPU Cost (Not in any phase fix plan)

**Reference:** `PRODUCTION_READINESS.md` — COST-6
**Priority:** P2 (performance, not a launch blocker)

**Problem:**
The search service decodes route polylines in memory and runs Haversine distance
calculations + point-on-route checks for every ride in every search result.
This is CPU-intensive and blocks the Node.js event loop proportionally to the
number of rides returned.

**File:** `src/modules/search-ride/search-ride.service.ts` + `polyline.utils.ts`

**Recommended fix options (pick one):**

Option A — Pre-computation (1 day):
- When a ride is published, pre-compute and store segment match scores in the DB
- Search queries sort/filter by the stored score instead of computing at query time

Option B — PostGIS (2 days):
- Enable the PostGIS extension on the PostgreSQL database
- Store ride routes as `GEOMETRY` columns
- Push proximity and bounding-box math into SQL queries
- Eliminates in-process polyline work entirely

**Effort:** 1–2 days depending on approach.

---

## Deferred operational items (post-launch)

These are operational concerns that can be addressed after initial launch
based on observed traffic patterns:

| Item | Description | When to address |
|------|-------------|-----------------|
| Stripe webhook retry deduplication | `StripeWebhookEvent` already stores `stripeEventId` for idempotency, but retry storms from Stripe could still cause race conditions under high load | When processing > 1,000 bookings/day |
| BullMQ worker scaling | deadline.queue.ts and maintenance.queue.ts workers run in the web process. Under high load, move workers to a dedicated process | When job queue depth exceeds 10,000 |
| Read replicas for search | All search queries hit the primary DB. Add a Postgres read replica and point search queries at it | When search p99 latency > 500ms |
| Notification delivery receipts | No tracking of whether push notifications were actually delivered/opened | Post-launch product analytics |
