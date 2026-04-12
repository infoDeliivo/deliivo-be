# Booking Response with Pickup & Drop OTPs

## Overview

When a booking is **confirmed by the driver**, the system generates two OTPs:
1. **Pickup OTP** - Used when passenger boards the vehicle
2. **Drop OTP** - Used when passenger completes the ride

These OTPs are included in the booking response for confirmed bookings.

---

## Complete Booking Response Structure

### When Booking is Created (PAYMENT_PENDING)

```json
{
  "success": true,
  "message": "Booking created, payment required",
  "data": {
    "id": "booking-uuid",
    "rideId": "ride-uuid",
    "passengerId": "passenger-uuid",
    "seatsBooked": 2,
    "luggageCount": 1,
    "totalPrice": 55.00,
    "status": "PAYMENT_PENDING",
    "pickupWaypointId": null,
    "dropoffWaypointId": null,
    "notes": "Booking for 2 people",
    "createdAt": "2026-04-13T10:00:00.000Z",
    "updatedAt": "2026-04-13T10:00:00.000Z",
    
    "priceBreakdown": {
      "basePricePerSeat": 25.00,
      "seatsBooked": 2,
      "subtotal": 50.00,
      "luggageFee": 5.00,
      "serviceFee": 0.00,
      "totalPrice": 55.00,
      "currency": "GBP"
    },
    
    "payment": {
      "provider": "stripe",
      "paymentIntentId": "pi_xxx",
      "clientSecret": "pi_xxx_secret_xxx",
      "currency": "GBP"
    },
    
    "ride": {
      "id": "ride-uuid",
      "originAddress": "London, UK",
      "originLat": 51.5074,
      "originLng": -0.1278,
      "destinationAddress": "Manchester, UK",
      "destinationLat": 53.4808,
      "destinationLng": -2.2426,
      "departureDate": "2026-04-20T00:00:00.000Z",
      "departureTime": "09:00",
      "basePricePerSeat": 25.00,
      "currency": "GBP",
      "driver": {
        "id": "driver-uuid",
        "name": "John Driver",
        "avatarUrl": "https://example.com/avatar.jpg"
      }
    },
    
    // OTPs not available yet (booking not confirmed)
    "pickupOtp": null,
    "dropOtp": null,
    "pickupOtpVerifiedAt": null,
    "dropOtpVerifiedAt": null
  }
}
```

---

### When Booking is Confirmed by Driver (CONFIRMED)

```json
{
  "success": true,
  "message": "Booking details fetched successfully",
  "data": {
    "id": "booking-uuid",
    "rideId": "ride-uuid",
    "passengerId": "passenger-uuid",
    "seatsBooked": 2,
    "luggageCount": 1,
    "totalPrice": 55.00,
    "status": "CONFIRMED",
    "pickupWaypointId": null,
    "dropoffWaypointId": null,
    "notes": "Booking for 2 people",
    "createdAt": "2026-04-13T10:00:00.000Z",
    "updatedAt": "2026-04-13T10:05:00.000Z",
    
    "priceBreakdown": {
      "basePricePerSeat": 25.00,
      "seatsBooked": 2,
      "subtotal": 50.00,
      "luggageFee": 5.00,
      "serviceFee": 0.00,
      "totalPrice": 55.00,
      "currency": "GBP"
    },
    
    "ride": {
      "id": "ride-uuid",
      "originAddress": "London, UK",
      "originLat": 51.5074,
      "originLng": -0.1278,
      "destinationAddress": "Manchester, UK",
      "destinationLat": 53.4808,
      "destinationLng": -2.2426,
      "departureDate": "2026-04-20T00:00:00.000Z",
      "departureTime": "09:00",
      "basePricePerSeat": 25.00,
      "currency": "GBP",
      "driver": {
        "id": "driver-uuid",
        "name": "John Driver",
        "avatarUrl": "https://example.com/avatar.jpg"
      }
    },
    
    // ✅ OTPs NOW AVAILABLE!
    "pickupOtp": "1234",
    "dropOtp": "5678",
    "pickupOtpVerifiedAt": null,
    "dropOtpVerifiedAt": null
  }
}
```

---

### When Pickup OTP is Verified (IN_PROGRESS)

```json
{
  "success": true,
  "message": "Booking details fetched successfully",
  "data": {
    "id": "booking-uuid",
    "rideId": "ride-uuid",
    "passengerId": "passenger-uuid",
    "seatsBooked": 2,
    "luggageCount": 1,
    "totalPrice": 55.00,
    "status": "IN_PROGRESS",
    "pickupWaypointId": null,
    "dropoffWaypointId": null,
    "notes": "Booking for 2 people",
    "createdAt": "2026-04-13T10:00:00.000Z",
    "updatedAt": "2026-04-13T10:30:00.000Z",
    
    "priceBreakdown": {
      "basePricePerSeat": 25.00,
      "seatsBooked": 2,
      "subtotal": 50.00,
      "luggageFee": 5.00,
      "serviceFee": 0.00,
      "totalPrice": 55.00,
      "currency": "GBP"
    },
    
    "ride": {
      "id": "ride-uuid",
      "originAddress": "London, UK",
      "destinationAddress": "Manchester, UK",
      "departureDate": "2026-04-20T00:00:00.000Z",
      "departureTime": "09:00",
      "basePricePerSeat": 25.00,
      "currency": "GBP",
      "driver": {
        "id": "driver-uuid",
        "name": "John Driver",
        "avatarUrl": "https://example.com/avatar.jpg"
      }
    },
    
    // Pickup OTP verified, Drop OTP still available
    "pickupOtp": "1234",
    "dropOtp": "5678",
    "pickupOtpVerifiedAt": "2026-04-13T10:30:00.000Z",  // ✅ Verified!
    "dropOtpVerifiedAt": null
  }
}
```

---

### When Drop OTP is Verified (COMPLETED)

```json
{
  "success": true,
  "message": "Booking details fetched successfully",
  "data": {
    "id": "booking-uuid",
    "rideId": "ride-uuid",
    "passengerId": "passenger-uuid",
    "seatsBooked": 2,
    "luggageCount": 1,
    "totalPrice": 55.00,
    "status": "COMPLETED",
    "pickupWaypointId": null,
    "dropoffWaypointId": null,
    "notes": "Booking for 2 people",
    "createdAt": "2026-04-13T10:00:00.000Z",
    "updatedAt": "2026-04-13T12:00:00.000Z",
    
    "priceBreakdown": {
      "basePricePerSeat": 25.00,
      "seatsBooked": 2,
      "subtotal": 50.00,
      "luggageFee": 5.00,
      "serviceFee": 0.00,
      "totalPrice": 55.00,
      "currency": "GBP"
    },
    
    "ride": {
      "id": "ride-uuid",
      "originAddress": "London, UK",
      "destinationAddress": "Manchester, UK",
      "departureDate": "2026-04-20T00:00:00.000Z",
      "departureTime": "09:00",
      "basePricePerSeat": 25.00,
      "currency": "GBP",
      "driver": {
        "id": "driver-uuid",
        "name": "John Driver",
        "avatarUrl": "https://example.com/avatar.jpg"
      }
    },
    
    // Both OTPs verified - Ride completed!
    "pickupOtp": "1234",
    "dropOtp": "5678",
    "pickupOtpVerifiedAt": "2026-04-13T10:30:00.000Z",  // ✅ Verified
    "dropOtpVerifiedAt": "2026-04-13T12:00:00.000Z"     // ✅ Verified
  }
}
```

---

## OTP Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    BOOKING LIFECYCLE                        │
└─────────────────────────────────────────────────────────────┘

1. PAYMENT_PENDING
   ├─ Passenger creates booking
   ├─ Payment required
   └─ OTPs: null

2. DRIVER_PENDING
   ├─ Payment completed
   ├─ Waiting for driver approval
   └─ OTPs: null

3. CONFIRMED ✅
   ├─ Driver accepts booking
   ├─ System generates OTPs
   ├─ pickupOtp: "1234"
   ├─ dropOtp: "5678"
   └─ OTPs sent to passenger via notification

4. IN_PROGRESS 🚗
   ├─ Driver verifies pickup OTP
   ├─ Passenger boards vehicle
   ├─ pickupOtpVerifiedAt: timestamp
   └─ dropOtp still available

5. COMPLETED ✅
   ├─ Driver verifies drop OTP
   ├─ Passenger completes ride
   ├─ dropOtpVerifiedAt: timestamp
   └─ Ride finished
```

---

## API Endpoints

### 1. Get Booking Details (Passenger)

```bash
GET /api/v1/bookings/:bookingId
Authorization: Bearer {passenger_token}

Response:
{
  "success": true,
  "data": {
    "id": "booking-uuid",
    "status": "CONFIRMED",
    "pickupOtp": "1234",  // ✅ Available for passenger
    "dropOtp": "5678",    // ✅ Available for passenger
    ...
  }
}
```

### 2. Driver Accepts Booking (Generates OTPs)

```bash
POST /api/v1/driver/bookings/:bookingId/accept
Authorization: Bearer {driver_token}

Response:
{
  "success": true,
  "message": "Booking accepted",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "pickupOtp": "1234",  // ✅ Generated
    "dropOtp": "5678",    // ✅ Generated
    ...
  }
}
```

### 3. Driver Verifies Pickup OTP

```bash
POST /api/v1/driver/bookings/:bookingId/pickup-otp/verify
Authorization: Bearer {driver_token}
Content-Type: application/json

{
  "otp": "1234"
}

Response:
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

### 4. Driver Verifies Drop OTP

```bash
POST /api/v1/driver/bookings/:bookingId/drop-otp/verify
Authorization: Bearer {driver_token}
Content-Type: application/json

{
  "otp": "5678"
}

Response:
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

## OTP Properties

### Format
- **Length**: 4 digits
- **Example**: "1234", "5678"
- **Type**: String (not number)

### Security
- **Hashed**: OTPs are hashed in database (bcrypt)
- **Expiry**: 
  - Pickup OTP: Valid for 24 hours
  - Drop OTP: Valid for 24 hours
- **Attempts**: Maximum 5 attempts before lockout

### Availability
- **PAYMENT_PENDING**: OTPs = null
- **DRIVER_PENDING**: OTPs = null
- **CONFIRMED**: OTPs available ✅
- **IN_PROGRESS**: OTPs available ✅
- **COMPLETED**: OTPs available (historical)

---

## Use Cases

### Passenger View

```javascript
// Passenger checks their booking
fetch('/api/v1/bookings/booking-123', {
  headers: { 'Authorization': 'Bearer passenger_token' }
})
.then(res => res.json())
.then(data => {
  if (data.status === 'CONFIRMED') {
    console.log('Pickup OTP:', data.pickupOtp);  // "1234"
    console.log('Drop OTP:', data.dropOtp);      // "5678"
    
    // Show OTPs to passenger
    alert(`Show pickup OTP to driver: ${data.pickupOtp}`);
  }
});
```

### Driver View

```javascript
// Driver accepts booking
fetch('/api/v1/driver/bookings/booking-123/accept', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer driver_token' }
})
.then(res => res.json())
.then(data => {
  console.log('Booking accepted');
  console.log('Pickup OTP:', data.pickupOtp);  // "1234"
  console.log('Drop OTP:', data.dropOtp);      // "5678"
  
  // OTPs sent to passenger via notification
});

// Driver verifies pickup OTP when passenger boards
fetch('/api/v1/driver/bookings/booking-123/pickup-otp/verify', {
  method: 'POST',
  headers: { 
    'Authorization': 'Bearer driver_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ otp: '1234' })
})
.then(res => res.json())
.then(data => {
  console.log('Passenger boarded, ride started');
  console.log('Status:', data.status);  // "IN_PROGRESS"
});

// Driver verifies drop OTP when passenger arrives
fetch('/api/v1/driver/bookings/booking-123/drop-otp/verify', {
  method: 'POST',
  headers: { 
    'Authorization': 'Bearer driver_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ otp: '5678' })
})
.then(res => res.json())
.then(data => {
  console.log('Ride completed');
  console.log('Status:', data.status);  // "COMPLETED"
});
```

---

## Error Responses

### Invalid Pickup OTP

```json
{
  "success": false,
  "message": "Invalid pickup OTP",
  "error": {
    "code": "INVALID_PICKUP_OTP",
    "attemptsRemaining": 4
  }
}
```

### Pickup OTP Expired

```json
{
  "success": false,
  "message": "Pickup OTP has expired",
  "error": {
    "code": "PICKUP_OTP_EXPIRED"
  }
}
```

### Too Many Attempts

```json
{
  "success": false,
  "message": "Too many failed attempts",
  "error": {
    "code": "OTP_ATTEMPTS_EXCEEDED"
  }
}
```

---

## Summary

### OTP Fields in Booking Response

| Field | Type | Description |
|-------|------|-------------|
| `pickupOtp` | string \| null | 4-digit OTP for pickup verification |
| `dropOtp` | string \| null | 4-digit OTP for drop verification |
| `pickupOtpVerifiedAt` | Date \| null | Timestamp when pickup OTP was verified |
| `dropOtpVerifiedAt` | Date \| null | Timestamp when drop OTP was verified |

### When OTPs are Available

- ✅ **CONFIRMED**: Both OTPs available
- ✅ **IN_PROGRESS**: Both OTPs available (pickup verified)
- ✅ **COMPLETED**: Both OTPs available (both verified)
- ❌ **PAYMENT_PENDING**: OTPs not available
- ❌ **DRIVER_PENDING**: OTPs not available

### OTP Flow

1. **Driver accepts booking** → OTPs generated
2. **Passenger receives OTPs** → Via notification
3. **Passenger boards** → Shows pickup OTP to driver
4. **Driver verifies pickup OTP** → Ride starts (IN_PROGRESS)
5. **Passenger arrives** → Shows drop OTP to driver
6. **Driver verifies drop OTP** → Ride completes (COMPLETED)

**All OTPs are included in the booking response! ✅**
