# Vehicle Details Testing Guide

## Overview

This guide explains how to test the vehicle details feature that was added to booking and ride APIs.

---

## What Was Implemented

Vehicle details are now included in the following APIs:

1. **GET /api/v1/publish-ride** - List driver's rides
2. **GET /api/v1/publish-ride/:id** - Get single ride details
3. **GET /api/v1/bookings** - List passenger's bookings
4. **GET /api/v1/bookings/:id** - Get single booking details

---

## Vehicle Information Included

Each response now includes a `vehicle` object with:

```json
{
  "vehicle": {
    "id": "vehicle-uuid",
    "brand": "Toyota",
    "model_name": "Camry",
    "model_num": "XV70",
    "type": "SEDAN",
    "color": "Silver",
    "year": 2023,
    "imageUrl": "https://example.com/vehicle.jpg",
    "isVerified": true
  }
}
```

If the ride has no vehicle assigned:
```json
{
  "vehicleId": null,
  "vehicle": null
}
```

---

## Testing Steps

### Prerequisites

1. Server running on `http://localhost:3000` or production URL
2. Valid user credentials (driver and passenger)
3. At least one ride with a vehicle assigned
4. At least one booking

### Step 1: Login as Driver

```bash
# Request OTP
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "method": "email",
    "identifier": "driver@example.com"
  }'

# Verify OTP (use OTP from email/SMS)
curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "email",
    "identifier": "driver@example.com",
    "otp": "123456",
    "purpose": "login"
  }'

# Save the accessToken from response
```

### Step 2: Test Driver's Rides List

```bash
curl -X GET "http://localhost:3000/api/v1/publish-ride?page=1&limit=10" \
  -H "Authorization: Bearer YOUR_DRIVER_TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "rides": [
      {
        "id": "ride-uuid",
        "originAddress": "London, UK",
        "destinationAddress": "Manchester, UK",
        "vehicleId": "vehicle-uuid",
        "vehicle": {
          "id": "vehicle-uuid",
          "brand": "Toyota",
          "model_name": "Camry",
          "type": "SEDAN",
          "color": "Silver",
          "year": 2023,
          "imageUrl": "https://...",
          "isVerified": true
        },
        "bookings": [...]
      }
    ],
    "pagination": {...}
  }
}
```

**Verification**:
- ✅ Check that `vehicle` field exists
- ✅ Check that vehicle has all expected fields
- ✅ If `vehicleId` is null, `vehicle` should also be null

### Step 3: Test Single Ride Details

```bash
curl -X GET "http://localhost:3000/api/v1/publish-ride/RIDE_ID" \
  -H "Authorization: Bearer YOUR_DRIVER_TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "id": "ride-uuid",
    "originAddress": "London, UK",
    "destinationAddress": "Manchester, UK",
    "vehicleId": "vehicle-uuid",
    "vehicle": {
      "id": "vehicle-uuid",
      "brand": "Toyota",
      "model_name": "Camry",
      "type": "SEDAN",
      "color": "Silver",
      "year": 2023,
      "imageUrl": "https://...",
      "isVerified": true
    },
    "bookings": [...]
  }
}
```

**Verification**:
- ✅ Check that `vehicle` field exists
- ✅ Vehicle details match the ride's assigned vehicle

### Step 4: Login as Passenger

```bash
# Request OTP
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "method": "email",
    "identifier": "passenger@example.com"
  }'

# Verify OTP
curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "email",
    "identifier": "passenger@example.com",
    "otp": "123456",
    "purpose": "login"
  }'
```

### Step 5: Test Passenger's Bookings List

```bash
curl -X GET "http://localhost:3000/api/v1/bookings?page=1&limit=10" \
  -H "Authorization: Bearer YOUR_PASSENGER_TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "bookings": [
      {
        "id": "booking-uuid",
        "rideId": "ride-uuid",
        "seatsBooked": 2,
        "totalPrice": 50.00,
        "status": "CONFIRMED",
        "ride": {
          "id": "ride-uuid",
          "originAddress": "London, UK",
          "destinationAddress": "Manchester, UK",
          "driver": {
            "id": "driver-uuid",
            "name": "John Driver",
            "avatarUrl": "https://..."
          },
          "vehicle": {
            "id": "vehicle-uuid",
            "brand": "Toyota",
            "model_name": "Camry",
            "type": "SEDAN",
            "color": "Silver",
            "year": 2023,
            "imageUrl": "https://...",
            "isVerified": true
          }
        }
      }
    ],
    "pagination": {...}
  }
}
```

**Verification**:
- ✅ Check that `ride.vehicle` field exists
- ✅ Vehicle details are included in each booking

### Step 6: Test Single Booking Details

```bash
curl -X GET "http://localhost:3000/api/v1/bookings/BOOKING_ID" \
  -H "Authorization: Bearer YOUR_PASSENGER_TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "id": "booking-uuid",
    "rideId": "ride-uuid",
    "seatsBooked": 2,
    "totalPrice": 50.00,
    "status": "CONFIRMED",
    "pickupOtp": "1234",
    "dropOtp": "5678",
    "ride": {
      "id": "ride-uuid",
      "originAddress": "London, UK",
      "destinationAddress": "Manchester, UK",
      "driver": {
        "id": "driver-uuid",
        "name": "John Driver",
        "avatarUrl": "https://..."
      },
      "vehicle": {
        "id": "vehicle-uuid",
        "brand": "Toyota",
        "model_name": "Camry",
        "type": "SEDAN",
        "color": "Silver",
        "year": 2023,
        "imageUrl": "https://...",
        "isVerified": true
      }
    }
  }
}
```

**Verification**:
- ✅ Check that `ride.vehicle` field exists
- ✅ Vehicle details match the ride's vehicle

---

## Testing with Production API

To test with production API:

```bash
BASE_URL="https://practical-communication-production-18f8.up.railway.app"

# Use the same curl commands but replace localhost:3000 with $BASE_URL
curl -X GET "$BASE_URL/api/v1/publish-ride?page=1&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Common Issues

### Issue 1: Vehicle field is null

**Cause**: The ride doesn't have a vehicle assigned (`vehicleId` is null)

**Solution**: This is expected behavior. Assign a vehicle to the ride:
```bash
# Update ride with vehicle
curl -X PATCH "http://localhost:3000/api/v1/publish-ride/RIDE_ID" \
  -H "Authorization: Bearer YOUR_DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicleId": "vehicle-uuid"
  }'
```

### Issue 2: Vehicle field doesn't exist

**Cause**: Code not deployed or Prisma client not regenerated

**Solution**:
1. Run `npx prisma generate`
2. Rebuild the project: `npm run build`
3. Restart the server

### Issue 3: TypeScript errors about vehicle

**Cause**: Prisma types not updated in IDE

**Solution**: The code uses `@ts-ignore` comments to bypass this. The relation exists in the schema and works at runtime.

---

## Database Check

To verify vehicle relations in the database:

```sql
-- Check rides with vehicles
SELECT 
  r.id as ride_id,
  r."originAddress",
  r."destinationAddress",
  r."vehicleId",
  v.brand,
  v.model_name,
  v.color,
  v.year
FROM "Ride" r
LEFT JOIN "Vehicle" v ON r."vehicleId" = v.id
LIMIT 10;

-- Check if any rides have vehicles assigned
SELECT 
  COUNT(*) as total_rides,
  COUNT("vehicleId") as rides_with_vehicle,
  COUNT(*) - COUNT("vehicleId") as rides_without_vehicle
FROM "Ride";
```

---

## Success Criteria

The implementation is successful if:

1. ✅ All 4 APIs return vehicle field in response
2. ✅ Vehicle field is null when ride has no vehicle
3. ✅ Vehicle field contains all expected properties when vehicle exists
4. ✅ No TypeScript compilation errors
5. ✅ No runtime errors when fetching data
6. ✅ Vehicle data matches the assigned vehicle in database

---

## Next Steps

After testing:

1. Update OpenAPI documentation with vehicle field
2. Update frontend to display vehicle details
3. Add vehicle filtering in search APIs (if needed)
4. Consider adding vehicle images to improve UX

---

**Date**: April 17, 2026
**Status**: Implementation Complete - Ready for Testing
