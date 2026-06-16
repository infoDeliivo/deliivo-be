# Stripe Web Payment and Payout Gaps

## Current Status

The backend has Stripe test-mode support for booking payments, Stripe Connect onboarding, refunds, payout eligibility, and payout processing.

The web portal has partial support:

- `/profile/payment-methods` can save cards using Stripe Setup Intents.
- `/profile/earnings` can start Stripe Connect onboarding and request payouts.
- `/admin/payouts` can check payout eligibility and process a payout for a driver ID.

## Missing Web Work

### Real Booking Payment Flow

The ride booking page does not complete Stripe payment confirmation.

Current behavior:

1. Rider clicks book.
2. Web calls `bookingsApi.create()`.
3. Backend may return `booking.payment.clientSecret`.
4. Web only calls `setMyBooking(res.data)`.
5. Web never calls Stripe payment confirmation.

Needed:

- Wrap ride detail booking flow in `StripeProvider`.
- Add saved-card selection or inline card entry during booking.
- If `res.data.payment.clientSecret` exists, call Stripe confirmation.
- After successful confirmation, show `Payment received, waiting for driver`.
- If confirmation fails, show retry action.
- Improve `PAYMENT_PENDING` state UI so testers know payment is incomplete.
- Decide whether booking should use saved cards only, inline card entry, or both.

### Existing Saved Cards

`/profile/payment-methods` already supports saving cards through Setup Intents, but the booking page does not use those saved cards yet.

Needed:

- Fetch saved payment methods in booking flow.
- Let rider select default/saved card.
- Confirm booking payment with selected card.
- Provide fallback inline card entry when no card is saved.

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

### Stripe Connect Return UX

`/profile/earnings` starts Connect onboarding, but does not handle return-state messaging.

Needed:

- Add success/error query handling after Stripe redirects back.
- Refresh Connect status on return.
- Show details for `chargesEnabled`, `payoutsEnabled`, and `detailsSubmitted`.

### Payout History Mapping

The web type expects:

- `amount`
- `paidAt`

Backend payout history returns `PayoutBatch`-style fields:

- `amountTotal`
- `createdAt`
- `status`
- `items`

Needed:

- Align `PayoutRecord` type with backend response.
- Display `amountTotal`.
- Display batch status and item count.

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

