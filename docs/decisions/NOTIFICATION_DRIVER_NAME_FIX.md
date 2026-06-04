# Notification Driver Name Bug Fix

## Issue
When a rider books a ride and the driver accepts, the notification sent to the rider was showing the **rider's own name** instead of the **driver's name**.

### Before (Bug)
```
Notification: "John Rider accepted your booking"
```
Where "John Rider" is the passenger's name (wrong!)

### After (Fixed)
```
Notification: "Sarah Driver accepted your booking"
```
Where "Sarah Driver" is the actual driver's name (correct!)

## Root Cause
In `src/modules/driver-booking/driver-booking.service.ts`, the `acceptBooking` function was using:
```typescript
body: `${booking.passenger.name ?? 'Your driver'} accepted your booking`
```

This was incorrectly using `booking.passenger.name` (the rider) instead of the driver's name.

## Changes Made

### 1. Updated `fetchDriverBooking` Function
Added driver information to the query:

```typescript
const fetchDriverBooking = async (bookingId: string) => {
    return prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            passenger: { ... },
            ride: {
                select: { ... },
                include: {
                    driver: {
                        select: {
                            id: true,
                            name: true,
                            avatarUrl: true,
                        },
                    },
                },
            },
        },
    });
};
```

### 2. Fixed Notification Message in `acceptBooking`
Changed the notification body to use the driver's name:

```typescript
await createNotification({
    userId: booking.passengerId,
    type: 'booking.driver.accepted',
    title: 'Ride confirmed',
    body: `${booking.ride.driver.name ?? 'Your driver'} accepted your booking`,
    data: { ... },
});
```

## Impact
- **Affected Function**: `acceptBooking` in `driver-booking.service.ts`
- **Notification Type**: `booking.driver.accepted`
- **User Impact**: Riders will now see the correct driver's name in acceptance notifications
- **Other Functions**: Checked `rejectBooking` and `cancelAfterAccept` - they don't have this issue

## Testing
Build successful - TypeScript compilation passed without errors.

## Related Files
- `src/modules/driver-booking/driver-booking.service.ts`
