# PRD: Disputes, Safety, And Ratings

## Purpose

Give users and admins structured tools to report issues, resolve disputes, preserve evidence, and maintain reputation signals after rides.

## Users

- Rider: reports driver or ride issues, opens disputes, rates completed rides.
- Driver: reports rider issues, responds to disputes, rates riders where supported.
- Admin: reviews evidence, decides outcomes, and coordinates financial reconciliation.

## Current Capabilities

- Dispute backend module.
- User report and block concepts.
- Rating backend module and rating stats model.
- Ride event and location evidence from operational flows.
- Reconciliation module for financial follow-up.
- Admin dispute routes.
- Emergency SOS backend route and web ride-detail actions.

## Functional Requirements

- Users can report safety, payment, pickup, dropoff, no-show, and behavior issues.
- Users can open disputes tied to ride and booking context.
- Disputes must include reason, description, actor, target, and current ride or booking state.
- Operational evidence must be available to admin review.
- Admin dispute lifecycle must show evidence as a checklist plus concrete ride event rows with GPS/no-GPS indicators where available.
- Admin can make terminal decisions that affect dispute status and financial reconciliation.
- Users can rate eligible completed rides.
- Rating attempts must be blocked for ineligible bookings.
- No-show and missed-pickup flows must preserve enough detail for dispute review.
- Riders and drivers can raise SOS from ride detail/manage screens with ride, booking, role, optional note, and optional browser GPS evidence.
- SOS alerts must notify admins immediately through persisted notification records and realtime delivery where available.

## Non-Functional Requirements

- Dispute decisions must be auditable.
- Safety reporting must not depend on realtime delivery.
- Emergency SOS must be durable even when realtime push delivery fails.
- Rating and report flows must be protected against duplicate submission where product policy requires one final record.
- Admin decision effects on payments must be explicit and traceable.

## Success Metrics

- Dispute open rate by ride outcome.
- Dispute resolution time.
- Rating submission rate after completed rides.
- Reported no-show reversal rate.
- Admin decision correction rate.

## Code References

- `src/modules/dispute`
- `src/modules/ratings`
- `src/modules/reconciliation`
- `src/modules/ride-operations`
- `src/modules/safety`
- `web/src/app/rides/[id]`
- `web/src/app/admin`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#dispute-and-reconciliation-flow`.
- See `../../08-feature-decisions-bottlenecks.md#disputes-safety-and-ratings` for final decisions, open questions, and bottlenecks.
