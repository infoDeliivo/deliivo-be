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
- Riders can provide a new card during booking when no saved card exists.
- Booking payment must not proceed without card details or a selected saved method.
- Drivers must complete payout setup before publishing rides where payouts are required.
- Stripe webhook events must be recorded idempotently.
- Payment state must update booking state consistently.
- Refund and payout handling must reflect cancellation, no-show, and dispute outcomes.
- Admin can inspect and resolve reconciliation issues.

## Non-Functional Requirements

- Stripe secrets must never be exposed to the browser.
- Webhook signature validation must use the raw request body.
- Payment and ledger records should preserve audit history.
- Financial state changes must be idempotent against webhook retries and repeated user actions.

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
