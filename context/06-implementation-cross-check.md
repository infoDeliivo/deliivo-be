# Implementation Cross-Check

This document records the second-pass code check against the context documentation.

## Checked Sources

- `src/app.ts`
- `src/modules/pricing`
- `src/modules/publish-ride`
- `src/modules/ride-booking`
- `src/modules/driver-booking`
- `src/queue/deadline.queue.ts`
- `src/jobs/booking-timeout.cron.ts`
- `src/services/fuel-price.service.ts`
- `prisma/schema.prisma`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`
- `docs/architecture/PRICE_CALCULATION.md`
- `docs/history/phase-2-payments-pricing.md`
- `docs/history/phase-3-request-expiry.md`

## Confirmed Matches

- The project has a dedicated pricing module mounted at `/api/v1/pricing`.
- The pricing router exposes preview, validate/snapshot, and active config listing.
- The admin router now exposes pricing config list/create/update for operational management.
- `PricingConfig` and `RidePricingSnapshot` exist in Prisma schema.
- Default config-based pricing region is `BALTIC`.
- Publish-draft recommended pricing uses route distance, fuel price, and fuel efficiency.
- Fuel price fallback supports `GB`, `IN`, and `EE`; EUR maps to `EE`.
- Booking request expiry options exist in validators and request-expiry utilities.
- `RideBooking` has deadline, extension, reminder, auto-cancel, withdrawal, and response expiry fields.
- Driver accept/reject checks the decision deadline.
- Rider ride details page exposes a request expiry selector before booking.
- Rider booking detail UI displays pending driver response expiry state.
- Deadline queue sends reminder, initial expiry notification, and extended auto-cancel.
- Booking timeout cron runs every minute as a recovery sweep.
- Stripe payment success now carries the rider-selected response expiry option through to the driver decision deadline instead of replacing it with a fixed window.
- Booking timeout cron now mirrors the queue lifecycle by issuing the initial expiry notification first and only auto-cancelling after the extended window.

## Corrected Documentation

- Admin docs now reflect that pricing mutation is available through protected admin routes, while the public pricing router stays read-only for configs.
- Pricing now has a dedicated PRD and ADR.
- Booking request expiry now has a dedicated PRD and ADR.
- Feature map now separates pricing and booking expiry from the broader ride publishing/search/booking feature.

## Implementation Gaps Found

- Baltic live fuel price source is not implemented; EUR recommendations use the `EE` fallback fuel price.
- PDF source documents were not text-extracted in this environment, so PDF-specific requirements need manual review.

## Recommendation

Before implementing more pricing changes, resolve the remaining pricing gaps:

- Baltic live fuel price source is still not implemented; EUR recommendations still use the `EE` fallback fuel price.
