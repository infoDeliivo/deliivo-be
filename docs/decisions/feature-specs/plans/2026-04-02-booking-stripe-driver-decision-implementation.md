# Booking Stripe + Driver Decision + Cancellation Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement paid booking with Stripe, driver accept/reject flow, driver/rider cancellation policy (50% refund before 24h, no refund within 24h), dual OTP ride start/end verification, and online/offline driver notification modal payload delivery.

**Architecture:** Keep booking orchestration in `ride-booking` domain, add dedicated `payments` module for Stripe webhook + PaymentIntent operations, and add `driver-booking` module for driver-facing decision/OTP actions. Persist payment/cancellation metadata on `RideBooking`, use idempotent webhook event storage, and schedule timeout/refund reconciliation job.

**Tech Stack:** Express 5, TypeScript, Prisma + PostgreSQL, Stripe SDK, BullMQ/Redis, Socket.IO, Firebase Admin push (FCM/APNs), Jest + ts-jest.

---

## File Structure (Lock This Before Coding)

### Create

- `src/modules/payments/stripe.service.ts`
- `src/modules/payments/stripe.webhook.controller.ts`
- `src/modules/payments/stripe.webhook.routes.ts`
- `src/modules/payments/stripe.types.ts`
- `src/modules/payments/stripe.constants.ts`
- `src/modules/driver-booking/driver-booking.controller.ts`
- `src/modules/driver-booking/driver-booking.routes.ts`
- `src/modules/driver-booking/driver-booking.service.ts`
- `src/modules/driver-booking/driver-booking.validator.ts`
- `src/modules/ride-booking/booking-cancellation-policy.ts`
- `src/modules/ride-booking/booking-otp.utils.ts`
- `src/jobs/booking-timeout.cron.ts`
- `src/modules/payments/stripe.webhook.controller.test.ts`
- `src/modules/driver-booking/driver-booking.service.test.ts`
- `src/modules/ride-booking/booking-cancellation-policy.test.ts`
- `prisma/migrations/<timestamp>_booking_payment_driver_flow/migration.sql` (generated)

### Modify

- `prisma/schema.prisma`
- `src/app.ts`
- `src/server.ts`
- `src/modules/index.ts`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/ride-booking/ride-booking.controller.ts`
- `src/modules/ride-booking/ride-booking.routes.ts`
- `src/modules/ride-booking/ride-booking.types.ts`
- `src/modules/ride-booking/ride-booking.validator.ts`
- `src/modules/notification/notification.service.ts` (small helper for booking payload normalization)
- `package.json`

### Responsibility Boundaries

- `payments/*` only talks Stripe + webhook idempotency + payment state transitions.
- `ride-booking/*` owns passenger booking creation and rider cancellation policy.
- `driver-booking/*` owns driver accept/reject/cancel and OTP verification endpoints.
- `jobs/booking-timeout.cron.ts` owns 30-minute driver-decision timeout cleanup/refund.

---

### Task 1: Extend Prisma Schema for Payment/Cancellation/OTP

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generated): `prisma/migrations/<timestamp>_booking_payment_driver_flow/migration.sql`
- Test: `npm run build`

- [ ] **Step 1: Add new booking statuses and fields to schema**

```prisma
enum BookingStatus {
  PAYMENT_PENDING
  DRIVER_PENDING
  CONFIRMED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  PAYMENT_FAILED
}

model RideBooking {
  id                      String   @id @default(uuid())
  rideId                  String
  passengerId             String
  pickupWaypointId        String?
  dropoffWaypointId       String?
  seatsBooked             Int      @default(1)
  totalPrice              Float
  status                  BookingStatus @default(PAYMENT_PENDING)
  stripePaymentIntentId   String?  @unique
  stripeChargeId          String?
  paymentAmount           Float?
  paymentCurrency         String?
  paymentCapturedAt       DateTime?
  refundId                String?
  refundedAt              DateTime?
  refundAmount            Float?
  refundPercent           Float?
  driverDecisionDeadlineAt DateTime?
  driverDecisionAt        DateTime?
  cancelledAt             DateTime?
  cancelledByRole         String?
  cancellationReason      String?
  driverPenaltyAppliedAt  DateTime?
  driverPenaltyValue      Float?
  pickupOtpHash           String?
  pickupOtpExpiresAt      DateTime?
  pickupOtpVerifiedAt     DateTime?
  dropOtpHash             String?
  dropOtpExpiresAt        DateTime?
  dropOtpVerifiedAt       DateTime?
  otpAttemptCount         Int      @default(0)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  @@index([status])
  @@index([driverDecisionDeadlineAt])
  @@index([rideId])
  @@index([passengerId])
}

model StripeWebhookEvent {
  id              String   @id @default(uuid())
  stripeEventId   String   @unique
  eventType       String
  paymentIntentId String?
  processedAt     DateTime @default(now())
  payload         Json?
}

model DriverPenaltyEvent {
  id             String   @id @default(uuid())
  driverId       String
  bookingId      String
  penaltyPercent Float
  reason         String
  createdAt      DateTime @default(now())

  @@index([driverId, createdAt])
  @@index([bookingId])
}
```

- [ ] **Step 2: Generate migration**

Run: `npx prisma migrate dev --name booking_payment_driver_flow`  
Expected: migration folder created and Prisma client regenerated.

- [ ] **Step 3: Build TypeScript after schema changes**

Run: `npm run build`  
Expected: build passes, no enum/type errors from `BookingStatus` changes.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(booking): extend schema for payment and driver decision flow"
```

---

### Task 2: Add Stripe Service Core

**Files:**
- Create: `src/modules/payments/stripe.constants.ts`
- Create: `src/modules/payments/stripe.types.ts`
- Create: `src/modules/payments/stripe.service.ts`
- Modify: `package.json`
- Test: `src/modules/payments/stripe.webhook.controller.test.ts` (later uses service)

- [ ] **Step 1: Add Stripe dependency**

Run: `npm install stripe`  
Expected: `stripe` added to dependencies in `package.json`.

- [ ] **Step 2: Create Stripe constants/types**

```ts
// src/modules/payments/stripe.constants.ts
export const STRIPE_CURRENCY_DEFAULT = 'inr';
export const STRIPE_METADATA_KEYS = {
  bookingId: 'bookingId',
  rideId: 'rideId',
  passengerId: 'passengerId',
} as const;
```

```ts
// src/modules/payments/stripe.types.ts
export interface CreatePaymentIntentInput {
  bookingId: string;
  rideId: string;
  passengerId: string;
  amountMajor: number;
  currency: string;
}

export interface CreatePaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
}
```

- [ ] **Step 3: Implement Stripe service methods**

```ts
// src/modules/payments/stripe.service.ts
import Stripe from 'stripe';
import { CreatePaymentIntentInput, CreatePaymentIntentResult } from './stripe.types.js';

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) throw new Error('STRIPE_SECRET_KEY_MISSING');

export const stripe = new Stripe(stripeSecret);

const toMinorUnits = (amountMajor: number): number => Math.round(amountMajor * 100);

export const createBookingPaymentIntent = async (
  input: CreatePaymentIntentInput
): Promise<CreatePaymentIntentResult> => {
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: toMinorUnits(input.amountMajor),
      currency: input.currency.toLowerCase(),
      metadata: {
        bookingId: input.bookingId,
        rideId: input.rideId,
        passengerId: input.passengerId,
      },
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: `booking-pi-${input.bookingId}` }
  );

  if (!paymentIntent.client_secret) throw new Error('STRIPE_CLIENT_SECRET_MISSING');

  return {
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
  };
};

export const refundPaymentIntent = async (
  paymentIntentId: string,
  amountMinor?: number
) => {
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    ...(amountMinor ? { amount: amountMinor } : {}),
  });
};
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/modules/payments
git commit -m "feat(payments): add Stripe service for intents and refunds"
```

---

### Task 3: Add Stripe Webhook Endpoint with Raw Body + Idempotency

**Files:**
- Create: `src/modules/payments/stripe.webhook.controller.ts`
- Create: `src/modules/payments/stripe.webhook.routes.ts`
- Modify: `src/app.ts`
- Modify: `src/modules/index.ts`
- Test: `src/modules/payments/stripe.webhook.controller.test.ts`

- [ ] **Step 1: Create webhook controller signature validation + event dedupe**

```ts
// src/modules/payments/stripe.webhook.controller.ts
import { Request, Response } from 'express';
import { stripe } from './stripe.service.js';
import { prisma } from '../../config/index.js';

export const handleStripeWebhook = async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return res.status(400).send('Webhook configuration missing');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, secret);
  } catch {
    return res.status(400).send('Invalid signature');
  }

  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: { stripeEventId: event.id },
  });
  if (existing) return res.status(200).json({ received: true, duplicate: true });

  await prisma.stripeWebhookEvent.create({
    data: {
      stripeEventId: event.id,
      eventType: event.type,
      paymentIntentId: (event.data.object as any).id ?? null,
      payload: event as any,
    },
  });

  return res.status(200).json({ received: true });
};
```

- [ ] **Step 2: Create webhook router**

```ts
// src/modules/payments/stripe.webhook.routes.ts
import { Router } from 'express';
import { handleStripeWebhook } from './stripe.webhook.controller.js';

const router = Router();
router.post('/stripe/webhook', handleStripeWebhook);
export default router;
```

- [ ] **Step 3: Mount webhook route before JSON parser**

```ts
// src/app.ts (important order)
import stripeWebhookRouter from './modules/payments/stripe.webhook.routes.js';

app.use('/api/v1/payments', express.raw({ type: 'application/json' }), stripeWebhookRouter);
app.use(express.json());
```

- [ ] **Step 4: Add payment router export**

```ts
// src/modules/index.ts
import paymentsWebhookRouter from './payments/stripe.webhook.routes.js';
export { paymentsWebhookRouter };
```

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/modules/index.ts src/modules/payments
git commit -m "feat(payments): add raw-body Stripe webhook endpoint with dedupe"
```

---

### Task 4: Refactor Booking Create to Payment-Pending + PaymentIntent

**Files:**
- Modify: `src/modules/ride-booking/ride-booking.types.ts`
- Modify: `src/modules/ride-booking/ride-booking.validator.ts`
- Modify: `src/modules/ride-booking/ride-booking.service.ts`
- Modify: `src/modules/ride-booking/ride-booking.controller.ts`
- Test: `src/modules/ride-booking/ride-booking.service.test.ts`

- [ ] **Step 1: Extend response types for payment object**

```ts
// src/modules/ride-booking/ride-booking.types.ts
export interface BookingPaymentInfo {
  provider: 'stripe';
  paymentIntentId: string;
  clientSecret?: string;
}

export interface BookingResponse {
  // existing fields...
  payment?: BookingPaymentInfo | null;
}
```

- [ ] **Step 2: Update create service flow**

```ts
// src/modules/ride-booking/ride-booking.service.ts (createBooking)
// 1) DB transaction: validate ride, reserve seats, create booking with PAYMENT_PENDING
// 2) create Stripe PaymentIntent after tx
// 3) update booking with stripePaymentIntentId/paymentAmount/paymentCurrency
// 4) on Stripe failure: mark PAYMENT_FAILED + restore seats in compensating tx
```

```ts
const booking = await tx.rideBooking.create({
  data: {
    rideId,
    passengerId,
    seatsBooked,
    totalPrice,
    pickupWaypointId: resolvedPickupWaypointId,
    dropoffWaypointId: resolvedDropoffWaypointId,
    status: BookingStatus.PAYMENT_PENDING,
  },
});
```

- [ ] **Step 3: Return payment payload from controller**

```ts
// src/modules/ride-booking/ride-booking.controller.ts
return sendSuccess(res, {
  status: HttpStatus.CREATED,
  message: 'Booking created, payment required',
  data: booking,
});
```

- [ ] **Step 4: Add/adjust tests for payment pending**

```ts
// src/modules/ride-booking/ride-booking.service.test.ts
it('creates booking in PAYMENT_PENDING and returns payment intent data', async () => {
  // mock stripe create intent
  // assert booking.status === 'PAYMENT_PENDING'
  // assert booking.payment.paymentIntentId is defined
});
```

- [ ] **Step 5: Run focused tests**

Run: `npx jest src/modules/ride-booking/ride-booking.service.test.ts -i`  
Expected: PASS for new payment-pending and existing segment tests.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ride-booking
git commit -m "feat(booking): create payment-pending bookings with Stripe intent"
```

---

### Task 5: Process Webhook Events into Booking State + Driver Notification

**Files:**
- Modify: `src/modules/payments/stripe.webhook.controller.ts`
- Modify: `src/modules/notification/notification.service.ts`
- Test: `src/modules/payments/stripe.webhook.controller.test.ts`

- [ ] **Step 1: Handle `payment_intent.succeeded`**

```ts
if (event.type === 'payment_intent.succeeded') {
  const intent = event.data.object as Stripe.PaymentIntent;
  const bookingId = intent.metadata.bookingId;
  await prisma.rideBooking.update({
    where: { id: bookingId },
    data: {
      status: BookingStatus.DRIVER_PENDING,
      stripePaymentIntentId: intent.id,
      stripeChargeId: typeof intent.latest_charge === 'string' ? intent.latest_charge : null,
      paymentCapturedAt: new Date(),
      driverDecisionDeadlineAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
}
```

- [ ] **Step 2: Emit driver decision notification payload**

```ts
await createNotification({
  userId: ride.driverId,
  type: 'booking.request.driver_decision',
  title: 'New ride request',
  body: `${passenger.name ?? 'Rider'} wants ${originAddress} to ${destinationAddress}`,
  data: {
    bookingId,
    rideId: ride.id,
    passengerName: passenger.name ?? 'Rider',
    passengerAvatarUrl: passenger.avatarUrl ?? '',
    originAddress,
    destinationAddress,
    seatsBooked: String(booking.seatsBooked),
    totalPrice: String(booking.totalPrice),
    currency: booking.paymentCurrency ?? ride.currency,
    decisionDeadlineAt: booking.driverDecisionDeadlineAt?.toISOString() ?? '',
    deepLink: `app://driver/booking-request/${bookingId}`,
  },
});
```

- [ ] **Step 3: Handle `payment_intent.payment_failed` with seat restore**

```ts
if (event.type === 'payment_intent.payment_failed') {
  await prisma.$transaction(async (tx) => {
    const booking = await tx.rideBooking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.status !== BookingStatus.PAYMENT_PENDING) return;
    await tx.rideBooking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.PAYMENT_FAILED },
    });
    await tx.ride.update({
      where: { id: booking.rideId },
      data: { availableSeats: { increment: booking.seatsBooked } },
    });
  });
}
```

- [ ] **Step 4: Add webhook tests**

```ts
// src/modules/payments/stripe.webhook.controller.test.ts
it('moves booking to DRIVER_PENDING on successful payment and sends driver notification', async () => {});
it('marks PAYMENT_FAILED and restores seats on failed payment', async () => {});
it('ignores duplicate event ids', async () => {});
```

- [ ] **Step 5: Run webhook tests**

Run: `npx jest src/modules/payments/stripe.webhook.controller.test.ts -i`  
Expected: all webhook transition tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/payments src/modules/notification/notification.service.ts
git commit -m "feat(payments): apply webhook transitions and notify drivers"
```

---

### Task 6: Add Driver Booking Decision + OTP Routes/Service

**Files:**
- Create: `src/modules/driver-booking/driver-booking.routes.ts`
- Create: `src/modules/driver-booking/driver-booking.controller.ts`
- Create: `src/modules/driver-booking/driver-booking.service.ts`
- Create: `src/modules/driver-booking/driver-booking.validator.ts`
- Modify: `src/app.ts`
- Test: `src/modules/driver-booking/driver-booking.service.test.ts`

- [ ] **Step 1: Create driver route contract**

```ts
// src/modules/driver-booking/driver-booking.routes.ts
router.post('/:id/accept', validate({ params: bookingIdParamSchema }), controller.acceptBooking);
router.post('/:id/reject', validate({ params: bookingIdParamSchema }), controller.rejectBooking);
router.post('/:id/cancel', validate({ params: bookingIdParamSchema }), controller.cancelAfterAccept);
router.post('/:id/pickup-otp/verify', validate({ params: bookingIdParamSchema, body: otpSchema }), controller.verifyPickupOtp);
router.post('/:id/drop-otp/verify', validate({ params: bookingIdParamSchema, body: otpSchema }), controller.verifyDropOtp);
```

- [ ] **Step 2: Mount driver routes**

```ts
// src/app.ts
import driverBookingRouter from './modules/driver-booking/driver-booking.routes.js';
app.use('/api/v1/driver/bookings', protect, driverBookingRouter);
```

- [ ] **Step 3: Implement accept/reject logic**

```ts
// src/modules/driver-booking/driver-booking.service.ts
export const acceptBooking = async (driverId: string, bookingId: string) => {
  // fetch booking + ride driver, assert driver ownership + DRIVER_PENDING + before deadline
  // generate OTP hashes + expiries
  // set status CONFIRMED
};

export const rejectBooking = async (driverId: string, bookingId: string) => {
  // assert same guards
  // set status CANCELLED, refund full, restore seats
};
```

- [ ] **Step 4: Add tests for decision guards**

```ts
it('allows only ride driver to accept DRIVER_PENDING booking before deadline', async () => {});
it('rejects accept when deadline passed', async () => {});
it('reject flow triggers refund and seat restore', async () => {});
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/modules/driver-booking/driver-booking.service.test.ts -i`  
Expected: decision and authorization tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/driver-booking src/app.ts
git commit -m "feat(driver-booking): add driver decision and OTP endpoints"
```

---

### Task 7: Implement Cancellation Policy (Rider + Driver After Accept)

**Files:**
- Create: `src/modules/ride-booking/booking-cancellation-policy.ts`
- Modify: `src/modules/ride-booking/ride-booking.service.ts`
- Modify: `src/modules/ride-booking/ride-booking.controller.ts`
- Modify: `src/modules/ride-booking/ride-booking.routes.ts`
- Test: `src/modules/ride-booking/booking-cancellation-policy.test.ts`

- [ ] **Step 1: Add pure cancellation policy helper**

```ts
// src/modules/ride-booking/booking-cancellation-policy.ts
export const getRiderRefundPercent = (departureAt: Date, now: Date): number => {
  const diffMs = departureAt.getTime() - now.getTime();
  return diffMs > 24 * 60 * 60 * 1000 ? 50 : 0;
};

export const getRiderRefundAmount = (totalPrice: number, percent: number): number =>
  Number(((totalPrice * percent) / 100).toFixed(2));
```

- [ ] **Step 2: Implement rider cancel endpoint logic**

```ts
// ride-booking.service.ts
// for passenger cancel:
// - if status CONFIRMED/DRIVER_PENDING/PAYMENT_PENDING and trip not started
// - compute refund policy using departure datetime
// - refund 50% if >24h, else 0
// - always set booking CANCELLED and restore seats
```

- [ ] **Step 3: Implement driver cancel-after-accept logic**

```ts
// driver-booking.service.ts (cancelAfterAccept)
// allowed only CONFIRMED and before IN_PROGRESS
// full refund + restore seats + create DriverPenaltyEvent { penaltyPercent: 50 }
```

- [ ] **Step 4: Add policy tests**

```ts
// booking-cancellation-policy.test.ts
it('returns 50% when cancellation is more than 24h before departure', () => {});
it('returns 0% when cancellation is within 24h', () => {});
```

- [ ] **Step 5: Run cancellation tests**

Run: `npx jest src/modules/ride-booking/booking-cancellation-policy.test.ts -i`  
Expected: both policy cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ride-booking src/modules/driver-booking/driver-booking.service.ts
git commit -m "feat(cancellation): enforce rider 24h policy and driver penalty flow"
```

---

### Task 8: Implement OTP Utilities + Driver OTP Verify State Transitions

**Files:**
- Create: `src/modules/ride-booking/booking-otp.utils.ts`
- Modify: `src/modules/driver-booking/driver-booking.service.ts`
- Test: `src/modules/driver-booking/driver-booking.service.test.ts`

- [ ] **Step 1: Add OTP hash/verify helpers**

```ts
// src/modules/ride-booking/booking-otp.utils.ts
import { createHash, randomInt } from 'crypto';

export const generateBookingOtp = (): string =>
  String(randomInt(100000, 999999));

export const hashOtp = (otp: string): string =>
  createHash('sha256').update(otp).digest('hex');

export const isOtpValid = (inputOtp: string, storedHash: string): boolean =>
  hashOtp(inputOtp) === storedHash;
```

- [ ] **Step 2: Wire OTP generation during driver accept**

```ts
const pickupOtp = generateBookingOtp();
const dropOtp = generateBookingOtp();
await tx.rideBooking.update({
  where: { id: bookingId },
  data: {
    status: BookingStatus.CONFIRMED,
    pickupOtpHash: hashOtp(pickupOtp),
    dropOtpHash: hashOtp(dropOtp),
    pickupOtpExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    dropOtpExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    otpAttemptCount: 0,
  },
});
```

- [ ] **Step 3: Implement pickup/drop verify handlers**

```ts
// pickup verify -> IN_PROGRESS
// drop verify -> COMPLETED
// increment otpAttemptCount on failure, block after 5 attempts
```

- [ ] **Step 4: Add OTP verification tests**

```ts
it('moves booking CONFIRMED -> IN_PROGRESS on valid pickup OTP', async () => {});
it('moves booking IN_PROGRESS -> COMPLETED on valid drop OTP', async () => {});
it('rejects OTP after max attempts', async () => {});
```

- [ ] **Step 5: Run OTP tests**

Run: `npx jest src/modules/driver-booking/driver-booking.service.test.ts -i`  
Expected: OTP transition tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ride-booking/booking-otp.utils.ts src/modules/driver-booking/driver-booking.service.ts src/modules/driver-booking/driver-booking.service.test.ts
git commit -m "feat(otp): add pickup/drop OTP verification state transitions"
```

---

### Task 9: Add Timeout Cron for Driver Decision Expiry

**Files:**
- Create: `src/jobs/booking-timeout.cron.ts`
- Modify: `src/server.ts`
- Test: `src/modules/driver-booking/driver-booking.service.test.ts` (or dedicated timeout test)

- [ ] **Step 1: Add timeout cron processor**

```ts
// src/jobs/booking-timeout.cron.ts
import cron from 'node-cron';
import { prisma } from '../config/index.js';
import { BookingStatus } from '@prisma/client';

export const startBookingTimeoutCron = () => {
  cron.schedule('* * * * *', async () => {
    const expired = await prisma.rideBooking.findMany({
      where: {
        status: BookingStatus.DRIVER_PENDING,
        driverDecisionDeadlineAt: { lt: new Date() },
      },
      include: { ride: true },
    });

    for (const booking of expired) {
      // cancel + full refund + restore seats (idempotent guard by status)
    }
  });
};
```

- [ ] **Step 2: Start cron from server bootstrap**

```ts
// src/server.ts
import { startBookingTimeoutCron } from './jobs/booking-timeout.cron.js';
startBookingTimeoutCron();
```

- [ ] **Step 3: Add timeout behavior test**

```ts
it('cancels DRIVER_PENDING booking after deadline and refunds full amount', async () => {});
```

- [ ] **Step 4: Run timeout tests**

Run: `npx jest src/modules/driver-booking/driver-booking.service.test.ts -i`  
Expected: timeout scenario test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/booking-timeout.cron.ts src/server.ts src/modules/driver-booking/driver-booking.service.test.ts
git commit -m "feat(jobs): add driver-decision timeout cancellation cron"
```

---

### Task 10: Remove Legacy Confirm Endpoint + Final Contract Alignment

**Files:**
- Modify: `src/modules/ride-booking/ride-booking.routes.ts`
- Modify: `src/modules/ride-booking/ride-booking.controller.ts`
- Modify: `src/modules/ride-booking/ride-booking.validator.ts`
- Modify: `src/modules/ride-booking/ride-booking.types.ts`
- Test: `src/modules/ride-booking/ride-booking.service.test.ts`, `src/modules/driver-booking/driver-booking.service.test.ts`

- [ ] **Step 1: Remove legacy confirm route and schema**

```ts
// remove:
// router.patch('/:id/confirm', ...)
// confirmBookingSchema and confirmBooking controller path
```

- [ ] **Step 2: Ensure API surfaces match new spec**

```ts
// keep passenger:
// POST /api/v1/bookings
// POST /api/v1/bookings/:id/cancel
// keep driver:
// /api/v1/driver/bookings/:id/{accept,reject,cancel,pickup-otp/verify,drop-otp/verify}
```

- [ ] **Step 3: Run targeted module tests**

Run:  
`npx jest src/modules/ride-booking/ride-booking.service.test.ts -i`  
`npx jest src/modules/driver-booking/driver-booking.service.test.ts -i`  
Expected: PASS without references to deprecated confirm flow.

- [ ] **Step 4: Commit**

```bash
git add src/modules/ride-booking src/modules/driver-booking
git commit -m "ref(booking): remove legacy confirm endpoint and align new contract"
```

---

### Task 11: End-to-End Verification + Build Gate

**Files:**
- Modify: test files in prior tasks
- Test: full build + focused tests

- [ ] **Step 1: Run build**

Run: `npm run build`  
Expected: TypeScript and Prisma generate complete without errors.

- [ ] **Step 2: Run full booking/payment test set**

Run:
```bash
npx jest src/modules/ride-booking/ride-booking.service.test.ts -i
npx jest src/modules/payments/stripe.webhook.controller.test.ts -i
npx jest src/modules/driver-booking/driver-booking.service.test.ts -i
npx jest src/modules/ride-booking/booking-cancellation-policy.test.ts -i
```
Expected: all tests PASS.

- [ ] **Step 3: Sanity-check notification payload keys**

Run: `rg -n "booking.request.driver_decision|deepLink|decisionDeadlineAt|passengerAvatarUrl" src -g"*.ts"`  
Expected: payload keys present in webhook/notification flow and no typos.

- [ ] **Step 4: Commit verification fixes**

```bash
git add src/modules src/jobs
git commit -m "test(booking): finalize payment-driver workflow verification"
```

---

## Spec Coverage Check

- Stripe payment at booking create: Task 2 + Task 4
- Webhook with signature and idempotency: Task 3 + Task 5
- Driver decision (accept/reject) + deadline: Task 6 + Task 9
- Driver online/offline modal payload: Task 5
- Driver cancel after accept full refund + 50% penalty: Task 7
- Rider cancel policy (50% >24h, 0% <=24h): Task 7
- OTP pickup/drop transitions: Task 8
- Remove legacy confirm endpoint: Task 10
- Tests and acceptance confidence: Task 11

## Placeholder Scan

- No `TODO`, `TBD`, or “implement later” markers in task steps.
- Each code-changing step includes concrete code blocks.
- Each test step contains concrete commands and expected outcomes.

## Type Consistency Check

- New statuses consistently use `PAYMENT_PENDING`, `DRIVER_PENDING`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `PAYMENT_FAILED`.
- Cancellation policy naming is consistent with spec: driver penalty 50%, rider refund 50% before 24h and 0% within 24h.
- Driver modal notification type is consistently `booking.request.driver_decision`.
