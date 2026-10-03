# Rider-requested shared rides

## Flow

1. A signed-in rider posts public meeting points, a departure window, seats, bags,
   optional budget and notes. Posting does not charge the rider.
2. Drivers browse requests and offer a verified vehicle, exact departure time,
   total passenger capacity and fare. Existing licence, vehicle, payout readiness,
   route and pricing checks apply. A driver commits to travelling without requiring
   any additional riders. An unselected offer does not block their schedule.
3. The request owner selects one offer. A transaction reserves seats and prevents
   competing selection or conflicting driver journeys. Checkout lasts up to 15 minutes.
4. Server-verified payment confirms the original booking, issues booking OTPs,
   closes competing offers and publishes the ride. Spare seats use normal booking.
   Payment bypass behaves the same only in environments already configured for it.
5. Failed card attempts may retry within checkout. The maintenance worker reconciles
   expired checkout with Stripe before releasing seats. Stripe outages retain the
   reservation for retry rather than risking a paid booking without seats.

Checkout initialization, resume and confirmation idempotently ensure the internal
Payment record exists; recovery never resets an existing payment status or fee
snapshot. Expiry cleanup compares both payment-intent links against the reconciled
snapshot and retries if initialization changed either link. OTP validity is based
on departure/expected arrival, including bookings made days in advance. Capacity
reservation and release both lock the ride before reading or changing segment rows.

Requests have OPEN, CHECKOUT_PENDING, MATCHED, CANCELLED and EXPIRED states.
Offers have OPEN, SELECTED, ACCEPTED, WITHDRAWN, CLOSED and EXPIRED states.
MATCHED records the historical match; subsequent journey cancellation is represented
by the existing ride/booking status, not by reopening the original request.

## Rollout (required order)

1. Back up and apply migrations using the normal release process (`prisma migrate deploy`).
   Migration: `20260926160000_add_ride_requests`. Do not use `db push` in production.
   **Apply before deploying code even with the flag off**: payment, driver scheduling
   and account cleanup code reference the new relations.
2. Deploy backend and its Redis-backed maintenance worker. Set
   `RIDE_REQUESTS_ENABLED=true` and restart the worker to register the minute-based
   checkout expiry task. Ensure migrations, Google routing and pricing configuration
   are present; retain real licence/vehicle/Stripe checks in production.
3. Set `NEXT_PUBLIC_RIDE_REQUESTS_ENABLED=true` and rebuild/deploy the webapp.
   The frontend flag is compiled into the build; runtime environment changes alone
   do not expose the screens.
4. Run the staging acceptance checks below with Stripe test mode before live rollout.

Both flags default to false in example configuration. No migration, live payments,
production configuration or deployment is performed by adding these files.
If disabling the UI/API later, keep the maintenance worker and webhook running until
all existing checkouts settle. Do not remove tables while old/new code uses them.

### Disabled release and off-hours testing

- For the initial deployment, leave `RIDE_REQUESTS_ENABLED` and
  `NEXT_PUBLIC_RIDE_REQUESTS_ENABLED` unset or explicitly `false` in hosting settings.
  The Docker entrypoint applies migrations before starting the backend, even with
  the feature disabled. Other deployment methods must apply migrations first.
- During the testing window, enable the backend flag and restart the API and
  maintenance worker, then enable the frontend flag and rebuild/redeploy the webapp.
  These flags enable access for all eligible users, not just administrators/testers.
- To close the window, set the frontend flag to `false` and rebuild/redeploy, then
  set the backend flag to `false` and restart the API. Keep checkout cleanup and
  payment webhooks running until outstanding payments have settled. Existing
  confirmed rides remain available through normal ride and booking screens.
- Flags do not put Stripe into test mode. Use staging with Stripe test credentials
  for simulated payments; production credentials can create real charges.

## API

All endpoints use existing authenticated JWT sessions and the booking rate limiter.
Base: `/api/v1/ride-requests`. Responses use the standard `data` envelope.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | `view=browse\|mine\|offers\|admin`, `page`, `from`, `to`, `date` (UTC), `seats` |
| POST | `/` | Create request: place IDs, ISO departureAfter/departureBefore, seats, luggage, budgetPerSeat?, notes? |
| GET | `/:id` | Owner/admin sees all offers; other viewers see only their own |
| POST | `/:id/cancel` | Owner/admin cancels OPEN request |
| POST | `/:id/offers` | vehicleId, departureAt, totalSeats, pricePerSeat, expiresInHours, acceptsSharedJourney=true |
| POST | `/offers/:id/checkout` | Owner selects or resumes a single offer; returns normal booking/payment details |
| POST | `/offers/:id/withdraw` | Driver withdraws their OPEN offer |

The browser never supplies rider/driver ownership IDs, final fare, booking status or
the hidden ride ID used to book an offer. Existing verified payment confirmation and
Stripe webhook endpoints complete checkout. Admin view/cancellation is role checked.

## MVP boundaries

- Webapp screens: browse, my requests, my offers, request creation/detail/checkout,
  admin listing. Mobile can reuse the API, but no native mobile screens are included.
- Request window: at least 3 hours ahead, at most 24 hours wide, within 180 days.
  Maximum 5 open requests per rider; maximum 4 seats per requesting party (existing
  booking limit) and 8 total passenger seats per driver offer.
- An existing booking cutoff can prevent last-minute offer selection even before
  request expiry. Requests close 30 minutes before earliest departure.
- Public meeting points and notes are visible to signed-in, unblocked viewers.
  Do not enter home addresses or contact information. Only first name/avatar are exposed.
- No request editing in this version: cancel an open request and repost. A selected
  checkout cannot be withdrawn/cancelled through ordinary booking cancellation;
  it either pays or expires safely. Confirmed bookings use existing cancellation terms.
- No private taxi pricing, minimum occupancy, driver broadcast alerts, offer chat,
  saved-card picker or automatic refund policy changes. Drivers discover requests
  by browsing; riders receive new-offer notifications and both parties get match notices.
- A payment discovered only after scheduled departure is deliberately not allowed
  to publish a past journey. `REQUEST_PAYMENT_REQUIRES_RECONCILIATION` requires support
  to reconcile/refund the Stripe payment; expiry retries must not be ignored.

## Acceptance checks

Unit tests cover selection ownership/expiry, competing selection, confirmation,
card-decline reservation retention and successful/failed expiry reconciliation.
They mock Prisma/Stripe and do not replace PostgreSQL concurrency or gateway testing.

Before enabling live: apply the migration on staging; post a request; submit two
drivers' offers; verify other drivers cannot see competitors; race offer selection;
test successful payment, decline/retry, authentication challenge, reload/resume,
duplicate/reordered webhooks, worker restart and Stripe outage. Confirm exactly one
booking and payment, correct remaining segment seats and public search visibility.
Book spare seats concurrently and confirm no oversell. Check driver schedule conflict,
blocked users, vehicle ownership, cancellation/refund, account deletion and admin access.

Monitor checkout reconciliation warnings, payment webhook failures, worker health
and outstanding CHECKOUT_PENDING requests after release.
