# Feature Decisions, Open Questions, And Bottlenecks

This document complements the feature PRDs and ADRs. It is the quick review surface for what is decided, what remains open, and where bottlenecks are likely.

## Auth, Profile, And Trust

Final decisions:

- OTP authentication and JWT sessions are the current identity model.
- Driver trust is composed from profile, vehicle, driving license verification, and payout readiness.
- Veriff integration is the external license verification path, with development bypasses gated by env.

Open questions:

- Which trust fields are mandatory for riders versus drivers at launch?
- Should access tokens be shortened with refresh rotation before production?
- Which verification bypass flags are allowed in shared development environments?

Bottlenecks and risks:

- Verification state is spread across profile, vehicle, and DL verification, so readiness checks can diverge.
- Admin review UX must keep pace with verification edge cases.
- OTP delivery failures can block onboarding if SMS/email fallback policy is unclear.

## Ride Publishing, Search, And Booking

Final decisions:

- Rides use ordered waypoints and segment capacity.
- Booking is segment-aware and tied to pickup/dropoff waypoint references.
- Driver approval remains required before a rider is fully confirmed.
- Backend state is authoritative; web refreshes after actions.

Open questions:

- Should duplicate booking prevention become a partial database index for active statuses?
- What is the final policy for auto-confirming trusted riders, if any?
- Should segment search rank by price, departure proximity, driver rating, or route match first?

Bottlenecks and risks:

- Segment capacity updates are concurrency-sensitive.
- Search result and ride detail access rules are easy to break when adding new booking statuses.
- Payment, booking, notification, and deadline side effects must stay idempotent.

## Pricing

Final decisions:

- Config-based pricing uses `PricingConfig` and `RidePricingSnapshot`.
- Publish-draft recommendations can use fuel-based calculation.
- Booking price is computed from resolved segment fare, seat count, luggage fee, and optional platform fee.

Open questions:

- What are final Baltic min/recommended/max rates per kilometer?
- Should pricing config create/update be exposed through admin UI?
- Should Baltic fuel price use a live country-specific source instead of `EE` fallback?
- What is the final `PLATFORM_FEE_PERCENT` policy?

Bottlenecks and risks:

- Two pricing paths exist: config validation and fuel recommendation. They must be presented clearly.
- Missing active pricing config can make `/api/v1/pricing` preview and validation fail.
- Historical snapshots are stable, but new publish behavior can drift if seed config changes.

## Booking Request Expiry

Final decisions:

- Rider-selected expiry options are part of booking creation.
- Driver accept/reject is blocked after decision deadline.
- One-time rider extension exists after initial expiry.
- Queue and cron both participate in expiry handling.

Open questions:

- Should Stripe payment success use the original rider-selected expiry option instead of fixed `DRIVER_DECISION_WINDOW_MS`?
- Should cron recovery mirror the queue extension path instead of immediate cancellation?
- Should expiry options be exposed through a backend metadata endpoint rather than hard-coded in the web UI?

Bottlenecks and risks:

- Queue and cron currently have conflicting initial-expiry outcomes.
- Stripe mode and bypass mode calculate deadlines differently.
- Delayed workers or stale UI can confuse riders unless screens refetch aggressively.

## Ride Operations And Live Tracking

Final decisions:

- Ride-day actions are backend state transitions.
- Pickup OTP is supported; manual pickup fallback exists.
- Operational evidence is persisted for dispute review.
- Dev simulation must be gated by env.

Open questions:

- Should dropoff OTP remain disabled or become a supported proof mechanism?
- Which geofence distance is required for driver/rider arrival evidence?
- Which ride-day reminders should repeat, and at what schedule?
- What exact ETA provider and refresh cadence should be used?

Bottlenecks and risks:

- Multi-passenger ride state is harder than full-ride state; each booking can be in a different operational status.
- Location updates can overload clients or backend if not throttled.
- Dev simulation must never leak into production.

## Payments, Payouts, And Reconciliation

Final decisions:

- Stripe is the payment and Connect payout provider.
- Local Payment, LedgerEntry, PayoutBatch, PayoutItem, and ReconciliationIssue records remain the internal audit model.
- Stripe webhook uses raw body parsing before JSON middleware.
- Payout readiness is required before publishing payable rides.

Open questions:

- Should rider payment be captured immediately, authorized then captured, or captured after driver acceptance?
- What refund matrix applies to rider cancellation, driver rejection, driver cancellation, no-show, missed pickup, and disputes?
- Should payouts be automatic, admin-approved, or hybrid at launch?

Bottlenecks and risks:

- Webhook delivery delays can create confusing booking states without direct reconciliation fallback.
- Financial state must be idempotent across webhooks, retries, and double-clicks.
- Payout and dispute policies can block ledger finalization if not explicit.

## Disputes, Safety, And Ratings

Final decisions:

- Disputes are their own domain module.
- Evidence is collected from ride operations, tracking, payments, notifications, and messages.
- Ratings are separate from disputes but share booking eligibility checks.

Open questions:

- What terminal dispute decisions exist, and which ones affect payout?
- Can users edit or delete ratings after submission?
- Which report categories trigger admin escalation versus simple record keeping?

Bottlenecks and risks:

- Dispute screens require cross-module aggregation.
- Missing ride event or location evidence weakens decision quality.
- Financial settlement must stay synchronized with reconciliation.

## Communications And Notifications

Final decisions:

- Notifications are persisted first and then pushed over Socket.IO/Firebase where possible.
- Socket events are acceleration, not the source of truth.
- Mail and SMS are worker-backed provider integrations.

Open questions:

- Which events require SMS or email versus in-app only?
- Should web use browser push in production, or only in-app toasts and panel updates?
- What notification retention and read/unread policy is required?

Bottlenecks and risks:

- Notification creation can be skipped if it is bundled with unrelated side effects.
- Payloads must include enough deep-link context without leaking sensitive data.
- Socket disconnects and reloads require API refetch behavior.

## Admin Operations

Final decisions:

- Admin capabilities use protected backend routes and web admin screens.
- Domain-specific admin actions stay near their owning modules.
- Pricing config is currently visible through APIs, not mutated through the pricing router.

Open questions:

- Which admin actions require dual control or explicit audit approval?
- Should pricing config management be added to admin?
- What operational dashboards are required for launch readiness?

Bottlenecks and risks:

- Admin pages need aggregation across many modules.
- Forbidden errors must distinguish missing auth from missing admin role.
- Manual actions can cause financial inconsistency if they bypass ledger/reconciliation.

## Web Portal

Final decisions:

- Next.js App Router is the web shell.
- Interactive workflows use client components.
- API utilities, auth context, socket utilities, Stripe provider, and map components are shared infrastructure.
- Screens refetch canonical state after important actions.

Open questions:

- Which state refresh intervals should be used for ride-day screens?
- Should notification toasts be global across all authenticated pages?
- Which mobile web workflows are launch-critical versus app-only?

Bottlenecks and risks:

- UI state can look stale if action responses do not update local state and trigger refetch.
- Map-heavy pages can duplicate components or render stale locations if shared state is not centralized.
- Build-time public env vars require web rebuilds after changes.
