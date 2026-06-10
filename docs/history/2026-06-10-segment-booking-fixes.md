# Segment Booking Fixes — 2026-06-10

## Summary

Fixed 4 critical issues with segment-based booking that prevented correct per-segment seat tracking, caused booking failures on unpriced stopovers, and hid segment information from drivers.

---

## Changes Made

### 1. Price Interpolation for Unpriced Stopovers

**File:** `src/modules/search-ride/segment-view.utils.ts`

**Problem:** Stopovers without explicit `pricePerSeat` produced `NaN` cumulative prices, causing `resolveSegmentView()` to return `null` and booking to fail with `INVALID_BOOKING_SEGMENT`.

**Solution:** Added `interpolateStopoverPrice()` that calculates a proportional price based on position ratio when `pricePerSeat` is null.

```
Formula: price = basePricePerSeat * ((index + 1) / (totalStopovers + 1))
Example: 2 stopovers on a 30/seat ride -> prices = [10, 20]
```

Removed the `Number.isNaN` guard in `resolveSegmentView` since NaN is no longer produced.

---

### 2. Driver Segment Visibility

**File:** `src/modules/driver-booking/driver-booking.service.ts`

**Problem:** Driver booking responses (accept, reject, OTP verify) returned no information about which segment was booked. Drivers couldn't see pickup/dropoff addresses for partial routes.

**Solution:**
- Added `waypoints` include in `fetchDriverBooking()` query
- Created `resolveBookingSegment()` helper that resolves pickup/dropoff addresses from waypoint IDs
- All driver actions now return a `segment` object:
  ```typescript
  segment: {
      pickupAddress: string;
      dropoffAddress: string;
      pickupWaypointId: string | null;
      dropoffWaypointId: string | null;
      isPartialRoute: boolean;
  }
  ```

---

### 3. Segment Data Snapshot at Booking Time

**File:** `prisma/schema.prisma`, `src/modules/ride-booking/ride-booking.service.ts`

**Problem:** Segment addresses were recalculated from live waypoints on every read. If waypoints changed after booking, responses could break.

**Solution:** Added snapshot fields to `RideBooking`:
- `pickupAddress` — Resolved segment origin address at booking time
- `dropoffAddress` — Resolved segment destination address at booking time
- `segmentFare` — Computed segment fare at booking time
- `pickupPosition` — Segment point position index (0=origin, N+1=destination)
- `dropoffPosition` — Segment point position index

These are set during `createBooking()` and used for capacity tracking.

---

### 4. Per-Segment Seat Capacity Tracking

**Files:** `prisma/schema.prisma`, `src/modules/ride-booking/segment-capacity.utils.ts` (NEW), `src/modules/ride-booking/ride-booking.service.ts`, `src/modules/driver-booking/driver-booking.service.ts`, `src/queue/deadline.queue.ts`, `src/modules/publish-ride/draft-ride.service.ts`

**Problem:** A single `availableSeats` counter for the entire ride meant non-overlapping segment bookings competed for the same seats. Booking `A->B` blocked `C->D` even though they don't overlap.

**Solution:** Edge-based capacity model:

```
Route: A --- B --- C --- D  (totalSeats = 3)
Edges: [0->1] [1->2] [2->3]

Booking A->B (2 seats): Edge[0->1].occupied = 2
Booking C->D (2 seats): Edge[2->3].occupied = 2  (allowed!)
Booking A->D (2 seats): max(occupied on 0->1, 1->2, 2->3) + 2 > 3? FAIL on edge 0->1
```

**New model:** `RideSegmentCapacity`
```prisma
model RideSegmentCapacity {
  id            String @id @default(uuid())
  rideId        String
  fromPosition  Int
  toPosition    Int
  occupiedSeats Int @default(0)
  @@unique([rideId, fromPosition, toPosition])
}
```

**Edge creation:** On ride publish, one row per edge (stopovers + 1 edges total).

**Booking check:** Before creating a booking, find all edges in range `[pickupPosition, dropoffPosition)` and verify `max(occupiedSeats) + seatsBooked <= totalSeats`.

**Seat release:** New utility `releaseSegmentSeats()` handles decrementing edge occupancy on cancel/reject/timeout, then recalculates denormalized `availableSeats`.

**Backward compatibility:** Falls back to global `availableSeats` decrement for rides without segment capacity rows (pre-existing rides).

---

## Schema Migration Required

```bash
npx prisma migrate dev --name segment-booking-fixes
```

New fields:
- `RideBooking.pickupAddress` (String?, nullable)
- `RideBooking.dropoffAddress` (String?, nullable)
- `RideBooking.segmentFare` (Float?, nullable)
- `RideBooking.pickupPosition` (Int?, nullable)
- `RideBooking.dropoffPosition` (Int?, nullable)
- New table: `RideSegmentCapacity`

---

## Files Modified

| File | Change Type |
|------|-------------|
| `prisma/schema.prisma` | Added `RideSegmentCapacity` model + snapshot fields on `RideBooking` |
| `src/modules/search-ride/segment-view.utils.ts` | Added `interpolateStopoverPrice`, removed NaN guard |
| `src/modules/search-ride/segment-view.utils.test.ts` | Added 3 new interpolation tests |
| `src/modules/driver-booking/driver-booking.service.ts` | Added segment visibility, waypoints include, `releaseSegmentSeats` |
| `src/modules/driver-booking/driver-booking.service.test.ts` | Updated mocks for new fields, fixed missing args |
| `src/modules/ride-booking/ride-booking.service.ts` | Per-segment capacity check, snapshot data, `releaseSegmentSeats` |
| `src/modules/ride-booking/ride-booking.service.test.ts` | Added mocks for new fields and queues |
| `src/modules/ride-booking/segment-capacity.utils.ts` | **NEW** — shared seat release utility |
| `src/modules/publish-ride/draft-ride.service.ts` | Creates `RideSegmentCapacity` rows on ride publish |
| `src/queue/deadline.queue.ts` | Uses `releaseSegmentSeats` for auto-cancel |

---

## Test Results

```
Test Suites: 5 passed, 5 total
Tests:       21 passed, 21 total

- segment-view.utils.test.ts (6 tests)
- view-token.utils.test.ts (4 tests)
- ride-booking.service.test.ts (4 tests)
- driver-booking.service.test.ts (6 tests)
- stopover-pricing.utils.test.ts (1 test)
```

---

## Runtime Flow Diagram (Updated)

```
BOOKING CREATION (with per-segment capacity)
=============================================

POST /bookings { rideId, segmentId, seatsBooked }
  |
  v
[Pre-checks: ToS, ban status]
  |
  v
BEGIN TRANSACTION
  |
  +-- Load ride + waypoints (PUBLISHED only)
  +-- Validate: not own ride, no blocks, no duplicate
  +-- Decode segmentId -> pickupRef, dropRef
  +-- buildSegmentPoints(ride)
  +-- resolveSegmentView(ride, points, pickupRef, dropRef)
  |     * Now uses interpolated prices if null
  |     * Returns: segmentFare, addresses, positions
  |
  +-- Resolve pickupPosition & dropoffPosition from points
  |
  +-- PER-SEGMENT CAPACITY CHECK:
  |     Query: SELECT * FROM RideSegmentCapacity
  |            WHERE rideId = ? AND fromPosition >= pickup AND toPosition <= drop
  |     Check: max(occupiedSeats) + seatsBooked <= totalSeats
  |     If FAIL -> throw INSUFFICIENT_SEATS
  |     If PASS -> UPDATE edges SET occupiedSeats += seatsBooked
  |     Then: Recalculate ride.availableSeats = totalSeats - max(all edges)
  |
  +-- CREATE booking with:
  |     - pickupAddress (snapshot)
  |     - dropoffAddress (snapshot)
  |     - segmentFare (snapshot)
  |     - pickupPosition, dropoffPosition (for capacity release)
  |
COMMIT
  |
  v
[Payment Intent / Driver Notification / Deadline Queue]


BOOKING CANCELLATION (segment-aware release)
=============================================

releaseSegmentSeats(tx, { rideId, seatsBooked, pickupPosition, dropoffPosition, totalSeats })
  |
  +-- If pickupPosition & dropoffPosition known:
  |     Decrement edges in range
  |     Recalculate ride.availableSeats
  +-- Else:
        Global increment ride.availableSeats (backward compat)
```

---

## Backfill Strategy (for existing rides)

Existing rides published before this change won't have `RideSegmentCapacity` rows. The code falls back to global seat check for these rides. To backfill:

```sql
-- For each published ride, create segment capacity edges
INSERT INTO "RideSegmentCapacity" (id, "rideId", "fromPosition", "toPosition", "occupiedSeats")
SELECT
  gen_random_uuid(),
  r.id,
  edge_idx,
  edge_idx + 1,
  0
FROM "Ride" r
CROSS JOIN generate_series(0, (
  SELECT COUNT(*) FROM "RideWaypoint" w
  WHERE w."rideId" = r.id AND w."waypointType" = 'STOPOVER'
)) AS edge_idx
WHERE r.status = 'PUBLISHED'
  AND NOT EXISTS (
    SELECT 1 FROM "RideSegmentCapacity" sc WHERE sc."rideId" = r.id
  );
```

Then recalculate occupied seats from active bookings (requires mapping existing bookings to positions).
