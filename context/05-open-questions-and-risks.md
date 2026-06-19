# Open Questions And Risks

## Source Coverage

- Requirement PDFs exist under `docs/requirements`, but this environment did not have a PDF text extraction tool available. The context docs use file names, Markdown docs, code, schema, and repository history as the source of truth. PDF-specific wording should be reviewed manually before treating these documents as final product signoff.
- Some feature behavior was inferred from recently changed code and bug-fix documents. If the repository has uncommitted changes that are not intended to survive, these docs should be reconciled after cleanup.

## Product Questions

- Should booking payment be captured immediately at request time, authorized then captured after driver acceptance, or captured only after ride completion? Current code has been moving toward paid booking with Stripe confirmation before driver acceptance, but this impacts refund and dispute policy.
- Should pickup OTP be the only passenger boarding proof, or should rider-arrived and driver-arrived location evidence be mandatory before OTP verification?
- Should dropoff OTP remain unsupported, or should dropoff confirmation require a rider-side action plus driver-side action?
- What is the final cancellation and refund matrix for rider cancellation, driver per-passenger cancellation, full ride cancellation, no-show, and driver missed pickup?
- What notification channels are required for web-only users: in-app panel, browser push, email, SMS, or all of them?

## Architecture Risks

- Realtime state must not depend only on Socket.IO delivery. The UI should continue to refetch canonical ride, booking, and notification state after any action and on navigation focus.
- Stripe webhook handling must keep raw body parsing before JSON middleware. Moving middleware order can silently break webhook signature validation.
- Prisma 7 requires datasource URL handling through Prisma config rather than `url = env("DATABASE_URL")` in the schema.
- Docker builds require environment availability during `npm ci` because `postinstall` runs `prisma generate`.
- Location simulation must be gated by development environment flags. It should never be enabled by default in production.

## UX Risks

- Driver and rider ride-day screens are state-heavy. The UI needs explicit action states and immediate local feedback after each action to avoid users double-clicking or assuming the system failed.
- Notification summaries need enough ride context to be useful after reload: origin, destination, date/time, passenger or driver name, booking status, and a deep link.
- Payment and payout readiness should be checked before users enter long forms. Publishing should block early if payout setup is incomplete.
- Admin pages should fail with clear role or session messages rather than generic forbidden responses.

## Data Risks

- Ride status and booking status are separate state machines. UI code must not assume one status fully explains the other.
- Segment capacity must be recalculated or transactionally maintained when bookings move between pending, confirmed, cancelled, rejected, expired, no-show, and disputed states.
- Ledger and payment records should remain append-only where possible. Manual admin actions should create compensating events rather than editing history.
