# PRD: Ride Operations And Live Tracking

## Purpose

Support the ride-day journey from scheduled departure through pickup, onboard travel, dropoff, completion, and live location sharing.

## Users

- Driver: starts the ride, marks arrival, verifies pickup, handles no-shows, confirms dropoffs, and finishes the ride.
- Rider: sees ride status, confirms arrival, shares or enters pickup OTP, views live driver location, and confirms dropoff.
- Admin: uses ride event and location evidence for support and disputes.

## Current Capabilities

- Ride start and finish actions.
- Driver arrived at pickup action.
- Rider arrived at pickup action.
- Pickup OTP verification.
- Manual pickup fallback.
- No-show action.
- Dropoff action.
- Location updates.
- Public tracking links.
- Development ride simulation controls.

## Functional Requirements

- A driver can start a ride only when schedule rules permit it, unless development simulation is enabled.
- Driver actions must include action id and client timestamp for traceability and idempotency.
- Driver can mark arrival for each passenger pickup point.
- Rider can mark arrival at pickup point.
- Rider can see pickup OTP when eligible.
- Driver can verify pickup with OTP or use manual fallback when allowed.
- Driver can mark no-show with a reason and evidence context.
- Driver can mark passenger dropoff.
- Rider can confirm dropoff where the flow requires rider confirmation.
- Driver and rider maps must show relevant route, pickup/dropoff context, and live location.
- Live tracking links must expose only the minimum safe ride location information.
- Development simulation controls can move ride date, pickup, dropoff, and driver location without physical travel.

## Non-Functional Requirements

- Every operational action must create durable evidence.
- Location updates must be throttled enough to protect backend and client performance.
- Realtime updates must be backed by polling or explicit refetch because socket delivery is not guaranteed.
- Development simulation must be disabled in production.

## Success Metrics

- Successful ride start rate.
- Pickup OTP success rate.
- Manual pickup fallback rate.
- No-show dispute rate.
- Location update freshness during active rides.
- Tracking link open rate.

## Code References

- `src/modules/ride-operations`
- `src/modules/tracking`
- `src/modules/notification`
- `web/src/app/rides/[id]`
- `web/src/app/tracking`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#ride-day-operations-flow` and `../../07-architecture-and-flow-diagrams.md#live-tracking-flow`.
- See `../../08-feature-decisions-bottlenecks.md#ride-operations-and-live-tracking` for final decisions, open questions, and bottlenecks.
