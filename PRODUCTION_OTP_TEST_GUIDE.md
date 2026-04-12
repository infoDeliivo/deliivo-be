# Production OTP Test Guide

## Production URL
```
https://practical-communication-production-18f8.up.railway.app
```

## ✅ Production API Status
- Server: Running
- Authentication: Working
- Signup/Login: Working

---

## 🔍 OTP in Booking Response - How It Works

### Important: When OTPs are Available

OTPs are **NOT** available immediately when booking is created. They are generated when the **driver accepts the booking**.

```
Booking Status Flow:
1. PAYMENT_PENDING    → No OTPs (just created)
2. DRIVER_PENDING     → No OTPs (payment completed, waiting for driver)
3. CONFIRMED          → ✅ OTPs AVAILABLE (driver accepted)
4. IN_PROGRESS        → ✅ OTPs AVAILABLE (pickup verified)
5. COMPLETED          → ✅ OTPs AVAILABLE (drop verified)
```

---

## 📋 Complete Test Flow

### Step 1: Create Driver Account

```bash
PROD_URL="https://practical-communication-production-18f8.up.railway.app"

# Signup as driver
curl -X POST "$PROD_URL/api/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "email",
    "email": "driver@test.com",
    "name": "Test Driver"
  }'

# Response includes OTP code
{
  "success": true,
  "data": {
    "code": "1234"
  }
}

# Verify OTP
curl -X POST "$PROD_URL/api/v1/auth/otp/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "email",
    "identifier": "driver@test.com",
    "code": "1234",
    "purpose": "signup"
  }'

# Save the accessToken
DRIVER_TOKEN="eyJhbGc..."
```

### Step 2: Publish a Ride (Driver)

```bash
# Step 2a: Create draft with origin
curl -X POST "$PROD_URL/api/v1/publish-ride/draft/origin" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originPlaceId": "ChIJdd4hrwug2EcRmSrV3Vo6llI",
    "originAddress": "London, UK",
    "originLat": 51.5074,
    "originLng": -0.1278
  }'

# Step 2b: Set destination
curl -X PUT "$PROD_URL/api/v1/publish-ride/draft/destination" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationPlaceId": "ChIJ2_UmUkzxe0gRqmv-BDgUvtU",
    "destinationAddress": "Manchester, UK",
    "destinationLat": 53.4808,
    "destinationLng": -2.2426
  }'

# Step 2c: Compute routes
curl "$PROD_URL/api/v1/publish-ride/draft/routes/compute" \
  -H "Authorization: Bearer $DRIVER_TOKEN"

# Step 2d: Select route
curl -X PUT "$PROD_URL/api/v1/publish-ride/draft/routes/select" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"routeIndex": 0}'

# Step 2e: Set schedule
curl -X PUT "$PROD_URL/api/v1/publish-ride/draft/schedule" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "departureDate": "2026-04-20",
    "departureTime": "09:00"
  }'

# Step 2f: Set capacity
curl -X PUT "$PROD_URL/api/v1/publish-ride/draft/capacity" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"totalSeats": 3}'

# Step 2g: Set pricing
curl -X PUT "$PROD_URL/api/v1/publish-ride/draft/pricing" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "basePricePerSeat": 25.00,
    "currency": "GBP"
  }'

# Step 2h: Publish ride
curl -X POST "$PROD_URL/api/v1/publish-ride/draft/publish" \
  -H "Authorization: Bearer $DRIVER_TOKEN"

# Response includes ride ID
{
  "success": true,
  "data": {
    "id": "ride-uuid"
  }
}

# Save the ride ID
RIDE_ID="ride-uuid"
```

### Step 3: Create Passenger Account

```bash
# Signup as passenger
curl -X POST "$PROD_URL/api/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "email",
    "email": "passenger@test.com",
    "name": "Test Passenger"
  }'

# Verify OTP
curl -X POST "$PROD_URL/api/v1/auth/otp/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "email",
    "identifier": "passenger@test.com",
    "code": "5678",
    "purpose": "signup"
  }'

# Save the accessToken
PASSENGER_TOKEN="eyJhbGc..."
```

### Step 4: Create Booking (Passenger)

```bash
# Create booking
curl -X POST "$PROD_URL/api/v1/bookings" \
  -H "Authorization: Bearer $PASSENGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"rideId\": \"$RIDE_ID\",
    \"seatsBooked\": 1,
    \"luggageCount\": 0,
    \"notes\": \"Test booking\"
  }"

# Response - Status: PAYMENT_PENDING
{
  "success": true,
  "data": {
    "id": "booking-uuid",
    "status": "PAYMENT_PENDING",
    "pickupOtp": null,  // ❌ Not available yet
    "dropOtp": null,    // ❌ Not available yet
    "payment": {
      "paymentIntentId": "pi_xxx",
      "clientSecret": "pi_xxx_secret_xxx"
    }
  }
}

# Save the booking ID
BOOKING_ID="booking-uuid"
```

### Step 5: Complete Payment (Passenger)

```bash
# In production, you would complete payment via Stripe
# For testing, you can simulate payment completion
# (This requires Stripe webhook or manual database update)

# After payment is completed, status changes to DRIVER_PENDING
# OTPs are still NOT available
```

### Step 6: Driver Accepts Booking ✅ (OTPs Generated Here!)

```bash
# Driver accepts the booking
curl -X POST "$PROD_URL/api/v1/driver/bookings/$BOOKING_ID/accept" \
  -H "Authorization: Bearer $DRIVER_TOKEN"

# Response - Status: CONFIRMED
{
  "success": true,
  "message": "Booking accepted",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "pickupOtp": "1234",  // ✅ Generated!
    "dropOtp": "5678",    // ✅ Generated!
    "status": "CONFIRMED"
  }
}
```

### Step 7: Check Booking Details (Passenger)

```bash
# Passenger checks booking details
curl "$PROD_URL/api/v1/bookings/$BOOKING_ID" \
  -H "Authorization: Bearer $PASSENGER_TOKEN"

# Response - OTPs are now available!
{
  "success": true,
  "data": {
    "id": "booking-uuid",
    "status": "CONFIRMED",
    "pickupOtp": "1234",  // ✅ Available!
    "dropOtp": "5678",    // ✅ Available!
    "pickupOtpVerifiedAt": null,
    "dropOtpVerifiedAt": null,
    "ride": {
      "originAddress": "London, UK",
      "destinationAddress": "Manchester, UK",
      "driver": {
        "name": "Test Driver"
      }
    }
  }
}
```

### Step 8: Verify Pickup OTP (Driver)

```bash
# When passenger boards, driver verifies pickup OTP
curl -X POST "$PROD_URL/api/v1/driver/bookings/$BOOKING_ID/pickup-otp/verify" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"otp": "1234"}'

# Response - Status: IN_PROGRESS
{
  "success": true,
  "message": "Pickup OTP verified, ride started",
  "data": {
    "bookingId": "booking-uuid",
    "status": "IN_PROGRESS",
    "pickupOtpVerifiedAt": "2026-04-13T10:30:00.000Z"
  }
}
```

### Step 9: Verify Drop OTP (Driver)

```bash
# When passenger arrives, driver verifies drop OTP
curl -X POST "$PROD_URL/api/v1/driver/bookings/$BOOKING_ID/drop-otp/verify" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"otp": "5678"}'

# Response - Status: COMPLETED
{
  "success": true,
  "message": "Drop OTP verified, ride completed",
  "data": {
    "bookingId": "booking-uuid",
    "status": "COMPLETED",
    "dropOtpVerifiedAt": "2026-04-13T12:00:00.000Z"
  }
}
```

---

## 🔑 Key Points

### When OTPs Appear in Response

| Booking Status | pickupOtp | dropOtp | Notes |
|----------------|-----------|---------|-------|
| PAYMENT_PENDING | ❌ null | ❌ null | Just created |
| DRIVER_PENDING | ❌ null | ❌ null | Payment done, waiting for driver |
| CONFIRMED | ✅ "1234" | ✅ "5678" | Driver accepted - OTPs generated |
| IN_PROGRESS | ✅ "1234" | ✅ "5678" | Pickup verified |
| COMPLETED | ✅ "1234" | ✅ "5678" | Both verified |

### OTP Generation Trigger

```
Driver accepts booking → System generates OTPs → OTPs sent to passenger
```

### Where to Find OTPs

1. **Driver Accept Response**: OTPs returned when driver accepts
2. **Booking Details API**: `GET /api/v1/bookings/:id` (for passenger)
3. **Notification**: Passenger receives notification with OTPs

---

## 📱 Quick Test Script

```bash
#!/bin/bash

PROD_URL="https://practical-communication-production-18f8.up.railway.app"

# 1. Create accounts (driver and passenger)
# 2. Publish ride (driver)
# 3. Create booking (passenger)
# 4. Accept booking (driver) ← OTPs generated here
# 5. Check booking details (passenger) ← OTPs visible here

# Check booking for OTPs
curl "$PROD_URL/api/v1/bookings/YOUR_BOOKING_ID" \
  -H "Authorization: Bearer YOUR_PASSENGER_TOKEN" \
  | jq '.data | {status, pickupOtp, dropOtp}'

# Expected output when status is CONFIRMED:
# {
#   "status": "CONFIRMED",
#   "pickupOtp": "1234",
#   "dropOtp": "5678"
# }
```

---

## ✅ Verification Checklist

- [ ] Production API is accessible
- [ ] Can create driver account
- [ ] Can publish ride
- [ ] Can create passenger account
- [ ] Can create booking (status: PAYMENT_PENDING, OTPs: null)
- [ ] Can complete payment (status: DRIVER_PENDING, OTPs: null)
- [ ] Driver can accept booking (status: CONFIRMED, OTPs: generated)
- [ ] Passenger can see OTPs in booking details
- [ ] Driver can verify pickup OTP (status: IN_PROGRESS)
- [ ] Driver can verify drop OTP (status: COMPLETED)

---

## 🐛 Troubleshooting

### OTPs are null in response

**Possible reasons:**
1. Booking status is PAYMENT_PENDING or DRIVER_PENDING
2. Driver hasn't accepted the booking yet
3. Payment not completed

**Solution:**
- Wait for driver to accept booking
- Check booking status: `GET /api/v1/bookings/:id`
- OTPs only appear when status is CONFIRMED or later

### Can't find any rides

**Solution:**
- Publish a ride first using the wizard flow
- Use the complete publish ride flow (11 steps)
- Check published rides: `GET /api/v1/publish-ride`

---

## 📊 Summary

**OTPs ARE included in booking response** ✅

**When**: After driver accepts booking (status: CONFIRMED)

**Where**: 
- `GET /api/v1/bookings/:id` response
- Driver accept booking response
- Passenger notification

**Format**:
```json
{
  "pickupOtp": "1234",
  "dropOtp": "5678",
  "pickupOtpVerifiedAt": null,
  "dropOtpVerifiedAt": null
}
```

**Your production API is working correctly!** 🎉
