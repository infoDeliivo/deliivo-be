# No-show, Rating, and Dispute Flow Fix

## Problem

When a driver marked a rider as no-show, the booking could become hard to find from the rider web flow. The rider also had no contextual way to report or dispute the outcome from the ride detail screen, and ratings were only accepted for `COMPLETED` bookings.

This created three user-facing issues:

- Failed pickup bookings looked lost from the rider side.
- Users could not rate after a no-show or missed-pickup outcome.
- Users had to manually open the generic disputes page and enter ride/booking IDs.

## Changes

### Booking Visibility

Ride-detail visibility now has a separate participant status list.

`activeBookingStatuses` remains focused on active/seat-impacting bookings. A new ride-detail visibility list includes terminal and failed-pickup statuses such as:

- `NO_SHOW`
- `DRIVER_MISSED_PICKUP`
- `DISPUTED`
- cancelled/withdrawn/rejected/expired states

This allows participants to reopen the ride detail page for support actions without treating failed bookings as active search or capacity state.

### Rider Web Flow

The rider ride-detail page now includes:

- `Report driver missed pickup` during pickup-stage statuses.
- Dev-mode missed-pickup simulation when `NEXT_PUBLIC_ALLOW_RIDE_SIMULATION=true`.
- A contextual report/dispute form for no-show, missed pickup, drop-off pending, completed, and disputed outcomes.
- Rating UI for terminal completed or failed-pickup outcomes.

The report form calls the existing backend dispute API with the current `rideId` and `bookingId`, so the user no longer has to copy IDs manually.

### My Rides Filters

The booked-rides list now classifies operational statuses:

- Active: pickup, in-progress, onboard, drop pending.
- Cancelled/failed: no-show, missed pickup, disputed, rejected, expired, withdrawn, cancelled.

This prevents no-show bookings from disappearing from filtered views.

### Rating Eligibility

Backend ratings now allow terminal ride outcomes:

- `COMPLETED`
- `NO_SHOW`
- `DRIVER_MISSED_PICKUP`

The existing duplicate-rating and participant checks still apply.

## Files Changed

- `src/modules/search-ride/search-ride.service.ts`
- `src/modules/ratings/ratings.service.ts`
- `src/modules/ratings/ratings.controller.ts`
- `src/modules/ratings/ratings.service.test.ts`
- `web/src/lib/api.ts`
- `web/src/app/rides/page.tsx`
- `web/src/app/rides/[id]/page.tsx`

## Verification

Passed:

```powershell
npm.cmd exec tsc -- --noEmit
cd web
npx.cmd tsc --noEmit
```

Note: no focused unit-test script is exposed in `package.json`; the rating service test was updated to cover the no-show rating path.
