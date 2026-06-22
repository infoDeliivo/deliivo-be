# Phase A — Critical Fixes — Complete

> Reference: `PRODUCTION_READINESS.md` Phase A
> Date: 2026-05-24

---

## A1 — Prisma datasource missing URL
**File:** `prisma/schema.prisma`
Added `url = env("DATABASE_URL")` to the datasource block.

---

## A2 — BOOKING_PAYMENT_MODE defaults to bypass
**Files:** `.env.example`, `src/modules/ride-booking/booking-payment-mode.ts`
- `.env.example` default changed from `bypass` → `stripe`
- `getBookingPaymentMode()` now throws on startup if the env var is not set

---

## A3 — Rate limiter never applied
**Files:** `src/app.ts`, `src/middlewares/rateLimit.ts`, `src/middlewares/index.ts`
- Global rate limiter applied: 100 req/min per IP
- OTP-specific limiter: 5 req/15 min, applied to `/api/v1/auth/otp/request`, `/otp/resend`, `/otp/verify`
- Body size limit: `50kb` on `express.json()` and `express.urlencoded()`

---

## A4 — Seat overbooking race condition
**Files:** `src/modules/ride-booking/ride-booking.service.ts`, `prisma/migrations/20260524000001_phase_a_fixes/migration.sql`
- Replaced read-validate-decrement with atomic `tx.ride.updateMany({ where: { availableSeats: { gte: seatsBooked } } })`
- Returns `INSUFFICIENT_SEATS` if the race is lost (count === 0)
- DB-level CHECK constraint: `availableSeats >= 0`

---

## A5 — OTP stored in plaintext in notifications
**Files:** `prisma/schema.prisma`, `src/modules/driver-booking/driver-booking.service.ts`, `src/modules/ride-booking/ride-booking.service.ts`, migration SQL
- Added `pickupOtp String?` and `dropOtp String?` fields to the `RideBooking` model
- `acceptBooking()` stores plaintext OTPs on the booking row, not in the notification payload
- `getBookingById()` reads OTPs from the booking directly — the notification table query is removed

> **Action required:** `npx prisma migrate deploy && npx prisma generate`
> After `prisma generate`, remove the `(booking as any)` cast in `getBookingById` and use the typed field directly.

---

## A6 — Refund issued before DB write (double refund risk)
**File:** `src/modules/ride-booking/ride-booking.service.ts` — `cancelBooking()`
Moved `refundPaymentIntent()` inside `prisma.$transaction()` as the last operation. DB writes must succeed before Stripe is charged.

---

## A7 — Cron in web process (double cancellations on multi-instance)
**Files:** `src/queue/deadline.queue.ts` (new), `src/modules/ride-booking/ride-booking.service.ts`, `src/app.ts`
- Created BullMQ queue `booking-deadline` with two job types:
  - `initial` — fires after `DRIVER_DECISION_WINDOW_MS`; notifies rider, re-enqueues `extended` with 1h delay
  - `extended` — fires 1h later; auto-cancels booking inside a transaction, issues refund last
- `createBooking()` enqueues the `initial` job immediately after creating a `DRIVER_PENDING` booking
- Job IDs are deterministic (`deadline:initial:{bookingId}`) for idempotency
- `startBookingDeadlineChecker()` (node-cron) removed from `app.ts`

> `src/jobs/booking-deadline-checker.job.ts` is now dead code and can be deleted.

---

## A8 — In-memory socket map breaks on multi-instance
**Files:** `src/socket/index.ts`, `src/modules/notification/notification.service.ts`
- Replaced `Map<userId, Set<socketId>>` with Redis-backed tracking:
  - `sockets:{userId}` → Redis SET of socketIds (TTL 1h)
  - `socket:{socketId}` → Redis STRING of userId for reverse lookup (TTL 1h)
- `getUserSocketIds()` is now `async` — all call sites updated to `await`

---

## A9 — No cascade cancellation when driver cancels a ride
**File:** `src/modules/publish-ride/publish-ride.service.ts` — `cancelRide()`
- Finds all `DRIVER_PENDING` / `CONFIRMED` bookings on the ride
- Cancels ride + all bookings + issues Stripe refunds inside a single `$transaction`
- Sends `booking.cancelled.driver_cancelled_ride` notification to each affected passenger after the transaction

---

## A10 — No ride start/complete endpoints
**Files:** `src/modules/publish-ride/publish-ride.service.ts`, `publish-ride.controller.ts`, `publish-ride.routes.ts`
- `POST /api/v1/publish-ride/:id/start` — transitions `PUBLISHED → IN_PROGRESS`
- `POST /api/v1/publish-ride/:id/complete` — transitions `IN_PROGRESS → COMPLETED`

---

## A11 — Booking auto-completion when ride is completed
**File:** `src/modules/publish-ride/publish-ride.service.ts` — `completeRide()`
- Auto-completes all `IN_PROGRESS` bookings via `rideBooking.updateMany()`
- Sends `ride.completed` notification with rating deep-link to all affected passengers
