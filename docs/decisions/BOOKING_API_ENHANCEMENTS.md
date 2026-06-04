# Booking API Enhancements

## Summary
Enhanced the booking list and booking detail APIs to include ride status and decision deadline information for better user experience.

## Changes Made

### 1. **Added Ride Status in Booking Responses**
- The `ride` object in booking responses now includes a `status` field
- This shows the current status of the ride (e.g., "PUBLISHED", "CANCELLED", "COMPLETED")
- Helps users understand if the ride is still active

### 2. **Added Decision Deadline Information**
- When a booking is in `DRIVER_PENDING` status, the response now includes a `decisionDeadline` object
- This object contains:
  - `deadlineAt`: The exact time when the driver must respond
  - `timeRemainingMs`: Time remaining in milliseconds
  - `timeRemainingSeconds`: Time remaining in seconds (for easier display)
  - `isExpired`: Boolean indicating if the deadline has passed

### 3. **Updated Type Definitions**
- Updated `BookingResponse` interface to include `decisionDeadline` field
- Updated `BookingRideInfo` interface to include `status` field
- Updated `RideWithDetails` internal type to include `status` field

### 4. **Updated Service Layer**
- Modified `mapBookingResponse` function to calculate and include decision deadline info
- Modified `mapRideInfo` function to include ride status
- Both `listUserBookings` and `getBookingById` now return the enhanced data

### 5. **Updated OpenAPI Documentation**
- Added new example `BookingDriverPending` showing a booking with decision deadline
- Updated existing examples to include the new fields
- All booking response examples now show:
  - `decisionDeadline` (null for non-DRIVER_PENDING bookings)
  - `ride.status` field

## API Response Examples

### Booking in DRIVER_PENDING Status
```json
{
  "id": "booking-uuid",
  "status": "DRIVER_PENDING",
  "decisionDeadline": {
    "deadlineAt": "2026-05-20T12:00:00.000Z",
    "timeRemainingMs": 3600000,
    "timeRemainingSeconds": 3600,
    "isExpired": false
  },
  "ride": {
    "id": "ride-uuid",
    "status": "PUBLISHED",
    "originAddress": "London, UK",
    "destinationAddress": "Manchester, UK",
    ...
  }
}
```

### Booking in Other Status (CONFIRMED, PAYMENT_PENDING, etc.)
```json
{
  "id": "booking-uuid",
  "status": "CONFIRMED",
  "decisionDeadline": null,
  "ride": {
    "id": "ride-uuid",
    "status": "PUBLISHED",
    ...
  }
}
```

## Benefits

1. **Better User Experience**: Users can see exactly how much time remains for driver confirmation
2. **Ride Status Visibility**: Users know if the ride is still active or has been cancelled
3. **Consistent with Driver API**: Similar to how driver booking API shows deadline info
4. **Real-time Countdown**: Frontend can show a countdown timer using `timeRemainingSeconds`
5. **Expired Detection**: Frontend can immediately detect expired deadlines with `isExpired` flag

## Affected Endpoints

- `GET /api/v1/bookings` - List user bookings
- `GET /api/v1/bookings/:id` - Get booking details

Both endpoints now return the enhanced booking response with ride status and decision deadline information.
