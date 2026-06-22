# Booking Bypass Payment + Immediate Driver Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch booking flow to bypass payment by default, send driver notification immediately when booking is created, and keep reject/cancel refund outcomes persisted without Stripe calls in bypass mode.

**Architecture:** Add a small runtime payment-mode helper (`bypass` or `stripe`) and branch service behavior in `ride-booking` and `driver-booking`. In bypass mode, booking is created directly as `DRIVER_PENDING` with local payment-captured fields, and the same driver decision notification payload is emitted immediately. Keep Stripe/webhook paths intact for future rollback by configuration only.

**Tech Stack:** TypeScript, Express 5, Prisma + PostgreSQL, Stripe SDK (retained), Socket.IO/push notifications, Jest + ts-jest.

---

## File Structure (Lock This Before Coding)

### Create

- `src/modules/ride-booking/booking-payment-mode.ts`
- `src/modules/ride-booking/booking-payment-mode.test.ts`
- `src/modules/ride-booking/ride-booking.cancel.service.test.ts`

### Modify

- `.env.example`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/ride-booking/ride-booking.service.test.ts`
- `src/modules/driver-booking/driver-booking.service.ts`
- `src/modules/driver-booking/driver-booking.service.test.ts`
- `docs/openapi/components/examples/common.yaml`

### Responsibility Boundaries

- `booking-payment-mode.ts`: single source of truth for runtime booking payment mode.
- `ride-booking.service.ts`: booking create + rider cancel branching by payment mode.
- `driver-booking.service.ts`: driver reject/cancel-after-accept refund branching by payment mode.
- Tests: isolate bypass-mode behavior from existing stripe-mode behavior.
- OpenAPI example: reflect current default API response semantics (`DRIVER_PENDING` + payment skipped).

---

### Task 1: Add Booking Payment Mode Helper + Env Contract

**Files:**
- Create: `src/modules/ride-booking/booking-payment-mode.test.ts`
- Create: `src/modules/ride-booking/booking-payment-mode.ts`
- Modify: `.env.example`
- Test: `src/modules/ride-booking/booking-payment-mode.test.ts`

- [ ] **Step 1: Write failing tests for mode parsing**

```ts
// src/modules/ride-booking/booking-payment-mode.test.ts
import { getBookingPaymentMode, isBypassBookingPaymentMode } from './booking-payment-mode.js';

describe('booking payment mode', () => {
    const original = process.env.BOOKING_PAYMENT_MODE;

    afterEach(() => {
        if (original === undefined) {
            delete process.env.BOOKING_PAYMENT_MODE;
        } else {
            process.env.BOOKING_PAYMENT_MODE = original;
        }
    });

    it('defaults to bypass when env is missing', () => {
        delete process.env.BOOKING_PAYMENT_MODE;
        expect(getBookingPaymentMode()).toBe('bypass');
        expect(isBypassBookingPaymentMode()).toBe(true);
    });

    it('returns stripe when env is stripe', () => {
        process.env.BOOKING_PAYMENT_MODE = 'stripe';
        expect(getBookingPaymentMode()).toBe('stripe');
        expect(isBypassBookingPaymentMode()).toBe(false);
    });

    it('throws for invalid values', () => {
        process.env.BOOKING_PAYMENT_MODE = 'invalid';
        expect(() => getBookingPaymentMode()).toThrow('BOOKING_PAYMENT_MODE_INVALID');
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest src/modules/ride-booking/booking-payment-mode.test.ts --runInBand`  
Expected: FAIL because `booking-payment-mode.ts` does not exist yet.

- [ ] **Step 3: Implement payment mode helper**

```ts
// src/modules/ride-booking/booking-payment-mode.ts
export type BookingPaymentMode = 'bypass' | 'stripe';

const DEFAULT_BOOKING_PAYMENT_MODE: BookingPaymentMode = 'bypass';

export const getBookingPaymentMode = (): BookingPaymentMode => {
    const raw = process.env.BOOKING_PAYMENT_MODE?.trim().toLowerCase();

    if (!raw) return DEFAULT_BOOKING_PAYMENT_MODE;
    if (raw === 'bypass') return 'bypass';
    if (raw === 'stripe') return 'stripe';

    throw new Error('BOOKING_PAYMENT_MODE_INVALID');
};

export const isBypassBookingPaymentMode = (): boolean => {
    return getBookingPaymentMode() === 'bypass';
};
```

- [ ] **Step 4: Add env example entry**

```env
# =============================
# Booking Payment Mode
# =============================
# bypass (default): skip Stripe and move booking directly to DRIVER_PENDING
# stripe: create PaymentIntent and wait for webhook transition
BOOKING_PAYMENT_MODE=bypass
```

- [ ] **Step 5: Run tests + commit**

Run: `npx jest src/modules/ride-booking/booking-payment-mode.test.ts --runInBand`  
Expected: PASS

```bash
git add src/modules/ride-booking/booking-payment-mode.ts \
        src/modules/ride-booking/booking-payment-mode.test.ts \
        .env.example
git commit -m "feat(booking): add runtime payment mode switch with bypass default"
```

---

### Task 2: Create Booking in Bypass Mode + Immediate Driver Notification

**Files:**
- Modify: `src/modules/ride-booking/ride-booking.service.test.ts`
- Modify: `src/modules/ride-booking/ride-booking.service.ts`
- Test: `src/modules/ride-booking/ride-booking.service.test.ts`

- [ ] **Step 1: Add failing test for bypass booking create**

```ts
// additions in src/modules/ride-booking/ride-booking.service.test.ts
const mockCreateNotification = jest.fn();

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

beforeEach(() => {
    process.env.BOOKING_PAYMENT_MODE = 'stripe';
    jest.clearAllMocks();
    // existing mockedCreateBookingPaymentIntent setup stays
});

it('creates DRIVER_PENDING booking and notifies driver immediately in bypass mode', async () => {
    process.env.BOOKING_PAYMENT_MODE = 'bypass';

    const tx = buildTx();
    tx.rideBooking.create = jest.fn().mockImplementation(async ({ data }) => ({
        id: 'booking-bypass-1',
        ...data,
        createdAt: new Date('2026-04-05T10:00:00.000Z'),
        updatedAt: new Date('2026-04-05T10:00:00.000Z'),
        passenger: { name: 'Rider', avatarUrl: null },
        ride: {
            ...tx.ride.findFirst.mock.results[0]?.value,
        },
    }));

    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const booking = await createBooking('passenger-1', {
        rideId: 'ride-1',
        seatsBooked: 1,
        pickupWaypointId: 'wp-b',
        dropoffWaypointId: 'wp-c',
    });

    expect(booking.status).toBe('DRIVER_PENDING');
    expect(booking.payment).toBeNull();
    expect(mockedCreateBookingPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
            type: 'booking.request.driver_decision',
            userId: 'driver-1',
        })
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/ride-booking/ride-booking.service.test.ts -t "bypass mode" --runInBand`  
Expected: FAIL because service still always creates PaymentIntent and does not emit driver notification.

- [ ] **Step 3: Implement bypass branch in booking create**

```ts
// key additions in src/modules/ride-booking/ride-booking.service.ts
import { createNotification } from '../notification/notification.service.js';
import { DRIVER_DECISION_NOTIFICATION_TYPE } from '../payments/stripe.constants.js';
import { isBypassBookingPaymentMode } from './booking-payment-mode.js';

const resolveSegmentAddress = (
    defaultAddress: string,
    waypointId: string | null,
    waypoints: Array<{ id: string; address: string }>
): string => {
    if (!waypointId) return defaultAddress;
    return waypoints.find((waypoint) => waypoint.id === waypointId)?.address ?? defaultAddress;
};

export const createBooking = async (
    passengerId: string,
    input: CreateBookingInput
): Promise<BookingResponse> => {
    const bypassPayment = isBypassBookingPaymentMode();
    const { rideId, segmentId, seatsBooked, luggageCount = 0, pickupWaypointId, dropoffWaypointId, notes } = input;

    const bookingSeed = await prisma.$transaction(async (tx) => {
        // existing ride checks...

        const booking = await tx.rideBooking.create({
            data: {
                rideId,
                passengerId,
                seatsBooked,
                totalPrice,
                pickupWaypointId: resolvedPickupWaypointId,
                dropoffWaypointId: resolvedDropoffWaypointId,
                status: bypassPayment ? BookingStatus.DRIVER_PENDING : BookingStatus.PAYMENT_PENDING,
                paymentCurrency: ride.currency,
                ...(bypassPayment
                    ? {
                        paymentAmount: totalPrice,
                        paymentCapturedAt: new Date(),
                    }
                    : {}),
            },
            include: {
                passenger: {
                    select: {
                        name: true,
                        avatarUrl: true,
                    },
                },
                ride: {
                    include: {
                        driver: {
                            select: {
                                id: true,
                                name: true,
                                avatarUrl: true,
                            },
                        },
                        waypoints: {
                            orderBy: { orderIndex: 'asc' },
                        },
                    },
                },
            },
        });

        await tx.ride.update({
            where: { id: rideId },
            data: { availableSeats: { decrement: seatsBooked } },
        });

        return { booking, ride, totalPrice };
    });

    if (bypassPayment) {
        const originAddress = resolveSegmentAddress(
            bookingSeed.booking.ride.originAddress,
            bookingSeed.booking.pickupWaypointId,
            bookingSeed.booking.ride.waypoints
        );
        const destinationAddress = resolveSegmentAddress(
            bookingSeed.booking.ride.destinationAddress,
            bookingSeed.booking.dropoffWaypointId,
            bookingSeed.booking.ride.waypoints
        );

        await createNotification({
            userId: bookingSeed.booking.ride.driverId,
            type: DRIVER_DECISION_NOTIFICATION_TYPE,
            title: 'New ride request',
            body: `${bookingSeed.booking.passenger.name ?? 'Rider'} wants ${originAddress} to ${destinationAddress}`,
            data: {
                bookingId: bookingSeed.booking.id,
                rideId: bookingSeed.booking.ride.id,
                passengerName: bookingSeed.booking.passenger.name ?? 'Rider',
                passengerAvatarUrl: bookingSeed.booking.passenger.avatarUrl ?? '',
                originAddress,
                destinationAddress,
                seatsBooked: String(bookingSeed.booking.seatsBooked),
                totalPrice: String(bookingSeed.booking.totalPrice),
                currency: bookingSeed.booking.paymentCurrency ?? bookingSeed.booking.ride.currency,
                decisionDeadlineAt: '',
                deepLink: `app://driver/booking-request/${bookingSeed.booking.id}`,
            },
        });

        return mapBookingResponse(bookingSeed.booking as unknown as BookingWithRideDetails, {
            luggageCount,
            notes: notes ?? null,
            payment: null,
        });
    }

    // existing Stripe PaymentIntent branch remains unchanged below...
};
```

- [ ] **Step 4: Run focused tests**

Run: `npx jest src/modules/ride-booking/ride-booking.service.test.ts --runInBand`  
Expected: PASS (existing stripe tests + new bypass test)

- [ ] **Step 5: Commit**

```bash
git add src/modules/ride-booking/ride-booking.service.ts \
        src/modules/ride-booking/ride-booking.service.test.ts
git commit -m "feat(booking): bypass payment on create and notify driver immediately"
```

---

### Task 3: Skip Stripe Refund Calls in Driver Reject/Cancel for Bypass Mode

**Files:**
- Modify: `src/modules/driver-booking/driver-booking.service.test.ts`
- Modify: `src/modules/driver-booking/driver-booking.service.ts`
- Test: `src/modules/driver-booking/driver-booking.service.test.ts`

- [ ] **Step 1: Add failing tests for bypass reject/cancel**

```ts
// additions in src/modules/driver-booking/driver-booking.service.test.ts
import {
    acceptBooking,
    rejectBooking,
    cancelAfterAccept,
    verifyPickupOtp,
} from './driver-booking.service.js';

beforeEach(() => {
    process.env.BOOKING_PAYMENT_MODE = 'stripe';
    jest.clearAllMocks();
    mockHashOtp.mockImplementation((otp: string) => `hash-${otp}`);
});

it('reject in bypass mode does not call Stripe refund and still marks refund fields', async () => {
    process.env.BOOKING_PAYMENT_MODE = 'bypass';

    mockPrisma.rideBooking.findUnique.mockResolvedValue({
        id: 'booking-bypass-reject',
        rideId: 'ride-2',
        passengerId: 'passenger-2',
        status: BookingStatus.DRIVER_PENDING,
        paymentCapturedAt: new Date(),
        paymentAmount: 500,
        totalPrice: 500,
        stripePaymentIntentId: null,
        driverDecisionDeadlineAt: null,
        passenger: { id: 'passenger-2', name: 'Rider', avatarUrl: null },
        ride: { id: 'ride-2', driverId: 'driver-2', originAddress: 'A', destinationAddress: 'B' },
    });

    const tx = {
        rideBooking: {
            findUnique: jest.fn().mockResolvedValue({
                id: 'booking-bypass-reject',
                status: BookingStatus.DRIVER_PENDING,
                rideId: 'ride-2',
                passengerId: 'passenger-2',
                seatsBooked: 1,
            }),
            update: jest.fn().mockResolvedValue({}),
        },
        ride: { update: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await rejectBooking('driver-2', 'booking-bypass-reject');

    expect(mockRefundPaymentIntent).not.toHaveBeenCalled();
    expect(tx.rideBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({
            data: expect.objectContaining({
                refundPercent: 100,
                refundAmount: 500,
            }),
        })
    );
});

it('cancel-after-accept in bypass mode does not call Stripe refund', async () => {
    process.env.BOOKING_PAYMENT_MODE = 'bypass';

    mockPrisma.rideBooking.findUnique.mockResolvedValue({
        id: 'booking-bypass-cancel',
        rideId: 'ride-3',
        passengerId: 'passenger-3',
        status: BookingStatus.CONFIRMED,
        paymentCapturedAt: new Date(),
        paymentAmount: 900,
        totalPrice: 900,
        stripePaymentIntentId: null,
        passenger: { id: 'passenger-3', name: 'Rider', avatarUrl: null },
        ride: { id: 'ride-3', driverId: 'driver-3', originAddress: 'A', destinationAddress: 'B' },
    });

    const tx = {
        rideBooking: {
            findUnique: jest.fn().mockResolvedValue({
                id: 'booking-bypass-cancel',
                status: BookingStatus.CONFIRMED,
                rideId: 'ride-3',
                passengerId: 'passenger-3',
                seatsBooked: 1,
            }),
            update: jest.fn().mockResolvedValue({}),
        },
        ride: { update: jest.fn().mockResolvedValue({}) },
        driverPenaltyEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await cancelAfterAccept('driver-3', 'booking-bypass-cancel');

    expect(mockRefundPaymentIntent).not.toHaveBeenCalled();
    expect(tx.driverPenaltyEvent.create).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx jest src/modules/driver-booking/driver-booking.service.test.ts --runInBand`  
Expected: FAIL because service still attempts Stripe refund when captured payment metadata exists.

- [ ] **Step 3: Implement bypass-aware refund branching**

```ts
// key additions in src/modules/driver-booking/driver-booking.service.ts
import { isBypassBookingPaymentMode } from '../ride-booking/booking-payment-mode.js';

export const rejectBooking = async (driverId: string, bookingId: string): Promise<DriverBookingResult> => {
    const booking = requireDriverBooking(driverId, await fetchDriverBooking(bookingId));
    // existing guards...

    const bypassPayment = isBypassBookingPaymentMode();
    const fullRefundAmount = booking.paymentAmount ?? booking.totalPrice;
    let refundId: string | null = null;
    let refundInitiated = false;

    if (!bypassPayment && booking.paymentCapturedAt && booking.stripePaymentIntentId) {
        const refund = await refundPaymentIntent(
            booking.stripePaymentIntentId,
            toMinorCurrencyUnits(fullRefundAmount)
        );
        refundId = refund.id;
        refundInitiated = true;
    }
    if (bypassPayment && fullRefundAmount > 0) {
        refundInitiated = true;
    }

    await prisma.$transaction(async (tx) => {
        // existing fetch guards...
        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CANCELLED,
                driverDecisionAt: new Date(),
                cancelledAt: new Date(),
                cancelledByRole: 'DRIVER',
                cancellationReason: 'DRIVER_REJECTED',
                refundPercent: 100,
                refundAmount: fullRefundAmount,
                refundId: refundId ?? null,
                refundedAt: refundInitiated ? new Date() : undefined,
            },
        });
        // existing seat restore...
    });
    // existing notification...
};

export const cancelAfterAccept = async (driverId: string, bookingId: string): Promise<DriverBookingResult> => {
    const booking = requireDriverBooking(driverId, await fetchDriverBooking(bookingId));
    // existing guards...

    const bypassPayment = isBypassBookingPaymentMode();
    const fullRefundAmount = booking.paymentAmount ?? booking.totalPrice;
    let refundId: string | null = null;
    let refundInitiated = false;

    if (!bypassPayment && booking.paymentCapturedAt && booking.stripePaymentIntentId) {
        const refund = await refundPaymentIntent(
            booking.stripePaymentIntentId,
            toMinorCurrencyUnits(fullRefundAmount)
        );
        refundId = refund.id;
        refundInitiated = true;
    }
    if (bypassPayment && fullRefundAmount > 0) {
        refundInitiated = true;
    }

    await prisma.$transaction(async (tx) => {
        // existing fetch guards...
        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
                cancelledByRole: 'DRIVER',
                cancellationReason: 'DRIVER_CANCELLED_AFTER_ACCEPT',
                refundPercent: 100,
                refundAmount: fullRefundAmount,
                refundId: refundId ?? null,
                refundedAt: refundInitiated ? new Date() : undefined,
                driverPenaltyAppliedAt: new Date(),
                driverPenaltyValue: DRIVER_PENALTY_PERCENT,
            },
        });
        // existing seat restore + penalty event...
    });
    // existing notification...
};
```

- [ ] **Step 4: Run focused tests**

Run: `npx jest src/modules/driver-booking/driver-booking.service.test.ts --runInBand`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/driver-booking/driver-booking.service.ts \
        src/modules/driver-booking/driver-booking.service.test.ts
git commit -m "feat(driver-booking): bypass Stripe refunds for reject and driver cancel"
```

---

### Task 4: Apply Bypass Refund Policy in Rider Cancel Flow

**Files:**
- Create: `src/modules/ride-booking/ride-booking.cancel.service.test.ts`
- Modify: `src/modules/ride-booking/ride-booking.service.ts`
- Test: `src/modules/ride-booking/ride-booking.cancel.service.test.ts`

- [ ] **Step 1: Write failing tests for rider cancel in bypass mode**

```ts
// src/modules/ride-booking/ride-booking.cancel.service.test.ts
const mockPrisma = {
    rideBooking: {
        findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
};

const mockRefundPaymentIntent = jest.fn();

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('../payments/stripe.service.js', () => ({
    __esModule: true,
    createBookingPaymentIntent: jest.fn(),
    refundPaymentIntent: (...args: unknown[]) => mockRefundPaymentIntent(...args),
}));

import { BookingStatus } from '@prisma/client';
import { cancelBooking } from './ride-booking.service.js';

describe('cancelBooking bypass mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.BOOKING_PAYMENT_MODE = 'bypass';
    });

    it('applies 50% refund in bypass mode when departure is more than 24h away', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue({
            id: 'booking-1',
            rideId: 'ride-1',
            passengerId: 'passenger-1',
            status: BookingStatus.DRIVER_PENDING,
            paymentCapturedAt: new Date(),
            paymentAmount: 1000,
            totalPrice: 1000,
            stripePaymentIntentId: null,
            ride: {
                id: 'ride-1',
                departureDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                departureTime: '10:00',
            },
        });

        const tx = {
            rideBooking: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'booking-1',
                    rideId: 'ride-1',
                    seatsBooked: 1,
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            ride: {
                update: jest.fn().mockResolvedValue({}),
            },
        };
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const result = await cancelBooking('passenger-1', 'booking-1');

        expect(result.refundPercent).toBe(50);
        expect(result.refundAmount).toBe(500);
        expect(result.refundInitiated).toBe(true);
        expect(mockRefundPaymentIntent).not.toHaveBeenCalled();
    });

    it('applies 0% refund in bypass mode when departure is within 24h', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue({
            id: 'booking-2',
            rideId: 'ride-2',
            passengerId: 'passenger-1',
            status: BookingStatus.DRIVER_PENDING,
            paymentCapturedAt: new Date(),
            paymentAmount: 1000,
            totalPrice: 1000,
            stripePaymentIntentId: null,
            ride: {
                id: 'ride-2',
                departureDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
                departureTime: '12:00',
            },
        });

        const tx = {
            rideBooking: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'booking-2',
                    rideId: 'ride-2',
                    seatsBooked: 1,
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            ride: {
                update: jest.fn().mockResolvedValue({}),
            },
        };
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const result = await cancelBooking('passenger-1', 'booking-2');

        expect(result.refundPercent).toBe(0);
        expect(result.refundAmount).toBe(0);
        expect(result.refundInitiated).toBe(false);
        expect(mockRefundPaymentIntent).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest src/modules/ride-booking/ride-booking.cancel.service.test.ts --runInBand`  
Expected: FAIL because current logic requires `stripePaymentIntentId` to apply refund policy.

- [ ] **Step 3: Implement bypass-aware rider cancel policy**

```ts
// key change in cancelBooking() inside src/modules/ride-booking/ride-booking.service.ts
const bypassPayment = isBypassBookingPaymentMode();
const hasCapturedStripePayment = Boolean(booking.paymentCapturedAt && booking.stripePaymentIntentId);
const shouldApplyRiderPolicy = bypassPayment || hasCapturedStripePayment;

const refundPercent = shouldApplyRiderPolicy
    ? getRiderRefundPercent(departureAt, new Date())
    : 0;
const refundAmount = shouldApplyRiderPolicy
    ? getRiderRefundAmount(booking.paymentAmount ?? booking.totalPrice, refundPercent)
    : 0;

let refundInitiated = false;
if (!bypassPayment && hasCapturedStripePayment && refundAmount > 0 && booking.stripePaymentIntentId) {
    await refundPaymentIntent(
        booking.stripePaymentIntentId,
        toMinorCurrencyUnits(refundAmount)
    );
    refundInitiated = true;
}
if (bypassPayment && refundAmount > 0) {
    refundInitiated = true;
}

await tx.rideBooking.update({
    where: { id: bookingId },
    data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByRole: 'PASSENGER',
        cancellationReason: 'PASSENGER_CANCELLED',
        refundPercent,
        refundAmount,
        refundedAt: refundInitiated ? new Date() : undefined,
    },
});
```

- [ ] **Step 4: Run focused tests**

Run: `npx jest src/modules/ride-booking/ride-booking.cancel.service.test.ts --runInBand`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/ride-booking/ride-booking.service.ts \
        src/modules/ride-booking/ride-booking.cancel.service.test.ts
git commit -m "feat(booking): apply bypass refund policy for rider cancellation"
```

---

### Task 5: Update OpenAPI Example to Match Bypass Default

**Files:**
- Modify: `docs/openapi/components/examples/common.yaml`
- Test: OpenAPI lint/bundle/coverage commands

- [ ] **Step 1: Update booking success example**

```yaml
# docs/openapi/components/examples/common.yaml
"BookingSuccess": {
  "summary": "Booking response",
  "value": {
    "success": true,
    "status": "CREATED",
    "message": "Booking created and sent to driver",
    "data": {
      "id": "55555555-5555-5555-5555-555555555555",
      "rideId": "44444444-4444-4444-4444-444444444444",
      "passengerId": "11111111-1111-1111-1111-111111111111",
      "seatsBooked": 1,
      "luggageCount": 1,
      "totalPrice": 499,
      "status": "DRIVER_PENDING",
      "payment": null
    }
  }
}
```

- [ ] **Step 2: Validate OpenAPI artifacts**

Run: `npm run openapi:check`  
Expected: PASS (lint, bundle, coverage all succeed).

- [ ] **Step 3: Commit**

```bash
git add docs/openapi/components/examples/common.yaml docs/openapi/dist/openapi.json
git commit -m "docs(openapi): update booking success example for bypass mode"
```

---

### Task 6: Final Verification and Production Safety Checks

**Files:**
- Test only (no file edits expected unless fixes are needed)

- [ ] **Step 1: Run targeted tests for changed booking flows**

Run:
`npx jest src/modules/ride-booking/booking-payment-mode.test.ts src/modules/ride-booking/ride-booking.service.test.ts src/modules/ride-booking/ride-booking.cancel.service.test.ts src/modules/driver-booking/driver-booking.service.test.ts --runInBand`  
Expected: PASS

- [ ] **Step 2: Run full build**

Run: `npm run build`  
Expected: PASS (`tsc` + `prisma generate`).

- [ ] **Step 3: Verify bypass default and stripe rollback behavior via env**

Run:
`BOOKING_PAYMENT_MODE=bypass npx jest src/modules/ride-booking/ride-booking.service.test.ts -t "bypass mode" --runInBand`
and
`BOOKING_PAYMENT_MODE=stripe npx jest src/modules/ride-booking/ride-booking.service.test.ts -t "payment intent" --runInBand`  
Expected: both PASS, confirming mode switch works.

- [ ] **Step 4: Commit any final fixups from verification**

```bash
git add -A
git commit -m "test(booking): finalize bypass mode verification and stability fixes"
```

---

## Plan Self-Review (Completed)

### 1) Spec coverage

- Bypass all users in production: Task 1 (`BOOKING_PAYMENT_MODE` default `bypass`) + Task 2.
- Immediate driver notification at booking create: Task 2.
- Skip payment and return `payment: null`: Task 2 + Task 5 docs.
- No decision deadline (`driverDecisionDeadlineAt = null`): Task 2 (no deadline assignment).
- Reject/cancel skip Stripe and persist refund fields: Task 3 and Task 4.
- Keep Stripe path for rollback: Task 1 + Task 6 stripe-mode test.

### 2) Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders.
- All tasks include concrete files, code, commands, and expected outcomes.

### 3) Type/contract consistency

- Uses existing `BookingStatus` enum values already in schema.
- Keeps existing endpoint paths unchanged.
- Reuses existing notification type `booking.request.driver_decision`.

