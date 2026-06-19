# PRD: Booking Request Expiry

## Purpose

Give riders control over how long they wait for driver confirmation, keep drivers accountable for timely responses, and automatically recover seats and payments when requests are not answered.

## Users

- Rider: selects how long the driver has to respond, sees countdown state, can extend once, withdraw, or cancel.
- Driver: receives a pending booking request, sees the decision deadline, and must accept or reject before expiry.
- System: sends reminders, marks expired deadlines, auto-cancels overdue requests, releases seats, and initiates refunds.

## Current Capabilities

- Rider can submit `responseExpiryOption` during booking creation.
- Supported options are `ONE_HOUR`, `THREE_HOURS`, `SIX_HOURS`, `TWELVE_HOURS`, `TWENTY_FOUR_HOURS`, and `BEFORE_DEPARTURE`.
- Deadline is capped at ride departure time.
- Booking response includes `decisionDeadline` for `DRIVER_PENDING` bookings.
- Driver accept and reject enforce the open decision window.
- Rider can extend waiting once after the initial deadline expires.
- Queue sends reminders and handles initial and extended deadline jobs.
- Cron sweep cancels stale `DRIVER_PENDING` bookings whose deadline is already past.
- Cancellation after timeout initiates full refund where payment was captured.

## Functional Requirements

- Booking creation must accept an optional rider-selected expiry option.
- If no option is supplied, deadline defaults to before-departure behavior.
- Deadline must never be after the ride departure time.
- Driver cannot accept or reject a pending request after `driverDecisionDeadlineAt`.
- Rider booking details must show deadline, remaining time, expired state, extension eligibility, and whether it was already extended.
- Rider can extend the waiting period exactly once after the initial deadline expires.
- System sends a driver reminder one hour before deadline when the deadline is more than one hour away.
- System notifies rider when the initial deadline expires and offers next action.
- If the extended waiting period expires, the booking is cancelled, seats are released, and full refund is initiated where applicable.
- Recovery cron must cancel overdue `DRIVER_PENDING` bookings even if the queue job was missed.

## Implemented State And Data

- `RideBooking.driverDecisionDeadlineAt`
- `RideBooking.deadlineExpiredNotifiedAt`
- `RideBooking.deadlineExtendedAt`
- `RideBooking.autoCancelledAt`
- `RideBooking.responseExpiryOption`
- `RideBooking.responseExpiryHours`
- `RideBooking.reminderSentAt`
- `RideBooking.withdrawnAt`
- `RideBooking.withdrawnReason`

## Important Behaviors

- In bypass payment mode, booking creation uses the rider-selected expiry option immediately because the booking starts as `DRIVER_PENDING`.
- In Stripe mode, booking creation starts as `PAYMENT_PENDING`; after payment succeeds, current code assigns the fixed `DRIVER_DECISION_WINDOW_MS` deadline when moving to `DRIVER_PENDING`.
- Queue initial deadline does not immediately cancel. It marks expiry, notifies the rider, and schedules an extended auto-cancel job one hour later.
- `extendWaitForDriver()` requires the booking to be `DRIVER_PENDING`, deadline to be expired, and no previous extension.
- `booking-timeout.cron.ts` runs every minute and directly cancels `DRIVER_PENDING` bookings with an expired `driverDecisionDeadlineAt`.

## Current Gaps

- Rider-selected expiry option is not preserved into the Stripe payment-success transition; Stripe mode currently uses the fixed driver decision window after payment succeeds.
- Queue behavior and cron behavior differ: queue initial expiry offers an extension path, while cron sweep directly cancels expired bookings.
- The source PDF `deliivo_booking_request_expiry_design.pdf` was not text-extracted in this environment and should be manually reviewed.

## Success Metrics

- Driver response time.
- Acceptance before deadline rate.
- Expired booking request rate.
- Extension usage rate.
- Auto-cancel refund success rate.
- Support tickets for stale pending requests.

## Code References

- `src/modules/ride-booking/request-expiry.utils.ts`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/ride-booking/ride-booking.validator.ts`
- `src/modules/driver-booking/driver-booking.service.ts`
- `src/queue/deadline.queue.ts`
- `src/jobs/booking-timeout.cron.ts`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`
- `docs/history/phase-3-request-expiry.md`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#booking-request-expiry-flow`.
- See `../../08-feature-decisions-bottlenecks.md#booking-request-expiry` for final decisions, open questions, and bottlenecks.
