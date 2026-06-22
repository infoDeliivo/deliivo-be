# ADR: Ride Publishing, Search, And Booking Architecture

## Status

Accepted as current architecture with ongoing refinements.

## Context

Carpool bookings are not simple whole-ride reservations. A rider can book only part of a route, and each segment must retain enough capacity. Drivers also need control over who joins the ride.

## Decision

Represent rides with ordered waypoints and segment capacity records. Keep publishing, searching, rider booking, and driver booking decisions in separate modules. Use booking status transitions to represent payment pending, driver pending, confirmed, rejected, expired, cancelled, and operational states.

## Rationale

- Ordered waypoints make partial-route bookings explicit.
- Segment capacity prevents overbooking when riders overlap only part of the route.
- Separate rider and driver booking modules match different actors and permissions.
- Backend state transitions are the source of truth; the web portal only reflects and requests transitions.

## Consequences

- Every booking must include pickup and dropoff waypoint references.
- UI needs segment labels rather than only ride origin and destination.
- Booking state can change from jobs, webhooks, driver actions, or rider actions, so screens must refetch after actions and on focus.
- Search result visibility and ride detail access must include drivers, published rides, and riders with eligible bookings.

## Alternatives Considered

- Store only origin and destination on bookings. Rejected because partial capacity cannot be proven safely.
- Confirm every paid booking automatically. Rejected because the product requires driver approval.
- Keep capacity as a computed value only. Rejected because concurrent booking requires transactional protection.

## Code References

- `prisma/schema.prisma`
- `src/modules/publish-ride`
- `src/modules/search-ride`
- `src/modules/ride-booking`
- `src/modules/driver-booking`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#ride-publishing-search-and-booking`.
- Supporting publish, search, booking, and domain diagrams are in `../../07-architecture-and-flow-diagrams.md`.
