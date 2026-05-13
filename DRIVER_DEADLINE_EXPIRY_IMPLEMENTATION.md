# Driver Decision Deadline Expiry - Implementation Complete ✅

## Overview

Successfully implemented the deadline expiry handling feature that notifies riders when drivers don't respond within the decision deadline and provides options to extend wait or cancel with full refund.

---

## Implementation Summary

### ✅ Phase 1: Background Job for Deadline Monitoring

**Created Files:**
- `src/services/booking-deadline-checker.service.ts` - Service that checks for expired deadlines
- `src/jobs/booking-deadline-checker.job.ts` - Cron job that runs every minute

**Features:**
- Monitors bookings in `DRIVER_PENDING` status
- Detects when `driverDecisionDeadlineAt` has passed
- Sends notification to rider when deadline expires
- Handles both initial deadline expiry and extended deadline expiry
- Auto-cancels bookings when extended deadline expires

---

### ✅ Phase 2: Rider Actions API

**New Endpoint:**
- `POST /api/bookings/:id/extend-wait` - Rider extends waiting period by 1 hour

**Enhanced Endpoint:**
- `POST /api/bookings/:id/cancel` - Now detects deadline expiry and gives 100% refund

**Implementation:**
- Added `extendWaitForDriver` service method in `ride-booking.service.ts`
- Enhanced `cancelBooking` service method to detect deadline expiry
- Added controller method `extendWaitForDriver` in `ride-booking.controller.ts`
- Added route in `ride-booking.routes.ts`

---

### ✅ Phase 3: Database Schema Updates

**New Fields in `RideBooking` model:**
```prisma
deadlineExpiredNotifiedAt DateTime?  // When rider was notified of expiry
deadlineExtendedAt        DateTime?  // When rider extended the wait
autoCancelledAt           DateTime?  // When system auto-cancelled
```

**Migration:**
- Applied using `npx prisma db push`
- Generated Prisma client with new fields

---

### ✅ Phase 4: Cron Job Registration

**Modified File:**
- `src/app.ts` - Added cron job startup

**Code:**
```typescript
import { startBookingDeadlineChecker } from './jobs/booking-deadline-checker.job.js';

// Start background jobs
startBookingDeadlineChecker();
```

---

## API Endpoints

### 1. Extend Waiting Period

**Endpoint:** `POST /api/bookings/:id/extend-wait`

**Purpose:** Rider extends waiting period by 1 hour when driver hasn't responded

**Request:**
```http
POST /api/bookings/booking-uuid/extend-wait
Authorization: Bearer <rider-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Waiting period extended successfully",
  "data": {
    "bookingId": "booking-uuid",
    "status": "DRIVER_PENDING",
    "newDeadline": "2026-05-13T11:00:00.000Z",
    "extendedBy": "rider"
  }
}
```

**Error Cases:**
- `404 NOT_FOUND` - Booking not found
- `409 CONFLICT` - Booking is not waiting for driver confirmation
- `400 BAD_REQUEST` - Deadline has not expired yet
- `409 CONFLICT` - Waiting period already extended

---

### 2. Cancel Booking (Enhanced)

**Endpoint:** `POST /api/bookings/:id/cancel`

**Purpose:** Rider cancels booking - gives 100% refund if deadline expired

**Request:**
```http
POST /api/bookings/booking-uuid/cancel
Authorization: Bearer <rider-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Booking cancelled successfully",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "refundPercent": 100,
    "refundAmount": 20.00,
    "refundInitiated": true
  }
}
```

**Enhancement:**
- Detects if deadline expired (`driverDecisionDeadlineAt < now` and status is `DRIVER_PENDING`)
- Gives 100% refund when deadline expired (instead of time-based refund policy)
- Sets cancellation reason to `DRIVER_NO_RESPONSE` instead of `PASSENGER_CANCELLED`

---

## Notification Types

### 1. Deadline Expired Notification (to Rider)

**Type:** `booking.driver.deadline_expired`

**Payload:**
```json
{
  "type": "booking.driver.deadline_expired",
  "title": "Driver hasn't responded yet",
  "body": "The driver hasn't confirmed your booking. You can wait 1 more hour or search for a new ride.",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "originAddress": "Palwal, Haryana",
    "destinationAddress": "Faridabad, Haryana",
    "action": "deadline_expired",
    "deepLink": "app://booking/booking-uuid/deadline-expired"
  }
}
```

---

### 2. Extended Wait Notification (to Driver)

**Type:** `booking.rider.extended_wait`

**Payload:**
```json
{
  "type": "booking.rider.extended_wait",
  "title": "Rider is still waiting",
  "body": "The rider extended the waiting period. Please respond within 1 hour.",
  "data": {
    "bookingId": "booking-uuid",
    "rideId": "ride-uuid",
    "newDeadline": "2026-05-13T11:00:00.000Z",
    "deepLink": "app://driver/booking-request/booking-uuid"
  }
}
```

---

### 3. Auto-Cancelled Notification (to Rider)

**Type:** `booking.cancelled.no_driver_response`

**Payload:**
```json
{
  "type": "booking.cancelled.no_driver_response",
  "title": "Booking cancelled",
  "body": "Your booking was cancelled due to no driver response. Full refund initiated.",
  "data": {
    "bookingId": "booking-uuid",
    "refundAmount": "20.00",
    "deepLink": "app://search-rides"
  }
}
```

---

## Flow Diagram

```
Booking Created (PAYMENT_PENDING)
         ↓
Payment Completed (DRIVER_PENDING)
         ↓
Driver Decision Deadline Set (60 minutes)
         ↓
    ┌────────────────────────────┐
    │   Driver Responds?         │
    └────────────────────────────┘
         ↓                    ↓
    YES (Accept/Reject)    NO (Deadline Expires)
         ↓                    ↓
    CONFIRMED/CANCELLED   Cron Job Detects Expiry
                              ↓
                    Notify Rider with Options:
                    1. Wait 1 more hour
                    2. Cancel & get full refund
                              ↓
                    ┌─────────────────────┐
                    │  Rider Chooses?     │
                    └─────────────────────┘
                         ↓              ↓
                    Wait 1 Hour    Cancel Booking
                         ↓              ↓
                Extended Deadline   100% Refund
                (DRIVER_PENDING)    Status: CANCELLED
                         ↓
                    ┌─────────────────────┐
                    │ Extended Deadline?  │
                    └─────────────────────┘
                         ↓              ↓
                    Driver Accepts  Still No Response
                         ↓              ↓
                    CONFIRMED      Auto-Cancel
                                   100% Refund
```

---

## Background Job Details

### Cron Schedule
- **Frequency:** Every minute (`* * * * *`)
- **Service:** `booking-deadline-checker.service.ts`
- **Job:** `booking-deadline-checker.job.ts`

### What It Does

1. **Check Initial Deadline Expiry:**
   - Finds bookings with `status = DRIVER_PENDING`
   - Where `driverDecisionDeadlineAt <= now`
   - And `deadlineExpiredNotifiedAt = null`
   - Sends notification to rider
   - Marks `deadlineExpiredNotifiedAt = now`

2. **Check Extended Deadline Expiry:**
   - Finds bookings with `status = DRIVER_PENDING`
   - Where `driverDecisionDeadlineAt <= now`
   - And `deadlineExtendedAt != null`
   - And `autoCancelledAt = null`
   - Auto-cancels booking with 100% refund
   - Marks `autoCancelledAt = now`
   - Restores seats to ride
   - Sends notification to rider

---

## Configuration

### Environment Variables

```bash
# Driver decision deadline (in minutes)
DRIVER_DECISION_WINDOW_MINUTES=60

# Extended deadline (in hours)
EXTENDED_DEADLINE_HOURS=1
```

### Constants

**File:** `src/modules/payments/stripe.constants.ts`
```typescript
export const DRIVER_DECISION_WINDOW_MINUTES = 60; // 1 hour
```

**File:** `src/modules/ride-booking/ride-booking.service.ts`
```typescript
const EXTENDED_DEADLINE_MS = 60 * 60 * 1000; // 1 hour
```

---

## Testing Scenarios

### Test 1: Deadline Expires, Rider Extends Wait

1. Create booking → Status: `DRIVER_PENDING`, deadline set to 60 minutes
2. Wait 60 minutes (or manually update `driverDecisionDeadlineAt` to past time)
3. Cron job runs → Rider gets notification
4. Rider calls `POST /api/bookings/:id/extend-wait`
5. Deadline extended by 1 hour
6. Driver gets notification about extended wait
7. Driver can still accept/reject within new deadline

**Expected Result:**
- Rider notification sent
- Deadline extended by 1 hour
- Driver notified
- Booking remains in `DRIVER_PENDING` status

---

### Test 2: Deadline Expires, Rider Cancels

1. Create booking → Status: `DRIVER_PENDING`, deadline set to 60 minutes
2. Wait 60 minutes
3. Cron job runs → Rider gets notification
4. Rider calls `POST /api/bookings/:id/cancel`
5. System detects deadline expired → 100% refund
6. Booking cancelled, seats restored to ride

**Expected Result:**
- Rider notification sent
- 100% refund processed
- Booking status: `CANCELLED`
- Cancellation reason: `DRIVER_NO_RESPONSE`
- Seats restored to ride

---

### Test 3: Extended Deadline Expires, Auto-Cancel

1. Create booking → Status: `DRIVER_PENDING`
2. Wait 60 minutes → Rider extends wait
3. Wait 1 more hour (extended deadline expires)
4. Cron job runs → Auto-cancels booking
5. Rider gets notification with refund info
6. 100% refund processed

**Expected Result:**
- Auto-cancellation triggered
- 100% refund processed
- Booking status: `CANCELLED`
- `autoCancelledAt` timestamp set
- Cancellation reason: `DRIVER_NO_RESPONSE_EXTENDED`
- Seats restored to ride
- Rider notified

---

## Dependencies Installed

```bash
npm install node-cron @types/node-cron
```

**Versions:**
- `node-cron`: ^3.0.3
- `@types/node-cron`: ^3.0.11

---

## Files Modified/Created

### Created Files:
1. `src/services/booking-deadline-checker.service.ts` - Deadline checking logic
2. `src/jobs/booking-deadline-checker.job.ts` - Cron job scheduler
3. `DRIVER_DEADLINE_EXPIRY_IMPLEMENTATION.md` - This documentation

### Modified Files:
1. `src/app.ts` - Added cron job startup
2. `src/modules/ride-booking/ride-booking.service.ts` - Added `extendWaitForDriver` and enhanced `cancelBooking`
3. `src/modules/ride-booking/ride-booking.controller.ts` - Added `extendWaitForDriver` controller
4. `src/modules/ride-booking/ride-booking.routes.ts` - Added extend-wait route
5. `prisma/schema.prisma` - Added deadline tracking fields

---

## Database Schema Changes

**Added Fields to `RideBooking` model:**

```prisma
deadlineExpiredNotifiedAt DateTime?  // When rider was notified of expiry
deadlineExtendedAt        DateTime?  // When rider extended the wait
autoCancelledAt           DateTime?  // When system auto-cancelled
```

**Migration Applied:**
```bash
npx prisma db push
npx prisma generate
```

---

## Frontend Integration Guide

### 1. Listen for Deadline Expired Notification

```typescript
// When notification type is 'booking.driver.deadline_expired'
if (notification.type === 'booking.driver.deadline_expired') {
  // Navigate to deadline expired screen
  navigation.navigate('BookingDeadlineExpired', {
    bookingId: notification.data.bookingId
  });
}
```

---

### 2. Deadline Expired Screen UI

```tsx
<View>
  <Text>Driver Hasn't Responded Yet</Text>
  <Text>The driver hasn't confirmed your booking within the time limit.</Text>
  
  <Button onPress={handleExtendWait}>
    ⏰ Wait 1 More Hour
  </Button>
  
  <Button onPress={handleCancelBooking}>
    ❌ Cancel Booking (100% Refund)
  </Button>
</View>
```

---

### 3. API Calls

```typescript
// Extend wait
const extendWait = async (bookingId: string) => {
  const response = await fetch(`/api/bookings/${bookingId}/extend-wait`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  const result = await response.json();
  // Show success message
  // Navigate back to booking details
};

// Cancel booking
const cancelBooking = async (bookingId: string) => {
  const response = await fetch(`/api/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  const result = await response.json();
  // Show refund confirmation
  // Navigate to search rides
};
```

---

## Summary

✅ Background job monitors expired deadlines every minute  
✅ Rider gets notified when deadline expires  
✅ Rider can extend wait by 1 hour via API  
✅ Rider can cancel and get 100% refund via existing API  
✅ System auto-cancels if extended deadline expires  
✅ All parties get appropriate notifications  
✅ Full refund guaranteed for no driver response  
✅ Database schema updated with tracking fields  
✅ TypeScript compilation successful  
✅ Cron job registered and running  

**Implementation Status:** ✅ COMPLETE

The deadline expiry handling feature is now fully implemented and ready for testing!
