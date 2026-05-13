# Driver Rejection/Cancellation Reason - Implementation Summary

## Overview

Added **required** reason text field when drivers reject or cancel bookings, allowing them to explain their decision to riders.

---

## What Was Implemented

### 1. **API Changes**

#### Reject Booking API
**Endpoint:** `POST /api/driver/bookings/:id/reject`

**Before:**
```json
{
  // No body required
}
```

**After (Required):**
```json
{
  "reason": "I have an emergency and cannot drive today"
}
```

**Validation:**
- `reason` is **required** (not optional)
- Minimum 1 character
- Maximum 500 characters

---

#### Cancel Booking API (After Accept)
**Endpoint:** `POST /api/driver/bookings/:id/cancel`

**Before:**
```json
{
  // No body required
}
```

**After (Required):**
```json
{
  "reason": "Vehicle broke down, cannot complete the trip"
}
```

**Validation:**
- `reason` is **required** (not optional)
- Minimum 1 character
- Maximum 500 characters

---

### 2. **Database Schema**

Added two new fields to `RideBooking` table:

```sql
ALTER TABLE "RideBooking" 
ADD COLUMN "driverRejectionReason" TEXT,
ADD COLUMN "driverCancellationReason" TEXT;
```

**Fields:**
- `driverRejectionReason` - Stored when driver rejects (DRIVER_PENDING → CANCELLED)
- `driverCancellationReason` - Stored when driver cancels after accepting (CONFIRMED → CANCELLED)

---

### 3. **Notification Updates**

#### Rejection Notification (to Rider)
```json
{
  "type": "booking.driver.rejected",
  "title": "Booking declined",
  "body": "The driver declined this ride request: I have an emergency and cannot drive today",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "rejectionReason": "I have an emergency and cannot drive today",
    "refundInitiated": "true",
    "refundPercent": "100",
    "deepLink": "app://booking/booking-uuid"
  }
}
```

#### Cancellation Notification (to Rider)
```json
{
  "type": "booking.driver.cancelled",
  "title": "Ride cancelled by driver",
  "body": "Your driver cancelled this ride: Vehicle broke down, cannot complete the trip. Refund has been initiated.",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "cancellationReason": "Vehicle broke down, cannot complete the trip",
    "refundInitiated": "true",
    "refundPercent": "100",
    "deepLink": "app://booking/booking-uuid"
  }
}
```

---

## Files Modified

### 1. Validator
**File:** `src/modules/driver-booking/driver-booking.validator.ts`

```typescript
export const rejectReasonSchema = z.object({
    reason: z.string()
        .min(1, 'Reason is required')
        .max(500, 'Reason must be 500 characters or less'),
});

export const cancelReasonSchema = z.object({
    reason: z.string()
        .min(1, 'Reason is required')
        .max(500, 'Reason must be 500 characters or less'),
});
```

### 2. Routes
**File:** `src/modules/driver-booking/driver-booking.routes.ts`

```typescript
router.post(
    '/:id/reject',
    validate({ params: bookingIdParamSchema, body: rejectReasonSchema }),
    controller.rejectBooking
);

router.post(
    '/:id/cancel',
    validate({ params: bookingIdParamSchema, body: cancelReasonSchema }),
    controller.cancelAfterAccept
);
```

### 3. Controller
**File:** `src/modules/driver-booking/driver-booking.controller.ts`

```typescript
export const rejectBooking = async (req: AuthRequest, res: Response) => {
    const bookingId = req.params.id as string;
    const { reason } = req.body as { reason: string };
    const result = await DriverBookingService.rejectBooking(req.user.id, bookingId, reason);
    // ...
};

export const cancelAfterAccept = async (req: AuthRequest, res: Response) => {
    const bookingId = req.params.id as string;
    const { reason } = req.body as { reason: string };
    const result = await DriverBookingService.cancelAfterAccept(req.user.id, bookingId, reason);
    // ...
};
```

### 4. Service
**File:** `src/modules/driver-booking/driver-booking.service.ts`

**Reject Booking:**
```typescript
export const rejectBooking = async (
    driverId: string, 
    bookingId: string, 
    reason: string  // NEW PARAMETER
): Promise<DriverBookingResult> => {
    // ...
    await tx.rideBooking.update({
        where: { id: bookingId },
        data: {
            // ...
            driverRejectionReason: reason,  // STORE REASON
            // ...
        },
    });
    
    // Include reason in notification
    await createNotification({
        userId: booking.passengerId,
        type: 'booking.driver.rejected',
        title: 'Booking declined',
        body: `The driver declined this ride request: ${reason}`,
        data: {
            rejectionReason: reason,  // INCLUDE IN NOTIFICATION
            // ...
        },
    });
};
```

**Cancel After Accept:**
```typescript
export const cancelAfterAccept = async (
    driverId: string, 
    bookingId: string, 
    reason: string  // NEW PARAMETER
): Promise<DriverBookingResult> => {
    // ...
    await tx.rideBooking.update({
        where: { id: bookingId },
        data: {
            // ...
            driverCancellationReason: reason,  // STORE REASON
            // ...
        },
    });
    
    // Include reason in notification
    await createNotification({
        userId: booking.passengerId,
        type: 'booking.driver.cancelled',
        title: 'Ride cancelled by driver',
        body: `Your driver cancelled this ride: ${reason}. Refund has been initiated.`,
        data: {
            cancellationReason: reason,  // INCLUDE IN NOTIFICATION
            // ...
        },
    });
};
```

---

## API Request Examples

### 1. Reject Booking

**Request:**
```http
POST /api/driver/bookings/cm123abc456/reject
Authorization: Bearer <driver-token>
Content-Type: application/json

{
  "reason": "I have an emergency and cannot drive today"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking rejected successfully",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "passengerId": "passenger-uuid",
    "status": "CANCELLED"
  }
}
```

**Error (Missing Reason):**
```json
{
  "success": false,
  "message": "Reason is required",
  "status": 400
}
```

---

### 2. Cancel After Accept

**Request:**
```http
POST /api/driver/bookings/cm123abc456/cancel
Authorization: Bearer <driver-token>
Content-Type: application/json

{
  "reason": "Vehicle broke down, cannot complete the trip"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking cancelled successfully",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "passengerId": "passenger-uuid",
    "status": "CANCELLED"
  }
}
```

---

## Common Rejection/Cancellation Reasons

### Rejection Reasons (DRIVER_PENDING → CANCELLED)
- "I have an emergency and cannot drive today"
- "Route is too far for me"
- "I'm not comfortable with this trip"
- "Vehicle is not available"
- "Schedule conflict"
- "Too many passengers for my vehicle"

### Cancellation Reasons (CONFIRMED → CANCELLED)
- "Vehicle broke down"
- "Family emergency"
- "Feeling unwell, cannot drive safely"
- "Unexpected traffic/road closure"
- "Vehicle accident"
- "Personal emergency"

---

## Frontend Integration

### Reject Booking Form

```typescript
const rejectBooking = async (bookingId: string, reason: string) => {
  try {
    const response = await fetch(`/api/driver/bookings/${bookingId}/reject`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to reject booking');
    }
    
    const data = await response.json();
    console.log('Booking rejected:', data);
  } catch (error) {
    console.error('Error rejecting booking:', error);
  }
};

// Usage
<form onSubmit={(e) => {
  e.preventDefault();
  const reason = e.target.reason.value;
  rejectBooking(bookingId, reason);
}}>
  <textarea 
    name="reason" 
    placeholder="Please explain why you're rejecting this booking"
    required
    maxLength={500}
  />
  <button type="submit">Reject Booking</button>
</form>
```

### Cancel Booking Form

```typescript
const cancelBooking = async (bookingId: string, reason: string) => {
  try {
    const response = await fetch(`/api/driver/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to cancel booking');
    }
    
    const data = await response.json();
    console.log('Booking cancelled:', data);
  } catch (error) {
    console.error('Error cancelling booking:', error);
  }
};

// Usage
<form onSubmit={(e) => {
  e.preventDefault();
  const reason = e.target.reason.value;
  cancelBooking(bookingId, reason);
}}>
  <textarea 
    name="reason" 
    placeholder="Please explain why you're cancelling this ride"
    required
    maxLength={500}
  />
  <button type="submit">Cancel Ride</button>
</form>
```

---

## Database Migration

Run this migration to add the new fields:

```bash
# Create migration
npx prisma migrate dev --name add_driver_reason_fields

# Or run the SQL directly
psql -d your_database -f DRIVER_REASON_FIELDS_MIGRATION.sql
```

---

## Testing

### Test 1: Reject with Reason
```bash
# 1. Create booking (as rider)
POST /api/bookings
{
  "rideId": "ride-uuid",
  "seatsBooked": 2
}

# 2. Complete payment

# 3. Reject as driver WITH reason
POST /api/driver/bookings/booking-uuid/reject
{
  "reason": "I have an emergency"
}

# Expected: 
# - Booking status: CANCELLED
# - driverRejectionReason: "I have an emergency"
# - Rider gets notification with reason
```

### Test 2: Reject WITHOUT Reason (Should Fail)
```bash
POST /api/driver/bookings/booking-uuid/reject
{
  // Empty body
}

# Expected: 400 Bad Request
# Error: "Reason is required"
```

### Test 3: Cancel with Reason
```bash
# 1. Accept booking first
POST /api/driver/bookings/booking-uuid/accept

# 2. Cancel WITH reason
POST /api/driver/bookings/booking-uuid/cancel
{
  "reason": "Vehicle broke down"
}

# Expected:
# - Booking status: CANCELLED
# - driverCancellationReason: "Vehicle broke down"
# - Rider gets notification with reason
# - Driver penalty applied
```

---

## Summary

✅ Reason field is **required** for reject and cancel  
✅ Stored in database (`driverRejectionReason`, `driverCancellationReason`)  
✅ Included in rider notifications  
✅ Validation: 1-500 characters  
✅ Better transparency for riders  
✅ Helps track driver behavior patterns  

This implementation ensures drivers must provide a reason when rejecting or cancelling bookings, improving communication and transparency with riders!
