# WebSocket Notification - Decision Time Remaining Enhancement

## Summary
Added the remaining time for driver decision in WebSocket notifications sent to both driver and rider when a booking is created.

## Changes Made

### 1. **Stripe Webhook Notification (Payment Mode)**
**File**: `src/modules/payments/stripe.webhook.controller.ts`

Added `decisionTimeRemainingSeconds` to the notification data:

```typescript
await createNotification({
    userId: booking.ride.driverId,
    type: DRIVER_DECISION_NOTIFICATION_TYPE,
    title: 'New ride request',
    body: `${booking.passenger.name ?? 'Rider'} wants ${originAddress} to ${destinationAddress}`,
    data: {
        bookingId: booking.id,
        rideId: booking.ride.id,
        passengerName: booking.passenger.name ?? 'Rider',
        passengerAvatarUrl: booking.passenger.avatarUrl ?? '',
        originAddress,
        destinationAddress,
        seatsBooked: String(booking.seatsBooked),
        totalPrice: String(booking.totalPrice),
        currency: booking.paymentCurrency ?? booking.ride.currency,
        decisionDeadlineAt: booking.driverDecisionDeadlineAt?.toISOString() ?? '',
        decisionTimeRemainingSeconds: booking.driverDecisionDeadlineAt 
            ? String(Math.max(0, Math.floor((booking.driverDecisionDeadlineAt.getTime() - Date.now()) / 1000)))
            : '0',
        deepLink: `app://driver/booking-request/${booking.id}`,
    },
});
```

### 2. **Bypass Payment Mode Notification**
**File**: `src/modules/ride-booking/ride-booking.service.ts`

#### Added deadline calculation:
```typescript
const now = new Date();
const driverDecisionDeadlineAt = bypassBookingPaymentMode 
    ? new Date(now.getTime() + DRIVER_DECISION_WINDOW_MS) 
    : null;
```

#### Set deadline in booking creation:
```typescript
const booking = await tx.rideBooking.create({
    data: {
        // ... other fields
        driverDecisionDeadlineAt: driverDecisionDeadlineAt ?? undefined,
    },
});
```

#### Added time remaining to notification:
```typescript
await createNotification({
    userId: bookingSeed.ride.driverId,
    type: DRIVER_DECISION_NOTIFICATION_TYPE,
    title: 'New ride request',
    body: `${passengerName} wants ${originAddress} to ${destinationAddress}`,
    data: {
        // ... other fields
        decisionDeadlineAt: driverDecisionDeadlineAt?.toISOString() ?? '',
        decisionTimeRemainingSeconds: driverDecisionDeadlineAt 
            ? String(Math.max(0, Math.floor((driverDecisionDeadlineAt.getTime() - Date.now()) / 1000)))
            : '0',
        deepLink: `app://driver/booking-request/${bookingSeed.booking.id}`,
    },
});
```

### 3. **Driver Booking Acceptance Notification Enhancement**
**File**: `src/modules/driver-booking/driver-booking.service.ts`

Added ride details to the acceptance notification:
```typescript
await createNotification({
    userId: booking.passengerId,
    type: 'booking.driver.accepted',
    title: 'Ride confirmed',
    body: `${booking.ride.driver.name ?? 'Your driver'} accepted your booking`,
    data: {
        bookingId: booking.id,
        rideId: booking.ride.id,
        pickupOtp,
        dropOtp,
        departureDate: booking.ride.departureDate.toISOString(),
        departureTime: booking.ride.departureTime,
        estimatedDurationSeconds: booking.ride.routeDurationSeconds?.toString() ?? '0',
        originAddress: booking.ride.originAddress,
        destinationAddress: booking.ride.destinationAddress,
        driverName: booking.ride.driver.name ?? 'Your driver',
        driverAvatarUrl: booking.ride.driver.avatarUrl ?? '',
        deepLink: `app://booking/${booking.id}`,
    },
});
```

## Notification Data Fields

### For Driver (New Booking Request)
- `decisionDeadlineAt`: ISO timestamp when the decision deadline expires
- `decisionTimeRemainingSeconds`: Number of seconds remaining to accept/reject (as string)
- `passengerName`: Name of the rider
- `passengerAvatarUrl`: Avatar URL of the rider
- `originAddress`: Pickup location
- `destinationAddress`: Drop-off location
- `seatsBooked`: Number of seats requested
- `totalPrice`: Total booking price
- `currency`: Payment currency

### For Rider (Driver Accepted)
- `pickupOtp`: OTP for pickup verification
- `dropOtp`: OTP for drop-off verification
- `departureDate`: Ride departure date (ISO format)
- `departureTime`: Ride departure time (HH:MM format)
- `estimatedDurationSeconds`: Estimated ride duration in seconds
- `originAddress`: Pickup location
- `destinationAddress`: Drop-off location
- `driverName`: Name of the driver
- `driverAvatarUrl`: Avatar URL of the driver

## Benefits

1. **Real-time Countdown**: Frontend can display a countdown timer showing how much time the driver has to respond
2. **Better UX**: Both driver and rider know exactly when the decision window expires
3. **Consistent Data**: Same format used in both payment and bypass payment modes
4. **Complete Information**: All necessary ride details included in notifications

## Example WebSocket Notification

### Driver Receives (New Booking):
```json
{
  "type": "booking.request.driver_decision",
  "title": "New ride request",
  "body": "John Rider wants London, UK to Manchester, UK",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "passengerName": "John Rider",
    "decisionDeadlineAt": "2026-05-20T11:00:00.000Z",
    "decisionTimeRemainingSeconds": "3600",
    "originAddress": "London, UK",
    "destinationAddress": "Manchester, UK",
    "seatsBooked": "2",
    "totalPrice": "50.00",
    "currency": "GBP"
  }
}
```

### Rider Receives (Driver Accepted):
```json
{
  "type": "booking.driver.accepted",
  "title": "Ride confirmed",
  "body": "Sarah Driver accepted your booking",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "pickupOtp": "123456",
    "dropOtp": "789012",
    "departureDate": "2026-05-21T00:00:00.000Z",
    "departureTime": "10:00",
    "estimatedDurationSeconds": "7200",
    "driverName": "Sarah Driver",
    "originAddress": "London, UK",
    "destinationAddress": "Manchester, UK"
  }
}
```

## Testing
Build successful - TypeScript compilation passed without errors.
