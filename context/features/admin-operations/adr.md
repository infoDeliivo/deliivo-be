# ADR: Admin Operations Architecture

## Status

Accepted as current architecture.

## Context

Marketplace operations require access to cross-cutting state. Admin capabilities must remain protected and auditable because they can affect users, rides, payments, and disputes.

## Decision

Expose admin functionality through dedicated protected backend routes and admin web screens. Keep domain-specific admin actions near their owning modules when they require specialized business logic, such as disputes, payouts, pricing, and reconciliation.

## Rationale

- Dedicated admin routes simplify authorization and audit review.
- Domain modules retain business rules for sensitive actions.
- Web admin pages provide operational visibility without requiring direct database access.
- Clear route boundaries reduce accidental exposure to normal users.

## Consequences

- Admin screens need aggregation across several APIs.
- Role and session handling must be consistent across backend and web portal.
- Admin action logs and domain events are important for later audit.
- Feature teams must add admin visibility when creating new operational states.

## Alternatives Considered

- Build admin as direct database tooling. Rejected because it bypasses business rules and audit behavior.
- Put all admin logic into a single module. Rejected because payout, dispute, and pricing rules belong with their domains.
- Rely only on third-party dashboards such as Stripe. Rejected because they do not understand ride and booking state.

## Code References

- `src/app.ts`
- `src/modules/admin`
- `src/modules/dispute`
- `src/modules/payout`
- `src/modules/reconciliation`
- `web/src/app/admin`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#admin-operations`.
- Supporting system and dispute/reconciliation diagrams are in `../../07-architecture-and-flow-diagrams.md`.
