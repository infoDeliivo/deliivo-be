# Feature Map

This document maps the major product areas to code modules, web routes, and supporting documents.

## Auth, Profile, And Trust

Primary backend modules:

- `src/modules/auth`
- `src/modules/user`
- `src/modules/travel-preferences`
- `src/modules/vehicles`
- `src/modules/dl-verification`
- `src/modules/otp`

Primary web areas:

- `web/src/app/auth`
- `web/src/app/profile`
- `web/src/app/onboarding`

Key concepts:

- OTP based authentication
- JWT access and refresh token lifecycle
- Profile completion and travel preferences
- Vehicle profile and document upload
- Driver license verification through Veriff
- Development mode verification bypasses for local testing

## Ride Publishing, Search, And Booking

Primary backend modules:

- `src/modules/publish-ride`
- `src/modules/search-ride`
- `src/modules/ride-booking`
- `src/modules/driver-booking`
- `src/modules/pricing`
- `src/modules/maps`

Primary web areas:

- `web/src/app/publish`
- `web/src/app/search`
- `web/src/app/rides/[id]`
- `web/src/app/profile/booked-rides`
- `web/src/app/profile/published-rides`

Key concepts:

- Route and stopover construction
- Segment capacity for partial route bookings
- Booking request expiry
- Terms and privacy acceptance before booking
- Saved card or inline card collection before paid booking
- Driver approval or rejection of pending requests

## Pricing

Primary backend modules:

- `src/modules/pricing`
- `src/modules/publish-ride`
- `src/modules/ride-booking`
- `src/services/fuel-price.service.ts`

Primary web areas:

- `web/src/app/publish`
- `web/src/app/rides/[id]`
- `web/src/app/admin/settings`

Key concepts:

- Baltic `BALTIC` region default for distance-rate pricing
- `PricingConfig` active regional min, recommended, and max rates per kilometer
- `RidePricingSnapshot` immutable per-ride pricing records
- Publish-draft fuel-based recommended pricing
- Segment-aware booking fare calculation
- Luggage fee and optional platform service fee
- Current pricing API supports preview, validation/snapshot, and active config listing

## Booking Request Expiry

Primary backend modules:

- `src/modules/ride-booking`
- `src/modules/driver-booking`
- `src/queue/deadline.queue.ts`
- `src/jobs/booking-timeout.cron.ts`

Primary web areas:

- `web/src/app/rides/[id]`
- `web/src/app/rides/[id]/manage`

Key concepts:

- Rider-selected response expiry options
- Driver decision deadline on `RideBooking`
- Driver accept/reject blocked after deadline
- One-time rider extension after initial expiry
- Queue reminder and auto-cancel jobs
- Cron recovery sweep for stale `DRIVER_PENDING` bookings

## Ride Operations And Live Tracking

Primary backend modules:

- `src/modules/ride-operations`
- `src/modules/tracking`
- `src/modules/notification`

Primary web areas:

- `web/src/app/rides/[id]`
- `web/src/app/tracking`

Key concepts:

- Start ride and finish ride
- Driver arrived at pickup
- Rider arrived at pickup
- Pickup OTP verification
- Manual pickup fallback
- No-show handling
- Dropoff confirmation
- Live driver location updates
- Public live sharing links
- Development simulation for ride day flows

## Payments, Payouts, And Reconciliation

Primary backend modules:

- `src/modules/payments`
- `src/modules/payment-methods`
- `src/modules/payout`
- `src/modules/ledger`
- `src/modules/reconciliation`
- `src/modules/pricing`

Primary web areas:

- `web/src/app/profile/cards`
- `web/src/app/profile/payout`
- `web/src/app/profile/earnings`
- `web/src/app/admin`

Key concepts:

- Stripe PaymentIntent lifecycle
- Saved payment methods
- Stripe Connect onboarding for drivers
- Mandatory payout readiness before publishing rides
- Ledger entries as the internal financial source of truth
- Payout batches and reconciliation issues
- Stripe webhook idempotency

## Disputes, Safety, And Ratings

Primary backend modules:

- `src/modules/dispute`
- `src/modules/ratings`
- `src/modules/reconciliation`
- `src/modules/notification`

Primary web areas:

- `web/src/app/profile/reports`
- `web/src/app/rides/[id]`
- `web/src/app/admin`

Key concepts:

- User reports and blocks
- Booking and ride disputes
- Evidence from ride events and location updates
- Rating submission after eligible rides
- Admin dispute decisions
- Payment reconciliation effects of disputes

## Communications And Notifications

Primary backend modules:

- `src/modules/notification`
- `src/modules/chat`
- `src/modules/mail`
- `src/modules/sms`

Primary web areas:

- `web/src/components/NotificationPanel.tsx`
- `web/src/app/profile/notifications`
- `web/src/app/chat`

Key concepts:

- Persisted notifications
- Socket.IO realtime events
- Firebase Cloud Messaging for push-capable clients
- Email and SMS worker queues
- Chat conversations per ride or user context

## Admin Operations

Primary backend modules:

- `src/modules/admin`
- `src/modules/dispute`
- `src/modules/payout`
- `src/modules/reconciliation`
- `src/modules/pricing`

Primary web areas:

- `web/src/app/admin`

Key concepts:

- Admin authorization
- User and operational oversight
- Pricing configuration visibility
- Dispute resolution
- Payout and reconciliation review
- Manual operational recovery actions

## Web Portal Shell

Primary frontend modules:

- `web/src/app`
- `web/src/components`
- `web/src/contexts`
- `web/src/lib`

Key concepts:

- Next.js App Router
- Client-side auth context
- API client wrapper
- Socket client wrapper
- Stripe Elements integration
- Google Maps integration
- Baltic region branding
