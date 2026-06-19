# PRD: Admin Operations

## Purpose

Give operations staff the tools to inspect, recover, and govern marketplace activity across users, rides, payments, payouts, disputes, pricing, and reconciliation.

## Users

- Admin: manages operational exceptions and reviews sensitive marketplace state.
- Support operator: investigates user issues and escalates complex financial or safety cases.

## Current Capabilities

- Admin route group.
- User and marketplace data access patterns.
- Pricing visibility through active pricing config APIs.
- Dispute admin routes.
- Payout admin routes.
- Reconciliation issue module.
- Admin web pages.

## Functional Requirements

- Admins can access protected admin routes only with authorized roles.
- Admins can inspect user, ride, booking, payment, payout, dispute, and notification context.
- Admins can resolve disputes with auditable decisions.
- Admins can review payout batches and reconciliation issues.
- Admins can inspect active pricing configuration where implemented.
- Admin pages must show clear forbidden or missing-role explanations.
- Admin actions must create traceable records.

## Non-Functional Requirements

- Admin endpoints must enforce role checks server-side.
- Admin pages should not expose sensitive secrets or full payment data.
- Operational actions must be idempotent where repeated clicks are possible.
- Admin screens need enough filtering to avoid manual database inspection for common support tasks.
- Pricing config create/update is not currently exposed by the implemented pricing router.

## Success Metrics

- Admin task completion time.
- Number of manual database interventions.
- Reconciliation issue aging.
- Dispute resolution time.
- Forbidden response rate for valid admin users.

## Code References

- `src/modules/admin`
- `src/modules/dispute`
- `src/modules/payout`
- `src/modules/reconciliation`
- `src/modules/pricing`
- `web/src/app/admin`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#high-level-system-architecture` and `../../07-architecture-and-flow-diagrams.md#dispute-and-reconciliation-flow`.
- See `../../08-feature-decisions-bottlenecks.md#admin-operations` for final decisions, open questions, and bottlenecks.
