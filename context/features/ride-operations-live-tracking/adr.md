# ADR: Ride Operations And Live Tracking Architecture

## Status

Accepted as current architecture.

## Context

Ride-day operations require reliable evidence and responsive UI. Drivers and riders may perform actions from separate devices, and live location must update both authenticated ride screens and public tracking links.

## Decision

Use backend ride operation endpoints for all state transitions. Persist operational evidence through ride events and location updates. Emit realtime updates over Socket.IO where available, but require web screens to refetch canonical state after actions and on relevant events. Gate simulation behavior with development environment flags. Keep ride detail pages map-light and surface live tracking through compact status cards, notification links, and public tracking URLs.

## Rationale

- Persisted events support disputes and support review.
- Socket.IO improves responsiveness but should not be the only source of truth.
- Public tracking links need a dedicated token model rather than exposing authenticated ride APIs.
- Development simulation allows testing complete ride-day flows without physical travel.
- Map-heavy ride detail pages increase clutter and duplicate route context already available in live tracking URLs and notifications.

## Consequences

- UI components need clear action loading state and post-action refetch.
- Driver screens must manage multiple passengers independently.
- Rider screens must distinguish full ride status from the rider's booking status.
- Location simulation and real tracking must share display paths to keep testing realistic.
- The live tracking link becomes the primary handoff artifact for riders, email, SMS, and notification panels.

## Alternatives Considered

- Client-only ride state transitions. Rejected because evidence and policy enforcement must be server-side.
- Firebase-only realtime model. Rejected for current backend because Socket.IO and database-backed notifications already exist.
- Always require physical geofence checks. Deferred because development testing and early rollout need controlled simulation.

## Code References

- `src/modules/ride-operations`
- `src/modules/tracking`
- `src/realtime`
- `prisma/schema.prisma`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#ride-operations-and-live-tracking`.
- Supporting ride-day and live tracking diagrams are in `../../07-architecture-and-flow-diagrams.md`.
