# Manual Test Plan — Carpooling App Backend

This document is the complete manual QA guide for the carpooling platform.
Each test case includes preconditions, exact steps, expected response, and pass/fail criteria.

---

## Test Environment Setup

### Base URL
```
Development:  http://localhost:3000
Staging:      https://staging.yourdomain.com
```

### Required Test Accounts
Create these before testing. Keep credentials in a shared test credential doc.

| Account | Role | Purpose |
|---|---|---|
| driver_a | Driver | Primary driver account (DL verified) |
| driver_b | Driver | Secondary driver for conflict tests |
| passenger_a | Passenger | Primary passenger account |
| passenger_b | Passenger | Second passenger (concurrent booking tests) |
| passenger_c | Passenger | Third passenger (multi-seat tests) |
| unverified_user | New user | Not OTP verified yet |

### Preconditions for All Tests
- API server running and connected to DB
- Redis running
- `BOOKING_PAYMENT_MODE=bypass` for booking tests (no real Stripe needed)
- `EXPOSE_OTP_IN_RESPONSE=true` for auth tests (OTP visible in response)
- `SMS_MOCK_MODE=true` to avoid real SMS charges during testing

### How to Read This Document
- `{{token}}` — replace with the Bearer token from login
- `{{bookingId}}`, `{{rideId}}` etc. — replace with IDs from previous step responses
- **PASS** criteria are listed under "Expected Result"
- Any deviation from the expected result is a **FAIL**

---

---

# MODULE 1: Authentication

---

## TC-AUTH-001: Signup with Email — Happy Path

**Preconditions:** Email does not exist in the system

**Steps:**
```
POST /api/v1/auth/signup
{
  "method": "email",
  "email": "testuser+001@example.com"
}
```

**Expected Result:**
- HTTP 201
- Body contains `next: "verify_otp"`
- Body contains `code` field (because EXPOSE_OTP_IN_RESPONSE=true)
- Email is sent to the address (check mail server / BullMQ logs)

---

## TC-AUTH-002: Signup with Phone — Happy Path

**Preconditions:** Phone number does not exist in the system

**Steps:**
```
POST /api/v1/auth/signup
{
  "method": "phone",
  "phone": "+447700900001"
}
```

**Expected Result:**
- HTTP 201
- Body contains `next: "verify_otp"`
- SMS queued in BullMQ (check queue dashboard or logs)

---

## TC-AUTH-003: Signup with Already Existing Verified Email

**Preconditions:** `testuser+001@example.com` was created and verified in TC-AUTH-001

**Steps:**
```
POST /api/v1/auth/signup
{ "method": "email", "email": "testuser+001@example.com" }
```

**Expected Result:**
- HTTP 409 Conflict
- Message: "User already exists"

---

## TC-AUTH-004: Signup with Existing but Unverified Email

**Preconditions:** Email exists but OTP was never submitted

**Steps:**
```
POST /api/v1/auth/signup
{ "method": "email", "email": "unverified@example.com" }
```

**Expected Result:**
- HTTP 201
- A new OTP is generated (not a conflict)
- Allows re-entering the OTP flow

---

## TC-AUTH-005: Verify OTP — Happy Path (Signup)

**Preconditions:** TC-AUTH-001 completed, `code` captured from response

**Steps:**
```
POST /api/v1/auth/verify-otp
{
  "identifier": "testuser+001@example.com",
  "code": "{{code from TC-AUTH-001}}",
  "purpose": "signup",
  "method": "email"
}
```

**Expected Result:**
- HTTP 200
- Body contains `accessToken` and `refreshToken`
- Body contains `user.id` and `user.email`
- Body contains `next: "onboarding"` (new user, onboarding not complete)
- User `isVerified` = true in DB

---

## TC-AUTH-006: Verify OTP — Wrong Code

**Preconditions:** Active OTP exists for identifier

**Steps:**
```
POST /api/v1/auth/verify-otp
{
  "identifier": "testuser+001@example.com",
  "code": "000000",
  "purpose": "signup",
  "method": "email"
}
```

**Expected Result:**
- HTTP 400
- Message: "Invalid OTP"

---

## TC-AUTH-007: Verify OTP — Expired Code

**Preconditions:** OTP was generated more than 10 minutes ago (adjust OTP TTL in test env or wait)

**Steps:** Submit correct code after expiry window

**Expected Result:**
- HTTP 400
- Message: "OTP expired"

---

## TC-AUTH-008: Resend OTP — Happy Path

**Preconditions:** OTP was recently sent (within cooldown window)

**Steps:**
```
POST /api/v1/auth/resend-otp
{
  "identifier": "testuser+001@example.com",
  "purpose": "signup",
  "method": "email"
}
```

**Expected Result:**
- HTTP 200
- Body contains new `code`
- Previous OTP is now invalid (verify this by submitting old code — should get Invalid OTP)

---

## TC-AUTH-009: Resend OTP — During Cooldown

**Steps:** Call resend-otp twice within 60 seconds

**Expected Result:**
- Second call: HTTP 429
- Message: "Please wait before requesting another OTP"

---

## TC-AUTH-010: Login — Happy Path

**Preconditions:** Verified user exists

**Steps:**
```
POST /api/v1/auth/login
{
  "method": "email",
  "identifier": "testuser+001@example.com"
}
```

**Expected Result:**
- HTTP 200
- OTP code returned in response (test env)

Then verify:
```
POST /api/v1/auth/verify-otp
{
  "identifier": "testuser+001@example.com",
  "code": "{{code}}",
  "purpose": "login",
  "method": "email"
}
```

**Expected Result:**
- HTTP 200
- `accessToken` and `refreshToken` returned
- `next: "home"` (existing user, onboarding complete)

---

## TC-AUTH-011: Login — Non-Existent User

**Steps:**
```
POST /api/v1/auth/login
{ "method": "email", "identifier": "nobody@example.com" }
```

**Expected Result:**
- HTTP 404
- Message: "User not found"

---

## TC-AUTH-012: Refresh Token — Happy Path

**Preconditions:** Valid `refreshToken` from login

**Steps:**
```
POST /api/v1/auth/refresh
{ "refreshToken": "{{refreshToken}}" }
```

**Expected Result:**
- HTTP 200
- New `accessToken` and `refreshToken` returned
- Old `refreshToken` is now revoked (test by using it again — should fail)

---

## TC-AUTH-013: Refresh Token — Reuse After Rotation

**Preconditions:** TC-AUTH-012 completed

**Steps:** Submit the OLD refresh token again

**Expected Result:**
- HTTP 401
- Message: "Invalid refresh token"

---

## TC-AUTH-014: Logout

**Preconditions:** Valid `refreshToken`

**Steps:**
```
POST /api/v1/auth/logout
{ "refreshToken": "{{refreshToken}}" }
```

**Expected Result:**
- HTTP 200
- Message: "Logged out successfully"
- Refresh token is revoked in DB
- Using the same refresh token again returns 401

---

## TC-AUTH-015: Access Protected Route Without Token

**Steps:**
```
GET /api/v1/users/me
(no Authorization header)
```

**Expected Result:**
- HTTP 401
- Message: "Not authorized, no token"

---

## TC-AUTH-016: Access Protected Route With Expired Token

**Steps:** Use an expired `accessToken`

**Expected Result:**
- HTTP 401
- Message: "Not authorized, token failed"

---

---

# MODULE 2: User Profile & Onboarding

---

## TC-USER-001: Get My Profile

**Preconditions:** Logged in as passenger_a

**Steps:**
```
GET /api/v1/users/me
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 200
- Returns user object with `id`, `email`/`phone`, `name`, `onboardingStatus`

---

## TC-USER-002: Update Profile — Happy Path

**Steps:**
```
PUT /api/v1/users/me
Authorization: Bearer {{token}}
{
  "name": "Alice Smith",
  "nickName": "Ali",
  "salutation": "MS",
  "dob": "1995-06-15"
}
```

**Expected Result:**
- HTTP 200
- Returned user has updated `name`, `nickName`, `salutation`, `dob`

---

## TC-USER-003: Set Travel Preferences

**Steps:**
```
POST /api/v1/travel-preferences
Authorization: Bearer {{token}}
{
  "chattiness": "LOW",
  "pets": "NO"
}
```

**Expected Result:**
- HTTP 200 or 201
- Preferences saved

---

## TC-USER-004: Update Travel Preferences

**Preconditions:** TC-USER-003 completed

**Steps:**
```
PUT /api/v1/travel-preferences
{ "chattiness": "HIGH", "pets": "YES" }
```

**Expected Result:**
- HTTP 200
- Updated preferences returned

---

## TC-USER-005: Upload Avatar

**Steps:**
```
POST /api/v1/users/avatar
Authorization: Bearer {{token}}
Content-Type: multipart/form-data
file: [image file < 5MB, JPEG or PNG]
```

**Expected Result:**
- HTTP 200
- Response contains `avatarUrl` pointing to S3
- URL is accessible (GET the URL, should return the image)

---

## TC-USER-006: Upload Avatar — File Too Large

**Steps:** Submit image > 5MB

**Expected Result:**
- HTTP 400 or 413
- Error about file size

---

---

# MODULE 3: Vehicle Management

---

## TC-VEH-001: Add a Vehicle

**Preconditions:** Logged in as driver_a

**Steps:**
```
POST /api/v1/vehicles
Authorization: Bearer {{token}}
{
  "licenseCountry": "GB",
  "licenseNumber": "AB12 CDE",
  "brand": "Toyota",
  "model_name": "Prius",
  "type": "sedan",
  "color": "Silver",
  "year": 2021
}
```

**Expected Result:**
- HTTP 201
- Vehicle created with `id`, `isVerified: false`

---

## TC-VEH-002: List My Vehicles

**Steps:**
```
GET /api/v1/vehicles
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 200
- Array includes the vehicle from TC-VEH-001

---

## TC-VEH-003: Upload Vehicle Document

**Preconditions:** Vehicle from TC-VEH-001

**Steps:**
```
POST /api/v1/vehicles/{{vehicleId}}/documents
Content-Type: multipart/form-data
file: [valid image]
documentType: VEHICLE_DOCUMENT
```

**Expected Result:**
- HTTP 200 or 201
- Document uploaded to S3, URL returned

---

## TC-VEH-004: Delete Vehicle

**Steps:**
```
DELETE /api/v1/vehicles/{{vehicleId}}
```

**Expected Result:**
- HTTP 200
- Vehicle has `deletedAt` set (soft delete)
- Vehicle no longer appears in `GET /vehicles` list

---

## TC-VEH-005: Delete Vehicle Belonging to Another User

**Preconditions:** driver_b tries to delete driver_a's vehicle

**Steps:**
```
DELETE /api/v1/vehicles/{{driver_a_vehicleId}}
Authorization: Bearer {{driver_b_token}}
```

**Expected Result:**
- HTTP 403 or 404
- Vehicle is NOT deleted

---

---

# MODULE 4: Driving Licence Verification

---

## TC-DL-001: Initiate DL Verification Session

**Preconditions:** Logged in as driver_a, Veriff keys configured

**Steps:**
```
POST /api/v1/dl-verification/session
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 201
- Response contains `sessionUrl` (Veriff URL for the user to complete)
- `DlVerification` record created in DB with status `PENDING`

---

## TC-DL-002: Get Verification Status

**Steps:**
```
GET /api/v1/dl-verification/status
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 200
- Returns current verification status and session info

---

## TC-DL-003: Veriff Webhook — Approved Decision

**Preconditions:** Active Veriff session for driver_a

**Steps:** Simulate Veriff webhook callback
```
POST /api/v1/dl-verification/webhook
Content-Type: application/json
X-HMAC-SIGNATURE: {{valid_hmac}}
{
  "status": "success",
  "verification": {
    "id": "{{veriff_session_id}}",
    "status": "approved",
    "code": 9001
  }
}
```

**Expected Result:**
- HTTP 200
- `DlVerification.status` = `APPROVED`
- `User.dlVerified` = `true`

---

## TC-DL-004: Veriff Webhook — Invalid Signature

**Steps:** Send webhook with wrong HMAC signature

**Expected Result:**
- HTTP 400
- Verification status unchanged

---

---

# MODULE 5: Publish Ride (Driver Flow)

This is a multi-step wizard. Each step must be completed in sequence.

---

## TC-RIDE-001: Step 1 — Set Origin

**Preconditions:** Logged in as driver_a, vehicle exists

**Steps:**
```
POST /api/v1/publish-ride/draft/origin
Authorization: Bearer {{driver_token}}
{
  "originPlaceId": "ChIJdd4hrwug2EcRmSrV3Vo6llI",
  "originAddress": "London, UK",
  "originLat": 51.5074,
  "originLng": -0.1278
}
```

**Expected Result:**
- HTTP 200 or 201
- Draft saved to Redis
- Any previous draft for this user is replaced

---

## TC-RIDE-002: Step 2 — Set Destination

**Preconditions:** TC-RIDE-001 completed

**Steps:**
```
PUT /api/v1/publish-ride/draft/destination
{
  "destinationPlaceId": "ChIJ-TBiMBp3fkgRvXqFABNNkv0",
  "destinationAddress": "Manchester, UK",
  "destinationLat": 53.4808,
  "destinationLng": -2.2426
}
```

**Expected Result:**
- HTTP 200
- Draft updated with destination

---

## TC-RIDE-003: Step 3 — Compute Routes

**Preconditions:** Origin and destination set

**Steps:**
```
GET /api/v1/publish-ride/draft/routes/compute
Authorization: Bearer {{driver_token}}
```

**Expected Result:**
- HTTP 200
- Array of 1-3 route options returned
- Each route has `polyline`, `distanceMeters`, `durationSeconds`

---

## TC-RIDE-004: Step 4 — Select Route

**Preconditions:** Routes computed from TC-RIDE-003

**Steps:**
```
PUT /api/v1/publish-ride/draft/routes/select
{
  "routeIndex": 0
}
```

**Expected Result:**
- HTTP 200
- Draft updated with selected route polyline and distance

---

## TC-RIDE-005: Step 5 — Add Stopovers (Optional)

**Steps:**
```
PUT /api/v1/publish-ride/draft/stopovers
{
  "stopovers": [
    {
      "placeId": "ChIJXXXXXX",
      "address": "Milton Keynes, UK",
      "lat": 52.0406,
      "lng": -0.7594,
      "pricePerSeat": 8.00
    }
  ]
}
```

**Expected Result:**
- HTTP 200
- Stopovers added to draft

---

## TC-RIDE-006: Step 6 — Set Schedule

**Steps:**
```
PUT /api/v1/publish-ride/draft/schedule
{
  "departureDate": "2026-06-15",
  "departureTime": "08:00"
}
```

**Expected Result:**
- HTTP 200
- Schedule saved

**Negative test:** Submit a departure date in the past
- Expected: HTTP 400

---

## TC-RIDE-007: Step 7 — Set Capacity

**Steps:**
```
PUT /api/v1/publish-ride/draft/capacity
{
  "totalSeats": 3,
  "maxLuggagePerPerson": 1,
  "backSeatOnly": false
}
```

**Expected Result:**
- HTTP 200

**Negative test:** Set `totalSeats: 0`
- Expected: HTTP 400

---

## TC-RIDE-008: Step 8 — Get Recommended Price

**Steps:**
```
GET /api/v1/publish-ride/draft/pricing/recommended
Authorization: Bearer {{driver_token}}
```

**Expected Result:**
- HTTP 200
- Returns `recommendedPrice`, `fuelCostEstimate`, `currency`

---

## TC-RIDE-009: Step 9 — Set Pricing

**Steps:**
```
PUT /api/v1/publish-ride/draft/pricing
{
  "basePricePerSeat": 15.00,
  "currency": "GBP"
}
```

**Expected Result:**
- HTTP 200

**Negative test:** Set price to 0
- Expected: HTTP 400

---

## TC-RIDE-010: Step 10 — Publish Ride

**Preconditions:** All required draft steps completed

**Steps:**
```
POST /api/v1/publish-ride/draft/publish
Authorization: Bearer {{driver_token}}
```

**Expected Result:**
- HTTP 201
- Ride created in DB with `status: PUBLISHED`
- `availableSeats` equals `totalSeats`
- Draft deleted from Redis
- Response contains `rideId`

---

## TC-RIDE-011: Publish Ride — Incomplete Draft

**Preconditions:** Draft exists but schedule was not set

**Steps:** Call publish endpoint without completing the schedule step

**Expected Result:**
- HTTP 400
- Error indicating required step is missing

---

## TC-RIDE-012: List Driver's Published Rides

**Steps:**
```
GET /api/v1/publish-ride
Authorization: Bearer {{driver_token}}
```

**Expected Result:**
- HTTP 200
- Array includes the ride from TC-RIDE-010
- Pagination info present (`page`, `limit`, `total`)

---

## TC-RIDE-013: Get Single Published Ride

**Steps:**
```
GET /api/v1/publish-ride/{{rideId}}
Authorization: Bearer {{driver_token}}
```

**Expected Result:**
- HTTP 200
- Full ride details including waypoints, vehicle, driver info

---

## TC-RIDE-014: Cancel a Published Ride

**Steps:**
```
DELETE /api/v1/publish-ride/{{rideId}}
Authorization: Bearer {{driver_token}}
```

**Expected Result:**
- HTTP 200
- Ride `status` = `CANCELLED`

---

---

# MODULE 6: Search Rides (Passenger Flow)

---

## TC-SEARCH-001: Basic Search — Happy Path

**Preconditions:** driver_a has a published ride: London → Manchester on 2026-06-15

**Steps:**
```
GET /api/v1/search-rides?originLat=51.5074&originLng=-0.1278&destinationLat=53.4808&destinationLng=-2.2426&departureDate=2026-06-15
Authorization: Bearer {{passenger_token}}
```

**Expected Result:**
- HTTP 200
- Results array includes driver_a's ride
- Each result contains `driver`, `vehicle`, `availableSeats`, `basePricePerSeat`
- Pagination present

---

## TC-SEARCH-002: Search — No Matching Rides

**Steps:** Search for a route/date with no published rides

**Expected Result:**
- HTTP 200
- `rides: []`
- `total: 0`

---

## TC-SEARCH-003: Search — Exclude Own Rides

**Preconditions:** driver_a is searching for rides they published themselves

**Steps:** Search as driver_a with same origin/destination/date as their own ride

**Expected Result:**
- HTTP 200
- driver_a's own ride is NOT in results

---

## TC-SEARCH-004: Search — Filter by Max Price

**Steps:**
```
GET /api/v1/search-rides?...&maxPrice=10
```

**Expected Result:**
- HTTP 200
- No ride in results has `basePricePerSeat > 10`

---

## TC-SEARCH-005: Search — Segment Ride (Stopover Pickup)

**Preconditions:** driver_a has a ride London → Manchester with stopover at Milton Keynes

**Steps:** Search with origin at Milton Keynes, destination at Manchester

**Expected Result:**
- HTTP 200
- The London → Manchester ride appears in results
- `segmentRide` field shows MK → Manchester segment with correct price

---

## TC-SEARCH-006: Get Ride Details

**Steps:**
```
GET /api/v1/search-rides/{{rideId}}
Authorization: Bearer {{passenger_token}}
```

**Expected Result:**
- HTTP 200
- Full ride detail including waypoints, driver rating stats, vehicle info

---

---

# MODULE 7: Booking — Passenger Flow

---

## TC-BOOK-001: Price Preview Before Booking

**Preconditions:** PUBLISHED ride exists with `basePricePerSeat: 15.00`

**Steps:**
```
POST /api/v1/bookings/price-preview
Authorization: Bearer {{passenger_token}}
{
  "rideId": "{{rideId}}",
  "seatsBooked": 2,
  "luggageCount": 1
}
```

**Expected Result:**
- HTTP 200
- `subtotal`: 30.00
- `luggageFee`: 5.00 (£5 per item)
- `totalPrice`: 35.00
- `currency`: "GBP"

---

## TC-BOOK-002: Create Booking — Bypass Payment Mode

**Preconditions:**
- `BOOKING_PAYMENT_MODE=bypass`
- PUBLISHED ride with 3 available seats
- passenger_a is not the driver

**Steps:**
```
POST /api/v1/bookings
Authorization: Bearer {{passenger_token}}
{
  "rideId": "{{rideId}}",
  "seatsBooked": 1,
  "luggageCount": 0
}
```

**Expected Result:**
- HTTP 201
- `status: "DRIVER_PENDING"`
- `driverDecisionDeadlineAt` is set (future timestamp)
- Driver (driver_a) receives a notification of type `booking.driver.decision_requested`
- `availableSeats` on the ride decremented by 1

---

## TC-BOOK-003: Create Booking — Cannot Book Own Ride

**Preconditions:** driver_a tries to book their own ride

**Steps:**
```
POST /api/v1/bookings
Authorization: Bearer {{driver_a_token}}
{ "rideId": "{{driver_a_rideId}}", "seatsBooked": 1 }
```

**Expected Result:**
- HTTP 400 or 409
- Message: references CANNOT_BOOK_OWN_RIDE

---

## TC-BOOK-004: Create Booking — Insufficient Seats

**Preconditions:** Ride has 1 available seat

**Steps:** Request `seatsBooked: 2`

**Expected Result:**
- HTTP 409
- Message: references INSUFFICIENT_SEATS

---

## TC-BOOK-005: Create Booking — Duplicate Booking

**Preconditions:** passenger_a already has an active booking on this ride

**Steps:** Submit another booking for the same ride

**Expected Result:**
- HTTP 409
- Message: references BOOKING_ALREADY_EXISTS

---

## TC-BOOK-006: Create Booking — Exceeds Max Seats Per Booking

**Steps:** Request `seatsBooked: 5` (limit is 4)

**Expected Result:**
- HTTP 400
- Message: references MAXIMUM_SEATS_EXCEEDED

---

## TC-BOOK-007: Get Booking by ID

**Preconditions:** TC-BOOK-002 completed, `bookingId` captured

**Steps:**
```
GET /api/v1/bookings/{{bookingId}}
Authorization: Bearer {{passenger_token}}
```

**Expected Result:**
- HTTP 200
- `status: "DRIVER_PENDING"`
- `decisionDeadline` object present with `deadlineAt`, `timeRemainingSeconds`, `isExpired: false`
- `ride` object present with full ride details

---

## TC-BOOK-008: Get Booking — By Another User

**Preconditions:** passenger_b tries to read passenger_a's booking

**Steps:**
```
GET /api/v1/bookings/{{passenger_a_bookingId}}
Authorization: Bearer {{passenger_b_token}}
```

**Expected Result:**
- HTTP 404 (booking not found for that user)

---

## TC-BOOK-009: List Bookings

**Steps:**
```
GET /api/v1/bookings
Authorization: Bearer {{passenger_token}}
```

**Expected Result:**
- HTTP 200
- Array of passenger_a's bookings
- Pagination present

---

## TC-BOOK-010: List Bookings — Filter by Status

**Steps:**
```
GET /api/v1/bookings?status=DRIVER_PENDING
```

**Expected Result:**
- HTTP 200
- Only bookings with `status: DRIVER_PENDING` returned

---

---

# MODULE 8: Driver Booking Decision

---

## TC-DRIVER-001: Accept Booking — Happy Path

**Preconditions:**
- Booking from TC-BOOK-002 in `DRIVER_PENDING` status
- Logged in as driver_a
- Deadline has NOT expired

**Steps:**
```
POST /api/v1/driver/bookings/{{bookingId}}/accept
Authorization: Bearer {{driver_token}}
```

**Expected Result:**
- HTTP 200
- `status: "CONFIRMED"`
- passenger_a receives a notification of type `booking.driver.accepted`
- passenger_a receives OTP codes (`pickupOtp`, `dropOtp`) in the notification data
- `pickupOtpHash` and `dropOtpHash` set on the booking in DB

---

## TC-DRIVER-002: Accept Booking — Not the Assigned Driver

**Preconditions:** Booking belongs to driver_a's ride

**Steps:** driver_b tries to accept

```
POST /api/v1/driver/bookings/{{bookingId}}/accept
Authorization: Bearer {{driver_b_token}}
```

**Expected Result:**
- HTTP 403
- Message: "Only the assigned driver can perform this action"

---

## TC-DRIVER-003: Accept Booking — Wrong Status

**Preconditions:** Booking already `CONFIRMED`

**Steps:** driver_a tries to accept again

**Expected Result:**
- HTTP 409
- Message: "Booking is not waiting for driver decision"

---

## TC-DRIVER-004: Accept Booking — After Deadline Expired

**Preconditions:** `driverDecisionDeadlineAt` is in the past

**Steps:**
```
POST /api/v1/driver/bookings/{{bookingId}}/accept
```

**Expected Result:**
- HTTP 409
- Message: "Driver decision deadline has passed"

---

## TC-DRIVER-005: Reject Booking — Happy Path

**Preconditions:** Fresh booking in `DRIVER_PENDING` status

**Steps:**
```
POST /api/v1/driver/bookings/{{bookingId}}/reject
Authorization: Bearer {{driver_token}}
{
  "reason": "I cannot accommodate extra luggage on this trip"
}
```

**Expected Result:**
- HTTP 200
- `status: "CANCELLED"`
- passenger_a receives rejection notification with the reason
- `availableSeats` on the ride restored

---

## TC-DRIVER-006: Reject Booking — Without Reason

**Steps:**
```
POST /api/v1/driver/bookings/{{bookingId}}/reject
{} (empty body)
```

**Expected Result:**
- HTTP 400
- Validation error requiring reason

---

## TC-DRIVER-007: Driver Cancels After Accepting

**Preconditions:** Booking is `CONFIRMED` (driver already accepted)

**Steps:**
```
POST /api/v1/driver/bookings/{{bookingId}}/cancel
Authorization: Bearer {{driver_token}}
{
  "reason": "My vehicle broke down, I cannot make this trip"
}
```

**Expected Result:**
- HTTP 200
- `status: "CANCELLED"`
- 50% penalty recorded in `DriverPenaltyEvent` table
- passenger_a receives cancellation notification
- Refund initiated (full refund to passenger)
- `availableSeats` restored on the ride

---

## TC-DRIVER-008: Driver Cancels — Without Reason

**Steps:** Call cancel endpoint with empty body

**Expected Result:**
- HTTP 400
- Validation error requiring reason

---

---

# MODULE 9: OTP Verification — Ride Day

---

## TC-OTP-001: Verify Pickup OTP — Happy Path

**Preconditions:**
- Booking in `CONFIRMED` status
- Driver is logged in
- passenger_a provides their pickup OTP to the driver verbally

**Steps:**
```
POST /api/v1/driver/bookings/{{bookingId}}/pickup-otp/verify
Authorization: Bearer {{driver_token}}
{
  "otp": "{{pickupOtp from passenger_a's booking}}"
}
```

**Expected Result:**
- HTTP 200
- `status: "IN_PROGRESS"`
- `pickupOtpVerifiedAt` timestamp set
- passenger_a receives notification that ride has started

---

## TC-OTP-002: Verify Pickup OTP — Wrong Code

**Steps:** Submit incorrect OTP

**Expected Result:**
- HTTP 400
- Message: "OTP is invalid"
- `otpAttemptCount` incremented by 1

---

## TC-OTP-003: Verify Pickup OTP — Expired OTP

**Preconditions:** Pickup OTP TTL (6 hours) has passed

**Steps:** Submit the correct OTP after expiry

**Expected Result:**
- HTTP 400
- Message: "OTP has expired"

---

## TC-OTP-004: Verify Pickup OTP — Attempt Limit Exceeded

**Preconditions:** 5 failed OTP attempts already recorded

**Steps:** Submit another OTP attempt

**Expected Result:**
- HTTP 409
- Message: "Maximum OTP attempts exceeded"
- Further attempts still blocked even with correct OTP

---

## TC-OTP-005: Verify Drop OTP — Happy Path

**Preconditions:** Booking in `IN_PROGRESS` status (pickup OTP verified)

**Steps:**
```
POST /api/v1/driver/bookings/{{bookingId}}/drop-otp/verify
Authorization: Bearer {{driver_token}}
{
  "otp": "{{dropOtp from passenger_a's booking}}"
}
```

**Expected Result:**
- HTTP 200
- `status: "COMPLETED"`
- `dropOtpVerifiedAt` timestamp set
- Both driver and passenger receive a rating prompt notification

---

## TC-OTP-006: Verify Drop OTP — Before Pickup OTP

**Preconditions:** Booking is `CONFIRMED` (pickup not done yet)

**Steps:** Attempt to verify drop OTP

**Expected Result:**
- HTTP 409
- Message indicates invalid booking status for this operation

---

---

# MODULE 10: Booking Cancellations

---

## TC-CANCEL-001: Passenger Cancels — Before Driver Decision (Full Refund)

**Preconditions:**
- Booking in `DRIVER_PENDING`
- `BOOKING_PAYMENT_MODE=bypass`

**Steps:**
```
POST /api/v1/bookings/{{bookingId}}/cancel
Authorization: Bearer {{passenger_token}}
```

**Expected Result:**
- HTTP 200
- `status: "CANCELLED"`
- `refundPercent: 100`
- `availableSeats` restored

---

## TC-CANCEL-002: Passenger Cancels — >24h Before Departure (50% Refund)

**Preconditions:**
- Booking `CONFIRMED`
- Departure is > 24 hours away
- Payment was captured

**Steps:**
```
POST /api/v1/bookings/{{bookingId}}/cancel
```

**Expected Result:**
- HTTP 200
- `refundPercent: 50`
- `refundAmount` = 50% of `paymentAmount`

---

## TC-CANCEL-003: Passenger Cancels — <24h Before Departure (No Refund)

**Preconditions:**
- Booking `CONFIRMED`
- Departure is < 24 hours away

**Steps:**
```
POST /api/v1/bookings/{{bookingId}}/cancel
```

**Expected Result:**
- HTTP 200
- `refundPercent: 0`
- `refundAmount: 0`
- `refundInitiated: false`

---

## TC-CANCEL-004: Passenger Cancels After Deadline Expired (Full Refund)

**Preconditions:**
- Booking `DRIVER_PENDING`
- `driverDecisionDeadlineAt` is in the past

**Steps:**
```
POST /api/v1/bookings/{{bookingId}}/cancel
```

**Expected Result:**
- HTTP 200
- `refundPercent: 100`
- `cancellationReason: "DRIVER_NO_RESPONSE"`

---

## TC-CANCEL-005: Extend Wait for Driver After Deadline

**Preconditions:**
- Booking `DRIVER_PENDING`
- Initial deadline has just expired
- Booking has NOT been extended before

**Steps:**
```
POST /api/v1/bookings/{{bookingId}}/extend-wait
Authorization: Bearer {{passenger_token}}
```

**Expected Result:**
- HTTP 200
- `newDeadline` is 1 hour from now
- `deadlineExtendedAt` is set
- Driver receives another notification

---

## TC-CANCEL-006: Extend Wait — Already Extended

**Preconditions:** TC-CANCEL-005 completed

**Steps:** Call extend-wait again

**Expected Result:**
- HTTP 409
- Error: ALREADY_EXTENDED

---

## TC-CANCEL-007: Cancel a Non-Cancellable Booking

**Preconditions:** Booking is `COMPLETED`

**Steps:**
```
POST /api/v1/bookings/{{bookingId}}/cancel
```

**Expected Result:**
- HTTP 404 (booking not found in cancellable statuses)

---

---

# MODULE 11: Booking Deadline Expiry (Background Job / Cron)

These tests verify the automated deadline expiry behavior.

---

## TC-DEADLINE-001: Initial Deadline Expires — Notification Sent

**Preconditions:**
- Booking in `DRIVER_PENDING`
- Manually set `driverDecisionDeadlineAt` to 1 minute ago in DB (or wait for real expiry)

**Trigger:** Wait for the cron to run (runs every minute)

**Expected Result:**
- `deadlineExpiredNotifiedAt` is set on the booking
- passenger_a receives a notification type `booking.driver.deadline_expired`
- Body says driver hasn't responded; passenger can wait or cancel

---

## TC-DEADLINE-002: Extended Deadline Expires — Auto Cancel

**Preconditions:**
- Booking was extended (`deadlineExtendedAt` is set)
- Extended deadline has now passed
- `autoCancelledAt` is null

**Trigger:** Wait for the cron to run

**Expected Result:**
- `status: "CANCELLED"`
- `autoCancelledAt` set
- `cancellationReason: "DRIVER_NO_RESPONSE_EXTENDED"`
- `refundPercent: 100`
- passenger_a receives notification type `booking.cancelled.no_driver_response`
- `availableSeats` restored on the ride

---

---

# MODULE 12: Ratings

---

## TC-RATE-001: Passenger Rates Driver After Completed Ride

**Preconditions:** Booking is `COMPLETED`

**Steps:**
```
POST /api/v1/ratings
Authorization: Bearer {{passenger_token}}
{
  "bookingId": "{{bookingId}}",
  "stars": 5,
  "reviewText": "Excellent driver, very punctual"
}
```

**Expected Result:**
- HTTP 201
- Rating created
- driver_a's `UserRatingStats.averageRating` updated
- `totalRatings` incremented

---

## TC-RATE-002: Driver Rates Passenger After Completed Ride

**Steps:**
```
POST /api/v1/ratings
Authorization: Bearer {{driver_token}}
{
  "bookingId": "{{bookingId}}",
  "stars": 4,
  "reviewText": "Polite and on time"
}
```

**Expected Result:**
- HTTP 201
- Rating created for the passenger

---

## TC-RATE-003: Rating Stars Out of Range

**Steps:** Submit with `stars: 6`

**Expected Result:**
- HTTP 400 or 422
- Validation error

---

## TC-RATE-004: Rate a Non-Completed Booking

**Preconditions:** Booking is `CONFIRMED` (not completed)

**Steps:** Submit a rating

**Expected Result:**
- HTTP 400 or 409
- Message references BOOKING_NOT_COMPLETED

---

## TC-RATE-005: Duplicate Rating

**Preconditions:** TC-RATE-001 completed

**Steps:** passenger_a tries to rate the same booking again

**Expected Result:**
- HTTP 409
- Message references RATING_ALREADY_SUBMITTED

---

## TC-RATE-006: Rate Booking You're Not Part Of

**Preconditions:** passenger_b tries to rate a booking between passenger_a and driver_a

**Steps:**
```
POST /api/v1/ratings
Authorization: Bearer {{passenger_b_token}}
{ "bookingId": "{{passenger_a_bookingId}}", "stars": 3 }
```

**Expected Result:**
- HTTP 403 or 404
- Message references NOT_BOOKING_PARTICIPANT

---

---

# MODULE 13: Chat

---

## TC-CHAT-001: Connect to WebSocket

**Preconditions:** Valid access token from a confirmed booking between passenger_a and driver_a

**Steps:** Connect to WebSocket
```
ws://localhost:3000
Auth: { token: "{{accessToken}}" }
```

**Expected Result:**
- Connection established
- No error event received

---

## TC-CHAT-002: Connect Without Token

**Steps:** Connect to WebSocket without auth token

**Expected Result:**
- Connection rejected
- Error: "Authentication required"

---

## TC-CHAT-003: Send a Text Message

**Preconditions:** passenger_a connected, confirmed booking exists with driver_a

**Steps:** Emit event
```javascript
socket.emit('chat:send', {
  receiverId: "{{driver_a_id}}",
  text: "Hello, I will be at the pickup point",
  clientMsgId: "unique-client-id-001",
  type: "TEXT"
})
```

**Expected Result:**
- Callback returns `{ success: true, message: { id, conversationId, createdAt } }`
- driver_a (if connected) receives `chat:message` event with the message
- Message persisted in DB with `deliveredAt` set if driver was online

---

## TC-CHAT-004: Send Message Without Confirmed Booking

**Preconditions:** passenger_b has no booking with driver_a

**Steps:** passenger_b tries to send a message to driver_a

**Expected Result:**
- Callback returns `{ error: "Chat is only available after a booking is confirmed" }`

---

## TC-CHAT-005: Send Message to Self

**Steps:** passenger_a sends a message to their own userId

**Expected Result:**
- Callback returns `{ error: "You cannot send a message to yourself" }`

---

## TC-CHAT-006: Send Location Message

**Steps:**
```javascript
socket.emit('chat:send', {
  receiverId: "{{driver_id}}",
  clientMsgId: "loc-001",
  type: "LOCATION",
  payloadJson: { latitude: 51.5074, longitude: -0.1278 }
})
```

**Expected Result:**
- Success callback
- Message persisted with `type: LOCATION`

---

## TC-CHAT-007: Typing Indicator

**Steps:**
```javascript
socket.emit('chat:typing', {
  conversationId: "{{conversationId}}",
  receiverId: "{{driver_id}}"
})
```

**Expected Result:**
- driver_a receives `chat:typing` event with `{ conversationId, senderId }`

---

## TC-CHAT-008: Message Sync on Reconnect

**Preconditions:**
- passenger_a was offline
- driver_a sent messages while passenger_a was offline

**Steps:**
1. passenger_a reconnects to WebSocket
2. Server automatically emits `chat:sync` with pending messages

**Expected Result:**
- `chat:sync` event received with all undelivered messages
- Messages marked as `deliveredAt` in DB

---

## TC-CHAT-009: Read Receipt

**Steps:**
```javascript
socket.emit('chat:read', {
  conversationId: "{{conversationId}}",
  lastReadMessageId: "{{messageId}}"
})
```

**Expected Result:**
- driver_a receives `chat:read` event
- Messages up to `lastReadMessageId` have `readAt` set in DB

---

## TC-CHAT-010: Get Chat History via REST

**Steps:**
```
GET /api/v1/chat/conversations/{{conversationId}}/messages?limit=20
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 200
- Paginated message list, newest first
- Each message has `id`, `text`, `type`, `senderId`, `createdAt`

---

---

# MODULE 14: Notifications

---

## TC-NOTIF-001: Get Notifications List

**Steps:**
```
GET /api/v1/notifications
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 200
- Cursor-paginated list of notifications
- Each has `id`, `type`, `title`, `body`, `isRead`, `createdAt`

---

## TC-NOTIF-002: Get Unread Count

**Steps:**
```
GET /api/v1/notifications/unread-count
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 200
- `count: N` where N is number of unread notifications
- Second call returns same value (Redis cached)

---

## TC-NOTIF-003: Mark Notifications as Read

**Preconditions:** At least 2 unread notifications exist

**Steps:**
```
POST /api/v1/notifications/mark-read
Authorization: Bearer {{token}}
{
  "notificationIds": ["{{id1}}", "{{id2}}"]
}
```

**Expected Result:**
- HTTP 200
- `markedCount: 2`
- `GET /notifications/unread-count` decreases by 2
- Both notifications have `isRead: true` in DB

---

## TC-NOTIF-004: Register Device Token for Push

**Steps:**
```
POST /api/v1/notifications/device-token
Authorization: Bearer {{token}}
{
  "platform": "ios",
  "token": "fcm-token-abc123"
}
```

**Expected Result:**
- HTTP 200 or 201
- Token stored in DB for this user

---

## TC-NOTIF-005: Register Same Device Token Again (Idempotent)

**Steps:** Submit the same FCM token again (device token should be upserted, not duplicated)

**Expected Result:**
- HTTP 200 or 201
- No duplicate token in DB
- `lastSeenAt` updated

---

---

# MODULE 15: Maps

---

## TC-MAPS-001: Autocomplete Address

**Steps:**
```
GET /api/v1/maps/autocomplete?input=Lond
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 200
- Array of place suggestions with `placeId` and `description`

---

## TC-MAPS-002: Get Place Details

**Steps:**
```
GET /api/v1/maps/place?placeId=ChIJdd4hrwug2EcRmSrV3Vo6llI
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 200
- Returns `lat`, `lng`, `formattedAddress` for London

---

## TC-MAPS-003: Get Directions

**Steps:**
```
GET /api/v1/maps/directions?originLat=51.5074&originLng=-0.1278&destLat=53.4808&destLng=-2.2426
Authorization: Bearer {{token}}
```

**Expected Result:**
- HTTP 200
- Returns route options with `polyline`, `distanceMeters`, `durationSeconds`

---

---

# MODULE 16: End-to-End User Journeys

These are full scenario walkthroughs that must be run as complete flows.

---

## E2E-001: Complete Happy Path — New User Books a Ride

**Scenario:** A new user signs up, a driver publishes a ride, the passenger books it, driver accepts, ride completes, both rate each other.

**Steps:**
1. Sign up driver_a with email → verify OTP → tokens issued
2. Complete driver_a profile (name, salutation, dob)
3. Add vehicle to driver_a account
4. driver_a publishes ride: London → Manchester, 2026-06-20 08:00, 3 seats, £15/seat
5. Sign up passenger_a with phone → verify OTP → tokens issued
6. passenger_a searches for London → Manchester on 2026-06-20 → finds driver_a's ride
7. passenger_a requests price preview: 1 seat, 1 luggage → verifies £20 total
8. passenger_a creates booking for 1 seat → status `DRIVER_PENDING`
9. driver_a receives notification of new booking request
10. driver_a accepts booking → status `CONFIRMED`
11. passenger_a receives notification with pickup OTP
12. driver_a verifies pickup OTP on ride day → status `IN_PROGRESS`
13. driver_a verifies drop OTP at destination → status `COMPLETED`
14. passenger_a rates driver_a: 5 stars
15. driver_a rates passenger_a: 4 stars
16. Check `UserRatingStats` for both users are updated

**Expected Result at Each Step:** All above expected results met. Final state: booking `COMPLETED`, both ratings created, stats updated.

---

## E2E-002: Driver Rejects — Passenger Re-Books

**Scenario:** Driver rejects booking. Passenger finds another driver and books successfully.

**Steps:**
1. passenger_a books driver_a's ride → `DRIVER_PENDING`
2. driver_a rejects with reason "no luggage space" → `CANCELLED`
3. passenger_a receives rejection notification with reason
4. passenger_a searches again, finds driver_b's ride
5. passenger_a books driver_b's ride → `DRIVER_PENDING`
6. driver_b accepts → `CONFIRMED`

**Verification:**
- First booking cancelled, seats restored on driver_a's ride
- Second booking confirmed on driver_b's ride
- passenger_a has 2 bookings in list: 1 `CANCELLED`, 1 `CONFIRMED`

---

## E2E-003: Deadline Expiry — Auto Cancel Flow

**Scenario:** Driver does not respond within the deadline window. Extended deadline also expires. System auto-cancels with full refund.

**Steps:**
1. passenger_a books driver_a's ride → `DRIVER_PENDING`
2. Manually expire `driverDecisionDeadlineAt` in DB (set to past)
3. Wait for cron to run (1 minute)
4. passenger_a receives "driver hasn't responded" notification
5. `deadlineExpiredNotifiedAt` set on booking
6. passenger_a calls extend-wait → new deadline +1 hour
7. Manually expire extended deadline in DB
8. Wait for cron to run
9. Booking is auto-cancelled: `status: CANCELLED`, `autoCancelledAt` set
10. passenger_a receives cancellation notification
11. `availableSeats` restored on the ride

---

## E2E-004: Multi-Seat Concurrent Booking (Race Condition Scenario)

**Scenario:** Ride has 1 seat left. Two passengers attempt to book simultaneously.

**Steps:**
1. driver_a publishes ride with `totalSeats: 1`, `availableSeats: 1`
2. passenger_a and passenger_b both call `POST /bookings` at the same time
3. Only one should succeed

**Expected Result:**
- Exactly one booking created with status `DRIVER_PENDING`
- `availableSeats` = 0 on the ride
- The other request receives HTTP 409 INSUFFICIENT_SEATS

---

## E2E-005: Driver Cancels After Accepting — Penalty Applied

**Scenario:** Driver accepts a booking and then cancels. Penalty should be recorded.

**Steps:**
1. passenger_a books → `DRIVER_PENDING`
2. driver_a accepts → `CONFIRMED`
3. driver_a cancels with reason "car broke down" → `CANCELLED`
4. Check `DriverPenaltyEvent` table — penalty record exists for driver_a
5. Check `driverPenaltyValue` on booking (50% of ride price)
6. passenger_a receives full refund notification

---

## E2E-006: Segment Booking — Pickup at Stopover

**Scenario:** Ride goes London → Manchester with a stopover at Milton Keynes. Passenger boards at MK.

**Steps:**
1. driver_a publishes ride with stopover at Milton Keynes (£8/seat)
2. passenger_a searches from Milton Keynes → Manchester
3. driver_a's ride appears in results with `segmentRide` showing MK → Manchester at £8/seat
4. passenger_a books the segment → `DRIVER_PENDING`
5. driver_a accepts
6. Verify `pickupWaypointId` = MK waypoint ID
7. Verify `totalPrice` reflects £8 segment price (not £15 full route)

---

## E2E-007: Chat Between Booked Users

**Scenario:** Passenger and driver message each other after booking is confirmed.

**Steps:**
1. passenger_a has a `CONFIRMED` booking with driver_a
2. Both connect to WebSocket with valid tokens
3. passenger_a sends: "I will be at the corner of the street"
4. driver_a receives the message in real-time via `chat:message` event
5. driver_a replies: "Perfect, I will be there in 5 minutes"
6. passenger_a receives the reply
7. passenger_a emits `chat:read` with the last message ID
8. driver_a receives `chat:read` event
9. Verify both messages have `readAt` set in DB

---

---

# MODULE 17: Health & Infrastructure

---

## TC-INFRA-001: Health Check Endpoint

**Steps:**
```
GET /health
```

**Expected Result:**
- HTTP 200
- `{ "status": "ok" }`

---

## TC-INFRA-002: API Docs Available

**Steps:**
```
GET /api-docs
```

**Expected Result:**
- HTTP 200
- Swagger UI rendered (HTML response)

---

## TC-INFRA-003: Invalid Route

**Steps:**
```
GET /api/v1/nonexistent-route
```

**Expected Result:**
- HTTP 404

---

## TC-INFRA-004: Invalid JSON Body

**Steps:**
```
POST /api/v1/auth/login
Content-Type: application/json
Body: { invalid json }
```

**Expected Result:**
- HTTP 400
- JSON parse error, not 500

---

---

# MODULE 18: Security Tests

---

## TC-SEC-001: SQL Injection Attempt in Search

**Steps:**
```
GET /api/v1/search-rides?departureDate=2026-06-15'; DROP TABLE rides; --
```

**Expected Result:**
- HTTP 400 (validation error) or results for invalid date
- Database is NOT affected (Prisma parameterizes all queries)

---

## TC-SEC-002: Access Another User's Booking

**Steps:** passenger_b requests
```
GET /api/v1/bookings/{{passenger_a_booking_id}}
Authorization: Bearer {{passenger_b_token}}
```

**Expected Result:**
- HTTP 404 (not 403, to not reveal existence)

---

## TC-SEC-003: Driver Acts on Another Driver's Booking

**Steps:** driver_b tries to accept driver_a's booking

**Expected Result:**
- HTTP 403
- "Only the assigned driver can perform this action"

---

## TC-SEC-004: Expired Token Rejected

**Steps:** Use an access token from > 15 minutes ago (if ACCESS_TOKEN_EXPIRY=15m)

**Expected Result:**
- HTTP 401

---

## TC-SEC-005: Tampered JWT

**Steps:** Modify the payload portion of a valid JWT and send it

**Expected Result:**
- HTTP 401
- Token verification fails

---

## TC-SEC-006: OTP Brute Force (if rate limiting is active)

**Steps:** Call verify-otp 6+ times within 15 minutes with wrong codes

**Expected Result:**
- After 5 attempts: HTTP 429
- Message: "Too many requests"

---

---

# Test Execution Checklist

Before marking a release as ready for staging:

| Area | Status |
|---|---|
| All TC-AUTH tests passing | [ ] |
| All TC-USER tests passing | [ ] |
| All TC-VEH tests passing | [ ] |
| All TC-RIDE tests passing | [ ] |
| All TC-SEARCH tests passing | [ ] |
| All TC-BOOK tests passing | [ ] |
| All TC-DRIVER tests passing | [ ] |
| All TC-OTP tests passing | [ ] |
| All TC-CANCEL tests passing | [ ] |
| All TC-DEADLINE tests passing | [ ] |
| All TC-RATE tests passing | [ ] |
| All TC-CHAT tests passing | [ ] |
| All TC-NOTIF tests passing | [ ] |
| All TC-MAPS tests passing | [ ] |
| E2E-001 complete happy path passing | [ ] |
| E2E-002 rejection re-book passing | [ ] |
| E2E-003 deadline auto-cancel passing | [ ] |
| E2E-004 concurrent booking race condition passing | [ ] |
| E2E-005 driver cancel penalty passing | [ ] |
| E2E-006 segment booking passing | [ ] |
| E2E-007 chat flow passing | [ ] |
| All TC-SEC tests passing | [ ] |

---

# Bug Report Template

When a test fails, log using this format:

```
TC ID:         TC-BOOK-004
Test Name:     Create Booking — Insufficient Seats
Environment:   Staging
Date:          2026-05-23
Tester:        [name]

Steps Taken:
  POST /api/v1/bookings with seatsBooked: 2 on a ride with availableSeats: 1

Expected:
  HTTP 409, message referencing INSUFFICIENT_SEATS

Actual:
  HTTP 500, Internal Server Error

Severity:      High
Logs/Evidence: [paste relevant server log or screenshot]
```
