# Production Readiness Assessment & Fix Plan

CTO-level review of all issues that must be addressed before launching to real users.

---

## Quick Summary

| Category | Count | Launch Blocker |
|---|---|---|
| Will break in production | 6 | YES |
| Security vulnerabilities | 6 | YES |
| Cost drivers | 6 | No (but will hurt fast) |
| Missing features | 8 | Most of them |

---

## Priority Matrix

| Priority | Issue | Category |
|---|---|---|
| P0 | `BOOKING_PAYMENT_MODE=bypass` is the default | Config |
| P0 | OTP stored in plaintext in Notifications table | Security |
| P0 | No driver payout / Stripe Connect | Missing Feature |
| P0 | Seat overbooking race condition | Data Integrity |
| P0 | Refund issued before DB write — double refund risk | Data Integrity |
| P0 | Cron runs in web process — double cancellations on multi-instance | Infra |
| P1 | No cascade cancellation when driver cancels a ride | Missing Feature |
| P1 | In-memory socket map breaks on multi-instance deployment | Infra |
| P1 | Rate limiter defined but never applied | Security |
| P1 | Ride and booking completion flow is missing | Missing Feature |
| P1 | Google Maps API — zero caching (major cost driver) | Cost |
| P1 | No admin APIs | Missing Feature |
| P2 | CORS completely open | Security |
| P2 | No Terms of Service acceptance tracking | Legal |
| P2 | Driver DL verification not enforced before publishing rides | Business Logic |
| P2 | Notifications table grows unboundedly | Cost |
| P2 | Stale FCM device tokens never cleaned up | Cost |
| P3 | No user reporting or blocking | Safety |
| P3 | No service fee model | Revenue |
| P3 | No femaleOnly booking enforcement | Business Logic |

---

## The Single Most Important Thing

**Do not launch with `BOOKING_PAYMENT_MODE=bypass`.**

`.env.example` defaults to `bypass`. If anyone deploys without explicitly setting this to `stripe`,
the entire payment system is silently skipped. Real rides will be booked, real drivers notified,
and no money will be collected. This is a financial zero-day in the default config.

---

---

# CATEGORY 1: Will Break in Production

---

## BRK-1: `datasource db` Has No URL Field

**File:** `prisma/schema.prisma:5`

**Problem:**
```prisma
datasource db {
  provider = "postgresql"
  // url is MISSING
}
```
Standard Prisma requires `url = env("DATABASE_URL")` in the schema. Without it, Prisma
cannot connect to the database in production.

**Fix:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Effort:** 5 minutes. Run `prisma generate` after.

---

## BRK-2: In-Memory Socket Map Breaks on Multi-Instance Deployment

**File:** `src/socket/index.ts:13`

**Problem:**
```typescript
const userSockets = new Map<string, Set<string>>(); // lives in process RAM only
```
You have the Redis Socket.IO adapter configured (correct for broadcasting), but
`getUserSocketIds()` queries this in-process Map, not Redis. Result:

- User A connects to Server 1
- User B sends a message via Server 2
- Server 2 calls `getUserSocketIds(userA)` → returns `[]`
- Message never delivered in real-time
- Push notification sent unnecessarily, charging you FCM costs

This affects both chat delivery and notification delivery. Every notification falls back
to FCM push even when the user is online, on any multi-instance setup.

**Fix:**
Replace the in-process Map with Redis-backed presence tracking. When a socket connects,
write `userId -> socketId` to Redis with a TTL. `getUserSocketIds()` reads from Redis.
The `PresenceService` is already partially doing this — consolidate it.

```typescript
// On connect:
await redis.sadd(`sockets:${userId}`, socketId);
await redis.expire(`sockets:${userId}`, 3600);

// getUserSocketIds:
return redis.smembers(`sockets:${userId}`);

// On disconnect:
await redis.srem(`sockets:${userId}`, socketId);
```

**Effort:** 1 day.

---

## BRK-3: Seat Overbooking Race Condition

**File:** `src/modules/ride-booking/ride-booking.service.ts:398`

**Problem:**
Two passengers requesting the last seat simultaneously:
1. Both transactions read `availableSeats = 1`
2. Both pass the `seatsBooked <= availableSeats` validation
3. Both create a booking
4. Both decrement `availableSeats` → goes to `-1`

There is no database-level lock or constraint preventing this.

**Fix — Two layers required:**

Layer 1 — DB constraint (prevents negative seats at data level):
```sql
ALTER TABLE "Ride" ADD CONSTRAINT chk_available_seats_non_negative
  CHECK ("availableSeats" >= 0);
```

Layer 2 — Atomic update in the transaction (prevents the race):
```typescript
// Replace the separate read-validate-decrement with an atomic conditional update
const updated = await tx.ride.updateMany({
  where: {
    id: rideId,
    availableSeats: { gte: seatsBooked },
    status: RideStatus.PUBLISHED,
  },
  data: {
    availableSeats: { decrement: seatsBooked },
  },
});

if (updated.count === 0) {
  throw new Error('INSUFFICIENT_SEATS'); // lost the race
}
```

**Effort:** Half day.

---

## BRK-4: Refund Before DB Write — Double Refund Risk

**File:** `src/modules/ride-booking/ride-booking.service.ts:791`

**Problem:**
```typescript
// Step 1: Issue Stripe refund — SUCCEEDS
await refundPaymentIntent(booking.stripePaymentIntentId, ...);

// Step 2: Write cancellation to DB — FAILS (timeout, network error)
await prisma.$transaction(async (tx) => { ... }); // throws
```
If step 2 fails, the booking remains `CONFIRMED` in the DB. The passenger got a refund.
The next cancellation attempt issues another refund — double refund.

**Fix:**
Use an outbox/saga pattern. Write a `CANCELLATION_PENDING` state to the DB first,
then issue the refund, then write `CANCELLED`. If any step fails, a background job
reconciles by checking `CANCELLATION_PENDING` bookings against Stripe refund status.

At minimum: move the Stripe refund call inside the DB transaction as the last operation,
so that DB failure prevents the refund call, not the other way around.

**Effort:** 1 day.

---

## BRK-5: Cron in Web Process — Double Cancellations on Multi-Instance

**File:** `src/jobs/booking-deadline-checker.job.ts`, `src/app.ts:62`

**Problem:**
`startBookingDeadlineChecker()` is called in `app.ts`. It runs inside every web server
process. With 2 PM2 instances:
- Every minute, both instances run `checkExpiredDeadlines()`
- The same booking is cancelled twice
- Two Stripe refunds issued for the same booking
- Two notifications sent to the passenger

**Fix:**
Move to a BullMQ delayed job. When a booking reaches `DRIVER_PENDING` status,
enqueue a job with a delay equal to `DRIVER_DECISION_WINDOW_MS`. BullMQ with a single
worker process guarantees exactly-once execution regardless of how many web server
instances are running.

```typescript
// When booking is created with DRIVER_PENDING status:
await bookingDeadlineQueue.add('check-deadline', { bookingId }, {
  delay: DRIVER_DECISION_WINDOW_MS,
  jobId: `deadline-${bookingId}`, // idempotency key
});
```

Remove `startBookingDeadlineChecker()` from `app.ts` entirely.

**Effort:** 1 day.

---

## BRK-6: OTP Stored in Plaintext in Notifications Table

**File:** `src/modules\driver-booking\driver-booking.service.ts` (accept flow),
`src/modules/ride-booking/ride-booking.service.ts:902`

**Problem:**
When a driver accepts a booking, the OTP is sent in the notification payload:
```typescript
data: { pickupOtp: plainOtp, dropOtp: plainDropOtp }
```
This plaintext OTP is permanently stored in the `Notification.data` JSON column.

Then to show the passenger their OTP, the code queries this notification:
```typescript
const notification = await prisma.notification.findFirst({
  where: { type: 'booking.driver.accepted' }
});
const pickupOtp = notification.data.pickupOtp; // plaintext from DB
```

The OTP hash is correctly stored in `pickupOtpHash` but the plaintext OTP is also
stored forever. Anyone with DB read access can retrieve all OTPs for all bookings.

**Fix:**
- Never put the plaintext OTP in the notification data
- Store OTPs directly on the `RideBooking` model as `pickupOtp` and `dropOtp` fields
  (separate from the hash — readable by the passenger, not used for verification)
- Or: derive a one-time readable OTP from the hash using a reversible cipher keyed
  per-booking, so the DB stores only the encrypted form
- Remove the notification query hack in `getBookingById`; read OTPs from `RideBooking` directly

**Effort:** Half day.

---

---

# CATEGORY 2: Security Vulnerabilities

---

## SEC-1: Rate Limiter Never Applied

**File:** `src/middlewares/rateLimit.ts` (defined), `src/app.ts` (never imported)

**Problem:**
The rate limiter exists as dead code. OTP endpoints are completely unprotected.
An attacker can:
- Enumerate valid phone numbers by calling `/auth/signup` in bulk
- Brute-force OTP codes (6-digit = 1,000,000 attempts, trivially automated)

**Fix:**
Apply rate limiting at two levels:

```typescript
// app.ts — global limiter (100 req/min per IP, already written)
app.use(rateLimiter);

// auth routes — tight limiter on OTP endpoints
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                    // 5 OTP requests per 15 min per IP
  keyGenerator: (req) => req.body?.phone || req.body?.email || req.ip,
});
app.use('/api/v1/auth/request-otp', otpLimiter);
app.use('/api/v1/auth/verify-otp', otpLimiter);
```

**Effort:** 2 hours.

---

## SEC-2: CORS Completely Open

**File:** `src/app.ts:28`, `src/socket/index.ts:55`

**Problem:**
```typescript
app.use(cors());       // accepts any origin
origin: '*'            // Socket.IO same
```
Any website can make credentialed requests to your API from a user's browser.

**Fix:**
```typescript
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? [];
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
```

**Effort:** 1 hour.

---

## SEC-3: No Request Body Size Limit

**File:** `src/app.ts:36`

**Problem:**
```typescript
app.use(express.json()); // no size limit
```
A malicious client can send large JSON payloads to exhaust the parser.

**Fix:**
```typescript
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
```

**Effort:** 5 minutes.

---

## SEC-4: Driver Verification Not Enforced Before Publishing Rides

**File:** `src/modules/publish-ride/publish-ride.service.ts`

**Problem:**
`User.dlVerified` defaults to `false`. There is no check in the publish-ride service
that prevents an unverified driver from publishing and accepting rides immediately.

**Fix:**
Add a guard at the start of the publish ride and accept booking services:
```typescript
const user = await prisma.user.findUnique({ where: { id: driverId } });
if (!user?.dlVerified) {
  throw new Error('DRIVER_NOT_VERIFIED');
}
```

**Effort:** 2 hours.

---

## SEC-5: `femaleOnly` Rides Not Enforced at Booking Level

**File:** `src/modules/ride-booking/ride-booking.service.ts` (createBooking)

**Problem:**
The `femaleOnly` flag is filterable in search but not enforced when a booking is created.
A male user (salutation MR) can still book a female-only ride by calling the booking
endpoint directly, bypassing the search filter.

**Fix:**
In `createBooking`, check:
```typescript
if (ride.femaleOnly) {
  const passenger = await tx.user.findUnique({ where: { id: passengerId } });
  if (!passenger?.salutation || !['MS', 'MRS', 'MX'].includes(passenger.salutation)) {
    throw new Error('FEMALE_ONLY_RIDE');
  }
}
```

**Effort:** 2 hours.

---

## SEC-6: `@ts-ignore` on Active DB Queries — Schema Drift Risk

**File:** `src/modules/ride-booking/ride-booking.service.ts:874, :969`

**Problem:**
```typescript
// @ts-ignore - vehicle relation exists in schema but Prisma types not updated
vehicle: { select: { ... } }
```
TypeScript is bypassed on a live Prisma query. Any schema rename or removal will fail
at runtime, not compile time.

**Fix:**
Run `prisma generate` to sync the client types, then remove all `@ts-ignore` comments.
The schema shows `Vehicle` is related to `Ride` via `vehicleId` — the relation should
already be generated. If it isn't, check the `Ride` model relation definition.

**Effort:** 1 hour.

---

---

# CATEGORY 3: Cost Drivers

---

## COST-1: Google Maps API — Zero Caching

**File:** `src/modules/maps/google.service.ts`, `src/modules/search-ride/search-ride.service.ts`

**Problem:**
Every search request triggers Google Directions/Routes API calls. The same
London → Manchester route is fetched hundreds of times daily.

Google Maps Routes API pricing: ~$10 per 1,000 requests.
At 5,000 daily searches on 10 popular routes = ~50,000 API calls = **$500/day**
for data that could be cached for near zero cost.

**Fix:**
Cache route data by `(origin_place_id, destination_place_id)` in Redis with a 24h TTL:
```typescript
const cacheKey = `route:${originPlaceId}:${destPlaceId}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

const route = await googleMapsClient.directions(...);
await redis.setex(cacheKey, 86400, JSON.stringify(route));
return route;
```

**Effort:** Half day.

---

## COST-2: Search Loads All Bookings for Every Ride

**File:** `src/modules/search-ride/search-ride.service.ts:266`

**Problem:**
```typescript
prisma.ride.findMany({
  include: {
    bookings: bookingWithRiderInclude  // ALL bookings for every ride in results
  }
})
```
A ride with 50 bookings loads 50 passenger records per search result.
With 10 rides per page = 500 passenger records loaded per search query.
This grows with ride popularity and will cause timeouts.

**Fix:**
Move booking summary to a separate query or a DB view:
```typescript
// Only load booking count and seat summary, not full passenger details
bookings: {
  where: { status: { in: activeBookingStatuses } },
  select: { seatsBooked: true, passengerId: true },
}
```
Full passenger details should only load when viewing a specific ride detail page,
not in search results.

**Effort:** Half day.

---

## COST-3: Notifications Table Has No Expiry

**File:** `prisma/schema.prisma:480`, `src/modules/notification/notification.service.ts`

**Problem:**
Every action creates a permanent `Notification` row. With 1,000 users getting
10 notifications/day, this is 10,000 rows/day = 3.6M rows/year. Most are never
read again after the first view. Queries slow down as the table grows.

**Fix:**
Add a cleanup job that runs nightly:
```typescript
// Delete read notifications older than 30 days
await prisma.notification.deleteMany({
  where: {
    isRead: true,
    createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  },
});

// Delete all notifications older than 90 days regardless
await prisma.notification.deleteMany({
  where: {
    createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
  },
});
```

**Effort:** 2 hours.

---

## COST-4: Stale FCM Device Tokens Never Cleaned

**File:** `src/services/push.service.ts`

**Problem:**
When users reinstall the app or get a new phone, old device tokens remain in the DB.
Firebase returns `UNREGISTERED` for these tokens. Every push attempt to stale tokens
wastes an FCM API call and DB lookup.

**Fix:**
Handle FCM error responses and remove invalid tokens:
```typescript
const result = await firebase.messaging().sendEachForMulticast(message);
result.responses.forEach((response, index) => {
  if (!response.success) {
    const errorCode = response.error?.code;
    if (errorCode === 'messaging/registration-token-not-registered' ||
        errorCode === 'messaging/invalid-registration-token') {
      // Remove stale token from DB
      prisma.deviceToken.delete({ where: { token: tokens[index] } });
    }
  }
});
```

**Effort:** 2 hours.

---

## COST-5: StripeWebhookEvent Stores Full Payload Forever

**File:** `prisma/schema.prisma:396`

**Problem:**
```prisma
model StripeWebhookEvent {
  payload Json?  // Full Stripe JSON — 5-10KB per event, grows without bound
}
```
At 100 bookings/day = 300+ Stripe events/day × 8KB = 2.4MB/day in Postgres.

**Fix:**
Either drop the `payload` column (the `stripeEventId` + `eventType` is sufficient for
idempotency checks) or add a cleanup job to nullify payloads after 30 days:
```typescript
await prisma.stripeWebhookEvent.updateMany({
  where: { processedAt: { lt: thirtyDaysAgo } },
  data: { payload: Prisma.DbNull },
});
```

**Effort:** 2 hours.

---

## COST-6: Polyline Decoding on Every Search Request (CPU Cost)

**File:** `src/modules/search-ride/polyline.utils.ts` (called in search service)

**Problem:**
The search service decodes route polylines in memory and runs geometric calculations
(Haversine distance, point-on-route checks) for every ride in every search result.
This is CPU-intensive and blocks the Node.js event loop proportionally to the number
of rides returned.

**Fix:**
Pre-compute and store segment match scores when a ride is published, not at search time.
Alternatively, index rides geospatially in Postgres using `PostGIS` and push the
bounding/proximity math to the DB layer where it belongs.

**Effort:** 2 days (PostGIS migration) or 1 day (pre-computation approach).

---

---

# CATEGORY 4: Missing Features — Not Launchable Without These

---

## FEAT-1: No Driver Payout / Stripe Connect (P0)

**Problem:**
The complete payment flow captures money from passengers into your Stripe platform
account. There is no mechanism to pay drivers. You are holding all passenger payments
with no disbursement path.

**Fix:**
Implement Stripe Connect:
1. Onboard drivers as Stripe Connected Accounts (Express accounts are fastest to integrate)
2. When a booking is confirmed, create a Transfer from your platform account to the driver
3. Apply your platform fee as an `application_fee_amount` on the PaymentIntent
4. Add a `stripeAccountId` field to the `User` model for drivers

This is a significant integration but it is the core financial infrastructure of the platform.

**Effort:** 3-5 days.

---

## FEAT-2: No Cascade Cancellation When Driver Cancels a Ride

**Problem:**
`Ride` can be set to `CANCELLED` but there is no code that:
- Finds all `CONFIRMED` / `DRIVER_PENDING` bookings on that ride
- Issues refunds to all passengers
- Notifies all affected passengers

If a driver cancels a ride with 3 confirmed passengers, those passengers are left with
active bookings and no refund.

**Fix:**
Create a `cancelRide` service that:
```typescript
export const cancelRide = async (driverId: string, rideId: string) => {
  // 1. Verify ride belongs to driver and is cancellable
  // 2. Find all active bookings
  // 3. For each booking: issue Stripe refund, update status to CANCELLED
  // 4. Restore available seats
  // 5. Update ride status to CANCELLED
  // 6. Notify all affected passengers
  // All inside a DB transaction with post-commit side effects
};
```

**Effort:** 1 day.

---

## FEAT-3: No Ride Lifecycle Management for Drivers

**Problem:**
`RideStatus` has `IN_PROGRESS` and `COMPLETED` states but there are no endpoints for
a driver to start or end a ride. The booking OTP flow handles individual passenger
pickup/dropoff, but the ride itself has no completion trigger.

**Missing endpoints:**
- `POST /driver/rides/:rideId/start` — transition `PUBLISHED` → `IN_PROGRESS`
- `POST /driver/rides/:rideId/complete` — transition `IN_PROGRESS` → `COMPLETED`

**Effort:** Half day.

---

## FEAT-4: Booking Completion Never Triggered

**Problem:**
There is no process that moves `RideBooking` from `IN_PROGRESS` → `COMPLETED`.
If a passenger leaves without scanning the drop OTP, the booking stays `IN_PROGRESS`
forever. The passenger can never rate the driver. The driver can never rate the passenger.

**Fix:**
When the driver marks a ride as `COMPLETED` (FEAT-3 above):
- Auto-complete all `IN_PROGRESS` bookings on that ride
- Mark unscanned drop OTPs as expired
- Send rating prompts to all passengers and the driver

**Effort:** Half day (depends on FEAT-3).

---

## FEAT-5: No Admin APIs

**Problem:**
There is zero operational visibility or control:
- No way to verify a driver's vehicle is legitimate
- No way to handle a passenger dispute
- No way to ban / suspend a user
- No way to manually trigger a refund outside the cancellation flow
- No platform-level metrics (bookings today, revenue, active rides)

**Fix:**
Minimum viable admin API set:
```
GET  /admin/users?role=driver&verified=false   — review pending driver verifications
POST /admin/users/:id/ban                      — suspend a user
POST /admin/bookings/:id/refund                — manual refund
GET  /admin/stats                              — dashboard metrics
POST /admin/vehicles/:id/verify                — mark vehicle as verified
```
Protect with a separate admin JWT that requires `role=ADMIN` (requires the role
field migration from the migration plan).

**Effort:** 2-3 days.

---

## FEAT-6: No Terms of Service Acceptance Tracking

**Problem:**
No `tosAcceptedAt` or `tosVersion` field on the `User` model. If T&Cs change, there
is no record of who accepted which version. This is a legal requirement for a payments
and transport platform in most jurisdictions (UK, EU, US).

**Fix:**
```prisma
model User {
  tosAcceptedAt      DateTime?
  tosVersion         String?    // e.g. "2026-05-01"
  privacyAcceptedAt  DateTime?
  privacyVersion     String?
}
```
Require acceptance during onboarding. If `tosVersion` is outdated, force re-acceptance
before the user can create or book rides.

**Effort:** Half day (schema + onboarding flow update).

---

## FEAT-7: No User Reporting or Blocking

**Problem:**
No mechanism for:
- A passenger to report a dangerous driver after a ride
- A driver to report a no-show or abusive passenger
- Either party to block the other from future contact

For a transport platform handling strangers sharing vehicles, this is a safety and
legal liability requirement.

**Fix:**
Minimum schema:
```prisma
model UserReport {
  id           String   @id @default(uuid())
  reporterId   String
  reportedId   String
  reason       String   // SAFETY, NO_SHOW, ABUSIVE, FRAUD, OTHER
  description  String?
  bookingId    String?
  createdAt    DateTime @default(now())
}

model UserBlock {
  id          String   @id @default(uuid())
  blockerId   String
  blockedId   String
  createdAt   DateTime @default(now())
  @@unique([blockerId, blockedId])
}
```
Blocks must be checked before allowing a booking between two users.

**Effort:** 1 day.

---

## FEAT-8: No Service Fee / Revenue Model

**Problem:**
```typescript
const serviceFee = 0; // No service fee for now
```
Every Stripe transaction costs you Stripe fees (~1.4% + 20p in the UK) with no revenue
return. The platform earns nothing per booking.

**Fix:**
Define a platform fee (e.g., 10%) and implement it as Stripe's `application_fee_amount`
on the PaymentIntent. This requires Stripe Connect (FEAT-1). The fee is deducted
automatically before funds are transferred to the driver.

**Effort:** 1 hour (after Stripe Connect is implemented).

---

---

# Fix Execution Plan

Ordered by dependency and priority. Each phase should be completed and deployed
before starting the next.

## Phase A — Critical Fixes (Block Launch) — Target: 1 Week

| Task | Issue | Effort |
|---|---|---|
| A1 | Add `url = env("DATABASE_URL")` to prisma.schema | 5 min |
| A2 | Set `BOOKING_PAYMENT_MODE=stripe` as default; add startup validation | 1 hour |
| A3 | Apply rate limiter in app.ts; add strict OTP-specific limiter | 2 hours |
| A4 | Fix seat overbooking with atomic DB update + CHECK constraint | half day |
| A5 | Fix OTP plaintext storage — remove OTP from notification data, read from RideBooking | half day |
| A6 | Fix refund-before-DB-write ordering in cancelBooking | 1 day |
| A7 | Move deadline checker to BullMQ delayed job, remove cron from app.ts | 1 day |
| A8 | Replace in-memory socket map with Redis-backed socket tracking | 1 day |
| A9 | Add cascade cancellation when driver cancels a ride | 1 day |
| A10 | Implement ride start/complete endpoints for drivers | half day |
| A11 | Implement booking auto-completion when ride is completed | half day |

## Phase B — Security & Config — Target: 2-3 Days

| Task | Issue | Effort |
|---|---|---|
| B1 | Lock down CORS to allowed origins via env var | 1 hour |
| B2 | Add request body size limit | 5 min |
| B3 | Enforce DL verification before publishing rides | 2 hours |
| B4 | Enforce femaleOnly at booking creation | 2 hours |
| B5 | Remove all `@ts-ignore` on Prisma queries (run prisma generate) | 1 hour |
| B6 | Add `tosAcceptedAt` + `tosVersion` to User model | half day |

## Phase C — Revenue & Operations — Target: 1 Week

| Task | Issue | Effort |
|---|---|---|
| C1 | Implement Stripe Connect for driver payouts | 3-5 days |
| C2 | Implement service fee as `application_fee_amount` | 1 hour |
| C3 | Build minimum viable admin API (ban, verify, refund, stats) | 2-3 days |
| C4 | Add user reporting and blocking | 1 day |

## Phase D — Cost Controls — Target: 2-3 Days

| Task | Issue | Effort |
|---|---|---|
| D1 | Cache Google Maps routes in Redis (24h TTL) | half day |
| D2 | Reduce search query — remove full booking list from search results | half day |
| D3 | Add notification cleanup job (30d read, 90d all) | 2 hours |
| D4 | Handle FCM stale token cleanup on UNREGISTERED response | 2 hours |
| D5 | Drop or archive StripeWebhookEvent payload after 30 days | 2 hours |

## Phase E — Pre-Launch Legal & Safety — Target: 1 Day

| Task | Issue | Effort |
|---|---|---|
| E1 | Add T&C acceptance gate in onboarding flow | half day |
| E2 | Create privacy policy and link from onboarding | varies |
| E3 | GDPR: add user data export and deletion endpoints | 1 day |

---

## Total Estimated Effort

| Phase | Effort |
|---|---|
| A — Critical fixes | ~6-7 days |
| B — Security & config | ~2 days |
| C — Revenue & operations | ~8-10 days |
| D — Cost controls | ~2 days |
| E — Legal & safety | ~2 days |
| **Total** | **~4-5 weeks with one developer** |

Phase A must be completed before any real user touches the system.
Phases B and D can run in parallel with Phase C.
Phase E has external dependencies (legal review of T&Cs) that may gate it independently.
