# Segment-Based Booking: Analysis & Fix Plan

## Current State Summary

The segment booking feature allows riders to book a **partial route** (e.g., `B → C` on a driver's `A → B → C → D` route). It's implemented across:

| Layer | File | Role |
|-------|------|------|
| Segment resolution | `src/modules/search-ride/segment-view.utils.ts` | Builds segment points, computes segment fare |
| Token signing | `src/modules/search-ride/view-token.utils.ts` | HMAC-signed opaque token for segment identity |
| Search matching | `src/modules/search-ride/search-ride.service.ts` | D_POINTS algorithm matches riders to segments |
| Booking creation | `src/modules/ride-booking/ride-booking.service.ts` | Resolves segment, computes price, creates booking |
| Price preview | `src/modules/ride-booking/ride-booking.service.ts` | `getBookingPricePreview()` |
| Ride publish | `src/modules/publish-ride/draft-ride.service.ts` | Sets `pricePerSeat` on STOPOVER waypoints |
| Driver actions | `src/modules/driver-booking/driver-booking.service.ts` | Accept/reject (no segment awareness) |

---

## Identified Issues

### Issue 1: Global Seat Count (No Per-Segment Seat Tracking)

**Problem:** A ride with 3 seats uses a single `availableSeats` counter for the entire route. If Rider A books segment `A→B` (2 seats), those 2 seats are unavailable for `C→D` even though the segments don't overlap.

**Impact:** Riders are falsely rejected with `INSUFFICIENT_SEATS` for non-overlapping segments. Significantly reduces ride utilization.

**Current code:**
```typescript
// ride-booking.service.ts:559
const seatUpdate = await tx.ride.updateMany({
    where: { id: rideId, availableSeats: { gte: seatsBooked } },
    data: { availableSeats: { decrement: seatsBooked } },
});
```

**Root cause:** No concept of per-segment seat occupancy. The system treats every booking as consuming seats for the ENTIRE route.

---

### Issue 2: Driver Has No Segment Visibility

**Problem:** The driver-booking service (`driver-booking.service.ts`) doesn't include `pickupWaypointId` or `dropoffWaypointId` in its queries or responses. When a driver views a booking request, they don't know which segment the rider booked.

**Impact:** Driver sees generic ride info but not "Rider wants B → C" in the booking details endpoint. The notification body does show segment addresses (via `resolveSegmentAddress`), but the structured data returned by `fetchDriverBooking` does not include waypoints.

---

### Issue 3: Stopover Without Price Breaks Segment Resolution

**Problem:** If a STOPOVER waypoint has `pricePerSeat: null` (driver didn't set a price), the cumulative price becomes `NaN`, and `resolveSegmentView` returns `null` → booking fails with `INVALID_BOOKING_SEGMENT`.

**Current code:**
```typescript
// segment-view.utils.ts:88
cumulativePrice: waypoint.pricePerSeat ?? Number.NaN,
```

**Impact:** Any ride with a stopover that lacks explicit pricing is effectively un-bookable by segment. Stopovers added via suggestions may not have pricing assigned.

---

### Issue 4: Seat Release on Cancellation Has No Segment Context

**Problem:** When a segment booking is cancelled, seats are restored globally (`increment: seatsBooked`). This is correct only because seat tracking is global (Issue 1). But once per-segment tracking is implemented, cancellation must also be segment-aware.

---

### Issue 5: No Overlapping Segment Booking Validation

**Problem:** Two riders can book overlapping segments (e.g., `A→C` and `B→D`) but the system doesn't check if the overlapping portion (`B→C`) has capacity. It only checks global seats.

**Impact:** With per-segment tracking, this becomes a correctness issue. Currently it's masked by the overly-conservative global check.

---

### Issue 6: `mapSegmentRideInfo` Recalculates on Every Read

**Problem:** Every time a booking is fetched (list, detail), `mapSegmentRideInfo` re-runs `buildSegmentPoints` + `resolveSegmentView`. If waypoints are deleted/modified after booking, the segment view could fail or return different data.

**Impact:** Stale or broken segment data in booking responses if ride waypoints change post-booking.

---

### Issue 7: Missing `decisionTimeRemainingSeconds` in Notification Data

**Problem:** In `createBooking` bypass mode (line 613), the `decisionTimeRemainingSeconds` is calculated but the notification may show `'0'` if `driverDecisionDeadlineAt` is just set to `now + window` within the same execution tick.

**Impact:** Minor — notification data might show incorrect remaining time. Frontend should derive from `decisionDeadlineAt` timestamp anyway.

---

## Fix Plan

### Fix 1: Per-Segment Seat Availability (HIGH PRIORITY)

**Goal:** Allow non-overlapping segment bookings to co-exist without competing for the same seats.

**Approach:** Segment-interval seat tracking using "seat edges" — track how many seats are occupied on each segment edge (between consecutive STOPOVER points).

#### Schema Changes

```prisma
model RideSegmentCapacity {
  id        String @id @default(uuid())
  rideId    String
  ride      Ride   @relation(fields: [rideId], references: [id], onDelete: Cascade)

  // Segment defined by consecutive points (origin=0, stopovers=1..N, destination=N+1)
  fromPosition  Int   // 0-based position index
  toPosition    Int   // fromPosition + 1

  occupiedSeats Int   @default(0)

  @@unique([rideId, fromPosition, toPosition])
  @@index([rideId])
}
```

#### Algorithm

A ride `A → B → C → D` has 3 **edges**:
- Edge 0→1: A→B
- Edge 1→2: B→C
- Edge 2→3: C→D

A booking for `B→D` (positions 1→3) occupies edges `1→2` and `2→3`.

**Seat check on booking:**
```typescript
// For a booking from position P to position Q (P < Q):
// Check that ALL edges [P→P+1, P+1→P+2, ..., Q-1→Q] have:
//   occupiedSeats + seatsBooked <= ride.totalSeats

const maxOccupied = await tx.rideSegmentCapacity.aggregate({
    _max: { occupiedSeats: true },
    where: {
        rideId,
        fromPosition: { gte: pickupPosition },
        toPosition: { lte: dropPosition },
    },
});

if ((maxOccupied._max.occupiedSeats ?? 0) + seatsBooked > ride.totalSeats) {
    throw new Error('INSUFFICIENT_SEATS');
}

// Increment all covered edges
await tx.rideSegmentCapacity.updateMany({
    where: {
        rideId,
        fromPosition: { gte: pickupPosition },
        toPosition: { lte: dropPosition },
    },
    data: { occupiedSeats: { increment: seatsBooked } },
});
```

**On cancellation:** Decrement the same edges.

**Migration:**
1. Create `RideSegmentCapacity` table
2. On ride publish: create edge rows (one per consecutive pair)
3. Backfill: For existing rides with bookings, calculate occupancy from active bookings

**Backward compatibility:** Keep `ride.availableSeats` as a denormalized "min available across all edges" for search filtering:
```sql
availableSeats = totalSeats - MAX(occupiedSeats across all edges)
```

---

### Fix 2: Fallback Pricing for Stopovers Without Price (MEDIUM PRIORITY)

**Goal:** If a stopover has `pricePerSeat: null`, auto-interpolate a price based on position ratio.

**Change in `segment-view.utils.ts`:**
```typescript
// Instead of: cumulativePrice: waypoint.pricePerSeat ?? Number.NaN
// Use interpolation:
cumulativePrice: waypoint.pricePerSeat ?? interpolatePrice(waypoint, ride, stopoverWaypoints),
```

**Interpolation logic:**
```typescript
const interpolatePrice = (
    waypoint: SegmentRideWaypoint,
    ride: SegmentRide,
    stopovers: SegmentRideWaypoint[]
): number => {
    // Linear interpolation based on orderIndex position
    const totalPositions = stopovers.length + 1; // +1 for destination
    const waypointIndex = stopovers.indexOf(waypoint);
    const ratio = (waypointIndex + 1) / totalPositions;
    return Math.round(ride.basePricePerSeat * ratio * 100) / 100;
};
```

---

### Fix 3: Driver Segment Visibility (MEDIUM PRIORITY)

**Goal:** Include segment info in driver booking responses.

**Changes in `driver-booking.service.ts`:**

```typescript
const fetchDriverBooking = async (bookingId: string) => {
    return prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            passenger: { select: { id: true, name: true, avatarUrl: true } },
            ride: {
                include: {
                    driver: { select: { id: true, name: true, avatarUrl: true, dlVerified: true } },
                    waypoints: { orderBy: { orderIndex: 'asc' } },  // ADD THIS
                },
            },
        },
    });
};
```

**Add to response mapping:**
```typescript
// Resolve segment addresses for driver view
const pickupAddress = booking.pickupWaypointId
    ? booking.ride.waypoints.find(w => w.id === booking.pickupWaypointId)?.address
    : booking.ride.originAddress;
const dropoffAddress = booking.dropoffWaypointId
    ? booking.ride.waypoints.find(w => w.id === booking.dropoffWaypointId)?.address
    : booking.ride.destinationAddress;

return {
    ...result,
    segment: {
        pickupAddress,
        dropoffAddress,
        pickupWaypointId: booking.pickupWaypointId,
        dropoffWaypointId: booking.dropoffWaypointId,
        isPartialRoute: !!(booking.pickupWaypointId || booking.dropoffWaypointId),
    },
};
```

---

### Fix 4: Snapshot Segment Data at Booking Time (LOW PRIORITY)

**Goal:** Prevent stale/broken segment data if ride waypoints change post-booking.

**Option A (recommended):** Store segment addresses in the booking record.

```prisma
model RideBooking {
    // ... existing fields ...
    pickupAddress     String?   // Snapshot at booking time
    dropoffAddress    String?   // Snapshot at booking time
    segmentFare       Float?    // Snapshot of computed segment fare
}
```

Set these during `createBooking`:
```typescript
const booking = await tx.rideBooking.create({
    data: {
        ...existingData,
        pickupAddress: riderView.originAddress,
        dropoffAddress: riderView.destinationAddress,
        segmentFare: riderView.basePricePerSeat,
    },
});
```

**Option B:** Keep current approach (recalculate on read) but handle null gracefully in `mapSegmentRideInfo` by falling back to stored addresses.

---

### Fix 5: Overlapping Segment Capacity Check (INCLUDED IN FIX 1)

Once per-segment seat tracking (Fix 1) is implemented, overlapping bookings are automatically handled. The edge-based model correctly checks capacity on each sub-segment independently.

---

## Implementation Order

| # | Fix | Priority | Effort | Dependencies |
|---|-----|----------|--------|--------------|
| 1 | Fallback pricing (Fix 2) | HIGH | 2h | None |
| 2 | Driver segment visibility (Fix 3) | MEDIUM | 2h | None |
| 3 | Snapshot segment data (Fix 4) | MEDIUM | 3h | None (migration) |
| 4 | Per-segment seat tracking (Fix 1) | HIGH | 1-2d | Migration + backfill |
| 5 | Tests for all fixes | HIGH | 4h | After fixes |

---

## Runtime Flow: Segment Booking (Current)

```
┌──────────────────────────────────────────────────────────────────┐
│                      SEARCH PHASE                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Rider searches: originLat/Lng → destinationLat/Lng               │
│       ↓                                                          │
│  advancedSearch() loads all PUBLISHED rides with waypoints        │
│       ↓                                                          │
│  For each ride: build D_POINTS array                             │
│    D_POINTS = [Origin, Stopover1, Stopover2, ..., Destination]    │
│       ↓                                                          │
│  Match: find (i, j) where:                                       │
│    distance(rider_origin, D_POINTS[i]) <= 10km AND               │
│    distance(rider_dest, D_POINTS[j]) <= 10km AND                 │
│    i < j                                                         │
│       ↓                                                          │
│  Classify match:                                                  │
│    COND_1: full route (i=origin, j=destination)                  │
│    COND_2: partial (segment) match                               │
│    COND_3: waypoint→waypoint                                     │
│    COND_4: waypoint→destination                                  │
│    ALT_ROUTE: polyline proximity fallback                        │
│       ↓                                                          │
│  For COND_2/3/4:                                                 │
│    1. resolveSegmentView(ride, points, pickupRef, dropRef)       │
│    2. Compute segmentFare = drop.cumPrice - pickup.cumPrice      │
│    3. encodeViewToken({rideId, pickupRef, dropRef}) → segmentId  │
│       ↓                                                          │
│  Return: { segmentId, basePricePerSeat: segmentFare, ... }       │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                    PRICE PREVIEW (optional)                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  POST /bookings/price-preview                                     │
│  { rideId, segmentId OR pickupWaypointId/dropoffWaypointId }      │
│       ↓                                                          │
│  1. Load ride + waypoints                                        │
│  2. Decode segmentId → pickupRef + dropRef                       │
│  3. buildSegmentPoints → resolveSegmentView                      │
│  4. calculateBookingPrice(segmentFare, seats, luggage)           │
│  5. Return priceBreakdown + segmentRide info                     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                    BOOKING CREATION                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  POST /bookings { rideId, segmentId, seatsBooked }                │
│       ↓                                                          │
│  Pre-transaction checks:                                         │
│    - Passenger ToS accepted, not banned                          │
│       ↓                                                          │
│  ┌── BEGIN TRANSACTION ──────────────────────────────────────┐   │
│  │                                                            │   │
│  │  1. Load ride (PUBLISHED) + waypoints + driver             │   │
│  │  2. Validate: not own ride, no block, no duplicate booking │   │
│  │  3. Validate: female-only check                           │   │
│  │  4. Decode segmentId → pickupRef + dropRef                │   │
│  │     OR derive from pickupWaypointId/dropoffWaypointId     │   │
│  │  5. buildSegmentPoints(ride)                              │   │
│  │  6. resolveSegmentView(ride, points, pickupRef, dropRef)  │   │
│  │     → riderView (contains segmentFare + resolved IDs)     │   │
│  │  7. calculateBookingPrice(segmentFare, seats, luggage)    │   │
│  │  8. CREATE rideBooking:                                   │   │
│  │       pickupWaypointId = resolved (null = origin)         │   │
│  │       dropoffWaypointId = resolved (null = destination)   │   │
│  │       totalPrice = priceBreakdown.totalPrice              │   │
│  │  9. UPDATE ride.availableSeats (conditional decrement)    │   │
│  │       WHERE availableSeats >= seatsBooked                 │   │
│  │       IF count === 0 → ROLLBACK (INSUFFICIENT_SEATS)      │   │
│  │                                                            │   │
│  └── COMMIT ─────────────────────────────────────────────────┘   │
│       ↓                                                          │
│  Payment mode?                                                    │
│    bypass: notify driver + enqueue deadline                       │
│    stripe: createPaymentIntent → return clientSecret             │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                    DRIVER DECISION                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Driver sees notification: "Passenger wants B to C"               │
│  ⚠️ BUG: Booking detail API doesn't expose segment info          │
│       ↓                                                          │
│  Accept → OTP generated, status = CONFIRMED                     │
│  Reject → seats restored, refund issued                         │
│  Timeout → auto-cancel (BullMQ deadline job)                    │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Building Blocks

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SEGMENT SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐   ┌──────────────────┐   ┌────────────────┐  │
│  │  buildSegment    │   │  resolveSegment  │   │  encodeView    │  │
│  │  Points()        │──▶│  View()          │──▶│  Token()       │  │
│  │                  │   │                  │   │                │  │
│  │  Input: ride +   │   │  Input: points   │   │  Input: refs   │  │
│  │  waypoints       │   │  + pickupRef     │   │  + rideId      │  │
│  │                  │   │  + dropRef       │   │                │  │
│  │  Output:         │   │  Output:         │   │  Output:       │  │
│  │  SegmentPoint[]  │   │  SegmentView     │   │  signed token  │  │
│  └──────────────────┘   └──────────────────┘   └────────────────┘  │
│         ↑                                              ↓            │
│  ┌──────────────────┐                      ┌────────────────────┐  │
│  │  Ride + Waypoints│                      │  decodeViewToken() │  │
│  │  (DB/Prisma)     │                      │  HMAC verify +     │  │
│  │                  │                      │  payload extract   │  │
│  └──────────────────┘                      └────────────────────┘  │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                        PRICING MODEL                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Route: A ──────── B ──────── C ──────── D                          │
│  CumPrice: 0        10        20         30 (basePricePerSeat)      │
│                                                                      │
│  Segment fare(B→C) = cumPrice(C) - cumPrice(B) = 20 - 10 = 10      │
│  Segment fare(A→D) = cumPrice(D) - cumPrice(A) = 30 - 0  = 30      │
│  Segment fare(A→B) = cumPrice(B) - cumPrice(A) = 10 - 0  = 10      │
│                                                                      │
│  Only STOPOVER waypoints participate in pricing.                     │
│  PICKUP/DROPOFF waypoints are filtered out.                         │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                    SEAT TRACKING (PROPOSED)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Route: A ─── B ─── C ─── D    (totalSeats = 3)                    │
│                                                                      │
│  Edges:  [0→1] [1→2] [2→3]     (RideSegmentCapacity rows)          │
│           A→B   B→C   C→D                                          │
│                                                                      │
│  Booking 1: A→B (2 seats)  → Edge[0→1].occupied = 2                │
│  Booking 2: B→D (1 seat)   → Edge[1→2].occupied = 1, [2→3] = 1    │
│  Booking 3: C→D (2 seats)  → Edge[2→3].occupied = 1+2 = 3 ✓       │
│  Booking 4: A→D (2 seats)  → max(edge[0→1]) = 2+2 = 4 > 3 ✗ FAIL │
│                                                                      │
│  availableSeats (denormalized) = 3 - max(2, 1, 3) = 0              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Test Plan Updates

### New Unit Tests Needed

**File: `src/modules/search-ride/segment-view.utils.test.ts`**

```typescript
// ADD:
it('interpolates price when stopover has null pricePerSeat');
it('handles ride with single stopover (origin → stopover → destination)');
it('returns null when ride has no stopovers and refs target waypoints');
it('handles edge case: pickup = origin, drop = first stopover');
it('handles edge case: pickup = last stopover, drop = destination');
```

**File: `src/modules/ride-booking/ride-booking.service.test.ts`**

```typescript
// ADD:
describe('segment booking with per-segment seats', () => {
    it('allows non-overlapping segment bookings when global seats would block');
    it('rejects overlapping segment when overlapping edge is full');
    it('correctly restores edge capacity on segment cancellation');
    it('updates denormalized availableSeats after segment booking');
});

describe('segment booking edge cases', () => {
    it('handles booking when stopover price is null (uses interpolated price)');
    it('snaps segment addresses at booking creation time');
    it('rejects booking with tampered viewToken');
    it('rejects booking with viewToken for different rideId');
});
```

**File: `src/modules/driver-booking/driver-booking.service.test.ts`**

```typescript
// ADD:
describe('driver segment visibility', () => {
    it('includes pickup/dropoff addresses for segment bookings');
    it('returns isPartialRoute=true for segment bookings');
    it('returns isPartialRoute=false for full-route bookings');
});
```

### E2E Test Scenarios

**File: `tests/e2e/segment-booking.e2e.test.ts` (NEW)**

```typescript
describe('Segment Booking E2E', () => {
    // Setup: Publish a ride A→B→C→D with stopovers B,C priced at 10,20

    it('search returns segment match with correct segmentId and fare');
    it('price preview returns correct breakdown for segment B→C');
    it('booking creation with segmentId succeeds and charges segment fare');
    it('booking creation with pickupWaypointId/dropoffWaypointId works');
    it('driver notification shows segment addresses');
    it('driver booking detail includes segment info');
    it('non-overlapping segments A→B and C→D can both be booked');
    it('overlapping segments fail when edge capacity is exhausted');
    it('cancellation restores segment capacity correctly');
    it('full-route booking on ride with stopovers works (origin→destination)');
    it('booking with null-priced stopover uses interpolated fare');
});
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `RideSegmentCapacity` model, add `pickupAddress`/`dropoffAddress`/`segmentFare` to `RideBooking` |
| `src/modules/search-ride/segment-view.utils.ts` | Add price interpolation fallback |
| `src/modules/ride-booking/ride-booking.service.ts` | Use per-segment capacity check, snapshot addresses |
| `src/modules/driver-booking/driver-booking.service.ts` | Include waypoints, return segment info |
| `src/modules/publish-ride/draft-ride.service.ts` | Create `RideSegmentCapacity` rows on publish |
| `src/modules/ride-booking/ride-booking.service.test.ts` | Add segment capacity tests |
| `src/modules/search-ride/segment-view.utils.test.ts` | Add interpolation tests |
| `src/modules/driver-booking/driver-booking.service.test.ts` | Add segment visibility tests |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Migration breaks existing bookings | LOW | HIGH | Backfill script populates edges from existing active bookings |
| Price interpolation gives unexpected values | MEDIUM | MEDIUM | Log warnings when interpolation is used; admin can review |
| Per-segment tracking increases DB queries | MEDIUM | LOW | Aggregate query is O(edges), max ~10 per ride |
| ViewToken secret rotation breaks existing tokens | LOW | MEDIUM | Support dual-secret (old + new) during rotation |
| Concurrent segment bookings on same edge | LOW | LOW | Already handled by transaction + conditional WHERE |
