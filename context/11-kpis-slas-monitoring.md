# KPIs, SLAs, And Monitoring

This document defines the first operational metrics and internal service targets for Deliivo.

## Product KPIs

- Search-to-detail open rate: riders opening a ride from search results.
- Detail-to-booking request rate: riders starting booking from ride details.
- Payment confirmation success rate: successful Stripe confirmation divided by attempted card confirmations.
- Driver acceptance rate: accepted driver-pending requests divided by total actionable requests.
- Booking expiry rate: requests expired before driver response.
- Ride completion rate: completed rides divided by started rides.
- Dispute rate: disputes opened divided by completed or terminal bookings.
- Payout completion rate: completed payout batches divided by payout requests.

## Operational SLAs

- Booking request creation response: p95 under 2 seconds.
- Payment confirmation UI feedback: p95 under 5 seconds, including direct Stripe confirmation fallback.
- Driver notification for new paid booking request: p95 under 10 seconds for persisted notification creation.
- Realtime notification delivery: best effort, p95 under 5 seconds when the user has an active socket.
- Notification panel reconciliation: web refreshes from persisted notifications on focus and at least once per minute while mounted.
- Ride-day action response: p95 under 2 seconds for driver arrived, rider arrived, pickup, no-show, drop-off, and completion actions.
- Stripe webhook processing: p95 under 10 seconds after Stripe delivery.
- Reconciliation issue triage: critical issues reviewed within 1 business day.
- Dispute resolution: manual disputes reviewed within 3 business days.

## Monitoring Signals

- API error rate by route, status code, and module.
- Queue depth and failure count for SMS, mail, push, expiry, payment, and reconciliation jobs.
- Stripe webhook duplicate count, failure count, and processing latency.
- Notification creation count by type and socket/push enqueue failures.
- Booking state transition counts and invalid transition errors.
- Ride operation event counts by type and actor.
- Ledger imbalance and reconciliation issue counts by severity.
- Admin override actions by admin user, booking ID, and reason.

## Logging Requirements

- Critical flows should log structured identifiers: `userId`, `rideId`, `bookingId`, `paymentId`, `disputeId`, `stripeEventId`, and `actionId` when available.
- Every response should carry a `requestId` / `x-request-id` so support can correlate the UI error with backend logs.
- The web client should send its own `x-request-id` header on every API call and preserve the returned ID on errors.
- Logs must not contain card details, raw OTPs in production, Stripe secrets, JWTs, or full service account JSON.
- User-facing failures should produce both a readable UI message and a backend log entry when the backend rejects or fails.

## Dashboards To Build

- Marketplace funnel: searches, detail opens, booking starts, payments, driver confirmations, completions.
- Ride-day operations: started rides, arrived events, OTP/pickup events, no-shows, drop-offs, completions.
- Notifications: created by type, socket delivery attempts, push queue failures, unread counts.
- Payments and payouts: payment statuses, refunds, payout eligible, payout completed, reconciliation issues.
- Disputes and safety: opened disputes, evidence completeness, recommendations, terminal outcomes.

## Current Implementation Status

- The admin portal now includes a live monitoring workbench at `/admin/monitoring` that summarizes platform KPIs, SLA targets, logging requirements, and dashboard shortcuts.
- The backend now emits request correlation IDs on responses and logs HTTP completion events with timing for traceability.
- The remaining work is deeper backend tracing/metrics export and richer historical charts, not the operational surface itself.
- The admin settings page now also surfaces `/health/ready` as the deployment gate for ride-day and payment testing.
