# Booking Completion Two-Way User Rating Design

Date: 2026-04-08

## Summary

Add a plain two-way rating system where both participants in a completed booking can rate each other.

Approved behavior:

- Rating format: `1-5 stars` + optional text review.
- Submission policy: one-time only per side (no edits).
- Scope: only after booking status is `COMPLETED`.
- Rating visibility: one combined rating on each user profile.
- Combined rating formula: average of all ratings a user has received (as rider and driver both).
- Rating participation: optional (users can skip).
- Empty state on profile: `No ratings yet`.

## Problem

Current booking lifecycle supports completion but has no feedback mechanism between rider and driver. This creates three gaps:

1. No trust signal on user profiles.
2. No way to capture post-trip quality feedback.
3. No persistent rating metric that future users can use for decision-making.

## Goals

- Enable rider -> driver and driver -> rider rating after trip completion.
- Ensure each side can submit only one rating per completed booking.
- Keep rating submission independent from trip completion (optional, not blocking).
- Expose a single combined profile rating for each user.
- Keep profile reads fast and predictable.

## Non-Goals

- Allowing rating edits or deletes.
- Public review feed/list endpoint in this phase.
- Per-role rating breakdown in profile response (driver-only vs rider-only).
- Mandatory rating gate for next booking or publish-ride actions.

## Selected Approach

Use a normalized event table for individual ratings plus a dedicated aggregate stats table.

- `RideRating` stores immutable rating submissions.
- `UserRatingStats` stores precomputed counters/average for fast profile reads.

Why this approach:

- Preserves each submitted rating record.
- Keeps profile endpoint efficient without runtime aggregation queries.
- Keeps responsibilities clear: transaction writes to both event row + aggregate row.

## Architecture and Components

### 1) Data Model

#### `RideRating` (new)

Purpose: immutable one-time rating event per rater per booking.

Fields:

- `id String @id @default(uuid())`
- `bookingId String`
- `rideId String`
- `raterId String`
- `rateeId String`
- `stars Int` (1..5)
- `reviewText String?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Constraints and indexes:

- `@@unique([bookingId, raterId])` to enforce one-time rating per side.
- `@@index([rateeId, createdAt])` for future review retrieval.
- `@@index([bookingId])` for booking-level traceability.

Relations:

- `bookingId -> RideBooking.id`
- `rideId -> Ride.id`
- `raterId -> User.id`
- `rateeId -> User.id`

#### `UserRatingStats` (new)

Purpose: denormalized aggregate for profile reads.

Fields:

- `id String @id @default(uuid())`
- `userId String @unique`
- `totalRatings Int @default(0)`
- `totalStars Int @default(0)`
- `averageRating Float @default(0)`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Computation rule:

- `averageRating = totalStars / totalRatings` rounded to 2 decimals in service logic.

### 2) New Ratings Module

Create `src/modules/ratings/` with:

- `ratings.routes.ts`
- `ratings.controller.ts`
- `ratings.service.ts`
- `ratings.validator.ts`
- `ratings.types.ts`

Add router mount in app/module index:

- `app.use('/api/v1/ratings', protect, ratingsRouter)`

### 3) Profile Integration

Extend `GET /api/v1/users/me/profile` response with:

```json
"rating": {
  "average": 4.67,
  "total": 12,
  "label": null
}
```

No-rating state:

```json
"rating": {
  "average": null,
  "total": 0,
  "label": "No ratings yet"
}
```

Source of truth for this block is `UserRatingStats`.

## API Design

### Submit Rating

`POST /api/v1/ratings/bookings/{bookingId}`

Auth required.

Request body:

```json
{
  "stars": 5,
  "reviewText": "Smooth trip and on-time pickup"
}
```

Validation:

- `stars` required, integer in range `1..5`.
- `reviewText` optional, trimmed, max 500 chars.

Success response:

```json
{
  "status": "SUCCESS",
  "message": "Rating submitted successfully",
  "data": {
    "bookingId": "...",
    "rideId": "...",
    "raterId": "...",
    "rateeId": "...",
    "stars": 5,
    "reviewText": "Smooth trip and on-time pickup",
    "createdAt": "..."
  }
}
```

### Authorization and Eligibility Rules

For `bookingId`:

- Booking must exist.
- Booking status must be `COMPLETED`.
- Caller must be either:
  - `RideBooking.passengerId`, or
  - `Ride.driverId` for the same ride.
- `rateeId` must always be the opposite participant.
- Caller cannot rate themselves.
- Duplicate (`bookingId`, `raterId`) is rejected.

## Data Flow

1. Client submits rating for completed booking.
2. Service loads booking + ride + participants in one query.
3. Service validates eligibility and duplicate guard.
4. Service resolves `rateeId` (opposite participant).
5. In one transaction:
   - Insert `RideRating` event.
   - Upsert/increment `UserRatingStats` for `rateeId`:
     - `totalRatings += 1`
     - `totalStars += stars`
     - recompute `averageRating`.
6. Invalidate profile cache key for `rateeId` so updated score appears on next fetch.
7. Return created rating payload.

## Error Handling

Mapped domain errors:

- `BOOKING_NOT_FOUND` -> `404`
- `NOT_BOOKING_PARTICIPANT` -> `403`
- `BOOKING_NOT_COMPLETED` -> `409`
- `RATING_ALREADY_SUBMITTED` -> `409`
- `INVALID_RATING_VALUE` -> `400`
- `SELF_RATING_NOT_ALLOWED` -> `400`

Unexpected failures return `500` with standard envelope.

## Caching Impact

Current profile endpoint uses user-profile cache keys.

On successful rating submission:

- Evict `userProfile` cache for `rateeId`.
- Optional: evict `raterId` profile cache only if future UX includes "ratings I gave" summary in `/me/profile`.

## OpenAPI Impact

Add path doc for:

- `POST /api/v1/ratings/bookings/{bookingId}`

Update `users/me/profile` response example/schema to include `rating` block.

## Testing Strategy

### Unit tests (`ratings.service.test.ts`)

- Passenger can rate driver on completed booking.
- Driver can rate passenger on completed booking.
- Duplicate rating by same rater on same booking is rejected.
- Non-completed booking cannot be rated.
- Unrelated user cannot rate booking.
- Stats aggregation updates correctly after each insert.

### Controller/route tests

- Request validation for `stars` range and review length.
- Auth required.
- Success and mapped error responses.

### Regression checks

- Existing driver booking completion flow remains unchanged.
- Existing user profile endpoint still returns legacy fields + new `rating` block.

## Migration Plan

1. Add Prisma models (`RideRating`, `UserRatingStats`) and user relations.
2. Generate migration and apply.
3. Deploy API code using new tables.
4. No backfill required initially.

Notes:

- Existing users start with no stats row and receive `No ratings yet`.
- Stats row is created lazily on first received rating.

## Scope Check

This scope is bounded to post-completion rating capture and profile aggregate exposure. It does not include moderation workflows, edit/delete semantics, or review feeds, and is suitable for a single implementation plan.
