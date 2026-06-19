# Domain Model

## Aggregate Overview

The product is centered on these major aggregates:

- User and trust profile
- Vehicle and documents
- Ride and waypoints
- Segment capacity
- Booking
- Payment and ledger
- Payout batch
- Ride operation events and live location
- Conversation and notifications
- Dispute and reconciliation
- Tracking link

## User

`User` represents both riders and drivers.

Important responsibilities:

- identity and authentication profile
- verification state
- role and onboarding state
- Stripe Connect account state
- trust data such as reports, blocks, ratings, and device tokens

Important related models:

- `TravelPreference`
- `Vehicle`
- `RefreshToken`
- `PaymentMethod`
- `DeviceToken`
- `Notification`
- `UserReport`
- `UserBlock`
- `UserRatingStats`

## Vehicle

`Vehicle` captures driver vehicle details and verification status.

Related models:

- `VehicleDocument`
- `DocumentType`
- `VehicleType`

Current product expectation:

- Driver should have a vehicle before publishing.
- Vehicle verification can be mocked or bypassed in development.
- Future production flow should integrate Veriff or a similar verification provider.

## Ride

`Ride` is the driver's published travel offer.

Important fields:

- origin and destination place/address/coordinates
- route polyline, distance, and duration
- departure date and time
- total and available seats
- base price per seat and currency
- status
- driver and vehicle references

Important related models:

- `RideWaypoint`
- `RideSegmentCapacity`
- `RideBooking`
- `RidePricingSnapshot`
- `LocationUpdate`
- `RideEvent`
- `TrackingLink`
- `Dispute`

## Ride States

Current enum includes:

- `DRAFT`
- `PUBLISHED`
- `SCHEDULED`
- `READY_TO_START`
- `IN_PROGRESS`
- `COMPLETION_PENDING`
- `COMPLETED`
- `CANCELLED`
- `DISPUTED`

Key expectations:

- Published rides are searchable.
- In-progress rides enable operational tracking and pickup/drop-off actions.
- Completed rides feed ratings and payout eligibility.
- Cancelled/disputed rides influence refunds, payouts, and settlement.

## Waypoints and Segment Capacity

`RideWaypoint` represents intermediate pickup/drop-off candidates along a route.

`RideSegmentCapacity` tracks occupied seats per route edge, allowing partial-route bookings without overbooking shared segments.

Core invariant:

- A booking must reserve capacity on every segment edge between its pickup and drop-off positions.
- Capacity must be released on payment failure, withdrawal, rejection, expiry, cancellation, and eligible no-show flows.

## Booking

`RideBooking` is the rider's request and operational ride participation record.

Booking states include:

- `PAYMENT_PENDING`
- `DRIVER_PENDING`
- `CONFIRMED`
- `WAITING_FOR_PICKUP`
- `DRIVER_ARRIVED`
- `OTP_PENDING`
- `IN_PROGRESS`
- `ONBOARD`
- `DROP_PENDING`
- `DRIVER_DROPPED`
- `COMPLETED`
- `CANCELLED`
- `PAYMENT_FAILED`
- `NO_SHOW`
- `DRIVER_MISSED_PICKUP`
- `DISPUTED`

Current important behavior:

- Booking creation reserves seats and initializes payment unless bypass mode is active.
- Real Stripe success moves booking to `DRIVER_PENDING`.
- Driver can accept/reject from `DRIVER_PENDING`.
- Accepted bookings progress through pickup, onboard, drop-off, and completion states.
- Booking status drives rider and driver UI.

## Payment

`Payment` is the dedicated payment record for a booking.

Payment states are string-based constants in service code:

- `CREATED`
- `PAYMENT_PENDING`
- `PAYMENT_FAILED`
- `PAID`
- `HELD_IN_ESCROW`
- `PAYOUT_ELIGIBLE`
- `TRANSFER_CREATED`
- `PAYOUT_COMPLETED`
- `REFUNDED`

Important invariants:

- Payment state transitions should be explicit and validated.
- Stripe webhook events must be deduplicated by `StripeWebhookEvent`.
- Browser Stripe success should not be the only source of truth; backend must reconcile with Stripe.
- Driver payout should not happen while disputes are open.

## Ledger

`LedgerEntry` is append-only accounting.

The ledger derives balances from credits and debits, rather than mutating stored balances.

Important concepts:

- `entryGroupId` links related entries.
- `accountType` separates rider, driver, platform, provider, and other accounting buckets.
- `entryType` explains the business event.
- `direction` is `DEBIT` or `CREDIT`.

## Payout

`PayoutBatch` groups eligible driver payments.

`PayoutItem` maps individual payment lines into a batch.

Important rules:

- Only `PAYOUT_ELIGIBLE` payments are payout candidates.
- Open disputes block payout.
- Stripe Connect must be ready for real payouts.
- Mock mode can complete payout flow without real Stripe transfer.

## Ride Operations Evidence

`RideEvent` captures ride actions with idempotency keys and timestamps.

`LocationUpdate` captures driver location history for live tracking and dispute evidence.

Important evidence sources:

- driver arrival
- rider arrival
- OTP verification
- pickup/drop-off confirmation
- no-show
- missed pickup report
- live location history

## Notifications and Realtime

`Notification` stores user notifications.

Socket.IO emits realtime events such as:

- `notification:new`
- `booking:updated`
- `ride:updated`
- `ride:location`

Notifications are stored and pushed through configured push channels where available.

## Disputes

`Dispute` represents a reported conflict tied to ride and booking.

Dispute states include open, evidence, auto-resolution, manual review, waiting, resolved, and escalated variants.

Settlement decisions can affect:

- rider refund
- driver payout
- split resolution
- payment freeze or release
- reconciliation status

## Tracking Link

`TrackingLink` allows limited public ride tracking for a booking through a secure token.

Expected constraints:

- token should expire
- token can be revoked
- public endpoint should expose limited location-only data

