# Test: Publish Ride with Bookings

## What Changed

Updated the publish-ride endpoints to include bookings information:

### 1. GET /api/v1/publish-ride/{id}
Now returns the ride with all active bookings and passenger details.

### 2. GET /api/v1/publish-ride
Now returns all driver's rides with their bookings.

## Testing Steps

### Prerequisites
1. Have a driver account (TOKEN_DRIVER)
2. Have a rider account (TOKEN_RIDER)
3. Driver has published a ride (RIDE_ID)

### Test Case 1: View Single Ride with Bookings

```bash
# Step 1: Driver publishes a ride
POST /api/v1/publish-ride/draft/publish
Authorization: Bearer TOKEN_DRIVER

# Save the ride ID from response as RIDE_ID

# Step 2: Rider books the ride
POST /api/v1/bookings
Authorization: Bearer TOKEN_RIDER
{
  "rideId": "RIDE_ID",
  "seatsBooked": 1
}

# Step 3: Driver checks the ride details
GET /api/v1/publish-ride/RIDE_ID
Authorization: Bearer TOKEN_DRIVER
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Ride fetched successfully",
  "data": {
    "id": "RIDE_ID",
    "driverId": "driver-id",
    "originAddress": "Origin Location",
    "destinationAddress": "Destination Location",
    "departureDate": "2026-04-15T00:00:00.000Z",
    "departureTime": "10:00",
    "totalSeats": 4,
    "availableSeats": 3,
    "basePricePerSeat": 500,
    "currency": "GBP",
    "status": "PUBLISHED",
    "waypoints": [...],
    "bookings": [
      {
        "id": "booking-id",
        "rideId": "RIDE_ID",
        "passengerId": "rider-id",
        "seatsBooked": 1,
        "totalPrice": 500,
        "status": "DRIVER_PENDING",
        "pickupWaypointId": null,
        "dropoffWaypointId": null,
        "createdAt": "2026-04-12T10:30:00.000Z",
        "updatedAt": "2026-04-12T10:30:00.000Z",
        "passenger": {
          "id": "rider-id",
          "name": "John Doe",
          "nickName": "Johnny",
          "phone": "+1234567890",
          "avatarUrl": "https://example.com/avatar.jpg"
        }
      }
    ]
  }
}
```

### Test Case 2: List All Driver Rides with Bookings

```bash
# Driver lists all their rides
GET /api/v1/publish-ride?page=1&limit=10
Authorization: Bearer TOKEN_DRIVER
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Rides fetched successfully",
  "data": {
    "rides": [
      {
        "id": "ride-1",
        "driverId": "driver-id",
        "originAddress": "Location A",
        "destinationAddress": "Location B",
        "totalSeats": 4,
        "availableSeats": 2,
        "basePricePerSeat": 500,
        "waypoints": [...],
        "bookings": [
          {
            "id": "booking-1",
            "passengerId": "rider-1",
            "seatsBooked": 2,
            "totalPrice": 1000,
            "status": "CONFIRMED",
            "passenger": {
              "id": "rider-1",
              "name": "Jane Smith",
              "nickName": "Jane",
              "phone": "+1234567891",
              "avatarUrl": "https://example.com/jane.jpg"
            }
          }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

### Test Case 3: Multiple Bookings on Same Ride

```bash
# Step 1: Rider 1 books
POST /api/v1/bookings
Authorization: Bearer TOKEN_RIDER_1
{
  "rideId": "RIDE_ID",
  "seatsBooked": 1
}

# Step 2: Rider 2 books
POST /api/v1/bookings
Authorization: Bearer TOKEN_RIDER_2
{
  "rideId": "RIDE_ID",
  "seatsBooked": 2
}

# Step 3: Driver checks ride
GET /api/v1/publish-ride/RIDE_ID
Authorization: Bearer TOKEN_DRIVER
```

**Expected:** Response should show 2 bookings in the `bookings` array.

### Test Case 4: Only Active Bookings Shown

The endpoint filters bookings to show only:
- PAYMENT_PENDING
- DRIVER_PENDING
- CONFIRMED
- IN_PROGRESS
- COMPLETED

Cancelled or rejected bookings are NOT shown.

```bash
# Step 1: Rider books
POST /api/v1/bookings
Authorization: Bearer TOKEN_RIDER
{
  "rideId": "RIDE_ID",
  "seatsBooked": 1
}

# Step 2: Rider cancels
DELETE /api/v1/bookings/BOOKING_ID
Authorization: Bearer TOKEN_RIDER

# Step 3: Driver checks ride
GET /api/v1/publish-ride/RIDE_ID
Authorization: Bearer TOKEN_DRIVER
```

**Expected:** The cancelled booking should NOT appear in the bookings array.

## Booking Statuses Included

- ✅ `PAYMENT_PENDING` - Waiting for payment
- ✅ `DRIVER_PENDING` - Waiting for driver to accept/reject
- ✅ `CONFIRMED` - Driver accepted
- ✅ `IN_PROGRESS` - Ride started (pickup OTP verified)
- ✅ `COMPLETED` - Ride finished (drop OTP verified)
- ❌ `CANCELLED` - Not shown
- ❌ `REJECTED` - Not shown
- ❌ `PAYMENT_FAILED` - Not shown

## Passenger Information Included

For each booking, the following passenger details are included:
- `id` - Passenger user ID
- `name` - Full name
- `nickName` - Display name
- `phone` - Contact number
- `avatarUrl` - Profile picture URL

## Benefits

1. **Driver can see all riders** who booked their ride
2. **Real-time view** of booking statuses
3. **Passenger contact info** for communication
4. **Booking details** (seats, price, pickup/dropoff points)
5. **Chronological order** (newest bookings first)

## Cache Invalidation

The cache is automatically invalidated when:
- Driver accepts/rejects a booking
- Rider cancels a booking
- Booking status changes

Cache keys affected:
- `ride:{rideId}` - Single ride cache
- `user:{driverId}:rides` - Driver's rides list cache
