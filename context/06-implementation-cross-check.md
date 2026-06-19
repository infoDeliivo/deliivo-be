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

## Corrected Documentation

- Admin docs no longer claim implemented pricing config mutation. Current router only lists active configs.
- Pricing now has a dedicated PRD and ADR.
- Booking request expiry now has a dedicated PRD and ADR.
- Feature map now separates pricing and booking expiry from the broader ride publishing/search/booking feature.

## Implementation Gaps Found

- Stripe-mode booking expiry does not fully use rider-selected `responseExpiryOption` after payment success. It moves from `PAYMENT_PENDING` to `DRIVER_PENDING` with the fixed `DRIVER_DECISION_WINDOW_MS`.
- Queue expiry and cron expiry are not product-equivalent. Queue initial expiry allows one more hour before auto-cancel; cron sweep cancels immediately when the deadline is past.
- Pricing config create/update is not implemented in the protected pricing router.
- Baltic live fuel price source is not implemented; EUR recommendations use the `EE` fallback fuel price.
- PDF source documents were not text-extracted in this environment, so PDF-specific requirements need manual review.

## Recommendation

Before implementing more pricing or expiry changes, resolve the two expiry consistency issues:

- carry `responseExpiryOption` through Stripe payment success into the actual driver decision deadline.
- make cron recovery match the queue state machine, or document cron as an emergency cancellation policy.
