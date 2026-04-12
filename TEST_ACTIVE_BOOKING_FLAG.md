# Testing hasActiveBooking Flag

## Overview
This document shows how to test the `hasActiveBooking` flag in search results.

## Test Scenario

### Step 1: Create Two Users

**User A (Driver & Passenger):**
```bash
POST /api/v1/auth/signup
{
  "phone": "+447700900001",
  "email": "usera@test.com"
}
# Save the access token as TOKEN_A
```

**User B (Passenger):**
```bash
POST /api/v1/auth/signup
{
  "phone": "+447700900002",
  "email": "userb@test.com"
}
# Save the access token as TOKEN_B
```

### Step 2: User A Creates a Ride (as Driver)

```bash
POST /api/v1/publish-ride/draft/origin
Authorization: Bearer TOKEN_A
{
  "originPlaceId": "ChIJdd4hrwug2EcRmSrV3Vo6llI",
  "originAddress": "London, UK",
  "originLat": 51.5074,
  "originLng": -0.1278
}

POST /api/v1/publish-ride/draft/destination
Authorization: Bearer TOKEN_A
{
  "destinationPlaceId": "ChIJ2_UmUkZWekgRqmv-BDgUvtU",
  "destinationAddress": "Manchester, UK",
  "destinationLat": 53.4808,
  "destinationLng": -2.2426
}

POST /api/v1/publish-ride/draft/schedule
Authorization: Bearer TOKEN_A
{
  "departureDate": "2026-04-15",
  "departureTime": "10:00"
}

POST /api/v1/publish-ride/draft/capacity
Authorization: Bearer TOKEN_A
{
  "totalSeats": 4
}

POST /api/v1/publish-ride/draft/pricing
Authorization: Bearer TOKEN_A
{
  "basePricePerSeat": 15.00
}

POST /api/v1/publish-ride/draft/publish
Authorization: Bearer TOKEN_A
# Save the ride ID from response as RIDE_ID
```

### Step 3: User B Books the Ride

```bash
POST /api/v1/bookings
Authorization: Bearer TOKEN_B
{
  "rideId": "RIDE_ID",
  "seatsBooked": 1
}
# Save booking ID as BOOKING_ID_B
```

### Step 3.5: Create User C and Book the Same Ride

**User C (Another Passenger):**
```bash
POST /api/v1/auth/signup
{
  "phone": "+447700900003",
  "email": "userc@test.com"
}
# Save the access token as TOKEN_C
```

**User C Books the Ride:**
```bash
POST /api/v1/bookings
Authorization: Bearer TOKEN_C
{
  "rideId": "RIDE_ID",
  "seatsBooked": 2
}
# Save booking ID as BOOKING_ID_C
```

### Step 4: Test Search Results

**User B Searches (Should see hasActiveBooking: true and ALL passengers):**
```bash
GET /api/v1/search-rides/advanced?originLat=51.5074&originLng=-0.1278&destinationLat=53.4808&destinationLng=-2.2426&departureDate=2026-04-15
Authorization: Bearer TOKEN_B
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "rides": [
      {
        "id": "RIDE_ID",
        "hasActiveBooking": true,  // ← User B already booked this
        "bookings": [
          {
            "id": "BOOKING_ID_C",
            "passengerId": "USER_C_ID",
            "seatsBooked": 2,
            "status": "CONFIRMED",
            "rider": {
              "id": "USER_C_ID",
              "name": "User C",
              "nickName": "userc",
              "avatarUrl": "https://example.com/userc.jpg"
            }
          },
          {
            "id": "BOOKING_ID_B",
            "passengerId": "USER_B_ID",
            "seatsBooked": 1,
            "status": "CONFIRMED",
            "rider": {
              "id": "USER_B_ID",
              "name": "User B",
              "nickName": "userb",
              "avatarUrl": "https://example.com/userb.jpg"
            }
          }
        ],
        "availableSeats": 1,  // 4 total - 2 (User C) - 1 (User B) = 1 remaining
        "basePricePerSeat": 15.00,
        "driver": {
          "id": "USER_A_ID",
          "name": "User A",
          "avatarUrl": "https://example.com/usera.jpg"
        }
      }
    ]
  }
}
```

**User C Searches (Should also see ALL passengers including User B):**
```bash
GET /api/v1/search-rides/advanced?originLat=51.5074&originLng=-0.1278&destinationLat=53.4808&destinationLng=-2.2426&departureDate=2026-04-15
Authorization: Bearer TOKEN_C
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "rides": [
      {
        "id": "RIDE_ID",
        "hasActiveBooking": true,  // ← User C already booked this
        "bookings": [
          {
            "id": "BOOKING_ID_C",
            "passengerId": "USER_C_ID",
            "seatsBooked": 2,
            "status": "CONFIRMED",
            "rider": {
              "id": "USER_C_ID",
              "name": "User C",
              "nickName": "userc",
              "avatarUrl": "https://example.com/userc.jpg"
            }
          },
          {
            "id": "BOOKING_ID_B",
            "passengerId": "USER_B_ID",
            "seatsBooked": 1,
            "status": "CONFIRMED",
            "rider": {
              "id": "USER_B_ID",
              "name": "User B",
              "nickName": "userb",
              "avatarUrl": "https://example.com/userb.jpg"
            }
          }
        ],
        "availableSeats": 1,
        "basePricePerSeat": 15.00
      }
    ]
  }
}
```

**User A Searches (Should see hasActiveBooking: false but see ALL passengers):**
```bash
GET /api/v1/search-rides/advanced?originLat=51.5074&originLng=-0.1278&destinationLat=53.4808&destinationLng=-2.2426&departureDate=2026-04-15
Authorization: Bearer TOKEN_A
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "rides": [
      {
        "id": "RIDE_ID",
        "hasActiveBooking": false,  // ← User A is the driver, not a passenger
        "bookings": [
          {
            "id": "BOOKING_ID_C",
            "passengerId": "USER_C_ID",
            "seatsBooked": 2,
            "status": "CONFIRMED",
            "rider": {
              "id": "USER_C_ID",
              "name": "User C",
              "nickName": "userc",
              "avatarUrl": "https://example.com/userc.jpg"
            }
          },
          {
            "id": "BOOKING_ID_B",
            "passengerId": "USER_B_ID",
            "seatsBooked": 1,
            "status": "CONFIRMED",
            "rider": {
              "id": "USER_B_ID",
              "name": "User B",
              "nickName": "userb",
              "avatarUrl": "https://example.com/userb.jpg"
            }
          }
        ],
        "availableSeats": 1,
        "basePricePerSeat": 15.00
      }
    ]
  }
}
```

**Anonymous User Searches (Should see hasActiveBooking: false):**
```bash
GET /api/v1/search-rides/advanced?originLat=51.5074&originLng=-0.1278&destinationLat=53.4808&destinationLng=-2.2426&departureDate=2026-04-15
# No Authorization header
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "rides": [
      {
        "id": "RIDE_ID",
        "hasActiveBooking": false,  // ← No user context
        "bookings": [
          {
            "id": "BOOKING_ID",
            "passengerId": "USER_B_ID",
            "seatsBooked": 1,
            "status": "CONFIRMED",
            "rider": {
              "id": "USER_B_ID",
              "name": "User B",
              "avatarUrl": null
            }
          }
        ],
        "availableSeats": 3,
        "basePricePerSeat": 15.00
      }
    ]
  }
}
```

## Verification Checklist

- [ ] User B sees `hasActiveBooking: true` for rides they booked
- [ ] User A (driver) sees `hasActiveBooking: false` for their own rides
- [ ] Other users see `hasActiveBooking: false` for rides they haven't booked
- [ ] Anonymous users see `hasActiveBooking: false`
- [ ] All bookings show rider details (name, avatarUrl)
- [ ] Available seats are correctly calculated

## Database Verification

```sql
-- Check the booking exists
SELECT * FROM "RideBooking" WHERE "rideId" = 'RIDE_ID';

-- Check booking status
SELECT status FROM "RideBooking" WHERE "passengerId" = 'USER_B_ID';

-- Verify active booking statuses
SELECT * FROM "RideBooking" 
WHERE "passengerId" = 'USER_B_ID' 
AND status IN ('PAYMENT_PENDING', 'DRIVER_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED');
```

## Notes

- The flag only shows `true` for **active bookings** (PAYMENT_PENDING, DRIVER_PENDING, CONFIRMED, IN_PROGRESS, COMPLETED)
- Cancelled or failed bookings will NOT set the flag to `true`
- The driver of a ride will never see `hasActiveBooking: true` for their own ride (they can't book their own ride)
