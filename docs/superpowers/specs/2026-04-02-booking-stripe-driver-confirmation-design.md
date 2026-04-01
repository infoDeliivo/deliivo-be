# Booking Stripe Payment + Driver Confirmation Design

Date: 2026-04-02

## Summary

This design adds a paid booking flow using Stripe where payment is collected from the passenger during booking, then the driver decides whether to accept or reject the paid booking.

Chosen behavior:

- Payment is initiated during booking creation.
- Stripe immediate charge flow is used.
- Booking is **not** auto-confirmed after payment.
- Driver must accept or reject within 30 minutes.
- If driver rejects or times out, passenger gets automatic full refund.
- Two confirmation codes (OTP) are used:
  - pickup OTP (trip start)
  - drop OTP (trip completion)
- Seats are reserved immediately at booking creation.
- Current `PATCH /api/v1/bookings/:id/confirm` flow is replaced by new decision/payment flow.

## Problem

Current booking flow allows booking creation and manual confirmation but has no integrated payment lifecycle, no driver decision deadline with refund handling, and no two-step trip verification via OTP.

This causes four gaps:

1. No trusted payment state tied to booking lifecycle.
2. No clear driver acceptance/rejection contract after payment.
3. No automatic refund on rejected/expired paid bookings.
4. No secure pickup/drop completion handshake between passenger and driver.

## Goals

- Introduce Stripe-backed payment at booking creation.
- Keep booking/seat state, payment state, and driver decision state consistent.
- Provide explicit APIs for driver accept/reject and OTP verification.
- Guarantee automatic full refund when driver rejects or does not respond in 30 minutes.
- Keep booking authorization strict (only booking passenger and ride driver can act).

## Non-Goals

- Wallet or partial refund system.
- Marketplace-style split payouts to drivers.
- Surge pricing redesign.
- Re-using old booking confirm endpoint semantics.

## Selected Approach

Selected approach: **Booking-first with Stripe PaymentIntent + webhook orchestration**.

Why this approach:

- Strong server-side source of truth via Stripe webhooks.
- Works well with driver-decision window and automatic refunds.
- Keeps frontend payment UX flexible (Elements or mobile SDK) while preserving backend control.
- Supports reliable idempotency and reconciliation.

## High-Level Flow

1. Passenger calls `POST /api/v1/bookings` with `rideId` and optional `segmentId`.
2. Backend validates booking, reserves seats immediately, creates booking in `PAYMENT_PENDING`, creates Stripe PaymentIntent, returns `clientSecret`.
3. Passenger completes payment on client.
4. Stripe webhook (`payment_intent.succeeded`) marks booking `DRIVER_PENDING`, sets 30-minute decision deadline.
5. Driver accepts or rejects using dedicated driver APIs.
6. If accepted: booking moves to `CONFIRMED`, pickup/drop OTPs are generated and shared via notification payload.
7. If rejected or deadline expires: booking moves to `CANCELLED`, full refund is created, seats are restored.
8. Pickup OTP verify moves booking to `IN_PROGRESS`.
9. Drop OTP verify moves booking to `COMPLETED`.

## State Machine

### Booking Statuses

- `PAYMENT_PENDING`
- `DRIVER_PENDING`
- `CONFIRMED`
- `IN_PROGRESS`
- `COMPLETED`
- `CANCELLED`
- `PAYMENT_FAILED`

### Transitions

- Create booking -> `PAYMENT_PENDING`
- Payment success webhook -> `DRIVER_PENDING`
- Payment failure webhook -> `PAYMENT_FAILED` then seats restored and booking finalized
- Driver accept -> `CONFIRMED`
- Driver reject -> `CANCELLED` then refund
- Driver timeout (30 min) -> `CANCELLED` then refund
- Pickup OTP verify -> `IN_PROGRESS`
- Drop OTP verify -> `COMPLETED`
- Refund success updates refund fields and keeps booking terminal state as `CANCELLED`.

## API Design

Base path uses existing auth middleware pattern.

### 1) Create Booking + Initialize Payment

`POST /api/v1/bookings`

Request body:

```json
{
  "rideId": "uuid",
  "segmentId": "segment-token-optional",
  "seatsBooked": 1,
  "luggageCount": 0,
  "notes": "optional"
}
```

Response (example):

```json
{
  "status": "CREATED",
  "message": "Booking created, payment required",
  "data": {
    "id": "booking-uuid",
    "status": "PAYMENT_PENDING",
    "totalPrice": 10,
    "currency": "GBP",
    "payment": {
      "provider": "stripe",
      "paymentIntentId": "pi_xxx",
      "clientSecret": "pi_xxx_secret_xxx"
    }
  }
}
```

Notes:

- Seat reservation happens here.
- If booking create fails after seat decrement, transaction must roll back.

### 2) Optional Client Payment Confirmation Poll

`POST /api/v1/bookings/:id/payment/confirm`

Purpose: client checks latest state after payment UI returns.  
Source of truth remains webhook.

### 3) Stripe Webhook

`POST /api/v1/payments/stripe/webhook`

Required:

- Verify Stripe signature.
- Process idempotently by event id + payment intent id.

Events:

- `payment_intent.succeeded` -> booking `DRIVER_PENDING`, set `driverDecisionDeadlineAt`.
- `payment_intent.payment_failed` -> booking `PAYMENT_FAILED`, restore seats.
- `charge.refunded` / refund events -> update refund fields.

### 4) Driver Accept Booking

`POST /api/v1/driver/bookings/:id/accept`

Rules:

- Only ride driver can call.
- Booking must be `DRIVER_PENDING` and before deadline.
- On success: `CONFIRMED`, generate pickup/drop OTP hashes and expiries.

### 5) Driver Reject Booking

`POST /api/v1/driver/bookings/:id/reject`

Rules:

- Only ride driver.
- Only `DRIVER_PENDING`.
- Trigger full refund and seat restoration.

### 6) Pickup OTP Verify (Driver API)

`POST /api/v1/driver/bookings/:id/pickup-otp/verify`

Request:

```json
{
  "otp": "123456"
}
```

Rules:

- Booking must be `CONFIRMED`.
- Passenger reads OTP from passenger app and shares it with driver at pickup.
- Driver submits OTP for verification.
- OTP must match, not expired, within attempt limit.
- Transition to `IN_PROGRESS`.

### 7) Drop OTP Verify (Driver API)

`POST /api/v1/driver/bookings/:id/drop-otp/verify`

Rules:

- Booking must be `IN_PROGRESS`.
- Passenger shares drop OTP with driver at drop-off.
- Driver submits OTP for verification.
- OTP valid and not expired.
- Transition to `COMPLETED`.

### Endpoint Removal

`PATCH /api/v1/bookings/:id/confirm` is removed from active contract and replaced by driver decision APIs.

## Data Model Changes

### RideBooking

Add fields:

- `stripePaymentIntentId String? @unique`
- `stripeChargeId String?`
- `paymentAmount Float?`
- `paymentCurrency String?`
- `paymentCapturedAt DateTime?`
- `refundId String?`
- `refundedAt DateTime?`
- `driverDecisionDeadlineAt DateTime?`
- `driverDecisionAt DateTime?`
- `pickupOtpHash String?`
- `pickupOtpExpiresAt DateTime?`
- `pickupOtpVerifiedAt DateTime?`
- `dropOtpHash String?`
- `dropOtpExpiresAt DateTime?`
- `dropOtpVerifiedAt DateTime?`
- `otpAttemptCount Int @default(0)`

Adjust enum `BookingStatus` with states listed above.

Recommendation:

- Add indexes for `status`, `driverDecisionDeadlineAt`, `stripePaymentIntentId`.

## Optional BookingEvent Table

Add append-only audit table:

- `id`, `bookingId`, `eventType`, `actorType`, `actorId`, `payloadJson`, `createdAt`

Used for:

- webhook traceability
- driver decision audits
- OTP verification attempts
- refund lifecycle debugging

## Timeout and Jobs

Add scheduler/worker task that runs periodically (for example every minute):

- Query bookings in `DRIVER_PENDING` where `driverDecisionDeadlineAt < now`.
- For each:
  - mark booking cancelled due to timeout,
  - issue full refund if payment captured,
  - restore seats,
  - emit notifications.

Job must be idempotent and safe on retries.

## Seat Integrity Rules

- Seats are decremented at booking creation.
- Seats are incremented on:
  - payment failure,
  - driver reject,
  - driver timeout cancellation.
- No double increment on repeated webhook/job execution.

Use transactional updates with status guards to keep exactly-once state transitions.

## Security and Validation

- Stripe webhook signature verification is mandatory.
- OTP values are stored hashed (never plaintext).
- OTP attempt limits enforced (for example max 5 attempts per stage).
- Authorization checks:
  - passenger-only actions for booking/payment status checks,
  - driver-only actions for accept/reject and OTP verification endpoints,
  - strict ride-driver/passenger linkage checks.
- Add idempotency keys for client retry on booking creation.

## Notifications

Passenger notifications:

- payment succeeded
- driver accepted
- driver rejected + refund initiated/succeeded
- timeout cancelled + refund initiated/succeeded
- trip started
- trip completed

Driver notifications:

- paid booking awaiting decision
- reminder near decision deadline
- trip started/completed status updates

### Driver Booking Request Modal Payload

For a new paid booking that needs driver decision, create notification with:

- `type`: `booking.request.driver_decision`
- `title`: short, actionable text (example: `New ride request`)
- `body`: short summary (example: `Rider wants Mathura to Delhi`)
- `data`: payload for modal rendering and deep-link fallback

Recommended `data` payload:

```json
{
  "bookingId": "booking-uuid",
  "rideId": "ride-uuid",
  "passengerName": "Rider Name",
  "passengerAvatarUrl": "https://cdn.example/avatar.jpg",
  "originAddress": "Mathura",
  "destinationAddress": "Delhi",
  "seatsBooked": "1",
  "totalPrice": "850",
  "currency": "INR",
  "decisionDeadlineAt": "2026-04-02T12:30:00.000Z",
  "deepLink": "app://driver/booking-request/booking-uuid"
}
```

Rules:

- Keep `data` values as strings for push compatibility.
- Always include `bookingId`, `rideId`, and `deepLink`.
- Driver app can fetch fresh booking details by `bookingId` before rendering modal.

### Online vs Offline Delivery Behavior

Use existing notification service behavior:

- If driver has active socket session:
  - send `notification:new` WebSocket event immediately,
  - open booking-request modal in-app instantly with payload from event data.
- If driver has no active socket session:
  - send FCM/APNs push with same core `data`,
  - on push tap, app resolves `deepLink`,
  - app fetches booking details by `bookingId`,
  - app opens the same booking-request modal UI.

This gives one UX contract with two transport paths (socket for online, push for offline).

Passenger app behavior:

- On driver accept, passenger receives pickup OTP and drop OTP in booking details payload.
- Passenger is instructed to share pickup OTP only after boarding.
- Passenger is instructed to share drop OTP only after reaching destination.

## Testing Strategy

Unit tests:

- booking state transitions
- payment webhook handlers
- timeout cancellation logic
- OTP hash/verify and attempt limit behavior

Integration tests:

- create booking -> pay -> webhook -> driver accept -> pickup OTP -> drop OTP
- create booking -> pay -> driver reject -> refund + seat restore
- create booking -> pay -> timeout -> refund + seat restore

Failure-path tests:

- duplicate webhook replay
- webhook out-of-order delivery
- payment failure after initial create
- OTP expired/invalid/attempt-limit reached

Contract tests:

- new API responses and auth behavior
- old confirm endpoint removed behavior according to migration plan

## Rollout Plan

1. Add schema and enum migrations.
2. Introduce Stripe service + webhook endpoint with idempotency store.
3. Implement booking create with PaymentIntent and seat reservation.
4. Implement driver decision APIs and timeout worker.
5. Implement OTP generation/verification endpoints.
6. Cut over clients from old confirm endpoint.
7. Remove old confirm route and legacy code path.

## Acceptance Criteria

- Paid booking cannot become confirmed without driver accept.
- Driver decision deadline is enforced at 30 minutes.
- Reject/timeout always triggers full refund and seat restoration.
- Pickup/drop OTP gates work and are auditable.
- Booking, payment, seat, and notification states remain consistent under retries and webhook duplication.
