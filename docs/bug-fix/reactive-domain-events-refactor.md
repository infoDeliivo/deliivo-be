# Reactive Domain Events Refactor

## Problem

The web portal was using notifications as both user alerts and state-change signals.

That made the UI feel slow:

1. Driver/rider performs an action.
2. Backend updates the database.
3. Backend creates a notification.
4. Browser receives `notification:new`.
5. Page refetches REST data.
6. UI updates only after the refetch completes.

This was reliable enough for persistence, but not good enough for user experience. Users could think an action failed because the other screen did not update immediately.

## New Design

Notifications and state synchronization are now separated.

Notifications answer:

- What should the user know?
- What should appear in the notification panel or toast?

Domain events answer:

- What changed in the system?
- Which ride or booking status should the UI update immediately?

The new flow is:

1. Driver/rider performs an action through REST.
2. Backend updates the database.
3. Backend emits a domain socket event.
4. Web pages patch local state immediately.
5. Backend still creates user-facing notifications.
6. REST refetch remains as background reconciliation.

## Events Added

### `booking:updated`

Emitted after booking state changes.

Payload:

```ts
{
  bookingId: string;
  rideId: string;
  passengerId?: string;
  status: string;
  previousStatus?: string;
  actor: string;
  action: string;
  updatedAt: string;
}
```

Covered actions:

- Rider creates a booking request.
- Driver accepts booking.
- Driver rejects booking.
- Driver cancels booking after accept.
- Ride starts and confirmed bookings move to pickup state.
- Driver arrives at pickup.
- Rider marks arrived at pickup.
- Pickup OTP is verified.
- Passenger is marked no-show.
- Driver confirms drop-off.
- Rider confirms drop-off.
- Dev pickup simulation.
- Dev drop-off simulation.

### `ride:updated`

Emitted after ride state changes.

Payload:

```ts
{
  rideId: string;
  status: string;
  previousStatus?: string;
  actor: string;
  action: string;
  updatedAt: string;
}
```

Covered actions:

- Ride started.
- Ride finished.

## Frontend Consumers

The following pages now update local state immediately from domain events:

- `/rides`
- `/rides/[id]`
- `/rides/[id]/manage`

These pages still listen to `notification:new` as a fallback/refetch trigger, but visible status changes no longer depend on waiting for REST reload.

## Socket Reliability Notes

The socket layer uses Redis-backed user-to-socket mapping so events can be emitted to users across processes.

Important behavior:

- The browser sends `presence:ping` every 45 seconds.
- Server refreshes socket mapping TTL on heartbeat.
- Server does not filter socket IDs using only the current process's local socket map, because a valid socket may live in another worker/process.

## Cache Consistency Fix

After the domain-event refactor, a manual refresh could still show old state because some volatile detail endpoints were cached:

- Rider ride detail: `GET /api/v1/search-rides/:id`
- Driver ride detail: `GET /api/v1/publish-ride/:id`
- Rider booking detail: `GET /api/v1/bookings/:id`

These endpoints contain live booking/ride status and should not serve 5-minute cached data. They now read directly from the database.

Also, old booking detail cache keys used the shape:

```text
booking:{bookingId}:user:{userId}
```

Some invalidation only deleted:

```text
booking:{bookingId}
```

That missed the actual cached key. Invalidation now deletes `booking:{bookingId}:*` where mutation endpoints still need cache cleanup.

## Final Working Workflow

The working ride/booking update flow is now:

1. User performs an action through REST.
   - Examples: driver accepts booking, driver starts ride, driver arrives, rider confirms drop-off.
2. Backend updates the database.
3. Backend invalidates volatile cache entries related to the ride/booking.
4. Backend emits a domain event:
   - `booking:updated` for booking status changes.
   - `ride:updated` for ride status changes.
5. Open web pages update local state immediately from the domain event.
6. Backend creates the user-facing notification.
7. Web pages may still refetch REST data, but the REST response now reads fresh database state for volatile details.

This fixes both symptoms:

- The other user sees the update quickly without waiting for a full refetch.
- Manual refresh also shows the correct latest state because volatile detail endpoints no longer return stale cache.

## Why Socket Alone Was Not Enough

The socket/domain event could reach the browser correctly, but the page often performed a REST refetch immediately after receiving the event.

Before the cache fix:

1. Socket event updated local state.
2. REST refetch returned stale Redis data.
3. UI was overwritten with the old status.

That made it look like the socket event did not work. The actual issue was stale REST data being used as the final source of truth.

After the cache fix, the socket event and REST refetch agree on the same latest state.

## Initial Booking Request Notification Fix

The initial booking request path also needed separation between payment side effects and notification side effects.

In bypass payment mode, the booking is created as `DRIVER_PENDING` immediately. Previously, driver notification creation lived inside the same `try` block as bypass payment ledger side effects. If payment side effects failed, the booking still succeeded but the driver notification could be skipped.

The bypass flow now:

1. Creates the booking.
2. Attempts bypass payment side effects.
3. Always attempts rider/driver booking request notifications.
4. Emits `booking:updated` with `action: "booking.requested"` to the driver.
5. Enqueues the driver decision deadline check.

The Stripe webhook payment-success path also emits `booking:updated` to the driver after the booking moves from `PAYMENT_PENDING` to `DRIVER_PENDING`.

## Live Tracking and ETA Fix

Driver arrival now also acts as a live-location update when coordinates are supplied.

Before this fix:

- `driver-arrived` changed the booking status.
- It did not write a `locationUpdate` row.
- It did not emit `ride:location`.
- Rider and public tracking maps stayed unchanged until a separate GPS update was submitted.

After this fix:

1. Driver arrives at pickup with lat/lng.
2. Backend stores that location in `locationUpdate`.
3. Backend emits `ride:location`.
4. Driver manage map updates locally.
5. Rider ride-detail map updates from the socket event.
6. Public tracking link reads the same latest location.

ETA display was also added:

- Rider ride-detail page shows ETA to pickup and drop-off when live driver location is available.
- Public tracking page shows ETA to pickup and drop-off.
- ETA is currently straight-line estimated time using a conservative average road speed. It is suitable for dev/testing visibility and can later be replaced with Google Routes/Directions ETA.

## Double Action Protection

Current protection:

- UI disables action buttons while requests are in flight.
- Many backend actions validate the current ride or booking status.
- Ride-operation endpoints use `actionId` and persist ride events for idempotency.

Remaining hardening needed:

- Convert all important state transitions to atomic conditional updates.
- Example pattern:

```ts
await prisma.rideBooking.updateMany({
  where: {
    id: bookingId,
    status: BookingStatus.DRIVER_PENDING,
  },
  data: {
    status: BookingStatus.CONFIRMED,
  },
});
```

If `count === 0`, return the current state or a conflict response. This avoids race conditions from double-clicks, multiple tabs, or repeated network requests.

## Files Changed

- `src/socket/index.ts`
- `src/modules/driver-booking/driver-booking.service.ts`
- `src/modules/driver-booking/driver-booking.controller.ts`
- `src/modules/publish-ride/publish-ride.controller.ts`
- `src/modules/payments/stripe.webhook.controller.ts`
- `src/modules/ride-booking/ride-booking.controller.ts`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/search-ride/search-ride.controller.ts`
- `src/modules/ride-operations/ride-operations.controller.ts`
- `src/modules/ride-operations/ride-operations.service.ts`
- `src/modules/tracking/tracking.service.ts`
- `web/src/lib/socket.ts`
- `web/src/app/rides/page.tsx`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`
- `web/src/app/tracking/[token]/page.tsx`

## Verification

Backend TypeScript:

```powershell
npm.cmd exec tsc -- --noEmit
```

Web TypeScript:

```powershell
cd web
npx.cmd tsc --noEmit
```

Both checks passed after the refactor.
