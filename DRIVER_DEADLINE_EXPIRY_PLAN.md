# Driver Decision Deadline Expiry - Implementation Plan

## Overview

When a driver doesn't respond to a booking request within the decision deadline, the system should notify the rider and give them options to either wait longer or search for a new ride.

---

## Current Flow Problem

**Current Behavior:**
1. Rider books a ride → Status: `PAYMENT_PENDING`
2. Rider pays → Status: `DRIVER_PENDING` (15-minute deadline set)
3. Driver has 15 minutes to accept/reject
4. **If deadline expires:** Nothing happens automatically ❌

**Problem:**
- Rider doesn't know the driver missed the deadline
- Booking stays in `DRIVER_PENDING` state indefinitely
- Rider's money is held but no confirmation
- Poor user experience

---

## Proposed Solution

### Flow Diagram

```
Booking Created (PAYMENT_PENDING)
         ↓
Payment Completed (DRIVER_PENDING)
         ↓
Driver Decision Deadline Set (15 minutes)
         ↓
    ┌────────────────────────────┐
    │   Driver Responds?         │
    └────────────────────────────┘
         ↓                    ↓
    YES (Accept/Reject)    NO (Deadline Expires)
         ↓                    ↓
    CONFIRMED/CANCELLED   DEADLINE_EXPIRED
                              ↓
                    Notify Rider with Options:
                    1. Wait 1 more hour
                    2. Cancel & search new ride
                              ↓
                    ┌─────────────────────┐
                    │  Rider Chooses?     │
                    └─────────────────────┘
                         ↓              ↓
                    Wait 1 Hour    Cancel Booking
                         ↓              ↓
                Extended Deadline   Full Refund
                (DRIVER_PENDING)    Search New Ride
                         ↓
                    ┌─────────────────────┐
                    │ Extended Deadline?  │
                    └─────────────────────┘
                         ↓              ↓
                    Driver Accepts  Still No Response
                         ↓              ↓
                    CONFIRMED      Auto-Cancel
                                   Full Refund
```

---

## Implementation Plan

### Phase 1: Background Job for Deadline Monitoring

#### 1.1 Create Deadline Checker Service

**File:** `src/services/booking-deadline-checker.service.ts`

```typescript
import { prisma } from '../config/index.js';
import { BookingStatus } from '@prisma/client';
import { createNotification } from '../modules/notification/notification.service.js';

const EXTENDED_DEADLINE_HOURS = 1;

export const checkExpiredDeadlines = async () => {
  const now = new Date();

  // Find bookings with expired deadlines
  const expiredBookings = await prisma.rideBooking.findMany({
    where: {
      status: BookingStatus.DRIVER_PENDING,
      driverDecisionDeadlineAt: {
        lte: now, // Deadline has passed
      },
      deadlineExpiredNotifiedAt: null, // Not yet notified
    },
    include: {
      passenger: {
        select: {
          id: true,
          name: true,
        },
      },
      ride: {
        select: {
          id: true,
          originAddress: true,
          destinationAddress: true,
          driverId: true,
        },
      },
    },
  });

  for (const booking of expiredBookings) {
    await handleExpiredDeadline(booking);
  }

  return {
    checked: expiredBookings.length,
    timestamp: now,
  };
};

const handleExpiredDeadline = async (booking: any) => {
  // Mark as notified
  await prisma.rideBooking.update({
    where: { id: booking.id },
    data: {
      deadlineExpiredNotifiedAt: new Date(),
    },
  });

  // Send notification to rider
  await createNotification({
    userId: booking.passengerId,
    type: 'booking.driver.deadline_expired',
    title: 'Driver hasn\'t responded yet',
    body: `The driver hasn't confirmed your booking. You can wait 1 more hour or search for a new ride.`,
    data: {
      bookingId: booking.id,
      rideId: booking.rideId,
      originAddress: booking.ride.originAddress,
      destinationAddress: booking.ride.destinationAddress,
      action: 'deadline_expired',
      deepLink: `app://booking/${booking.id}/deadline-expired`,
    },
  });

  console.log(`[Deadline Expired] Booking ${booking.id} - Notified rider ${booking.passengerId}`);
};
```

#### 1.2 Create Cron Job

**File:** `src/jobs/booking-deadline-checker.job.ts`

```typescript
import cron from 'node-cron';
import { checkExpiredDeadlines } from '../services/booking-deadline-checker.service.js';

// Run every minute
export const startBookingDeadlineChecker = () => {
  cron.schedule('* * * * *', async () => {
    try {
      const result = await checkExpiredDeadlines();
      if (result.checked > 0) {
        console.log(`[Cron] Checked ${result.checked} expired deadlines at ${result.timestamp}`);
      }
    } catch (error) {
      console.error('[Cron] Error checking expired deadlines:', error);
    }
  });

  console.log('[Cron] Booking deadline checker started');
};
```

#### 1.3 Register Cron Job in App

**File:** `src/app.ts` (add to startup)

```typescript
import { startBookingDeadlineChecker } from './jobs/booking-deadline-checker.job.js';

// After server starts
startBookingDeadlineChecker();
```

---

### Phase 2: Rider Actions API

#### 2.1 Extend Waiting Period

**Endpoint:** `POST /api/bookings/:id/extend-wait`

**Purpose:** Rider chooses to wait 1 more hour for driver confirmation

**Request:**
```http
POST /api/bookings/booking-uuid/extend-wait
Authorization: Bearer <rider-token>
```

**Implementation:**

**File:** `src/modules/ride-booking/ride-booking.routes.ts`

```typescript
// Add new route
router.post(
    '/:id/extend-wait',
    validate({ params: bookingIdParamSchema }),
    controller.extendWaitForDriver
);
```

**File:** `src/modules/ride-booking/ride-booking.controller.ts`

```typescript
export const extendWaitForDriver = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await BookingService.extendWaitForDriver(req.user.id, bookingId);

        await deleteCache(cacheKeys.booking(bookingId));

        return sendSuccess(res, {
            message: 'Waiting period extended successfully',
            data: result,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to extend waiting period';

        switch (error.message) {
            case 'BOOKING_NOT_FOUND':
                status = HttpStatus.NOT_FOUND;
                message = 'Booking not found';
                break;
            case 'BOOKING_NOT_DRIVER_PENDING':
                status = HttpStatus.CONFLICT;
                message = 'Booking is not waiting for driver confirmation';
                break;
            case 'DEADLINE_NOT_EXPIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Deadline has not expired yet';
                break;
            case 'ALREADY_EXTENDED':
                status = HttpStatus.CONFLICT;
                message = 'Waiting period already extended';
                break;
        }

        return sendError(res, { status, message });
    }
};
```

**File:** `src/modules/ride-booking/ride-booking.service.ts`

```typescript
const EXTENDED_DEADLINE_MS = 60 * 60 * 1000; // 1 hour

export const extendWaitForDriver = async (
    passengerId: string,
    bookingId: string
) => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
            status: BookingStatus.DRIVER_PENDING,
        },
    });

    if (!booking) {
        throw new Error('BOOKING_NOT_FOUND');
    }

    if (booking.status !== BookingStatus.DRIVER_PENDING) {
        throw new Error('BOOKING_NOT_DRIVER_PENDING');
    }

    // Check if deadline has expired
    if (!booking.driverDecisionDeadlineAt || booking.driverDecisionDeadlineAt > new Date()) {
        throw new Error('DEADLINE_NOT_EXPIRED');
    }

    // Check if already extended
    if (booking.deadlineExtendedAt) {
        throw new Error('ALREADY_EXTENDED');
    }

    const newDeadline = new Date(Date.now() + EXTENDED_DEADLINE_MS);

    const updated = await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            driverDecisionDeadlineAt: newDeadline,
            deadlineExtendedAt: new Date(),
        },
        select: {
            id: true,
            driverDecisionDeadlineAt: true,
            status: true,
        },
    });

    // Notify driver again
    await createNotification({
        userId: booking.ride.driverId,
        type: 'booking.rider.extended_wait',
        title: 'Rider is still waiting',
        body: 'The rider extended the waiting period. Please respond within 1 hour.',
        data: {
            bookingId: booking.id,
            rideId: booking.rideId,
            newDeadline: newDeadline.toISOString(),
            deepLink: `app://driver/booking-request/${booking.id}`,
        },
    });

    return {
        bookingId: updated.id,
        status: updated.status,
        newDeadline: updated.driverDecisionDeadlineAt,
        extendedBy: 'rider',
    };
};
```

#### 2.2 Use Existing Cancel Endpoint

**Endpoint:** `POST /api/bookings/:id/cancel` (Already exists!)

**Purpose:** Rider cancels the booking - works for both normal cancellation and deadline expiry

**Enhancement Needed:** Modify the existing `cancelBooking` service to:
1. Allow cancellation when deadline expires (even if normally not cancellable)
2. Give 100% refund when driver doesn't respond
3. Add special cancellation reason: `DRIVER_NO_RESPONSE`

**Request:**
```http
POST /api/bookings/booking-uuid/cancel
Authorization: Bearer <rider-token>
```

**Implementation:**

**File:** `src/modules/ride-booking/ride-booking.service.ts`

Enhance the existing `cancelBooking` function:

```typescript
export const cancelBooking = async (
    passengerId: string,
    bookingId: string
): Promise<CancelBookingResult> => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
            status: { in: CANCELLABLE_BOOKING_STATUSES },
        },
        include: {
            ride: {
                select: {
                    id: true,
                    departureDate: true,
                    departureTime: true,
                },
            },
        },
    });

    if (!booking) {
        throw new Error('BOOKING_NOT_FOUND');
    }

    const departureAt = combineDepartureDateTimeUtc(
        booking.ride.departureDate,
        booking.ride.departureTime
    );

    // Check if deadline expired (driver didn't respond)
    const isDeadlineExpired = booking.driverDecisionDeadlineAt 
        && booking.driverDecisionDeadlineAt < new Date()
        && booking.status === BookingStatus.DRIVER_PENDING;

    const isPaymentCaptured = Boolean(booking.paymentCapturedAt && booking.stripePaymentIntentId);
    
    // If deadline expired, give 100% refund regardless of time
    const refundPercent = isDeadlineExpired 
        ? 100 
        : (isPaymentCaptured ? getRiderRefundPercent(departureAt, new Date()) : 0);
    
    const refundAmount = isPaymentCaptured
        ? getRiderRefundAmount(booking.paymentAmount ?? booking.totalPrice, refundPercent)
        : 0;

    let refundInitiated = false;
    if (isPaymentCaptured && refundAmount > 0 && booking.stripePaymentIntentId) {
        await refundPaymentIntent(
            booking.stripePaymentIntentId,
            toMinorCurrencyUnits(refundAmount)
        );
        refundInitiated = true;
    }

    const cancellationReason = isDeadlineExpired 
        ? 'DRIVER_NO_RESPONSE' 
        : 'PASSENGER_CANCELLED';

    const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.rideBooking.findFirst({
            where: {
                id: bookingId,
                passengerId,
                status: { in: CANCELLABLE_BOOKING_STATUSES },
            },
            select: {
                id: true,
                rideId: true,
                seatsBooked: true,
            },
        });

        if (!current) {
            throw new Error('BOOKING_NOT_CANCELLABLE');
        }

        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
                cancelledByRole: 'PASSENGER',
                cancellationReason,
                refundPercent,
                refundAmount,
                refundedAt: refundInitiated ? new Date() : undefined,
            },
        });

        await tx.ride.update({
            where: { id: current.rideId },
            data: {
                availableSeats: { increment: current.seatsBooked },
            },
        });

        return current;
    });

    return {
        bookingId: updated.id,
        rideId: updated.rideId,
        refundPercent,
        refundAmount,
        refundInitiated,
    };
};
```

**No new routes needed!** The existing cancel endpoint handles everything.

---

### Phase 3: Auto-Cancel After Extended Deadline

#### 3.1 Enhanced Deadline Checker

Update the deadline checker to also handle extended deadlines:

**File:** `src/services/booking-deadline-checker.service.ts`

```typescript
export const checkExpiredDeadlines = async () => {
  const now = new Date();

  // 1. Find initial expired deadlines (not yet notified)
  const expiredBookings = await prisma.rideBooking.findMany({
    where: {
      status: BookingStatus.DRIVER_PENDING,
      driverDecisionDeadlineAt: { lte: now },
      deadlineExpiredNotifiedAt: null,
    },
    include: { passenger: true, ride: true },
  });

  for (const booking of expiredBookings) {
    await handleExpiredDeadline(booking);
  }

  // 2. Find extended deadlines that expired (auto-cancel)
  const extendedExpiredBookings = await prisma.rideBooking.findMany({
    where: {
      status: BookingStatus.DRIVER_PENDING,
      driverDecisionDeadlineAt: { lte: now },
      deadlineExtendedAt: { not: null },
      autoCancelledAt: null,
    },
    include: { passenger: true, ride: true },
  });

  for (const booking of extendedExpiredBookings) {
    await autoCancel Booking(booking);
  }

  return {
    initialExpired: expiredBookings.length,
    extendedExpired: extendedExpiredBookings.length,
    timestamp: now,
  };
};

const autoCancelBooking = async (booking: any) => {
  // Same logic as cancelAndSearchNew but automated
  const fullRefundAmount = booking.paymentAmount ?? booking.totalPrice;
  
  // Process refund...
  // Cancel booking...
  // Restore seats...
  // Notify rider...

  await prisma.rideBooking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.CANCELLED,
      cancelledAt: new Date(),
      autoCancelledAt: new Date(),
      cancelledByRole: 'SYSTEM',
      cancellationReason: 'DRIVER_NO_RESPONSE_EXTENDED',
      refundPercent: 100,
      refundAmount: fullRefundAmount,
    },
  });

  console.log(`[Auto-Cancel] Booking ${booking.id} - Extended deadline expired`);
};
```

---

### Phase 4: Database Schema Updates

Add new fields to track deadline expiry:

**File:** `prisma/schema.prisma`

```prisma
model RideBooking {
  // ... existing fields ...
  
  // Deadline tracking
  driverDecisionDeadlineAt  DateTime?
  deadlineExpiredNotifiedAt DateTime?  // When rider was notified of expiry
  deadlineExtendedAt        DateTime?  // When rider extended the wait
  autoCancelledAt           DateTime?  // When system auto-cancelled
  
  // ... rest of fields ...
}
```

**Migration:**
```bash
npx prisma migrate dev --name add_deadline_tracking_fields
```

---

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/bookings/:id/extend-wait` | Rider extends waiting period by 1 hour |
| POST | `/api/bookings/:id/cancel` | **Enhanced:** Rider cancels (100% refund if deadline expired) |

**Note:** We reuse the existing cancel endpoint instead of creating a new one!

---

## Notification Types

### 1. **Deadline Expired Notification** (to Rider)
```json
{
  "type": "booking.driver.deadline_expired",
  "title": "Driver hasn't responded yet",
  "body": "The driver hasn't confirmed your booking. You can wait 1 more hour or search for a new ride.",
  "data": {
    "bookingId": "booking-uuid",
    "action": "deadline_expired",
    "deepLink": "app://booking/booking-uuid/deadline-expired"
  }
}
```

### 2. **Extended Wait Notification** (to Driver)
```json
{
  "type": "booking.rider.extended_wait",
  "title": "Rider is still waiting",
  "body": "The rider extended the waiting period. Please respond within 1 hour.",
  "data": {
    "bookingId": "booking-uuid",
    "newDeadline": "2026-05-13T10:00:00Z",
    "deepLink": "app://driver/booking-request/booking-uuid"
  }
}
```

### 3. **Auto-Cancelled Notification** (to Rider)
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

## Frontend UI Flow

### 1. **Deadline Expired Screen**

```
┌─────────────────────────────────────┐
│  Driver Hasn't Responded Yet        │
├─────────────────────────────────────┤
│                                     │
│  The driver hasn't confirmed your  │
│  booking within the time limit.    │
│                                     │
│  What would you like to do?        │
│                                     │
│  ┌───────────────────────────────┐ │
│  │  ⏰ Wait 1 More Hour          │ │
│  │  Give the driver more time    │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │  ❌ Cancel Booking            │ │
│  │  Get 100% refund & search new │ │
│  └───────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

**Actions:**
- **Wait 1 More Hour:** `POST /api/bookings/:id/extend-wait`
- **Cancel Booking:** `POST /api/bookings/:id/cancel` (existing endpoint!)

### 2. **Extended Wait Confirmation**

```
┌─────────────────────────────────────┐
│  ✓ Waiting Period Extended          │
├─────────────────────────────────────┤
│                                     │
│  We've given the driver 1 more     │
│  hour to respond.                  │
│                                     │
│  Time remaining: 59:45             │
│                                     │
│  We'll notify you when the driver  │
│  responds.                         │
│                                     │
└─────────────────────────────────────┘
```

---

## Configuration

**File:** `.env`

```bash
# Deadline settings
DRIVER_DECISION_DEADLINE_MINUTES=15
EXTENDED_DEADLINE_HOURS=1

# Cron job settings
ENABLE_DEADLINE_CHECKER=true
DEADLINE_CHECKER_INTERVAL_MINUTES=1
```

---

## Testing Scenarios

### Test 1: Deadline Expires, Rider Extends
1. Create booking → Status: `DRIVER_PENDING`
2. Wait 15 minutes (or manually set past deadline)
3. Cron job runs → Rider gets notification
4. Rider calls `POST /api/bookings/:id/extend-wait`
5. Deadline extended by 1 hour
6. Driver gets notification

### Test 2: Deadline Expires, Rider Cancels
1. Create booking → Status: `DRIVER_PENDING`
2. Wait 15 minutes
3. Cron job runs → Rider gets notification
4. Rider calls `POST /api/bookings/:id/cancel` (existing endpoint)
5. System detects deadline expired → 100% refund
6. Booking cancelled, seats restored to ride

### Test 3: Extended Deadline Expires, Auto-Cancel
1. Create booking → Status: `DRIVER_PENDING`
2. Wait 15 minutes → Rider extends wait
3. Wait 1 more hour
4. Cron job runs → Auto-cancels booking
5. Rider gets notification with refund info

---

## Dependencies

```bash
npm install node-cron
npm install @types/node-cron --save-dev
```

---

## Summary

✅ Background job monitors expired deadlines  
✅ Rider gets notified when deadline expires  
✅ Rider can extend wait by 1 hour  
✅ Rider can cancel and get full refund  
✅ System auto-cancels if extended deadline expires  
✅ All parties get appropriate notifications  
✅ Full refund guaranteed for no driver response  

This implementation ensures riders are never left waiting indefinitely and always have control over their booking!
