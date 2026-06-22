# Production Readiness Checklist

This checklist records what must be true before treating the current web and backend stack as production ready.

## Environment And Secrets

- `NODE_ENV=production` is set for backend services.
- `JWT_SECRET`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, and `SEGMENT_VIEW_TOKEN_SECRET` are strong unique values.
- `DATABASE_URL` points to the production PostgreSQL database.
- `REDIS_URL` points to the production Redis instance used by queues, cache, and realtime support.
- `GOOGLE_MAPS_API_KEY` is restricted by domain and API.
- `BOOKING_PAYMENT_MODE=stripe` for real payment flows.
- `SMS_MOCK_MODE=false`, `EXPOSE_OTP_IN_RESPONSE=false`, and `ALLOW_RIDE_SIMULATION=false` in production.
- `RIDE_OVERDUE_CANCEL_AFTER_MINUTES` and `RIDE_OVERDUE_END_GRACE_MINUTES` are set to the approved operational policy values, or left at the documented defaults if the defaults are acceptable.
- Public web build env vars are set before building the web image because Next.js embeds them at build time.
- `GET /health/ready` should return `ready` before calling the environment safe for ride-day or payment testing.

## Stripe Test And Live Readiness

- Test mode and live mode must use separate Stripe secret keys, publishable keys, webhook secrets, and Connect account data.
- Stripe webhook endpoint must be configured for the deployed backend URL and must receive raw request body before JSON middleware.
- Required webhook events must include payment intent success/failure and refund-related events used by the backend.
- Stripe CLI is acceptable for local test mode, but production must use the Stripe dashboard webhook endpoint.
- Connect onboarding return and refresh URLs must point to the deployed web domain.
- Driver publishing must stay gated on payout readiness where real payouts are required.
- Reconciliation jobs must be scheduled and monitored after deployment.
- The ride-overdue scheduler must be running alongside the other maintenance workers so rides past departure time are promoted and orphaned seats are cleaned up.
- Overdue ride auto-cancel must not silently refund by default; finance resolution should remain under dispute or admin review policy.

## Notifications And Messaging

- Persisted notification creation is the durable source of truth.
- Socket.IO and Firebase/browser push are acceleration channels, not the only correctness path.
- Firebase web push requires `NEXT_PUBLIC_FIREBASE_*` values and `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
- Mail and SMS workers must run separately from the API process and expose queue failure logs.
- Critical ride-day notifications should include ride ID, booking ID, route, actor, status, and a deep link or live tracking link.
- The web portal should keep its connectivity banner enabled so users can distinguish an actual offline state from a delayed backend mutation.

## Operations

- Admin users are seeded or promoted through an audited process.
- Admin ride history, disputes, revenue ledger, payouts, and reconciliation pages are reachable only with admin role.
- Logs must include enough correlation data for ride ID, booking ID, payment ID, user ID, and action.
- Manual admin support overrides must be confirmed in UI, follow the manual override policy matrix, and be followed by ledger/reconciliation review.
- Support should request the ride ID and booking ID surfaced on rider and driver ride-day pages before applying any override, refund, or dispute action.

## Deployment Verification

- Run backend TypeScript check.
- Run web TypeScript check.
- Run web production build.
- Run Prisma migration against a staging copy before production.
- Validate Stripe webhook signature handling in the deployed environment.
- Publish a staging ride, book with Stripe test card, accept, start, simulate pickup/drop-off, complete, and verify ledger/payout state.
- Verify browser-local publish recovery by refreshing mid-wizard and confirming the step/state resume correctly.
- Confirm `/health/ready` returns `ready` in the deployed environment before wider testing.
