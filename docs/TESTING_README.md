# Testing Guide

## Quick Start

```bash
# Run ALL tests
npx jest --no-coverage

# Run ALL tests with names visible
npx jest --no-coverage --verbose

# Run integration test (full flow: publish → book → driver actions)
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage --verbose
```

---

## Test Files Overview

| # | File | Type | Tests | Flow |
|---|------|------|-------|------|
| 1 | `src/modules/publish-ride/draft-ride.service.test.ts` | Unit | 3 | Publish |
| 2 | `src/modules/publish-ride/stopover-pricing.utils.test.ts` | Unit | 2 | Publish |
| 3 | `src/modules/search-ride/segment-view.utils.test.ts` | Unit | 6 | Search |
| 4 | `src/modules/search-ride/view-token.utils.test.ts` | Unit | 3 | Search |
| 5 | `src/modules/search-ride/search-ride.view.test.ts` | Unit | 4 | Search |
| 6 | `src/modules/search-ride/search-ride.service.test.ts` | Unit | 3 | Search |
| 7 | `src/modules/ride-booking/ride-booking.service.test.ts` | Unit | 4 | Booking |
| 8 | `src/modules/ride-booking/booking-payment-mode.test.ts` | Unit | 5 | Booking |
| 9 | `src/modules/ride-booking/booking-cancellation-policy.test.ts` | Unit | 2 | Booking |
| 10 | `src/modules/driver-booking/driver-booking.service.test.ts` | Unit | 6 | Driver |
| 11 | `src/modules/payments/stripe.webhook.controller.test.ts` | Unit | 3 | Payment |
| 12 | `src/modules/ratings/ratings.service.test.ts` | Unit | 5 | Ratings |
| 13 | `src/modules/ratings/ratings.prisma-contract.test.ts` | Unit | 1 | Ratings |
| 14 | `src/docs/docs.routes.test.ts` | Unit | 4 | API Docs |
| 15 | `src/modules/integration/publish-to-booking.integration.test.ts` | **Integration** | 41 | **Full Flow** |

**Total: 92 tests across 15 suites**

---

## How to Run

### Run everything

```bash
npx jest --no-coverage
```

### Run by file

```bash
# Integration test (recommended to read first)
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage --verbose

# Publish flow
npx jest --testPathPattern="draft-ride.service.test" --no-coverage
npx jest --testPathPattern="stopover-pricing.utils.test" --no-coverage

# Search flow
npx jest --testPathPattern="segment-view.utils.test" --no-coverage
npx jest --testPathPattern="view-token.utils.test" --no-coverage
npx jest --testPathPattern="search-ride.view.test" --no-coverage
npx jest --testPathPattern="search-ride.service.test" --no-coverage

# Booking flow
npx jest --testPathPattern="ride-booking.service.test" --no-coverage
npx jest --testPathPattern="booking-payment-mode.test" --no-coverage
npx jest --testPathPattern="booking-cancellation-policy.test" --no-coverage

# Driver actions
npx jest --testPathPattern="driver-booking.service.test" --no-coverage

# Payments
npx jest --testPathPattern="stripe.webhook.controller.test" --no-coverage

# Ratings
npx jest --testPathPattern="ratings.service.test" --no-coverage
npx jest --testPathPattern="ratings.prisma-contract.test" --no-coverage

# API docs
npx jest --testPathPattern="docs.routes.test" --no-coverage
```

### Run by flow (multiple files)

```bash
# All search-related tests
npx jest --testPathPattern="search-ride" --no-coverage

# All booking-related tests
npx jest --testPathPattern="ride-booking|driver-booking" --no-coverage

# All publish-related tests
npx jest --testPathPattern="publish-ride" --no-coverage

# All ratings tests
npx jest --testPathPattern="ratings" --no-coverage
```

### Run specific test by name (-t flag)

```bash
# Run only tests matching a description
npx jest --testPathPattern="publish-to-booking.integration" -t "Happy Path" --no-coverage
npx jest --testPathPattern="publish-to-booking.integration" -t "Segment Capacity" --no-coverage
npx jest --testPathPattern="publish-to-booking.integration" -t "Pricing edge cases" --no-coverage
npx jest --testPathPattern="publish-to-booking.integration" -t "Booking validation" --no-coverage
npx jest --testPathPattern="publish-to-booking.integration" -t "Driver action" --no-coverage
npx jest --testPathPattern="publish-to-booking.integration" -t "Seat release" --no-coverage
npx jest --testPathPattern="publish-to-booking.integration" -t "Female-only" --no-coverage
npx jest --testPathPattern="publish-to-booking.integration" -t "Multi-booking" --no-coverage
npx jest --testPathPattern="publish-to-booking.integration" -t "snapshot" --no-coverage
npx jest --testPathPattern="publish-to-booking.integration" -t "no stopovers" --no-coverage --verbose
```

### Watch mode (re-runs on file change)

```bash
npx jest --watch --no-coverage
npx jest --watch --testPathPattern="publish-to-booking.integration" --no-coverage
```

---

## Integration Test: Publish → Booking → Driver Actions

**File:** `src/modules/integration/publish-to-booking.integration.test.ts`

This is the most important test file. It chains the entire business flow using shared in-memory state.

### What it covers (41 tests)

| Section | Tests | Description |
|---------|-------|-------------|
| Happy Path | 4 | Publish → book segment → accept → OTP verify |
| Segment Capacity | 2 | Non-overlapping bookings allowed, overlapping blocked |
| Pricing Edge Cases | 3 | Interpolation, full-route, middle segment pricing |
| Booking Validation | 9 | Own ride, banned, no ToS, blocks, duplicates, reversed segments, seat limits |
| Driver Action Failures | 4 | Wrong driver, expired deadline, wrong OTP, wrong state |
| Seat Release | 3 | Reject/cancel releases seats correctly |
| Publish Validation | 8 | Missing fields, unverified driver, no vehicle |
| Female-Only | 2 | Allows/blocks based on salutation |
| Multi-Booking Capacity | 2 | Complex multi-passenger scenarios |
| Snapshot Integrity | 2 | Addresses and positions frozen at booking time |
| No Stopovers | 1 | Single-edge ride works |

### How it works

```
┌─────────────────────────────────────────────────┐
│          IN-MEMORY STATE (shared)                │
│                                                  │
│  rides[]  bookings[]  segmentCapacities[]        │
│  waypoints[]  users[]  vehicles[]  blocks[]      │
└─────────────────────────────────────────────────┘
         ▲            ▲             ▲
         │            │             │
   PublishRide   CreateBooking   AcceptBooking
   (real logic)  (real logic)   (real logic)
         │            │             │
         ▼            ▼             ▼
┌─────────────────────────────────────────────────┐
│          MOCKED (external only)                  │
│                                                  │
│  Redis  │  Stripe  │  Notifications  │  BullMQ  │
└─────────────────────────────────────────────────┘
```

All internal business logic runs for real. Only external services are mocked.

---

## Unit Tests by Flow

### Flow 1: Ride Publishing

```bash
npx jest --testPathPattern="draft-ride|stopover-pricing" --no-coverage --verbose
```

**What's tested:**
- Draft stored in Redis with stopover pricing map
- Partial updates preserve existing pricing
- `publishRide()` creates ride + waypoints + segment capacity edges in a transaction
- Validation: origin, destination, route, schedule, capacity, ToS, DL, vehicle

---

### Flow 2: Search & Segment Resolution

```bash
npx jest --testPathPattern="search-ride|segment-view|view-token" --no-coverage --verbose
```

**What's tested:**
- `buildSegmentPoints()` creates ordered points with cumulative prices
- `resolveSegmentView()` computes segment fare from ref pairs
- Price interpolation when stopovers lack explicit pricing
- ViewToken HMAC integrity (tamper detection)
- Search returns correct segment addresses, fares, and booking context
- Price filter applies to segment fare, not full-ride price

---

### Flow 3: Booking Creation

```bash
npx jest --testPathPattern="ride-booking" --no-coverage --verbose
```

**What's tested:**
- Segment fare = drop.cumulativePrice - pickup.cumulativePrice
- Per-segment capacity check before creating booking
- Payment intent creation (Stripe mode)
- Bypass mode: skip payment, send driver notification directly
- Reversed segments rejected
- Snapshot fields stored (pickupAddress, dropoffAddress, segmentFare, positions)

---

### Flow 4: Driver Actions

```bash
npx jest --testPathPattern="driver-booking" --no-coverage --verbose
```

**What's tested:**
- Accept: generates OTPs, moves to CONFIRMED, notifies passenger
- Reject: refunds payment, releases segment seats, notifies passenger
- Cancel-after-accept: refunds, releases seats, creates driver penalty
- OTP verify: valid code → IN_PROGRESS, invalid → increment attempt counter
- Bypass mode: skip Stripe calls but record refund metadata

---

### Flow 5: Payment Webhooks

```bash
npx jest --testPathPattern="stripe.webhook" --no-coverage --verbose
```

**What's tested:**
- Payment success → DRIVER_PENDING + notification + deadline enqueue
- Payment failure → PAYMENT_FAILED + seat release
- Webhook idempotency (duplicate events ignored)

---

### Flow 6: Ratings

```bash
npx jest --testPathPattern="ratings" --no-coverage --verbose
```

**What's tested:**
- Passenger rates driver (creates stats row)
- Driver rates passenger (updates running average)
- Duplicate rating rejected
- Non-completed booking rejected
- Users not part of booking rejected

---

## End-to-End Flow Order

Read and run tests in this order to understand the full system:

```
1. npx jest --testPathPattern="publish-to-booking.integration" --verbose  ← START HERE
2. npx jest --testPathPattern="draft-ride.service.test" --verbose
3. npx jest --testPathPattern="segment-view.utils.test" --verbose
4. npx jest --testPathPattern="search-ride.service.test" --verbose
5. npx jest --testPathPattern="ride-booking.service.test" --verbose
6. npx jest --testPathPattern="stripe.webhook.controller.test" --verbose
7. npx jest --testPathPattern="driver-booking.service.test" --verbose
8. npx jest --testPathPattern="ratings.service.test" --verbose
```

---

## Known Issues

| Test | Status | Reason |
|------|--------|--------|
| `booking-payment-mode.test.ts` (2 tests) | FAILING | Tests expect fallback to 'bypass' when env missing, but code now throws. Pre-existing issue, not related to segment booking. |

---

## Environment Variables for Tests

Tests set these internally via `process.env`:

```bash
BOOKING_PAYMENT_MODE=bypass    # or 'stripe'
PLATFORM_FEE_PERCENT=0
VIEW_TOKEN_SECRET=test-secret-key-32chars-long!!!
```

No external services (Redis, PostgreSQL, Stripe) are needed — everything is mocked.

---

## Troubleshooting

**"Cannot find module" errors:**
```bash
npx prisma generate   # Regenerate Prisma client types
```

**Tests hang or timeout:**
```bash
npx jest --detectOpenHandles --no-coverage
```

**Run a single test in isolation:**
```bash
npx jest --testPathPattern="file-name" -t "test description" --no-coverage
```

**Clear Jest cache:**
```bash
npx jest --clearCache
```
