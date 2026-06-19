# ADR: Disputes, Safety, And Ratings Architecture

## Status

Accepted as current direction.

## Context

Disputes depend on facts produced by booking, ride operation, tracking, notification, payment, and payout flows. The architecture needs to avoid burying dispute decisions inside unrelated modules.

## Decision

Keep dispute handling in a dedicated module and consume evidence from ride events, booking state, location updates, reports, and financial records. Keep rating logic separate from disputes but use the same ride and booking eligibility context.

## Rationale

- Dedicated dispute workflows make admin decisions explicit.
- Evidence reuse avoids duplicating operational data.
- Separating ratings prevents reputation updates from becoming coupled to dispute state.
- Reconciliation can apply financial consequences after a dispute decision.

## Consequences

- Dispute screens need cross-module data aggregation.
- Ride operation endpoints must write enough durable evidence.
- Admin tooling must expose both human-readable summary and raw evidence.
- Financial changes from disputes should be represented as reconciliation or ledger events.

## Alternatives Considered

- Add dispute flags directly to bookings only. Rejected because disputes can span ride, user, payment, and safety context.
- Handle ratings only in the frontend. Rejected because eligibility and duplicate prevention must be server enforced.
- Resolve disputes automatically from status alone. Rejected because evidence and admin judgment are required for edge cases.

## Code References

- `src/modules/dispute`
- `src/modules/ratings`
- `src/modules/reconciliation`
- `prisma/schema.prisma`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#disputes-safety-and-ratings`.
- Supporting dispute and reconciliation diagrams are in `../../07-architecture-and-flow-diagrams.md`.
