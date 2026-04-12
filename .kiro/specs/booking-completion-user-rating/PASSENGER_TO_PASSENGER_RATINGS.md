# Passenger-to-Passenger Rating Enhancement

## Current System Limitation

### Current Design
The rating system only supports **one-to-one** ratings between passenger and driver:
- Passenger → Driver (via booking)
- Driver → Passenger (via booking)

### The Problem
In a carpooling ride with multiple passengers:
```
Ride: London → Manchester
Driver: Bob

Booking 1: Alice (2 seats)
Booking 2: Charlie (1 seat)
Booking 3: Diana (1 seat)
```

**Current ratings possible:**
- Alice ↔ Bob ✅
- Charlie ↔ Bob ✅
- Diana ↔ Bob ✅
- Alice ↔ Charlie ❌ (NOT POSSIBLE)
- Alice ↔ Diana ❌ (NOT POSSIBLE)
- Charlie ↔ Diana ❌ (NOT POSSIBLE)

**Issue:** Passengers who shared the same ride cannot rate each other's behavior.

## Solution: Add Ride-Level Ratings

### Proposed Design

#### New Endpoint
```
POST /api/v1/ratings/rides/{rideId}/users/{userId}
```

This allows any participant (driver or passenger) to rate any other participant in the same completed ride.

### How It Works

#### Example Scenario
```
Ride ID: ride-123 (COMPLETED)
Driver: Bob (user-bob)
Passengers: Alice (user-alice), Charlie (user-charlie), Diana (user-diana)
```

#### Rating Possibilities

**Alice can rate:**
```bash
# Rate the driver
POST /api/v1/ratings/rides/ride-123/users/user-bob
Authorization: Bearer <alice-token>
{ "stars": 5, "reviewText": "Great driver!" }

# Rate fellow passenger Charlie
POST /api/v1/ratings/rides/ride-123/users/user-charlie
Authorization: Bearer <alice-token>
{ "stars": 4, "reviewText": "Friendly passenger" }

# Rate fellow passenger Diana
POST /api/v1/ratings/rides/ride-123/users/user-diana
Authorization: Bearer <alice-token>
{ "stars": 5, "reviewText": "Very quiet and respectful" }
```

**Bob (driver) can rate:**
```bash
# Rate passenger Alice
POST /api/v1/ratings/rides/ride-123/users/user-alice
Authorization: Bearer <bob-token>
{ "stars": 5, "reviewText": "Punctual and polite" }

# Rate passenger Charlie
POST /api/v1/ratings/rides/ride-123/users/user-charlie
Authorization: Bearer <bob-token>
{ "stars": 3, "reviewText": "Was late" }

# Rate passenger Diana
POST /api/v1/ratings/rides/ride-123/users/user-diana
Authorization: Bearer <bob-token>
{ "stars": 5, "reviewText": "Perfect passenger" }
```

### Database Schema Changes

#### Option A: Extend Current RideRating Model
```prisma
model RideRating {
  id String @id @default(uuid())

  // Keep booking relation optional for backward compatibility
  bookingId String?
  booking   RideBooking? @relation(fields: [bookingId], references: [id], onDelete: Cascade)

  // Ride relation is required
  rideId String
  ride   Ride @relation(fields: [rideId], references: [id], onDelete: Cascade)

  raterId String
  rater   User @relation("RatingsGiven", fields: [raterId], references: [id], onDelete: Cascade)

  rateeId String
  ratee   User @relation("RatingsReceived", fields: [rateeId], references: [id], onDelete: Cascade)

  stars      Int
  reviewText String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Change unique constraint to ride + rater + ratee
  @@unique([rideId, raterId, rateeId])
  @@index([bookingId])
  @@index([rideId])
  @@index([rateeId, createdAt])
}
```

**Key Changes:**
- `bookingId` becomes optional
- Unique constraint changes from `[bookingId, raterId]` to `[rideId, raterId, rateeId]`
- This allows: Alice can rate Bob, Charlie, and Diana in the same ride

### Service Logic

```typescript
// New service: submitRideRating
export const submitRideRating = async (
  raterId: string,
  rideId: string,
  rateeId: string,
  input: SubmitRatingInput
): Promise<SubmittedRating> => {
  
  // 1. Validate stars
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new Error('INVALID_RATING_VALUE');
  }

  // 2. Check ride exists and is completed
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      bookings: {
        where: { status: BookingStatus.COMPLETED },
        select: { passengerId: true }
      }
    }
  });

  if (!ride) throw new Error('RIDE_NOT_FOUND');
  if (ride.status !== RideStatus.COMPLETED) throw new Error('RIDE_NOT_COMPLETED');

  // 3. Check rater is a participant (driver or passenger)
  const passengerIds = ride.bookings.map(b => b.passengerId);
  const isDriver = ride.driverId === raterId;
  const isPassenger = passengerIds.includes(raterId);

  if (!isDriver && !isPassenger) {
    throw new Error('NOT_RIDE_PARTICIPANT');
  }

  // 4. Check ratee is a participant
  const rateeIsDriver = ride.driverId === rateeId;
  const rateeIsPassenger = passengerIds.includes(rateeId);

  if (!rateeIsDriver && !rateeIsPassenger) {
    throw new Error('RATEE_NOT_RIDE_PARTICIPANT');
  }

  // 5. Prevent self-rating
  if (raterId === rateeId) {
    throw new Error('SELF_RATING_NOT_ALLOWED');
  }

  // 6. Check for duplicate rating
  const existing = await prisma.rideRating.findUnique({
    where: {
      rideId_raterId_rateeId: {
        rideId,
        raterId,
        rateeId
      }
    }
  });

  if (existing) throw new Error('RATING_ALREADY_SUBMITTED');

  // 7. Normalize review text
  const reviewText = input.reviewText?.trim() || null;

  // 8. Create rating and update stats (same as before)
  const created = await prisma.$transaction(async (tx) => {
    const rating = await tx.rideRating.create({
      data: {
        rideId,
        raterId,
        rateeId,
        stars: input.stars,
        reviewText,
        bookingId: null // No booking for ride-level ratings
      }
    });

    // Update stats (same logic as before)
    const existingStats = await tx.userRatingStats.findUnique({
      where: { userId: rateeId }
    });

    if (!existingStats) {
      await tx.userRatingStats.create({
        data: {
          userId: rateeId,
          totalRatings: 1,
          totalStars: input.stars,
          averageRating: input.stars
        }
      });
    } else {
      const totalRatings = existingStats.totalRatings + 1;
      const totalStars = existingStats.totalStars + input.stars;
      await tx.userRatingStats.update({
        where: { userId: rateeId },
        data: {
          totalRatings,
          totalStars,
          averageRating: Number((totalStars / totalRatings).toFixed(2))
        }
      });
    }

    return rating;
  });

  return created;
};
```

### API Routes

```typescript
// ratings.routes.ts

// Existing booking-based rating (keep for backward compatibility)
router.post(
  '/bookings/:bookingId',
  validate({ params: submitRatingParamsSchema, body: submitRatingBodySchema }),
  controller.submitBookingRating
);

// NEW: Ride-based rating (allows passenger-to-passenger)
router.post(
  '/rides/:rideId/users/:userId',
  validate({ 
    params: submitRideRatingParamsSchema, 
    body: submitRatingBodySchema 
  }),
  controller.submitRideRating
);
```

### Frontend Flow

#### After Ride Completion

**Show rating screen with all participants:**

```
Rate your trip participants:

[Driver] Bob ⭐⭐⭐⭐⭐
[Passenger] Charlie ⭐⭐⭐⭐⭐
[Passenger] Diana ⭐⭐⭐⭐⭐

[Submit All Ratings]
```

**API calls:**
```javascript
// Rate driver
await fetch('/api/v1/ratings/rides/ride-123/users/user-bob', {
  method: 'POST',
  body: JSON.stringify({ stars: 5, reviewText: 'Great!' })
});

// Rate passenger Charlie
await fetch('/api/v1/ratings/rides/ride-123/users/user-charlie', {
  method: 'POST',
  body: JSON.stringify({ stars: 4 })
});

// Rate passenger Diana
await fetch('/api/v1/ratings/rides/ride-123/users/user-diana', {
  method: 'POST',
  body: JSON.stringify({ stars: 5 })
});
```

## Migration Strategy

### Phase 1: Keep Current System (Recommended for MVP)
- Current booking-based ratings work fine
- Simple and proven
- Most carpooling apps only do driver ↔ passenger ratings

### Phase 2: Add Ride-Level Ratings (Future Enhancement)
1. Add new endpoint `/api/v1/ratings/rides/{rideId}/users/{userId}`
2. Make `bookingId` optional in schema
3. Change unique constraint
4. Keep old endpoint for backward compatibility
5. Frontend can choose which flow to use

## Comparison with Other Platforms

### BlaBlaCar (Europe's largest carpooling)
- Only driver ↔ passenger ratings
- No passenger-to-passenger ratings

### Uber/Lyft
- Only driver ↔ passenger ratings
- No passenger-to-passenger ratings

### Recommendation
**Start with current system** (booking-based, driver ↔ passenger only). Add passenger-to-passenger ratings only if users request it.

## Summary

**Current System:**
- ✅ Simple and proven
- ✅ Covers main use case (driver quality)
- ✅ Already implemented
- ❌ No passenger-to-passenger ratings

**Enhanced System:**
- ✅ Full rating coverage
- ✅ Better passenger behavior tracking
- ❌ More complex
- ❌ More API calls per ride
- ❌ Potential rating fatigue (too many people to rate)

**Recommendation:** Keep current system for now, add ride-level ratings as Phase 2 if needed.
