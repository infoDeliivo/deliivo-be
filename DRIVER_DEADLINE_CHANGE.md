# Driver Decision Deadline Change

## Change Summary

**Date:** May 13, 2026

**Change:** Increased driver response deadline from 30 minutes to 1 hour

---

## What Changed

### Before
- Driver had **30 minutes** to accept/reject a booking
- After 30 minutes, deadline would expire

### After
- Driver now has **1 hour (60 minutes)** to accept/reject a booking
- After 1 hour, deadline will expire

---

## File Modified

**File:** `src/modules/payments/stripe.constants.ts`

```typescript
// BEFORE
export const DRIVER_DECISION_WINDOW_MINUTES = 30;

// AFTER
export const DRIVER_DECISION_WINDOW_MINUTES = 60;
```

---

## Impact

### When Payment is Captured

When a rider completes payment, the system:
1. Updates booking status to `DRIVER_PENDING`
2. Sets `driverDecisionDeadlineAt` = current time + **1 hour**
3. Sends notification to driver

**Example:**
- Payment completed: 09:00 AM
- Deadline set to: 10:00 AM (1 hour later)
- Driver must respond before: 10:00 AM

### Driver View

When driver views the booking:
```json
{
  "decisionDeadline": {
    "deadlineAt": "2026-05-13T10:00:00Z",
    "timeRemainingMs": 3600000,
    "timeRemainingSeconds": 3600,
    "isExpired": false
  }
}
```

### Notification

Driver receives notification with:
```json
{
  "type": "booking.request.driver_decision",
  "title": "New ride request",
  "body": "John wants Palwal to Faridabad",
  "data": {
    "decisionDeadlineAt": "2026-05-13T10:00:00Z"
  }
}
```

---

## Testing

### Test Scenario

1. **Create booking and complete payment**
   ```bash
   POST /api/bookings
   # Complete payment via Stripe
   ```

2. **Check deadline is set to 1 hour**
   ```bash
   GET /api/publish-ride/:rideId
   # Verify: decisionDeadline.timeRemainingSeconds ≈ 3600
   ```

3. **Wait 1 hour**
   ```bash
   # After 1 hour, deadline should expire
   # decisionDeadline.isExpired = true
   ```

4. **Try to accept after deadline**
   ```bash
   POST /api/driver/bookings/:id/accept
   # Expected: 409 Conflict
   # Error: "Driver decision deadline has passed"
   ```

---

## Configuration

The deadline can be adjusted by changing the constant:

```typescript
// src/modules/payments/stripe.constants.ts

// Set to desired minutes
export const DRIVER_DECISION_WINDOW_MINUTES = 60; // 1 hour

// Or change to different values:
// 15 minutes: DRIVER_DECISION_WINDOW_MINUTES = 15
// 30 minutes: DRIVER_DECISION_WINDOW_MINUTES = 30
// 2 hours: DRIVER_DECISION_WINDOW_MINUTES = 120
```

---

## Related Features

### Deadline Expiry Handling (Planned)

When the 1-hour deadline expires:
1. Rider gets notification
2. Rider can choose to:
   - Wait 1 more hour
   - Cancel and get full refund

See: `DRIVER_DEADLINE_EXPIRY_PLAN.md`

---

## Summary

✅ **Driver deadline changed: 30 minutes → 1 hour**  
✅ **No code changes needed elsewhere**  
✅ **Automatically applies to all new bookings**  
✅ **Existing bookings keep their original deadline**  

The change is complete and will take effect immediately for all new bookings!
