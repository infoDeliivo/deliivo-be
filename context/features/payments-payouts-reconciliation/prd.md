# PRD: Payments, Payouts, And Reconciliation

## Purpose

Collect rider payments, prepare driver payouts, and maintain a clear financial audit trail for operations, refunds, disputes, and reconciliation.

## Users

- Rider: adds cards and pays for bookings.
- Driver: connects payout account and receives ride earnings.
- Admin: reviews failed payments, payouts, refunds, ledger entries, and reconciliation issues.

## Current Capabilities

- Stripe PaymentIntent based rider payment.
- Saved card management.
- Inline card collection during booking.
- Stripe webhook handling.
- Stripe Connect account onboarding and status checks.
- Driver payout readiness checks.
- Ledger, payout batch, payout item, and reconciliation issue models.
- Admin payout and reconciliation routes.

## Functional Requirements

- Riders can add, view, and select saved payment methods.
- Rider payment settings must show saved cards first and ride payment history below it in a desktop-friendly layout.
- Rider card actions must provide immediate success/failure feedback.
- Riders can provide a new card during booking when no saved card exists.
- Booking payment must not proceed without card details or a selected saved method.
- Drivers must complete payout setup before publishing rides where payouts are required.
- Driver earnings must stay simple: total earnings, pending earnings, paid earnings, payout-eligible amount, plus pending/paid item tabs.
- Driver payout setup and payout request actions must provide immediate success/failure feedback.
- Stripe webhook events must be recorded idempotently.
- Test and live Stripe modes must be fully separated by environment variables for secret key, publishable key, webhook secret, and Connect account data.
- Payment state must update booking state consistently.
- Refund and payout handling must reflect cancellation, no-show, and dispute outcomes.
- Admin can inspect and resolve reconciliation issues.

## Non-Functional Requirements

- Stripe secrets must never be exposed to the browser.
- Webhook signature validation must use the raw request body.
- Payment and ledger records should preserve audit history.
- Financial state changes must be idempotent against webhook retries and repeated user actions.
- Production Stripe readiness requires dashboard-configured webhooks; Stripe CLI is only for local test mode.

## Success Metrics

- Payment confirmation success rate.
- Booking payment failure rate.
- Payout onboarding completion rate.
- Webhook processing failure rate.
- Reconciliation issue count by severity.

## Code References

- `src/modules/payments`
- `src/modules/payment-methods`
- `src/modules/payout`
- `src/modules/ledger`
- `src/modules/reconciliation`
- `web/src/app/profile/cards`
- `web/src/app/profile/payout`
- `web/src/app/profile/earnings`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#payment-and-payout-flow`.
- See `../../08-feature-decisions-bottlenecks.md#payments-payouts-and-reconciliation` for final decisions, open questions, and bottlenecks.
