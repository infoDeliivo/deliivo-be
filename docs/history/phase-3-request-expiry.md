# Phase 3: Request Expiry & Driver Decision

**Date:** 2026-06-11
**Branch:** `production-readiness-fixes-phase-2`
**Status:** COMPLETE (compiles, 180/182 tests pass — 2 pre-existing failures unrelated)

---

## Summary

Implemented rider-selected response deadlines, booking withdrawal, deadline reminders, manual capture mode support, and driver response metrics.

---

## Changes Made

### 1. Prisma Schema (`prisma/schema.prisma`)

**New fields on `RideBooking`:**

| Field | Type | Purpose |
|-------|------|---------|
| `responseExpiryOption` | `String?` | Rider's selected expiry (ONE_HOUR, THREE_HOURS, etc.) |
| `responseExpiryHours` | `Int?` | Calculated expiry hours stored for reference |
| `captureMethod` | `String?` | Payment capture mode (automatic/manual) |
| `withdrawnAt` | `DateTime?` | When rider withdrew the request |
| `withdrawnReason` | `String?` | Reason for withdrawal |
| `reminderSentAt` | `DateTime?` | When deadline reminder was sent to driver |

---

### 2. Request Expiry Utils: `src/modules/ride-booking/request-expiry.utils.ts`

**Functions:**
- `calculateDeadline(option, departureAt, now)` — Calculates deadline from rider's option, caps at departure time
- `suggestDefaultOption(departureAt, now)` — Suggests best option based on time to departure
- `getAvailableOptions(departureAt, now)` — Returns all options with availability flags

**Options:**
| Option | Hours | Auto-suggestion when |
|--------|-------|---------------------|
| ONE_HOUR | 1 | Departure < 2h away |
| THREE_HOURS | 3 | Departure 2-7h away |
| SIX_HOURS | 6 | Departure 7-13h away |
| TWELVE_HOURS | 12 | Departure 13-25h away |
| TWENTY_FOUR_HOURS | 24 | Departure > 25h away |
| BEFORE_DEPARTURE | dynamic | Departure - 1 hour |

**Business rules:**
- Deadline is always capped at departure time (never expires after ride departs)
- If no option specified, defaults to BEFORE_DEPARTURE behavior

---

### 3. Updated Booking Service (`src/modules/ride-booking/ride-booking.service.ts`)

**Changes to `createBooking`:**
- Accepts `responseExpiryOption` in input
- Calculates deadline using `calculateDeadline()` instead of fixed `DRIVER_DECISION_WINDOW_MS`
- Stores `responseExpiryOption` and `responseExpiryHours` on booking
- Enqueues deadline check using calculated delay (not fixed constant)

**New functions:**
- `withdrawBooking(passengerId, bookingId, reason?)` — Rider withdraws pending request with full refund + seat release
- `getDriverResponseMetrics(driverId)` — Returns acceptance rate, avg response time, total/accepted/rejected/expired counts

---

### 4. Updated Validator (`src/modules/ride-booking/ride-booking.validator.ts`)

- Added `responseExpiryOption` to `createBookingSchema` (enum validation)
- Added `withdrawReasonSchema` for withdraw endpoint

---

### 5. Updated Controller (`src/modules/ride-booking/ride-booking.controller.ts`)

**New handlers:**
- `withdrawBooking` — POST `/:id/withdraw`
- `getDriverResponseMetrics` — GET `/driver/response-metrics`

---

### 6. Updated Routes (`src/modules/ride-booking/ride-booking.routes.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/:id/withdraw` | Rider withdraws pending booking request |
| GET | `/driver/response-metrics` | Driver response metrics |

---

### 7. Deadline Queue Updates (`src/queue/deadline.queue.ts`)

**New job type:** `reminder`
- Fires 1 hour before deadline (if deadline > 1h)
- Sends notification to driver: "A booking request will expire in 1 hour"
- Stored via `reminderSentAt` to prevent duplicates

**Updated `enqueueDeadlineCheck`:**
- Now also enqueues a `reminder` job at `deadline - 1 hour`

---

### 8. Stripe Manual Capture Support (`src/modules/payments/stripe.service.ts`)

**New functions:**
- `capturePaymentIntent(paymentIntentId, amountMinor?)` — Capture authorized payment
- `cancelPaymentIntent(paymentIntentId)` — Release authorization

**Updated:**
- `createBookingPaymentIntent` now accepts `captureMethod` ('automatic' | 'manual')
- `CreatePaymentIntentInput` type updated with optional `captureMethod`

---

## API Endpoints

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/bookings/:id/withdraw` | Withdraw pending booking request |
| GET | `/api/v1/bookings/driver/response-metrics` | Driver acceptance metrics |

### Updated Endpoints

| Method | Path | Change |
|--------|------|--------|
| POST | `/api/v1/bookings` | Now accepts `responseExpiryOption` field |

---

## Integration Tests

**File:** `src/modules/integration/request-expiry.integration.test.ts` — **19 tests**

| Section | Tests | Coverage |
|---------|-------|----------|
| calculateDeadline | 7 | All options, capping, edge cases |
| suggestDefaultOption | 5 | All time-to-departure ranges |
| getAvailableOptions | 3 | Availability filtering |
| Withdraw Booking | 2 | Function exports |
| Manual Capture | 2 | Function exports |

**Run command:**
```bash
npx jest --testPathPattern="request-expiry.integration" --no-coverage --verbose
```

---

## Verification

```bash
# TypeScript compilation: 0 errors
npx tsc --noEmit

# Full test suite: 180/182 pass (2 pre-existing failures unrelated)
npx jest --no-coverage

# Prisma client generated successfully
npx prisma generate
```

---

## Migration Required

Run before deploying:
```bash
npx prisma migrate dev --name request-expiry-phase-3
```

Adds 6 new nullable fields to `RideBooking`.

---

## What's NOT in Phase 3 (deferred)

- Full manual capture integration in webhook handler (needs frontend flow update)
- Auto-capture on driver accept (wire `capturePaymentIntent` in `acceptBooking` when manual mode is active)
- Driver response rate displayed on profile (frontend)
- Push reminder notification to rider about options (frontend UX)
