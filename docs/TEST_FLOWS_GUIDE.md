# Test Flows Guide

This document maps all test files to their business flows, organized by the user journey from ride publish to completion.

---

## Flow 1: Ride Publishing

### `src/modules/publish-ride/draft-ride.service.test.ts`

| Test | What It Verifies |
|------|-----------------|
| stores stopover pricing on the draft when updatePricing is called | `updatePricing()` saves `stopoverPricingByPlaceId` map to Redis draft |
| preserves existing stopover pricing when updatePricing omits stopoverPricing | Partial update keeps previously stored stopover prices intact |
| persists stopover pricePerSeat from draft pricing by placeId and null when missing | `publishRide()` creates waypoints with per-stopover `pricePerSeat` from draft map; missing stopovers get `null` |

**Key concepts tested:**
- Redis draft lifecycle (get/setex)
- Stopover pricing map (`stopoverPricingByPlaceId`)
- Atomic ride+waypoints+segmentCapacity creation in a single transaction
- Segment capacity edge initialization on publish

### `src/modules/publish-ride/stopover-pricing.utils.test.ts`

| Test | What It Verifies |
|------|-----------------|
| builds a placeId-keyed pricing map from draft stopover pricing input | Utility converts `[{placeId, pricePerSeat}]` array to `{placeId: price}` map |
| returns null when a placeId is missing from the pricing map | Lookup returns `null` for stopovers not in the map |

---

## Flow 2: Search & Segment Resolution

### `src/modules/search-ride/segment-view.utils.test.ts`

| Test | What It Verifies |
|------|-----------------|
| computes B -> C as 10 when cumulative prices are 10 and 20 | Segment fare = drop.cumulativePrice - pickup.cumulativePrice |
| computes C -> D as 10 when destination base is 30 | Last segment fare = basePricePerSeat - lastStopover.cumulativePrice |
| interpolates price when stopover has null pricePerSeat | Formula: `basePricePerSeat * ((index+1) / (totalStopovers+1))` |
| interpolates single stopover without price as midpoint | Single null-priced stopover gets 50% of base price |
| uses explicit pricePerSeat when set, skips interpolation | Explicit values bypass interpolation |
| ignores non-stopover waypoints so origin -> first stopover remains valid | PICKUP/DROPOFF waypoints excluded from segment point calculation |

**Key concepts tested:**
- `buildSegmentPoints()` — ordered list of origin + stopovers + destination with cumulative prices
- `resolveSegmentView()` — resolves segment fare, addresses, and booking context from ref pairs
- Price interpolation for unpriced stopovers (prevents NaN)

### `src/modules/search-ride/view-token.utils.test.ts`

| Test | What It Verifies |
|------|-----------------|
| round-trips a valid payload | HMAC-signed token encodes/decodes correctly |
| rejects a tampered token | Modified payload fails signature check |
| rejects malformed but correctly signed payloads | Structural validation catches bad data |

**Key concepts tested:**
- ViewToken integrity (HMAC-SHA256 signing)
- Prevents segment spoofing between search and booking

### `src/modules/search-ride/search-ride.view.test.ts`

| Test | What It Verifies |
|------|-----------------|
| returns the same B -> C rider-facing view selected from search | View endpoint returns consistent segment data from signed token |
| rejects an invalid token before fetching ride data | Invalid tokens fail fast before DB query |
| returns the same B -> C rider-facing view selected from search (segmentId path) | Alternative path using segmentId |
| rejects an invalid segment id before fetching ride data | Bad segmentId rejected early |

### `src/modules/search-ride/search-ride.service.test.ts`

| Test | What It Verifies |
|------|-----------------|
| returns matched segment addresses, segment fare, bookingContext, and segmentId | Full search flow returns correct segment data for partial route matches |
| keeps a ride when full-ride base price exceeds maxPrice but the matched segment fare does not | Price filter applies to segment fare, not full ride price |
| keeps full-ride origin, destination, and price for exact route matches | Origin-to-destination match uses base price directly |

**Key concepts tested:**
- Search matching against origin/stopovers/destination
- Segment fare calculation for partial routes
- Price filtering based on segment fare

---

## Flow 3: Ride Booking

### `src/modules/ride-booking/ride-booking.service.test.ts`

| Test | What It Verifies |
|------|-----------------|
| charges B -> C as the difference between cumulative waypoint prices and returns payment info | Segment fare computed correctly, Stripe payment intent created |
| charges C -> D as destination minus stopover cumulative price | Last segment pricing works |
| rejects reversed or unresolved segment selections | Reversed waypoint order throws `INVALID_BOOKING_SEGMENT` |
| creates a driver-pending booking and notifies the driver when payment mode is bypass | Bypass mode skips Stripe, sends driver notification with correct segment addresses |

**Key concepts tested:**
- Per-segment capacity check (edge-based model)
- Segment fare calculation at booking time
- Snapshot fields (pickupAddress, dropoffAddress, segmentFare, pickupPosition, dropoffPosition)
- Payment mode branching (stripe vs bypass)
- Driver notification with segment-aware pickup/dropoff addresses

### `src/modules/ride-booking/booking-payment-mode.test.ts`

| Test | What It Verifies |
|------|-----------------|
| returns stripe when env is stripe | `BOOKING_PAYMENT_MODE=stripe` returns 'stripe' |
| normalizes whitespace and case when env is stripe | Trimming and lowercasing |
| throws BOOKING_PAYMENT_MODE_INVALID for invalid values | Invalid values throw instead of silently defaulting |
| marks PAYMENT_FAILED and restores seats on payment failure | Failed payment releases segment seats |

**Note:** 2 tests (`defaults to bypass when env is missing/blank`) are failing — they expect a fallback that was removed in favor of throwing on missing config.

### `src/modules/ride-booking/booking-cancellation-policy.test.ts`

| Test | What It Verifies |
|------|-----------------|
| returns 50% when cancellation is more than 24h before departure | Refund policy: >24h = 50% refund |
| returns 0% when cancellation is within 24h | Refund policy: <24h = 0% refund |

---

## Flow 4: Driver Actions (Accept / Reject / OTP / Cancel)

### `src/modules/driver-booking/driver-booking.service.test.ts`

| Test | What It Verifies |
|------|-----------------|
| allows ride driver to accept DRIVER_PENDING booking before deadline | Accept generates OTPs, moves to CONFIRMED, notifies passenger |
| reject flow triggers refund and seat restore | Reject refunds payment, releases segment seats via `releaseSegmentSeats` |
| moves booking CONFIRMED -> IN_PROGRESS on valid pickup OTP | Valid OTP transitions booking state |
| increments attempt count on invalid pickup OTP | Bad OTP increments counter, throws `INVALID_PICKUP_OTP` |
| reject in bypass mode does not call Stripe refund and still marks refund fields | Bypass mode skips Stripe but records refund metadata |
| cancel-after-accept in bypass mode does not call Stripe refund | Cancel records driver penalty, skips Stripe |

**Key concepts tested:**
- Segment-aware seat release on reject/cancel (shared `releaseSegmentSeats` utility)
- Driver segment visibility (resolveBookingSegment)
- OTP verification flow
- Payment mode branching in driver actions
- Driver penalty events

---

## Flow 5: Payment Webhooks

### `src/modules/payments/stripe.webhook.controller.test.ts`

| Test | What It Verifies |
|------|-----------------|
| moves booking to DRIVER_PENDING on payment success and sends driver notification | Successful payment transitions booking, enqueues deadline, notifies driver |
| marks PAYMENT_FAILED and restores seats on payment failure | Failed payment releases seats and marks booking |
| ignores duplicate event ids | Idempotency — same webhook event processed once |

**Key concepts tested:**
- Webhook idempotency
- State machine: PAYMENT_PENDING -> DRIVER_PENDING (success) or PAYMENT_FAILED (failure)
- Seat release on payment failure

---

## Flow 6: Ratings

### `src/modules/ratings/ratings.service.test.ts`

| Test | What It Verifies |
|------|-----------------|
| allows passenger to rate driver on completed booking and creates stats row | First rating creates UserRatingStats |
| allows driver to rate passenger on completed booking and updates stats row | Subsequent rating updates running average |
| rejects duplicate rating by same rater for same booking | One rating per user per booking |
| rejects when booking is not completed | Only COMPLETED bookings can be rated |
| rejects users not part of the booking | Only driver/passenger of the booking can rate |

### `src/modules/ratings/ratings.prisma-contract.test.ts`

| Test | What It Verifies |
|------|-----------------|
| exposes rideRating and userRatingStats delegates on prisma client | Prisma schema exports expected model delegates |

---

## Flow 7: API Documentation

### `src/docs/docs.routes.test.ts`

| Test | What It Verifies |
|------|-----------------|
| serves openapi.json | OpenAPI spec endpoint responds 200 |
| serves swagger docs page | Swagger UI page renders |
| returns a 500 JSON error when the spec file is missing for /openapi.json | Graceful error when spec missing |
| returns a 500 JSON error when the spec file is missing for /docs | Graceful error when docs missing |

---

## End-to-End Flow Summary

```
[1] PUBLISH RIDE
    draft-ride.service.test.ts
    stopover-pricing.utils.test.ts
         |
         v
[2] SEARCH & SEGMENT RESOLUTION
    segment-view.utils.test.ts
    view-token.utils.test.ts
    search-ride.view.test.ts
    search-ride.service.test.ts
         |
         v
[3] BOOKING CREATION
    ride-booking.service.test.ts
    booking-payment-mode.test.ts
         |
         v
[4] PAYMENT WEBHOOK
    stripe.webhook.controller.test.ts
         |
         v
[5] DRIVER DECISION
    driver-booking.service.test.ts
         |
         v
[6] RIDE COMPLETION & RATING
    ratings.service.test.ts
    ratings.prisma-contract.test.ts
```

---

## Running Tests

```bash
# All tests
npx jest --no-coverage

# Specific flow
npx jest --testPathPattern="draft-ride.service.test"
npx jest --testPathPattern="segment-view.utils.test"
npx jest --testPathPattern="ride-booking.service.test"
npx jest --testPathPattern="driver-booking.service.test"

# All search-related
npx jest --testPathPattern="search-ride"
```

---

## Test Status (as of 2026-06-10)

```
Test Suites: 1 failed (booking-payment-mode — pre-existing), 13 passed
Tests:       2 failed, 49 passed, 51 total
```

The 2 failing tests in `booking-payment-mode.test.ts` expect a fallback-to-bypass behavior that was intentionally removed (code now throws when `BOOKING_PAYMENT_MODE` is missing). These tests should be updated to expect the throw.
