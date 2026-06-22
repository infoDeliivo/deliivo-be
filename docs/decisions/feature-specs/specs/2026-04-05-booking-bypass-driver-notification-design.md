# Booking Bypass Payment + Immediate Driver Notification Design

Date: 2026-04-05

## Summary

For production testing, all new ride bookings should skip Stripe payment orchestration and immediately notify the driver when a booking is created. The system should still preserve the existing booking lifecycle and accept/reject/cancel flows, while treating payment as internally successful.

Approved behavior:

- Apply to all users in production.
- On booking create, skip payment intent creation and move directly to `DRIVER_PENDING`.
- Send driver notification immediately at booking creation time.
- Return `payment: null` in booking response.
- Do not enforce driver decision deadline for now (`driverDecisionDeadlineAt = null`).
- On reject/cancel flows, do not call Stripe refunds; persist refund outcomes in DB only.
- Keep Stripe/webhook path in code for future rollback.

## Problem

Current implementation requires Stripe completion and webhook success before a booking reaches `DRIVER_PENDING` and before the driver is notified. For production testing, this blocks testing driver decision and trip lifecycle behavior.

## Goals

- Enable immediate end-to-end booking decision testing in production without Stripe dependency.
- Preserve current domain behavior for booking status transitions and seat restoration.
- Keep rollback path simple so Stripe mode can be re-enabled later without re-architecture.

## Non-Goals

- Deleting Stripe integration.
- Redesigning cancellation policy percentages.
- Changing API paths or introducing new endpoints.
- Adding temporary per-user test allowlists.

## Selected Approach

Use a runtime payment mode switch for booking flow:

- `BOOKING_PAYMENT_MODE=bypass`: immediate paid simulation + driver notification at booking creation.
- `BOOKING_PAYMENT_MODE=stripe`: existing Stripe-first flow.

Why this approach:

- Minimal blast radius by isolating behavior behind one mode gate.
- Preserves future return to Stripe path by configuration.
- Avoids hardcoding temporary behavior into core booking lifecycle.

## Architecture and Components

### 1) Configuration

- Add `BOOKING_PAYMENT_MODE` runtime config with accepted values:
  - `bypass`
  - `stripe`
- Effective default for current production testing: `bypass`.

### 2) Ride Booking Creation (`ride-booking.service.ts`)

In `bypass` mode:

1. Keep validation and seat reservation transaction unchanged.
2. Create booking directly with:
   - `status = DRIVER_PENDING`
   - `paymentCapturedAt = now`
   - `paymentAmount = totalPrice`
   - `paymentCurrency = ride.currency`
   - `driverDecisionDeadlineAt = null`
   - `stripePaymentIntentId = null`
   - `stripeChargeId = null`
3. Send driver decision notification immediately after booking creation:
   - `type = booking.request.driver_decision`
   - includes booking/ride/passenger/segment context payload used by driver app
4. Return booking response with:
   - `payment = null`
   - status already in `DRIVER_PENDING`

In `stripe` mode:

- Keep current behavior unchanged (PaymentIntent creation + webhook-driven move to `DRIVER_PENDING`).

### 3) Driver Reject / Cancel and Rider Cancel

In `bypass` mode:

- Never call `refundPaymentIntent`.
- Persist refund results in DB as simulated refund outcomes.

Driver reject (`DRIVER_PENDING -> CANCELLED`):

- Restore seats.
- Set:
  - `refundPercent = 100`
  - `refundAmount = paymentAmount ?? totalPrice`
  - `refundId = null`
  - `refundedAt = now`

Driver cancel after accept (`CONFIRMED -> CANCELLED`):

- Restore seats.
- Keep driver penalty behavior unchanged.
- Set full-refund DB fields same as reject above.

Rider cancel:

- Keep existing policy calculation:
  - `>24h`: 50%
  - `<=24h`: 0%
- Restore seats when cancelled before trip start.
- Set DB refund fields from computed values without Stripe call.
- Set `refundedAt = now` only when `refundAmount > 0`.

In `stripe` mode:

- Keep existing refund calls and webhook reconciliation behavior unchanged.

### 4) Webhook Component

- Keep Stripe webhook endpoint and handlers intact.
- In bypass mode, booking progression must not rely on webhook.
- Webhook remains available for future mode switch back to Stripe.

## Data Flow

### Bypass Mode Booking Create

1. Rider calls `POST /api/v1/bookings`.
2. Backend validates ride/segment/seats and reserves seats.
3. Backend creates booking directly as `DRIVER_PENDING` with simulated payment-captured fields.
4. Backend emits driver decision notification immediately.
5. Backend returns booking payload with `payment: null`.

### Bypass Mode Decision / Cancellation

1. Driver accepts/rejects via existing endpoints.
2. Rider/driver cancel via existing endpoints when eligible.
3. Refund outcomes are persisted internally without Stripe API calls.
4. Booking and seat state transitions remain consistent with existing domain rules.

## API Contract Impact

No path changes.

`POST /api/v1/bookings` in bypass mode:

- `status` becomes `DRIVER_PENDING` immediately.
- `payment` is `null`.

All driver/rider booking action endpoints remain unchanged in route and request shape.

## Error Handling

- Booking creation should not fail solely because socket/push delivery fails.
- Driver notification send is best-effort after successful booking persistence.
- Stripe-specific runtime errors should not occur in bypass mode because Stripe APIs are not invoked.
- Existing authorization and booking status conflict errors remain unchanged.

## Testing Strategy

Add/update tests for mode-dependent behavior:

1. Booking create in bypass mode:
   - Creates `DRIVER_PENDING` directly
   - Returns `payment: null`
   - Sends driver notification immediately
   - Does not call PaymentIntent creation

2. Driver reject in bypass mode:
   - Cancels booking
   - Restores seats
   - Persists full refund fields in DB
   - Does not call Stripe refund API

3. Driver cancel-after-accept in bypass mode:
   - Cancels booking
   - Restores seats
   - Persists full refund fields
   - Keeps penalty behavior
   - No Stripe refund call

4. Rider cancel in bypass mode:
   - Keeps 50%/0% policy
   - Persists computed refund fields
   - No Stripe refund call

5. Stripe webhook tests remain valid in stripe mode and do not regress.

## Rollback Plan

To return to Stripe-driven flow:

1. Set `BOOKING_PAYMENT_MODE=stripe`.
2. Verify booking create returns payment intent payload again.
3. Verify webhook transitions booking to `DRIVER_PENDING`.
4. Verify reject/cancel refund calls use Stripe APIs as before.

No endpoint contract migrations are required.

## Scope Check

This scope is bounded to booking payment-mode branching and notification timing behavior. It does not introduce new subsystems and is suitable for a single implementation plan.
