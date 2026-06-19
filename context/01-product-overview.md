# Product Overview

## Product

Deliivo is a real-time carpooling platform for the Baltic region, currently focused on Estonia, Latvia, and Lithuania. It connects drivers publishing intercity rides with riders searching, booking, paying, and tracking rides.

The product supports both a web portal and a future/additional mobile app. The current active web portal covers onboarding, profile, vehicle, ride publishing, ride search, booking, payments, ride management, notifications, tracking, disputes, and admin operations.

## Primary Actors

- Rider: searches rides, books seats, pays, tracks ride progress, confirms pickup/drop-off states, rates rides, and raises disputes.
- Driver: completes trust setup, adds vehicle and payout details, publishes rides, accepts or rejects booking requests, starts rides, manages pickup/drop-off, marks no-show, and receives payouts.
- Admin: manages users, disputes, refunds, reconciliation, payout checks, and platform operations.
- System: handles OTPs, deadlines, notifications, payment webhooks, reconciliation jobs, queue workers, and cleanup tasks.
- External services: Stripe, Google Maps, Veriff, Firebase Cloud Messaging, Twilio, email provider, AWS S3.

## Product Goals

- Let riders find and book affordable intercity trips with clear segment pricing.
- Let drivers monetize unused seats while retaining control over booking approval.
- Keep payments, refunds, and payouts auditable.
- Capture enough ride lifecycle evidence for dispute resolution.
- Provide realtime operational visibility during ride day.
- Support local development and testing with simulation controls.

## Core Journeys

### Rider Booking Journey

1. Rider signs up or logs in.
2. Rider searches a route and chooses a ride or segment.
3. Rider accepts terms where required.
4. Rider selects or adds a saved payment card.
5. Rider books and confirms Stripe payment.
6. Backend moves booking to `DRIVER_PENDING`.
7. Driver approves or rejects the request.
8. Rider receives the result and proceeds to pickup if accepted.

### Driver Publishing Journey

1. Driver completes profile/trust setup.
2. Driver adds vehicle details.
3. Driver completes Stripe Connect payout onboarding.
4. Driver creates a ride draft with origin, destination, route, stopovers, schedule, seats, luggage, and pricing.
5. Driver publishes ride.
6. Ride becomes searchable and bookable.

### Ride Day Journey

1. Driver starts ride near scheduled departure.
2. Driver location is tracked and visible to riders.
3. Driver marks arrival at rider pickup point.
4. Rider marks own pickup arrival.
5. Rider shares pickup OTP or driver uses permitted manual flow.
6. Driver confirms pickup/onboarding.
7. Driver confirms drop-off.
8. Rider confirms drop-off.
9. Ride and bookings complete.
10. Ratings, payout eligibility, and dispute windows begin.

### Dispute and Settlement Journey

1. Rider or driver reports an issue.
2. Backend links dispute to ride, booking, payment, location, event, and OTP evidence.
3. Rule engine or admin evaluates.
4. Decision can produce refund, payout, split settlement, or escalation.
5. Reconciliation validates payment and settlement consistency.

## Non-Goals For Current Web Scope

- Full native mobile UX is not in this repository.
- One-time unsaved card booking is not currently the intended flow.
- Fully automated dispute decisions should remain conservative.
- Multi-region active-active infrastructure is not implemented.

