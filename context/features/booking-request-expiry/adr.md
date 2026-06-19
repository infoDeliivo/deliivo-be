# ADR: Booking Request Expiry Architecture

## Status

Accepted with implementation inconsistency to resolve.

## Context

Drivers need time to approve riders, but riders should not be blocked indefinitely. The system also needs to release seats and refund captured payments when a driver does not respond.

## Decision

Store the driver's decision deadline on each `RideBooking`. Let riders choose a deadline option during booking creation. Use BullMQ deadline jobs for reminders, initial expiry notification, and extended auto-cancel. Use a cron sweep as a recovery mechanism for stale overdue bookings. Enforce the deadline in driver accept and reject endpoints.

## Rationale

- A per-booking deadline supports rider-specific waiting preferences.
- Persisted deadline fields make countdown UI and backend enforcement use the same data.
- Queue jobs support targeted reminders and delayed actions without blocking requests.
- Cron sweep protects against missed or delayed queue jobs.
- Driver endpoint enforcement prevents late accept/reject even if the UI is stale.

## Consequences

- Booking state can change asynchronously, so rider and driver screens must refetch after actions and on focus.
- Queue and cron behavior must stay aligned to avoid confusing product outcomes.
- Payment mode affects when a booking becomes `DRIVER_PENDING`, so deadline calculation must happen at the actual driver-decision start time.
- Expiry workflows need notification, refund, seat release, and realtime state update side effects.

## Alternatives Considered

- Fixed global driver response window. Rejected because the product requires rider-selected expiry.
- Frontend-only countdown. Rejected because driver decisions and refunds must be enforced server-side.
- Queue-only expiry. Rejected because missed jobs or worker downtime need recovery.
- Cron-only expiry. Rejected because reminders and one-time extension UX require scheduled per-booking jobs.

## Implementation Notes

- `calculateDeadline()` supports six options and caps all deadlines at departure time.
- `getAvailableOptions()` and `suggestDefaultOption()` exist in backend utilities but are not currently exposed as a dedicated API.
- `assertDecisionWindowOpen()` blocks late driver accept and reject.
- `extendWaitForDriver()` extends once for one hour after expiry.
- `enqueueDeadlineCheck()` schedules initial and reminder jobs.
- `deadline.queue.ts` schedules an extended auto-cancel job after the initial deadline expires.
- `booking-timeout.cron.ts` runs every minute as a recovery sweep.

## Known Design Conflict

The queue path and cron path currently have different outcomes at initial expiry:

- Queue path marks expiry, notifies the rider, and allows one more hour before auto-cancel.
- Cron path cancels immediately when `driverDecisionDeadlineAt` is in the past.

This should be resolved before treating the expiry flow as final.

## Code References

- `src/modules/ride-booking/request-expiry.utils.ts`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/driver-booking/driver-booking.service.ts`
- `src/queue/deadline.queue.ts`
- `src/jobs/booking-timeout.cron.ts`
- `prisma/schema.prisma`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#booking-request-expiry`.
- Supporting expiry and booking diagrams are in `../../07-architecture-and-flow-diagrams.md`.
