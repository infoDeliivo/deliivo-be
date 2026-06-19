# ADR: Web Portal Architecture

## Status

Accepted as current architecture.

## Context

The web portal supports multiple actors and state-heavy workflows. Several features depend on browser-only SDKs such as Stripe, Google Maps, Firebase, and Socket.IO.

## Decision

Use Next.js App Router with client components for interactive workflows. Centralize backend calls in API client utilities, session state in auth context, Stripe setup in provider utilities, and realtime behavior in socket utilities. Treat backend APIs as the source of truth and refetch after state-changing actions.

## Rationale

- Next.js gives route-based organization for rider, driver, profile, and admin screens.
- Client components fit maps, Stripe Elements, sockets, and ride-day controls.
- Central API utilities make error handling and auth headers consistent.
- Refetch-after-action mitigates delayed or missed realtime events.

## Consequences

- Build-time environment configuration must be kept in sync with Docker and root `.env`.
- UI state machines need careful handling because ride and booking states can change independently.
- Shared components such as notification panel and maps must support both desktop and mobile.
- Web should avoid duplicating backend business rules beyond presentation gating.

## Alternatives Considered

- Server-render most ride workflows. Rejected because maps, sockets, and payment entry are client-heavy.
- Build separate rider and driver web apps. Rejected for now because shared screens and auth reduce implementation cost.
- Depend only on optimistic UI without refetch. Rejected because payment, booking, and operations state can change asynchronously.

## Code References

- `web/src/app`
- `web/src/components`
- `web/src/contexts`
- `web/src/lib`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#web-portal`.
- Supporting request lifecycle, notification, and tracking diagrams are in `../../07-architecture-and-flow-diagrams.md`.
