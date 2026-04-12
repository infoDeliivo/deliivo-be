# OTP in Booking Response - Feature Added

## Overview

Added **pickup and drop OTPs** to the passenger's booking details API response.

## What Changed

### API Endpoint
```
GET /api/v1/bookings/{bookingId}
Authorization: Bearer <passenger-token>
```

### New Response Fields

```typescript
{
  "id": "booking-123",
  "rideId": "ride-456",
  "status": "CONFIRMED",
  "seatsBooked": 2,
  "totalPrice": 30.00,
  
  // NEW FIELDS ⬇️
  "pickupOtp": "123456",           // 6-digit OTP for pickup
  "dropOtp": "789012",             // 6-digit OTP for drop
  "pickupOtpVerifiedAt": null,     // Timestamp when pickup OTP was verified
  "dropOtpVerifiedAt": null,       // Timestamp when drop OTP was verified
  
  "ride": {
    "driver": {
      "name": "John Driver",
      "avatarUrl": "..."
    },
    "originAddress": "London",
    "destinationAddress": "Manchester",
    "departureDate": "2026-04-15",
    "departureTime": "10:00"
  }
}
```

## When OTPs Are Available

### Booking Status Flow

1. **PAYMENT_PENDING** → No OTPs yet
2. **DRIVER_PENDING** → No OTPs yet
3. **CONFIRMED** → ✅ **OTPs available** (driver accepted)
4. **IN_PROGRESS** → ✅ **OTPs available** (pickup verified)
5. **COMPLETED** → OTPs available (both verified)

### OTP Availability

| Booking Status | pickupOtp | dropOtp | pickupOtpVerifiedAt | dropOtpVerifiedAt |
|----------------|-----------|---------|---------------------|-------------------|
| PAYMENT_PENDING | `null` | `null` | `null` | `null` |
| DRIVER_PENDING | `null` | `null` | `null` | `null` |
| **CONFIRMED** | `"123456"` | `"789012"` | `null` | `null` |
| **IN_PROGRESS** | `"123456"` | `"789012"` | `2026-04-15T10:05:00Z` | `null` |
| **COMPLETED** | `"123456"` | `"789012"` | `2026-04-15T10:05:00Z` | `2026-04-15T12:30:00Z` |

## Example Responses

### Before Driver Accepts (DRIVER_PENDING)
```json
{
  "success": true,
  "data": {
    "id": "booking-123",
    "status": "DRIVER_PENDING",
    "pickupOtp": null,
    "dropOtp": null,
    "pickupOtpVerifiedAt": null,
    "dropOtpVerifiedAt": null
  }
}
```

### After Driver Accepts (CONFIRMED)
```json
{
  "success": true,
  "data": {
    "id": "booking-123",
    "status": "CONFIRMED",
    "pickupOtp": "123456",           // ← Show this to driver at pickup
    "dropOtp": "789012",             // ← Show this to driver at drop
    "pickupOtpVerifiedAt": null,
    "dropOtpVerifiedAt": null,
    "ride": {
      "driver": {
        "name": "John Driver",
        "avatarUrl": "https://example.com/john.jpg"
      },
      "departureDate": "2026-04-15",
      "departureTime": "10:00"
    }
  }
}
```

### After Pickup Verified (IN_PROGRESS)
```json
{
  "success": true,
  "data": {
    "id": "booking-123",
    "status": "IN_PROGRESS",
    "pickupOtp": "123456",
    "dropOtp": "789012",
    "pickupOtpVerifiedAt": "2026-04-15T10:05:00Z",  // ← Pickup verified
    "dropOtpVerifiedAt": null
  }
}
```

### After Drop Verified (COMPLETED)
```json
{
  "success": true,
  "data": {
    "id": "booking-123",
    "status": "COMPLETED",
    "pickupOtp": "123456",
    "dropOtp": "789012",
    "pickupOtpVerifiedAt": "2026-04-15T10:05:00Z",
    "dropOtpVerifiedAt": "2026-04-15T12:30:00Z"    // ← Drop verified
  }
}
```

## Frontend Integration

### Display OTPs to Passenger

```jsx
const BookingDetails = ({ booking }) => {
  if (booking.status === 'CONFIRMED' || booking.status === 'IN_PROGRESS') {
    return (
      <div className="otp-section">
        <h3>Your Ride OTPs</h3>
        
        {/* Pickup OTP */}
        <div className="otp-card">
          <div className="otp-header">
            <h4>Pickup OTP</h4>
            {booking.pickupOtpVerifiedAt ? (
              <Badge color="green">✓ Verified</Badge>
            ) : (
              <Badge color="blue">Show to driver at pickup</Badge>
            )}
          </div>
          <div className="otp-value">{booking.pickupOtp}</div>
          {booking.pickupOtpVerifiedAt && (
            <p className="verified-time">
              Verified at {new Date(booking.pickupOtpVerifiedAt).toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Drop OTP */}
        <div className="otp-card">
          <div className="otp-header">
            <h4>Drop OTP</h4>
            {booking.dropOtpVerifiedAt ? (
              <Badge color="green">✓ Verified</Badge>
            ) : (
              <Badge color="orange">Show to driver at destination</Badge>
            )}
          </div>
          <div className="otp-value">{booking.dropOtp}</div>
          {booking.dropOtpVerifiedAt && (
            <p className="verified-time">
              Verified at {new Date(booking.dropOtpVerifiedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="waiting-confirmation">
      <p>Waiting for driver to accept your booking...</p>
      <p>OTPs will be available once confirmed</p>
    </div>
  );
};
```

### Copy OTP to Clipboard

```jsx
const CopyOtpButton = ({ otp, type }) => {
  const copyToClipboard = () => {
    navigator.clipboard.writeText(otp);
    toast.success(`${type} OTP copied!`);
  };

  return (
    <button onClick={copyToClipboard} className="copy-btn">
      <CopyIcon /> Copy {type} OTP
    </button>
  );
};
```

### Show OTP Status

```jsx
const OtpStatus = ({ booking }) => {
  const getStatus = () => {
    if (booking.status === 'DRIVER_PENDING') {
      return { text: 'Waiting for driver confirmation', color: 'gray' };
    }
    if (booking.status === 'CONFIRMED') {
      return { text: 'OTPs ready - Show to driver', color: 'blue' };
    }
    if (booking.status === 'IN_PROGRESS') {
      return { text: 'Ride in progress', color: 'green' };
    }
    if (booking.status === 'COMPLETED') {
      return { text: 'Ride completed', color: 'green' };
    }
    return { text: 'Unknown status', color: 'gray' };
  };

  const status = getStatus();
  
  return (
    <div className={`status-badge status-${status.color}`}>
      {status.text}
    </div>
  );
};
```

## Security Notes

✅ **OTPs are only visible to the passenger** who owns the booking  
✅ **OTPs are retrieved from notifications** (stored when driver accepts)  
✅ **OTPs expire** after a certain time:
- Pickup OTP: 6 hours validity
- Drop OTP: 24 hours validity

✅ **OTPs are hashed in database** for security  
✅ **Plain OTPs only available via notification data**

## Testing

### Test Scenario

1. **Create booking** → OTPs are `null`
```bash
POST /api/v1/bookings
GET /api/v1/bookings/{id}
# Response: pickupOtp: null, dropOtp: null
```

2. **Driver accepts** → OTPs generated
```bash
POST /api/v1/driver/bookings/{id}/accept
GET /api/v1/bookings/{id}
# Response: pickupOtp: "123456", dropOtp: "789012"
```

3. **Driver verifies pickup** → Pickup verified
```bash
POST /api/v1/driver/bookings/{id}/pickup-otp/verify
GET /api/v1/bookings/{id}
# Response: pickupOtpVerifiedAt: "2026-04-15T10:05:00Z"
```

4. **Driver verifies drop** → Drop verified
```bash
POST /api/v1/driver/bookings/{id}/drop-otp/verify
GET /api/v1/bookings/{id}
# Response: dropOtpVerifiedAt: "2026-04-15T12:30:00Z"
```

## Summary

✅ **Added OTP fields** to `GET /api/v1/bookings/{id}` response  
✅ **OTPs available** when booking status is CONFIRMED or IN_PROGRESS  
✅ **Verification timestamps** show when OTPs were used  
✅ **Passenger can see their OTPs** to show to driver  
✅ **No database schema changes** needed (uses notification data)

The feature is ready to use!
