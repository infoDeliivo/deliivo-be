# PRD: Web Portal

## Purpose

Provide the browser experience for riders, drivers, and admins across onboarding, publishing, search, booking, ride-day operations, payments, notifications, and admin workflows.

## Users

- Rider: searches, books, pays, tracks, confirms, reports, and rates rides.
- Driver: publishes, manages bookings, operates ride-day flows, tracks earnings, and handles payouts.
- Admin: performs operational review and recovery.

## Current Capabilities

- Next.js App Router application.
- Baltic region branding updates.
- Authenticated profile pages.
- Ride publishing and search pages.
- Ride details and ride management pages.
- Notification panel and notification page.
- Stripe Elements integration.
- Google Maps integration.
- Admin section.

## Functional Requirements

- Web pages must render current canonical state after refresh.
- User actions must show immediate loading state and refetch after completion.
- Driver and rider ride details must present role-specific actions clearly.
- Payment and payout setup must be discoverable from profile and booking flows.
- Notification UI must work on desktop and mobile layouts.
- Maps must show relevant ride, rider, driver, and tracking context.
- Admin routes must handle forbidden, unauthenticated, and missing-role states clearly.

## Non-Functional Requirements

- Build must pass TypeScript checks.
- API errors must render actionable messages instead of raw JSON parse failures.
- Client code must avoid assuming socket events always arrive.
- Responsive layout must avoid clipped text and duplicated map sections.
- Environment variables must be documented and available in Docker builds.

## Success Metrics

- Booking flow completion rate.
- Publish flow completion rate.
- Ride-day action success rate.
- Payment method add success rate.
- Web error rate by route.
- Support tickets for stale state or missing notifications.

## Code References

- `web/src/app`
- `web/src/components`
- `web/src/contexts`
- `web/src/lib/api.ts`
- `web/src/lib/socket`
- `web/src/lib/stripe.tsx`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#backend-request-lifecycle`, `../../07-architecture-and-flow-diagrams.md#notification-delivery-flow`, and `../../07-architecture-and-flow-diagrams.md#live-tracking-flow`.
- See `../../08-feature-decisions-bottlenecks.md#web-portal` for final decisions, open questions, and bottlenecks.
