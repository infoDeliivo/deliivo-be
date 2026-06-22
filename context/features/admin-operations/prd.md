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
- Admin pricing management through protected list/create/update routes.
- Content CMS routes with persistent posts and audit trail.
- Dispute admin routes.
- Payout admin routes.
- Reconciliation issue module.
- Admin web pages.

## Functional Requirements

- Admins can access protected admin routes only with authorized roles.
- Admins can inspect user, ride, booking, payment, payout, dispute, and notification context.
- Admins can search ride history by ride ID, booking ID, driver ID/name/email/phone, rider ID/name/email/phone, and route text.
- Admin ride history must expose copyable operational IDs for support handoff and log correlation.
- Admin ride history must hydrate URL query parameters so dispute-to-ride deep links open pre-filtered operational context.
- Admin ride history links must stay inside admin-operable screens instead of sending admins to rider/driver restricted ride pages.
- Admin ride history can perform support override refunds only with explicit confirmation and visible feedback.
- Admins can resolve disputes with auditable decisions.
- Admin dispute actions must provide immediate success/failure feedback.
- Admin dispute lifecycle links must navigate to admin-operable ride history views rather than role-restricted rider/driver pages.
- Admins can review payout batches and reconciliation issues.
- Admin revenue ledger must expose copyable booking, payment, and user IDs and allow navigation from booking ledger entries back to ride history.
- Admin reconciliation jobs and issue resolution actions must provide visible success/failure feedback.
- Admins can inspect active pricing configuration where implemented.
- Admins can edit, publish, delete, and review audit history for guide/blog content.
- Admin pages must show clear forbidden or missing-role explanations.
- Admin actions must create traceable records.

## Non-Functional Requirements

- Admin endpoints must enforce role checks server-side.
- Admin pages should not expose sensitive secrets or full payment data.
- Operational actions must be idempotent where repeated clicks are possible.
- Admin screens need enough filtering to avoid manual database inspection for common support tasks.
- Pricing config create/update is exposed through the protected admin router, not the public pricing router.

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
