# ADR: Payments, Payouts, And Reconciliation Architecture

## Status

Accepted as current architecture with known product policy questions.

## Context

The marketplace must handle rider payment, driver payout, refunds, and disputes. Stripe provides payment and Connect primitives, but the platform still needs its own booking, ledger, and reconciliation state.

## Decision

Use Stripe for external payment and payout rails. Store local Payment, LedgerEntry, PayoutBatch, PayoutItem, StripeWebhookEvent, and ReconciliationIssue records. Keep webhook routes mounted with raw body parsing before JSON middleware. Require payout readiness before driver publishing flows that create payable rides.

## Rationale

- Local financial records allow support and admin flows without relying only on Stripe dashboard state.
- Ledger and reconciliation models make manual recovery possible.
- Webhook idempotency protects against duplicate Stripe deliveries.
- Payout readiness gating avoids rides that cannot later be paid out.

## Consequences

- Payment state must be reconciled between direct API responses and asynchronous webhooks.
- Web code needs separate flows for saved cards, new card entry, and booking confirmation.
- Driver publishing readiness depends on Stripe Connect status and backend policy.
- Refund timing depends on the final business decision for capture and cancellation policies.

## Alternatives Considered

- Use Stripe as the only financial source of truth. Rejected because disputes, admin decisions, and marketplace status need internal records.
- Skip saved card support. Rejected because repeat booking UX requires it.
- Allow publishing before payout setup. Rejected for current product direction because it creates operational payout failures later.

## Code References

- `src/app.ts`
- `src/modules/payments`
- `src/modules/payment-methods`
- `src/modules/payout`
- `src/modules/ledger`
- `src/modules/reconciliation`
- `docs/bug-fix/stripe-web-payment-payout-gaps.md`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#payments-payouts-and-reconciliation`.
- Supporting payment, payout, and reconciliation diagrams are in `../../07-architecture-and-flow-diagrams.md`.
