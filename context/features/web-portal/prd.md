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
- Ongoing ride sticky panel for active or next-24-hour rides.
- Public terms, privacy, FAQ, and contact pages.
- Public guide/blog route backed by persistent CMS posts and localized guide content.
- Admin content operations route for editing guide content, publishing state, and audit review.
- Language preference selector and translation catalogs for English, Estonian, and Russian.
- Stripe Elements integration.
- Google Maps integration.
- Admin section.

## Functional Requirements

- Web pages must render current canonical state after refresh.
- Shared request handling must retry transient idempotent GET failures once and keep request IDs visible in errors.
- User actions must show immediate loading state and refetch after completion.
- Driver and rider ride details must present role-specific actions clearly.
- Ride-day OTP and verification controls must appear near the top of driver and rider ride-detail screens.
- Authenticated users must have a persistent entry point back to their active or imminent ride.
- Landing page search controls must carry origin, destination, date, seats, and women-only filters into the search page.
- Landing page must explain rider and driver workflows separately.
- Legal and support links must resolve to production-ready public pages.
- Public guide content must be reachable from top navigation and footer support links.
- Admins must have a content operations entry point for persistent CMS editing and audit review.
- Language preference must persist locally and be represented through the page `lang` attribute.
- Public contact emails must be configurable through documented `NEXT_PUBLIC_*` environment variables.
- API/network failures must be normalized into readable user-facing messages.
- Critical driver actions must show immediate success or failure feedback without requiring the user to infer state from delayed refreshes.
- Critical rider actions must show immediate success or failure feedback across booking, payment, pickup, drop-off, cancellation, rating, reports, and live-link operations.
- Booked and published ride lists must use backend pagination metadata and expose page controls.
- Ride list status filters must request grouped statuses from the API instead of filtering only the first loaded page.
- Payment and payout setup must be discoverable from profile and booking flows.
- Notification UI must work on desktop and mobile layouts.
- Authenticated ride-detail pages must avoid embedded live-location cards; live movement is handled by background updates and dedicated live sharing links.
- The ongoing ride sticky panel must not cover ride-detail action buttons.
- Admin routes must handle forbidden, unauthenticated, and missing-role states clearly.

## Non-Functional Requirements

- Build must pass TypeScript checks.
- API errors must render actionable messages instead of raw JSON parse failures.
- Client code must avoid assuming socket events always arrive.
- Auth, profile, notifications, and sticky ride surfaces must refresh on focus, visibility change, and reconnect.
- Responsive layout must avoid clipped text and duplicated map sections.
- Profile and account hub layouts must use desktop width effectively while remaining readable on mobile.
- Profile, ride-detail, and notification surfaces should preserve desktop readability without collapsing into mobile-width cards.
- Admin shell spacing must remain readable on compact and desktop screens.
- Environment variables must be documented and available in Docker builds.

## Current Content And I18n Limits

- The web portal now supports language preference selection for `en`, `et`, and `ru`.
- Public/common surfaces now use translation catalogs: navigation, footer, landing, search form, FAQ, contact, blog landing, terms summary, and privacy summary.
- Authenticated rider, driver, payment, payout, and admin operation screens still need page-by-page translation-key migration.
- The blog/guide route is backed by persistent database content with seeded starter posts.
- Admin content editing is enabled and records audit events for create, update, and delete actions.
- Localized content storage is still basic and does not yet provide full translation workflow management.

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
- `web/src/lib/i18n.ts`
- `web/src/lib/blog-content.ts`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#backend-request-lifecycle`, `../../07-architecture-and-flow-diagrams.md#notification-delivery-flow`, and `../../07-architecture-and-flow-diagrams.md#live-tracking-flow`.
- See `../../08-feature-decisions-bottlenecks.md#web-portal` for final decisions, open questions, and bottlenecks.
