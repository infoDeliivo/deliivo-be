# Integration Test Guide: Publish → Booking → Driver Actions

## Overview

The integration test at `src/modules/integration/publish-to-booking.integration.test.ts` validates the complete ride lifecycle end-to-end, from publishing a ride through booking creation, driver decisions, and cancellation flows.

Unlike unit tests that mock each dependency in isolation, this test uses a **shared in-memory state** that simulates the database across all service calls, ensuring that state transitions are consistent across module boundaries.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    IN-MEMORY STATE                                │
│                                                                   │
│  rides[]  bookings[]  segmentCapacities[]  waypoints[]  users[]  │
│  vehicles[]  blocks[]  draftStore{}                               │
└─────────────────────────────────────────────────────────────────┘
        ▲               ▲               ▲
        │               │               │
┌───────┴───┐   ┌──────┴──────┐   ┌────┴────────────┐
│  Publish  │   │   Booking   │   │  Driver Actions  │
│  Service  │   │   Service   │   │    Service       │
└───────────┘   └─────────────┘   └──────────────────┘
        │               │               │
        ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MOCKED EXTERNALS                               │
│                                                                   │
│  Redis (draftStore)  │  Stripe  │  Notifications  │  BullMQ      │
└─────────────────────────────────────────────────────────────────┘
```

### What's Real
- All business logic in `draft-ride.service.ts`, `ride-booking.service.ts`, `driver-booking.service.ts`
- Segment pricing calculations (`segment-view.utils.ts`)
- Per-segment capacity checks and releases (`segment-capacity.utils.ts`)
- Validation rules (ToS, bans, blocks, female-only, seat limits)

### What's Mocked
- Redis (uses `draftStore` object)
- Prisma (in-memory arrays with realistic query behavior)
- Stripe payment intents and refunds
- Push notifications
- BullMQ deadline queue
- OTP generation (fixed `123456`)

---

## Test Sections

### 1. Happy Path: Full Ride Lifecycle

**File section:** `Happy Path: Full ride lifecycle`

Tests the golden path that every ride goes through:

```
Driver publishes ride
    → Ride created with PUBLISHED status
    → Waypoints stored with pricePerSeat
    → Segment capacity edges initialized (N stopovers = N+1 edges)
    → Draft deleted from Redis

Passenger books a segment
    → Correct segment fare calculated (drop.cumPrice - pickup.cumPrice)
    → Edges in booked range incremented
    → Booking created with DRIVER_PENDING status
    → Driver notified
    → Deadline job enqueued

Driver accepts
    → Status moves to CONFIRMED
    → OTPs generated and stored
    → Passenger notified
    → Segment info returned (pickupAddress, dropoffAddress, isPartialRoute)

Driver verifies pickup OTP
    → Status moves to IN_PROGRESS
```

**Key assertions:**
- `rides[0].availableSeats` decreases correctly
- `segmentCapacities` edges update only for covered range
- Notification payloads contain correct segment addresses
- Snapshot fields (pickupAddress, dropoffAddress, segmentFare) set at booking time

---

### 2. Segment Capacity: Non-Overlapping Bookings

**File section:** `Segment Capacity: Non-overlapping bookings succeed`

Validates the core innovation — non-overlapping segments don't compete for seats:

```
Route: Origin ─── Gatwick ─── Crawley ─── Brighton
Edges:    [0→1]      [1→2]       [2→3]

1-seat ride:
  P1 books Origin → Gatwick   → edge [0→1] = 1
  P2 books Crawley → Brighton → edge [2→3] = 1

  Both succeed! They don't overlap.
```

Also tests that overlapping segments on a full ride correctly block:

```
P1 books full route (all edges = 1)
P2 tries Origin → Gatwick → INSUFFICIENT_SEATS (edge 0→1 already at max)
```

---

### 3. Pricing Edge Cases

**File section:** `Pricing edge cases`

| Scenario | Expected Price | Formula |
|----------|---------------|---------|
| Full route, 2 seats | 60 | basePricePerSeat(30) × seats(2) |
| Gatwick→Brighton (explicit pricing) | 18 | destination(30) - gatwick(12) |
| Gatwick→Crawley (middle segment) | 10 | crawley(22) - gatwick(12) |
| Origin→Gatwick (no explicit price, interpolated) | 10 | 30 × (1/3) = 10 |

**Interpolation formula** (when `pricePerSeat` is null):
```
price = basePricePerSeat × ((stopoverIndex + 1) / (totalStopovers + 1))
```

---

### 4. Booking Validation Failures

**File section:** `Booking validation failures`

| Test Case | Expected Error | Guard Location |
|-----------|---------------|----------------|
| Book own ride | `CANNOT_BOOK_OWN_RIDE` | Transaction (ride.driverId check) |
| Banned user | `USER_BANNED` | Pre-transaction (user.isBanned) |
| No ToS | `TOS_NOT_ACCEPTED` | Pre-transaction (user.tosAcceptedAt) |
| Blocked by driver | `USER_BLOCKED` | Transaction (userBlock query) |
| Passenger blocked driver | `USER_BLOCKED` | Transaction (bidirectional block) |
| Duplicate active booking | `BOOKING_ALREADY_EXISTS` | Transaction (existing booking check) |
| Reversed waypoints | `INVALID_BOOKING_SEGMENT` | Segment resolution returns null |
| 5+ seats | `MAXIMUM_SEATS_EXCEEDED` | validateBookingSeats() |
| 0 seats | `MINIMUM_ONE_SEAT_REQUIRED` | validateBookingSeats() |
| Non-existent ride | `RIDE_NOT_FOUND` | Transaction (ride.findFirst) |

---

### 5. Driver Action Failures

**File section:** `Driver action failures`

| Test Case | Expected Error | Why |
|-----------|---------------|-----|
| Non-driver tries to accept | `FORBIDDEN_DRIVER` | `ride.driverId !== driverId` |
| Accept after deadline | `BOOKING_DECISION_DEADLINE_PASSED` | Deadline timestamp expired |
| Wrong OTP code | `INVALID_PICKUP_OTP` | Hash mismatch, attempt count incremented |
| Cancel-after-accept on DRIVER_PENDING | `BOOKING_NOT_CONFIRMED` | Wrong state for this action |

---

### 6. Seat Release Flows

**File section:** `Seat release on rejection/cancellation`

All cancellation paths must release segment seats correctly:

```
┌──────────────────────┐     ┌────────────────────────────┐
│  Driver Rejects      │────▶│  releaseSegmentSeats()     │
│  Driver Cancel-After │────▶│  Decrements covered edges  │
│  Passenger Cancels   │────▶│  Recalculates availSeats   │
│  Deadline Auto-Cancel│────▶│  = totalSeats - max(edges) │
└──────────────────────┘     └────────────────────────────┘
```

**Assertions:**
- After release, `segmentCapacities[edge].occupiedSeats` returns to 0
- `ride.availableSeats` returns to `totalSeats`
- Notifications sent to affected party
- Driver penalty event created (cancel-after-accept only)

---

### 7. Publish Validation

**File section:** `Publish validation failures`

| Missing Field | Expected Error |
|---------------|---------------|
| originPlaceId | `ORIGIN_AND_DESTINATION_REQUIRED` |
| destinationPlaceId | `ORIGIN_AND_DESTINATION_REQUIRED` |
| routePolyline | `ROUTE_REQUIRED` |
| departureDate | `SCHEDULE_REQUIRED` |
| totalSeats (0) | `CAPACITY_AND_PRICING_REQUIRED` |
| driver.tosAcceptedAt | `TOS_NOT_ACCEPTED` |
| driver.dlVerified | `DRIVER_NOT_VERIFIED` |
| No vehicle | `VEHICLE_REQUIRED` |

---

### 8. Female-Only Ride Enforcement

**File section:** `Female-only ride enforcement`

When `femaleOnly: true`:
- Passengers with salutation `MS`, `MRS`, `MX` → allowed
- Passengers with salutation `MR` or missing → `FEMALE_ONLY_RIDE` error

---

### 9. Multi-Booking Capacity Scenarios

**File section:** `Multi-booking capacity scenarios`

Tests complex multi-passenger scenarios:

```
3-seat ride: Origin ─── Gatwick ─── Crawley ─── Brighton

P1: Full route, 1 seat      → All edges: [1, 1, 1]
P2: Origin→Gatwick, 2 seats → Edge 0→1: [3, 1, 1]
P3: Crawley→Brighton, 2 seats → Edges: [3, 1, 3]

All three succeed because no single edge exceeds 3!
```

---

### 10. Booking Snapshot Integrity

**File section:** `Booking snapshot fields`

Verifies data frozen at booking time:

| Field | Purpose |
|-------|---------|
| `pickupAddress` | Display address for passenger's pickup point |
| `dropoffAddress` | Display address for passenger's dropoff point |
| `segmentFare` | Per-seat price for the segment (not total) |
| `pickupPosition` | Edge index for capacity release |
| `dropoffPosition` | Edge index for capacity release |

These snapshots ensure that even if waypoints are modified after booking, the booking remains consistent.

---

### 11. Ride Without Stopovers

**File section:** `Ride without stopovers`

A ride with 0 stopovers still works correctly:
- Creates 1 edge (0→1): origin directly to destination
- Full-route booking charges `basePricePerSeat`
- Capacity tracking works on the single edge

---

## Running the Tests

```bash
# Run only integration tests
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage

# Run with verbose output
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage --verbose

# Run a specific section
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage -t "Happy Path"
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage -t "Segment Capacity"
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage -t "Pricing edge cases"
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage -t "Booking validation"
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage -t "Driver action"
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage -t "Seat release"
npx jest --testPathPattern="publish-to-booking.integration" --no-coverage -t "Female-only"
```

---

## Adding New Tests

### Pattern for a new happy-path test:

```typescript
it('describes what the test validates', async () => {
    // 1. Setup draft and publish
    draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ /* overrides */ }));
    await DraftRideService.publishRide('driver-1');

    // 2. Grab references
    const rideId = rides[0].id;
    const someWp = waypoints.find(w => w.placeId === 'place-xxx')!;

    // 3. Create booking
    const booking = await createBooking('passenger-1', {
        rideId,
        seatsBooked: 1,
        pickupWaypointId: someWp.id,
    });

    // 4. Assert state
    expect(booking.totalPrice).toBe(expectedPrice);
    expect(segmentCapacities.find(e => e.fromPosition === X)!.occupiedSeats).toBe(Y);
});
```

### Pattern for a new validation failure test:

```typescript
it('rejects when [condition]', async () => {
    draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
    await DraftRideService.publishRide('driver-1');

    // Setup the failing condition
    // e.g., blocks.push({ blockerId: 'x', blockedId: 'y' });

    await expect(
        createBooking('passenger-1', { rideId: rides[0].id, seatsBooked: 1 })
    ).rejects.toThrow('EXPECTED_ERROR_CODE');
});
```

### Pattern for seat release tests:

```typescript
it('releases seats when [action]', async () => {
    draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
    await DraftRideService.publishRide('driver-1');

    // Create booking (seats occupied)
    await createBooking('passenger-1', { rideId: rides[0].id, seatsBooked: 2 });
    expect(segmentCapacities[0].occupiedSeats).toBe(2);

    // Trigger release action
    await cancelBooking('passenger-1', bookings[0].id);

    // Assert seats returned
    expect(segmentCapacities[0].occupiedSeats).toBe(0);
    expect(rides[0].availableSeats).toBe(originalSeats);
});
```

---

## State Diagram: Booking Lifecycle

```
                    ┌─────────────┐
                    │   PUBLISH   │
                    │    RIDE     │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   CREATE    │
                    │   BOOKING   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────────┐
              │ bypass mode │  stripe mode   │
              ▼            │                ▼
    ┌─────────────────┐    │    ┌──────────────────┐
    │ DRIVER_PENDING  │    │    │ PAYMENT_PENDING  │
    └────┬───────┬────┘    │    └────────┬─────────┘
         │       │         │             │
    accept│  reject│        │     webhook success
         │       │         │             │
         ▼       ▼         │             ▼
  ┌───────────┐ ┌────────┐ │   ┌─────────────────┐
  │ CONFIRMED │ │CANCELLED│ │   │ DRIVER_PENDING  │
  └─────┬─────┘ └────────┘ │   └────┬───────┬────┘
        │                   │        │       │
   OTP verify              │   accept│  reject│
        │                   │        │       │
        ▼                   │        ▼       ▼
  ┌─────────────┐          │  ┌───────────┐ ┌────────┐
  │ IN_PROGRESS │          │  │ CONFIRMED │ │CANCELLED│
  └─────┬───────┘          │  └─────┬─────┘ └────────┘
        │                   │        │
   drop OTP verify         │   OTP verify
        │                   │        │
        ▼                   │        ▼
  ┌───────────┐            │  ┌─────────────┐
  │ COMPLETED │            │  │ IN_PROGRESS │
  └───────────┘            │  └─────────────┘
                           │
              Cancellable at any point before IN_PROGRESS:
              - Passenger cancel → CANCELLED + refund policy
              - Driver cancel-after-accept → CANCELLED + 100% refund + penalty
              - Deadline auto-cancel → CANCELLED + 100% refund
```

---

## Segment Capacity Visual

```
Route with 2 stopovers (3 edges):

Position:  0          1           2           3
Points:  ORIGIN ─── STOPOVER1 ─── STOPOVER2 ─── DESTINATION
Edges:      [0→1]       [1→2]        [2→3]

totalSeats = 3

After booking Origin→Destination (1 seat):
  Edges: [1, 1, 1]  availableSeats = 3 - max(1,1,1) = 2

After booking Stopover1→Destination (2 seats):
  Edges: [1, 3, 3]  availableSeats = 3 - max(1,3,3) = 0

Can still book Origin→Stopover1 (2 seats)?
  Check: max(edge[0→1].occupied) + 2 = 1 + 2 = 3 ≤ 3  ✓ YES!
  Edges: [3, 3, 3]  availableSeats = 3 - 3 = 0

After cancel of Origin→Destination booking:
  Release edges [0→1, 1→2, 2→3] by 1
  Edges: [2, 2, 2]  availableSeats = 3 - max(2,2,2) = 1
```

---

## Common Debugging

**Test fails with `RIDE_NOT_FOUND`:**
- Ensure `DraftRideService.publishRide()` was called before `createBooking()`
- Check that `rides[]` array has the expected ride with `status: 'PUBLISHED'`

**Test fails with `INSUFFICIENT_SEATS`:**
- Print `segmentCapacities` to see current edge occupancy
- Verify `totalSeats` matches your expectation
- Check which edges are being queried (pickupPosition → dropoffPosition range)

**Test fails with `INVALID_BOOKING_SEGMENT`:**
- The waypoint ID doesn't match any waypoint in the ride
- Or the pickup comes after the dropoff in route order
- Print `waypoints.filter(w => w.rideId === rideId)` to see available waypoints

**Seats not releasing:**
- `releaseSegmentSeats` requires `pickupPosition` and `dropoffPosition` to be non-null
- If null, it falls back to global increment (which may not match edge state)
- Ensure booking was created with positions set

---

## Test Results Summary

```
Test Suites: 1 passed, 1 total
Tests:       41 passed, 41 total

  Happy Path: Full ride lifecycle (4 tests)
  Segment Capacity: Non-overlapping bookings (2 tests)
  Pricing edge cases (3 tests)
  Booking validation failures (9 tests)
  Driver action failures (4 tests)
  Seat release on rejection/cancellation (3 tests)
  Publish validation failures (8 tests)
  Female-only ride enforcement (2 tests)
  Multi-booking capacity scenarios (2 tests)
  Booking snapshot fields (2 tests)
  Ride without stopovers (1 test)
```
