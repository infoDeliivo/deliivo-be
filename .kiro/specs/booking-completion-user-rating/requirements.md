# Requirements Document: Booking Completion User Rating System

## Introduction

This document specifies the requirements for a two-way post-completion rating system in a carpooling application. After a ride booking is completed, both the passenger and driver can rate each other exactly once. Ratings consist of a mandatory 1-5 star value and optional review text. The system maintains immutable rating events and denormalized aggregate statistics per user, exposing a combined rating summary on user profiles.

## Glossary

- **Rating_System**: The subsystem responsible for accepting, validating, storing, and aggregating user ratings
- **Booking**: A confirmed passenger reservation for a specific ride
- **Completed_Booking**: A booking with status `COMPLETED`
- **Participant**: Either the passenger or driver associated with a booking
- **Rater**: The user submitting a rating
- **Ratee**: The user receiving a rating
- **Rating_Event**: An immutable record of a single rating submission
- **Rating_Stats**: Denormalized aggregate statistics (total count, total stars, average) for a user
- **Profile_Cache**: Redis cache storing user profile data
- **API_Client**: External system or frontend application consuming the rating endpoint

## Requirements

### Requirement 1: Rating Submission Eligibility

**User Story:** As a passenger or driver, I want to rate my trip counterpart after the ride is completed, so that I can provide feedback on the experience.

#### Acceptance Criteria

1. WHEN a Participant submits a rating for a Completed_Booking, THE Rating_System SHALL accept the rating
2. IF a Participant submits a rating for a booking that is not completed, THEN THE Rating_System SHALL reject the request with error code `BOOKING_NOT_COMPLETED`
3. IF a user who is not a Participant submits a rating for a booking, THEN THE Rating_System SHALL reject the request with error code `NOT_BOOKING_PARTICIPANT`
4. IF a booking does not exist, THEN THE Rating_System SHALL reject the rating request with error code `BOOKING_NOT_FOUND`

### Requirement 2: Rating Uniqueness and Duplicate Prevention

**User Story:** As a system administrator, I want to ensure each participant can rate the other exactly once per booking, so that rating integrity is maintained.

#### Acceptance Criteria

1. WHEN a Rater submits a rating for a booking for the first time, THE Rating_System SHALL create a Rating_Event
2. IF a Rater submits a rating for a booking they have already rated, THEN THE Rating_System SHALL reject the request with error code `RATING_ALREADY_SUBMITTED`
3. THE Rating_System SHALL enforce uniqueness using the combination of booking ID and rater ID
4. WHEN both Participants rate each other for the same booking, THE Rating_System SHALL create two separate Rating_Events

### Requirement 3: Rating Value Validation

**User Story:** As a system administrator, I want to ensure all ratings use valid star values, so that aggregate statistics are meaningful.

#### Acceptance Criteria

1. WHEN a rating is submitted with stars between 1 and 5 (inclusive), THE Rating_System SHALL accept the star value
2. IF a rating is submitted with stars less than 1 or greater than 5, THEN THE Rating_System SHALL reject the request with error code `INVALID_RATING_VALUE`
3. THE Rating_System SHALL require stars to be an integer value
4. THE Rating_System SHALL require the stars field in all rating submissions

### Requirement 4: Review Text Handling

**User Story:** As a passenger or driver, I want to optionally include written feedback with my rating, so that I can provide detailed context.

#### Acceptance Criteria

1. WHERE review text is provided, THE Rating_System SHALL store the review text with the Rating_Event
2. WHEN review text exceeds 500 characters, THE Rating_System SHALL reject the request with validation error
3. WHEN review text is empty or contains only whitespace, THE Rating_System SHALL store null instead of the text
4. THE Rating_System SHALL allow rating submission without review text

### Requirement 5: Immutable Rating Event Storage

**User Story:** As a system administrator, I want all rating submissions to be stored as immutable events, so that rating history is preserved and auditable.

#### Acceptance Criteria

1. WHEN a rating is submitted, THE Rating_System SHALL create a Rating_Event with booking ID, ride ID, rater ID, ratee ID, stars, review text, and timestamp
2. THE Rating_System SHALL assign a unique identifier to each Rating_Event
3. THE Rating_System SHALL record the creation timestamp for each Rating_Event
4. THE Rating_System SHALL prevent modification of Rating_Events after creation

### Requirement 6: Aggregate Statistics Maintenance

**User Story:** As a system administrator, I want user rating statistics to be updated automatically when ratings are submitted, so that profile data remains current without batch processing.

#### Acceptance Criteria

1. WHEN a rating is submitted, THE Rating_System SHALL update the Ratee's Rating_Stats within the same database transaction
2. WHEN a Ratee receives their first rating, THE Rating_System SHALL create a Rating_Stats record with total ratings = 1, total stars = submitted stars, and average rating = submitted stars
3. WHEN a Ratee receives additional ratings, THE Rating_System SHALL increment total ratings by 1, add submitted stars to total stars, and recalculate average rating
4. THE Rating_System SHALL round average rating to 2 decimal places
5. IF the Rating_Event creation fails, THEN THE Rating_System SHALL rollback the Rating_Stats update

### Requirement 7: Profile Rating Summary Exposure

**User Story:** As an API client, I want to retrieve a user's combined rating summary in their profile, so that I can display their reputation to other users.

#### Acceptance Criteria

1. WHEN a user profile is requested, THE Rating_System SHALL include a rating summary with average, total count, and label fields
2. WHEN a user has received ratings, THE Rating_System SHALL return the average rating rounded to 2 decimal places and total count with label = null
3. WHEN a user has not received any ratings, THE Rating_System SHALL return average = null, total = 0, and label = "No ratings yet"
4. THE Rating_System SHALL compute the rating summary from the user's Rating_Stats record

### Requirement 8: Cache Invalidation on Rating Submission

**User Story:** As a system administrator, I want the ratee's profile cache to be invalidated when a new rating is submitted, so that profile requests return updated rating statistics.

#### Acceptance Criteria

1. WHEN a rating is successfully submitted, THE Rating_System SHALL delete the Ratee's Profile_Cache entry
2. THE Rating_System SHALL invalidate the cache after the database transaction commits
3. IF cache invalidation fails, THEN THE Rating_System SHALL log the error but not fail the rating submission

### Requirement 9: Secure Rating Endpoint

**User Story:** As a system administrator, I want the rating submission endpoint to require authentication, so that only authenticated users can submit ratings.

#### Acceptance Criteria

1. THE Rating_System SHALL expose endpoint POST /api/v1/ratings/bookings/:bookingId
2. WHEN an unauthenticated request is made to the rating endpoint, THE Rating_System SHALL reject with HTTP 401
3. THE Rating_System SHALL extract the Rater ID from the authenticated user context
4. THE Rating_System SHALL validate the booking ID parameter as a valid UUID format

### Requirement 10: Self-Rating Prevention

**User Story:** As a system administrator, I want to prevent users from rating themselves, so that rating integrity is maintained.

#### Acceptance Criteria

1. IF a Rater attempts to submit a rating where the Ratee is the same user, THEN THE Rating_System SHALL reject the request with error code `SELF_RATING_NOT_ALLOWED`
2. THE Rating_System SHALL determine the Ratee based on the Rater's role in the booking (passenger rates driver, driver rates passenger)

### Requirement 11: Error Response Mapping

**User Story:** As an API client, I want clear HTTP status codes and error messages for rating submission failures, so that I can provide appropriate feedback to users.

#### Acceptance Criteria

1. WHEN error code is `BOOKING_NOT_FOUND`, THE Rating_System SHALL return HTTP 404 with message "Booking not found"
2. WHEN error code is `NOT_BOOKING_PARTICIPANT`, THE Rating_System SHALL return HTTP 403 with message "You are not a participant in this booking"
3. WHEN error code is `BOOKING_NOT_COMPLETED`, THE Rating_System SHALL return HTTP 409 with message "Rating is allowed only after trip completion"
4. WHEN error code is `RATING_ALREADY_SUBMITTED`, THE Rating_System SHALL return HTTP 409 with message "Rating already submitted for this booking"
5. WHEN error code is `INVALID_RATING_VALUE`, THE Rating_System SHALL return HTTP 400 with message "Stars must be an integer between 1 and 5"
6. WHEN error code is `SELF_RATING_NOT_ALLOWED`, THE Rating_System SHALL return HTTP 400 with message "Self rating is not allowed"
7. WHEN a rating is successfully submitted, THE Rating_System SHALL return HTTP 201 with the created Rating_Event

### Requirement 12: OpenAPI Documentation

**User Story:** As an API client developer, I want complete OpenAPI documentation for the rating endpoint, so that I can integrate the rating feature correctly.

#### Acceptance Criteria

1. THE Rating_System SHALL document the POST /api/v1/ratings/bookings/:bookingId endpoint in OpenAPI specification
2. THE Rating_System SHALL document the request body schema with stars (integer, 1-5, required) and reviewText (string, max 500 chars, optional)
3. THE Rating_System SHALL document all response codes (201, 400, 401, 403, 404, 409, 500) with examples
4. THE Rating_System SHALL document the rating summary fields in the user profile response schema
5. THE Rating_System SHALL include example payloads for successful rating submission and profile with ratings

### Requirement 13: Optional Participation

**User Story:** As a passenger or driver, I want rating submission to be optional, so that I am not blocked from future rides if I choose not to rate.

#### Acceptance Criteria

1. THE Rating_System SHALL allow users to complete bookings without submitting ratings
2. THE Rating_System SHALL not gate ride publishing or booking creation on rating submission
3. THE Rating_System SHALL not send mandatory rating reminders or enforce rating deadlines
