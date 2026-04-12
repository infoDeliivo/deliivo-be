# Implementation Plan: Booking Completion User Rating System

## Overview

Implement a two-way post-completion rating system where passengers and drivers can rate each other exactly once after a ride is completed. The system stores immutable rating events (1-5 stars + optional review text) and maintains denormalized aggregate statistics for efficient profile queries. Rating summaries are exposed in user profiles with a "No ratings yet" label for unrated users.

## Tasks

- [x] 1. Add Prisma Models and Relations for Ratings
  - Create `RideRating` model for immutable rating events
  - Create `UserRatingStats` model for denormalized aggregates
  - Add relations to `User`, `Ride`, and `RideBooking` models
  - Generate migration and verify Prisma client delegates
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.2, 6.3_
  
  - [ ]* 1.1 Write Prisma delegate contract test
    - Create `src/modules/ratings/ratings.prisma-contract.test.ts`
    - Verify `prisma.rideRating` and `prisma.userRatingStats` delegates exist
    - Run test to confirm it fails before schema changes
    - _Requirements: 5.1_
  
  - [x] 1.2 Update Prisma schema with rating models
    - Add `RideRating` model with booking/ride/rater/ratee relations
    - Add `UserRatingStats` model with user relation
    - Add `@@unique([bookingId, raterId])` constraint for duplicate prevention
    - Add indexes for query optimization
    - Extend `User`, `Ride`, `RideBooking` models with rating relations
    - _Requirements: 2.3, 5.1, 5.2, 6.2_
  
  - [x] 1.3 Generate migration and verify
    - Run `npx prisma migrate dev --name add_user_ratings`
    - Verify migration SQL creates tables with correct constraints
    - Re-run contract test to confirm it passes
    - _Requirements: 5.1_

- [x] 2. Implement Rating Service Rules and Transactional Stats Update
  - [x] 2.1 Create rating types and validation
    - Create `src/modules/ratings/ratings.types.ts`
    - Define `SubmitRatingInput` interface (stars, reviewText)
    - Define `SubmittedRating` interface for response
    - _Requirements: 3.1, 3.3, 4.1_
  
  - [ ]* 2.2 Write service unit tests
    - Create `src/modules/ratings/ratings.service.test.ts`
    - Test passenger can rate driver on completed booking
    - Test driver can rate passenger on completed booking
    - Test rejection of non-completed bookings
    - Test rejection of non-participants
    - Test rejection of duplicate ratings
    - Test rejection of self-ratings
    - Test stats creation on first rating
    - Test stats update on subsequent ratings
    - Test star value validation (1-5, integer)
    - Test review text length validation (max 500 chars)
    - Test whitespace-only review text normalization to null
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 3.3, 4.2, 4.3, 6.2, 6.3, 10.1, 10.2_
  
  - [x] 2.3 Implement rating service with business rules
    - Create `src/modules/ratings/ratings.service.ts`
    - Implement `submitBookingRating(raterId, bookingId, input)` function
    - Validate stars are integer 1-5
    - Check booking exists and status is COMPLETED
    - Check rater is participant (passenger or driver)
    - Determine ratee based on rater role
    - Prevent self-rating
    - Check for duplicate rating using unique constraint
    - Normalize review text (trim, null if empty/whitespace)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 3.3, 4.1, 4.3, 10.1, 10.2_
  
  - [x] 2.4 Implement transactional stats update
    - Use Prisma transaction for atomic rating creation and stats update
    - Create `RideRating` event with all required fields
    - Query existing `UserRatingStats` for ratee
    - If no stats exist, create with totalRatings=1, totalStars=stars, averageRating=stars
    - If stats exist, increment totalRatings, add to totalStars, recalculate average
    - Round average rating to 2 decimal places
    - Ensure rollback on failure
    - _Requirements: 5.1, 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [ ]* 2.5 Write property test for valid completed booking rating acceptance
    - **Property 1: Valid Completed Booking Rating Acceptance**
    - **Validates: Requirements 1.1, 2.1, 5.1**
    - Generate random completed bookings with valid participants
    - Generate random stars (1-5) and optional review text
    - Verify RideRating created with correct fields
    - _Requirements: 1.1, 2.1, 5.1_
  
  - [ ]* 2.6 Write property test for duplicate rating prevention
    - **Property 4: Duplicate Rating Prevention**
    - **Validates: Requirements 2.2**
    - Generate random booking and participant
    - Submit first rating successfully
    - Verify second rating attempt is rejected with RATING_ALREADY_SUBMITTED
    - _Requirements: 2.2_
  
  - [ ]* 2.7 Write property test for bidirectional rating independence
    - **Property 5: Bidirectional Rating Independence**
    - **Validates: Requirements 2.4**
    - Generate random completed booking
    - Submit passenger rating for driver
    - Submit driver rating for passenger
    - Verify two separate RideRating events created with correct raterId/rateeId pairs
    - _Requirements: 2.4_
  
  - [ ]* 2.8 Write property test for stats accumulation
    - **Property 10: Subsequent Rating Stats Accumulation**
    - **Validates: Requirements 6.3, 6.4**
    - Generate random user with existing stats
    - Submit new rating with random stars
    - Verify totalRatings incremented, totalStars updated, average recalculated correctly
    - _Requirements: 6.3, 6.4_

- [x] 3. Add Ratings Endpoint, Validation, Controller, and Route Mounting
  - [x] 3.1 Create Zod validation schemas
    - Create `src/modules/ratings/ratings.validator.ts`
    - Define `submitRatingParamsSchema` for bookingId UUID validation
    - Define `submitRatingBodySchema` for stars (1-5 integer) and reviewText (max 500 chars)
    - _Requirements: 3.1, 3.2, 3.3, 4.2, 9.4_
  
  - [ ]* 3.2 Write route mount test
    - Create `src/modules/ratings/ratings.routes.mount.test.ts`
    - Test POST /api/v1/ratings/bookings/:bookingId returns non-404
    - Run test to confirm it fails before route mounting
    - _Requirements: 9.1_
  
  - [x] 3.3 Implement ratings controller with error mapping
    - Create `src/modules/ratings/ratings.controller.ts`
    - Implement `submitRating` controller function
    - Extract authenticated user ID from request
    - Call `submitBookingRating` service function
    - Map domain errors to HTTP status codes and messages
    - BOOKING_NOT_FOUND → 404 "Booking not found"
    - NOT_BOOKING_PARTICIPANT → 403 "You are not a participant in this booking"
    - BOOKING_NOT_COMPLETED → 409 "Rating is allowed only after trip completion"
    - RATING_ALREADY_SUBMITTED → 409 "Rating already submitted for this booking"
    - INVALID_RATING_VALUE → 400 "Stars must be an integer between 1 and 5"
    - SELF_RATING_NOT_ALLOWED → 400 "Self rating is not allowed"
    - Default → 500 "Failed to submit rating"
    - Return 201 with created rating on success
    - _Requirements: 9.1, 9.2, 9.3, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_
  
  - [x] 3.4 Implement cache invalidation after rating submission
    - In controller, after successful rating submission
    - Call `deleteCache(cacheKeys.userProfile(rating.rateeId))`
    - Log error if cache invalidation fails but don't fail request
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [x] 3.5 Create ratings routes with authentication
    - Create `src/modules/ratings/ratings.routes.ts`
    - Define POST /bookings/:bookingId route
    - Apply validation middleware for params and body
    - Wire to `submitRating` controller
    - _Requirements: 9.1, 9.4_
  
  - [x] 3.6 Mount ratings router in app
    - Modify `src/modules/index.ts` to export `ratingsRouter`
    - Modify `src/app.ts` to mount at `/api/v1/ratings` with `protect` middleware
    - Re-run mount test to confirm it passes
    - _Requirements: 9.1, 9.2_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add Combined Rating Block to User Profile Response
  - [x] 5.1 Extend user profile types
    - Modify `src/modules/user/user.types.ts`
    - Define `UserRatingSummary` interface (average, total, label)
    - Add `rating: UserRatingSummary` field to `FullProfileResponse`
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [ ]* 5.2 Write profile rating block tests
    - Create `src/modules/user/user.service.rating.test.ts`
    - Test profile returns "No ratings yet" label when stats don't exist
    - Test profile returns correct average and total when stats exist
    - Test average is rounded to 2 decimal places
    - Test label is null when ratings exist
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 5.3 Implement profile rating summary mapping
    - Modify `src/modules/user/user.service.ts` in `getFullProfileService`
    - Query `UserRatingStats` for user
    - If no stats or totalRatings = 0, return { average: null, total: 0, label: "No ratings yet" }
    - If stats exist, return { average: rounded to 2 decimals, total: totalRatings, label: null }
    - Include rating summary in profile response
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  
  - [ ]* 5.4 Write property test for profile rating summary structure
    - **Property 12: Profile Rating Summary Structure**
    - **Validates: Requirements 7.1**
    - Generate random user profiles
    - Verify rating summary always has average, total, and label fields
    - _Requirements: 7.1_
  
  - [ ]* 5.5 Write property test for rated user profile summary
    - **Property 13: Rated User Profile Summary**
    - **Validates: Requirements 7.2**
    - Generate random users with totalRatings > 0
    - Verify average equals averageRating rounded to 2 decimals
    - Verify total equals totalRatings
    - Verify label is null
    - _Requirements: 7.2_

- [x] 6. Document Ratings Endpoint in OpenAPI and Update Profile Example
  - [x] 6.1 Create ratings OpenAPI path document
    - Create `docs/openapi/paths/ratings.yaml`
    - Document POST /api/v1/ratings/bookings/{bookingId} endpoint
    - Define path parameter bookingId (UUID)
    - Define request body schema (stars: integer 1-5, reviewText: string max 500)
    - Document all response codes (201, 400, 401, 403, 404, 409, 500)
    - Reference rating submit success example
    - Add security requirement (BearerAuth)
    - _Requirements: 12.1, 12.2, 12.3_
  
  - [x] 6.2 Wire ratings path in root OpenAPI file
    - Modify `docs/openapi/openapi.yaml`
    - Add "Ratings" tag with description
    - Add path reference to ratings.yaml
    - _Requirements: 12.1_
  
  - [x] 6.3 Add rating response examples
    - Modify `docs/openapi/components/examples/common.yaml`
    - Add `RatingSubmitSuccess` example with sample rating data
    - Update `UserProfileSuccess` example to include rating summary
    - _Requirements: 12.4, 12.5_
  
  - [x] 6.4 Verify OpenAPI coverage and consistency
    - Run `npm run openapi:bundle`
    - Run `npm run openapi:coverage` to verify endpoint is documented
    - Run `npm run openapi:check` to validate spec consistency
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 7. Final Verification Gate Before PR
  - [x] 7.1 Run all rating tests
    - Run `npx jest src/modules/ratings/ --runInBand`
    - Run `npx jest src/modules/user/user.service.rating.test.ts --runInBand`
    - Verify all tests pass
  
  - [x] 7.2 Run TypeScript build
    - Run `npm run build`
    - Verify Prisma client generation succeeds
    - Verify no TypeScript compilation errors
  
  - [x] 7.3 Run OpenAPI consistency check
    - Run `npm run openapi:check`
    - Verify spec is valid and consistent
  
  - [x] 7.4 Verify all requirements covered
    - Review requirements document
    - Confirm all 13 requirements have corresponding implementation
    - Confirm all 16 correctness properties are validated by tests

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from design document
- Unit tests validate specific examples and edge cases
- The system enforces one-rating-per-participant-per-booking at database level
- Rating events are immutable (no update/delete operations)
- Aggregate statistics are updated transactionally with each rating
- Profile cache is invalidated after successful rating submission
- Rating submission is optional and does not gate future rides
