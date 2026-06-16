# Stripe Web Payment and Payout Gaps

## Current Status

The backend has Stripe test-mode support for booking payments, Stripe Connect onboarding, refunds, payout eligibility, and payout processing.

The web portal has partial support:

- `/profile/payment-methods` can save cards using Stripe Setup Intents.
- `/profile/earnings` can start Stripe Connect onboarding and request payouts.
- `/admin/payouts` can check payout eligibility and process a payout for a driver ID.
- `/rides/[id]` can now confirm a booking PaymentIntent with a saved Stripe card when the backend returns `booking.payment.clientSecret`.
- `/publish` now requires Stripe Connect payout readiness before the driver can publish a ride.
- `/profile/earnings` now renders the real backend earnings, balance, payout-batch history, and Connect status fields.
- `/profile/payment-methods` now reloads server state after card changes and keeps a default card assigned when the current default is removed.

## Implemented In This Pass

### Real Booking Payment Flow

The ride booking page now completes Stripe payment confirmation using saved payment methods.

Current behavior after this fix:

1. Rider clicks book.
2. Web calls `bookingsApi.create()`.
3. Backend may return `booking.payment.clientSecret`.
4. Web requires the rider to select a saved card, or save a card on the booking page first.
5. Web confirms the PaymentIntent through Stripe.js using the selected saved `stripePaymentMethodId`.
6. Web calls `bookingsApi.confirmPayment(bookingId)` after successful Stripe confirmation.
7. Web shows payment progress and then the driver-pending booking state.
8. If the booking remains `PAYMENT_PENDING` with a `clientSecret`, web shows a retry confirmation action using saved cards.

Files changed:

- `web/src/lib/stripe.tsx`
- `web/src/app/rides/[id]/page.tsx`

Notes:

- If `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is missing and backend returns a Stripe `clientSecret`, the booking page shows a clear configuration error.
- If backend payment mode is mock and no `clientSecret` is returned, the booking still proceeds without card confirmation.
- If Stripe confirmation fails after backend booking creation, the rider can retry payment from the existing `PAYMENT_PENDING` booking instead of creating a duplicate booking.
- New cards are saved through the existing SetupIntent flow before booking is submitted.
- Booking PaymentIntents are now created with the rider's Stripe `customer` when a saved card exists, which is required for confirming saved payment methods.

## Remaining Web Work

### Existing Saved Cards

`/profile/payment-methods` supports saving cards through Setup Intents, and the ride booking page now uses saved cards.

Still needed:

- Add a richer default-card management UX from the ride booking page if needed.
- Decide whether booking should allow one-time unsaved cards later. Current behavior intentionally saves the card first.

### Stripe Webhook Dependency

Real Stripe payment flow depends on local/webhook delivery:

```text
POST /api/v1/payments/stripe/webhook
```

For local testing:

```powershell
stripe listen --forward-to http://localhost:3000/api/v1/payments/stripe/webhook
```

Web should show a clearer state when payment is confirmed in Stripe but the booking is still waiting for webhook processing.

Current mitigation:

- `POST /api/v1/bookings/:id/payment/confirm` now reconciles the Stripe PaymentIntent directly when Stripe already says `succeeded`, so the booking can move to `DRIVER_PENDING` and notify the driver even if local webhook forwarding is delayed.

### Stripe Connect Return UX

`/profile/earnings` now handles return-state messaging.

Implemented:

- Added `/driver/stripe-connect/return` and `/driver/stripe-connect/refresh` pages that redirect back into the web portal.
- Added return and refresh status messaging on `/profile/earnings`.
- Refreshes Connect status after returning from Stripe.
- Shows `chargesEnabled`, `payoutsEnabled`, and `detailsSubmitted` on the earnings page.

### Payout History Mapping

Implemented:

- `PayoutRecord` now matches the backend `PayoutBatch` response shape.
- Web now displays `amountTotal`, batch status, transfer ID, failure reason, and item counts.

### Admin Payout UX

`/admin/payouts` works technically, but requires manual driver UUID entry.

Needed later:

- searchable driver selector
- eligible amount preview
- connected-account status before processing
- clearer errors for `NO_STRIPE_ACCOUNT` and no eligible payments

## Environment Required For Real Stripe Test Mode

Root `.env` should use test keys:

```env
BOOKING_PAYMENT_MODE=stripe
STRIPE_CONNECT_MOCK_MODE=false
STRIPE_PAYMENT_METHODS_MOCK_MODE=false
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
APP_BASE_URL=http://localhost:3001
PLATFORM_FEE_PERCENT=10
```

Rebuild web after changing `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
