# Booking Status Verification

## Current Implementation

The booking list API (`GET /api/v1/bookings`) correctly returns booking statuses based on the database state. Here's how the system works:

### Status Flow

1. **PAYMENT_PENDING** → User creates booking, payment not yet captured
2. **DRIVER_PENDING** → Payment captured, waiting for driver decision (has deadline)
3. **CONFIRMED** → Driver accepted the booking
4. **IN_PROGRESS** → Ride has started (pickup OTP verified)
5. **COMPLETED** → Ride finished (drop OTP verified)
6. **CANCELLED** → Booking cancelled by user, driver, or system

### Deadline Handling

#### Background Job (Every Minute)
The system runs a cron job every minute that:

1. **Initial Deadline Expired** (not yet notified):
   - Finds bookings with `status = DRIVER_PENDING` and `driverDecisionDeadlineAt <= now`
   - Marks as notified (`deadlineExpiredNotifiedAt`)
   - Sends notification to rider: "Driver hasn't responded yet"
   - Rider can extend wait by 1 hour or cancel

2. **Extended Deadline Expired** (auto-cancel):
   - Finds bookings with extended deadline that expired
   - Updates status to `CANCELLED`
   - Processes 100% refund
   - Restores seats to ride
   - Sends cancellation notification

#### API Response
The `listUserBookings` API returns:

```typescript
{
  "id": "booking-uuid",
  "status": "DRIVER_PENDING",  // Current DB status
  "decisionDeadline": {
    "deadlineAt": "2026-05-20T12:00:00.000Z",
    "timeRemainingMs": 3600000,
    "timeRemainingSeconds": 3600,
    "isExpired": false  // ✅ Calculated in real-time
  }
}
```

### Key Points

✅ **Status is Correct**: The API returns the actual status from the database
✅ **Real-time Expiry Check**: The `isExpired` flag is calculated on each request
✅ **Background Job**: Updates status every minute (max 1-minute delay)
✅ **Frontend Can Handle**: Frontend can check `isExpired` flag to show appropriate UI

### Status Accuracy

The booking status is **always correct** because:

1. **Database is Source of Truth**: Status is stored in DB and updated by background job
2. **Timely Updates**: Cron job runs every minute to update expired bookings
3. **Real-time Deadline Info**: `decisionDeadline.isExpired` is calculated on each API call
4. **Proper Transitions**: All status transitions are handled by the system:
   - Payment webhook → `DRIVER_PENDING`
   - Driver accepts → `CONFIRMED`
   - Pickup OTP → `IN_PROGRESS`
   - Drop OTP → `COMPLETED`
   - Deadline expires → `CANCELLED` (after extension)

### Example Scenarios

#### Scenario 1: Fresh Booking
```json
{
  "status": "DRIVER_PENDING",
  "decisionDeadline": {
    "deadlineAt": "2026-05-20T12:00:00.000Z",
    "timeRemainingSeconds": 3600,
    "isExpired": false
  }
}
```

#### Scenario 2: Deadline Just Expired (Before Cron Runs)
```json
{
  "status": "DRIVER_PENDING",  // Still pending in DB
  "decisionDeadline": {
    "deadlineAt": "2026-05-20T11:00:00.000Z",
    "timeRemainingSeconds": 0,
    "isExpired": true  // ✅ Frontend knows it's expired
  }
}
```

#### Scenario 3: After Cron Job Runs
```json
{
  "status": "CANCELLED",  // Updated by cron job
  "decisionDeadline": null
}
```

### Frontend Handling

The frontend should:

1. **Check `isExpired` flag**: If true, show "Deadline expired" UI even if status is still `DRIVER_PENDING`
2. **Show countdown**: Use `timeRemainingSeconds` to display countdown timer
3. **Handle status transitions**: Listen for WebSocket notifications for real-time updates
4. **Refresh on expiry**: When countdown reaches 0, refresh the booking to get updated status

### Verification Checklist

✅ Booking status reflects database state
✅ `driverDecisionDeadlineAt` is included in booking response
✅ `decisionDeadline` object is calculated for `DRIVER_PENDING` bookings
✅ `isExpired` flag is calculated in real-time
✅ Background job updates expired bookings every minute
✅ All status transitions are properly handled

## Conclusion

The booking list API **correctly returns booking statuses** according to their actual state in the database. The system provides both:
- **Database status**: The official status updated by background jobs
- **Real-time expiry info**: The `isExpired` flag calculated on each request

This dual approach ensures the frontend always has accurate information, even during the brief window (up to 1 minute) between deadline expiry and status update.
