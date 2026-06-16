# Stripe Booking Payment Root Causes

## Summary

This document captures the root causes and fixes for the Stripe booking/payment issues found during rider-to-driver booking flow testing on the web portal.

The affected path was:

1. Rider saves or selects a card.
2. Rider confirms payment for a booking.
3. Booking should move from `PAYMENT_PENDING` to `DRIVER_PENDING`.
4. Driver should see a pending request and receive a notification.

Two distinct bugs were present in that flow.

## Symptoms Observed

- Rider added a card and tried to complete booking payment.
- Stripe returned an error similar to:

```text
The `payment_method` parameter supplied ... belongs to the Customer ...
Please include the Customer in the `customer` parameter on the PaymentIntent.
```

- After payment success, rider could see a success message such as `Payment confirmed. Waiting for driver response.`
- Driver still did not see the booking request in the manage-ride screen.
- Driver notification was missing for the newly paid request.

## Root Causes

### 1. Saved card PaymentIntent was created without Stripe customer

The web booking page was changed to confirm payment using a saved Stripe payment method ID.

That exposed a backend mismatch:

- saved cards are attached to a Stripe `customer`
- booking `PaymentIntent` creation did not include that `customer`
- Stripe does not allow confirming a saved `payment_method` attached to a customer unless the `PaymentIntent` is created with the same `customer`

Result:

- card save worked
- booking creation worked
- payment confirmation failed at Stripe confirm step

### 2. Driver request creation depended only on webhook delivery

The business transition from `PAYMENT_PENDING` to `DRIVER_PENDING` originally happened only in the Stripe webhook handler for:

```text
payment_intent.succeeded
```

That webhook transition was responsible for:

- updating booking status to `DRIVER_PENDING`
- setting payment captured fields
- creating the driver notification
- creating the rider "request sent" notification
- emitting the `booking:updated` socket event
- starting the driver decision deadline timer

If webhook delivery was missing or delayed in local/dev, the booking stayed in `PAYMENT_PENDING`.

Result:

- rider saw payment success on the browser side
- backend booking did not move to the driver-visible request state yet
- driver saw nothing

### 3. Booking payment confirm endpoint was read-only

The rider-side endpoint:

```text
POST /api/v1/bookings/:id/payment/confirm
```

was only fetching booking status back to the UI.

It was not reconciling Stripe state directly.

Result:

- even after browser-side Stripe success, the app still depended on webhook delivery
- there was no fallback path to move the booking forward when webhook forwarding was not active

## Changes Implemented

### Booking payment flow

- Web booking now uses saved cards or allows saving a card first on the ride page.
- Backend booking `PaymentIntent` creation now includes the rider's `stripeCustomerId` when an active saved card exists.
- This makes saved Stripe payment methods valid for booking confirmation.

### Payment success handoff

- Added a shared backend helper for `Stripe succeeded -> DRIVER_PENDING` booking transition.
- Stripe webhook now uses that shared helper.
- `POST /api/v1/bookings/:id/payment/confirm` now also checks Stripe directly.
- If Stripe already says the `PaymentIntent` succeeded, the backend applies the same transition immediately.

This means the driver request can appear even if webhook forwarding is delayed or absent in local testing.

### Driver-visible side effects now covered by both paths

The shared transition now consistently handles:

- booking status update
- payment captured fields
- driver notification
- rider notification
- `booking:updated` socket emission
- decision deadline queue scheduling

## Related Profile and Payout Fixes

During the same Stripe review pass, related payout/profile issues were also fixed:

- `/profile/earnings` now uses the real backend response shape for balance, earnings, and payout history
- `/profile/payment-methods` now reloads canonical server state after add/default/remove
- removing a default card now promotes another active card to default on the backend
- `/publish` now blocks ride publishing until Stripe Connect payout readiness is complete
- Stripe Connect return and refresh routes now redirect back into the web portal correctly

## Files Changed

- `web/src/app/rides/[id]/page.tsx`
- `web/src/lib/stripe.tsx`
- `web/src/lib/api.ts`
- `web/src/app/profile/earnings/page.tsx`
- `web/src/app/profile/payment-methods/page.tsx`
- `web/src/app/profile/page.tsx`
- `web/src/app/publish/page.tsx`
- `web/src/app/driver/stripe-connect/return/page.tsx`
- `web/src/app/driver/stripe-connect/refresh/page.tsx`
- `src/modules/payments/stripe.types.ts`
- `src/modules/payments/stripe.service.ts`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/payments/stripe.webhook.controller.ts`
- `src/modules/payment-methods/payment-methods.service.ts`

## Operational Note

The new fallback reduces reliance on webhook timing, but real Stripe flow still expects webhook delivery for complete backend consistency.

For local testing, keep Stripe forwarding active:

```powershell
stripe listen --forward-to http://localhost:3000/api/v1/payments/stripe/webhook
```

Without that, the booking flow now still progresses via `POST /api/v1/bookings/:id/payment/confirm`, but webhook delivery remains the correct source for full Stripe event processing.
