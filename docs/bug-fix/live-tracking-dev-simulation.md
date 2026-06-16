# Live Tracking, Sharing Link, and Dev Simulation

## Purpose

This document captures the web and backend changes for testing the ride-day flow without physically travelling between pickup and drop-off points.

The goal is to support:

- Driver live location updates.
- Rider live map updates.
- Public live sharing links.
- Development-only controls for simulating pickup and drop-off for each rider.

## Environment Flags

Enable simulation only in local/development environments:

```env
ALLOW_RIDE_SIMULATION=true
NEXT_PUBLIC_ALLOW_RIDE_SIMULATION=true
```

`ALLOW_RIDE_SIMULATION` is used by the backend.

`NEXT_PUBLIC_ALLOW_RIDE_SIMULATION` is used by the web app to show the dev simulator UI.

Do not enable these in production.

## Live Tracking Flow

When the driver starts a ride:

1. Driver clicks `Start Ride`.
2. Backend moves the ride to `IN_PROGRESS`.
3. Confirmed bookings move to `WAITING_FOR_PICKUP`.
4. Driver web app starts geolocation tracking.
5. Driver location is submitted to:

```http
POST /api/v1/rides/:rideId/locations
```

6. Backend stores the location and emits:

```text
ride:location
```

7. Driver and rider pages listen to this socket event and update the map.

## Fixed Live Tracking Issue

Previously, the backend recorded GPS points but returned/emitted only:

```json
{
  "rideId": "...",
  "recorded": true
}
```

That meant the frontend socket listener did not receive `lat` or `lng`, so the live map could not move.

Now the backend returns/emits:

```json
{
  "rideId": "...",
  "lat": 56.9496,
  "lng": 24.1052,
  "speed": null,
  "heading": null,
  "accuracy": null,
  "timestamp": "2026-06-15T..."
}
```

## Fixed Rider Reopen Issue

Riders could see `Ride not found` when opening a ride they had already booked.

Cause:

- The rider ride detail page uses:

```http
GET /api/v1/search-rides/:rideId
```

- That backend endpoint only returned rides with status:

```text
PUBLISHED
```

- Once a ride was booked, started, or moved into operational states, the ride was no longer considered searchable, so booked riders could not reopen it.

Fix:

- `GET /api/v1/search-rides/:rideId` now accepts the current authenticated viewer.
- It returns ride details when:
  - the ride is still `PUBLISHED`;
  - the viewer is the driver; or
  - the viewer has an active/operational booking for that ride.
- The active booking status list now includes operational statuses such as:

```text
WAITING_FOR_PICKUP
DRIVER_ARRIVED
OTP_PENDING
ONBOARD
DROP_PENDING
DRIVER_DROPPED
COMPLETED
```

The ride-details cache key now includes the viewer id so a booked-rider view is not mixed with another user's ride-detail cache.

## Fixed Ride-Day Action Refresh Issues

Several ride-day actions were succeeding on the backend but not updating the opposite user's screen reliably.

Fixes:

- Driver accept/reject now reloads the authoritative ride payload after the action.
- Driver `Driver arrived` now reloads the ride payload after the backend confirms the booking moved to `DRIVER_ARRIVED`.
- Driver `Confirm drop-off` now sends the booked drop-off coordinates when available and reloads the ride payload.
- Driver `Finish ride` now reloads after completion.
- Rider `I am at pickup point` now shows for full-route bookings as well as segment bookings.
- Rider `I am at pickup point` now shows success/error feedback.
- Rider dev-mode `Simulate pickup arrival` now sends the booked pickup coordinates instead of the tester's home GPS.
- Rider `Confirm I was dropped off` now shows success/error feedback and reloads the ride/booking data.
- `POST /api/v1/rides/:rideId/locations` now returns the full location payload, matching the `ride:location` socket event.

Backend notification fixes:

- Rider arrival at pickup now notifies the driver.
- Pickup OTP verification now notifies the rider that they are onboard.
- Rider drop-off confirmation now notifies the driver.

Expected state flow per rider:

```text
CONFIRMED
  -> WAITING_FOR_PICKUP       (driver starts ride)
  -> DRIVER_ARRIVED           (driver marks arrived)
  -> ONBOARD                  (driver verifies pickup OTP, or dev simulates pickup)
  -> DROP_PENDING             (driver confirms drop-off)
  -> COMPLETED                (rider confirms drop-off, or dev simulates drop-off)
```

Multiple riders can be onboard at the same time. This is valid for a carpool ride. Each booking moves through the lifecycle independently.

## Driver Dev Simulator

The driver manage ride page now shows a dev simulator when:

```env
NEXT_PUBLIC_ALLOW_RIDE_SIMULATION=true
```

For each confirmed rider, the driver can simulate:

- Driver arrived at pickup.
- Pickup completed.
- Drop-off completed.

The simulator uses each booking's real pickup/drop-off waypoint coordinates when available.

Before changing booking state, the web app submits a simulated driver location to the backend so maps update during testing.

## Dev Simulation Backend Endpoints

These endpoints are guarded by:

```env
ALLOW_RIDE_SIMULATION=true
```

### Simulate Pickup

```http
POST /api/v1/bookings/:id/dev-simulate-pickup
```

This moves the booking to:

```text
ONBOARD
```

It records a ride event:

```text
DEV_PICKUP_SIMULATED
```

### Simulate Drop-Off

```http
POST /api/v1/bookings/:id/dev-simulate-dropoff
```

This moves the booking to:

```text
COMPLETED
```

It records a ride event:

```text
DEV_DROPOFF_SIMULATED
```

## Public Live Sharing Link

The backend already had tracking-link support. The web app now exposes it on the rider ride-detail page.

Rider can create/copy a live sharing link after booking is active.

The web app calls:

```http
POST /api/v1/tracking/links
GET /api/v1/tracking/bookings/:bookingId/links
```

The public page is:

```text
/tracking/:token
```

The public page polls:

```http
GET /api/v1/tracking/:token
```

No login is required for the public tracking page.

## Public Tracking Data

The public tracking page shows:

- Ride status.
- Booking status.
- Pickup label.
- Drop-off label.
- Latest driver location.
- Last update time.

It does not expose:

- Rider profile details.
- Driver private contact details.
- Booking controls.
- Payment details.

## Backend Route Fix

The public tracking route must be mounted before the protected tracking router:

```ts
app.use('/api/v1/tracking', publicTrackingRouter);
app.use('/api/v1/tracking', protect, trackingRouter);
```

This ensures shared tracking links work without authentication.

## Local Test Flow

1. Set the simulation flags in `.env`.
2. Rebuild Docker:

```powershell
docker compose down
docker compose up --build
```

3. Driver publishes a ride.
4. Rider 1 books the ride.
5. Rider 2 books the ride.
6. Driver accepts both requests.
7. Driver opens the manage ride page.
8. Driver clicks `Start Ride`.
9. Use the dev simulator:

```text
Rider 1:
Simulate driver arrived
Simulate pickup
Simulate drop-off

Rider 2:
Simulate driver arrived
Simulate pickup
Simulate drop-off
```

10. Rider opens ride detail page and confirms/observes status changes.
11. Rider creates a live sharing link.
12. Open `/tracking/:token` in another browser tab to verify public live tracking.

## Notification Coverage

The web notification stream now covers the initial ride and booking states as well as ride-day operations:

- `ride.published` goes to the driver when a draft ride is published.
- `booking.payment.pending` goes to the rider when Stripe payment must be completed before the request is sent.
- `booking.request.sent` goes to the rider when the request is waiting for the driver, including after Stripe payment success.
- `booking.request.driver_decision` goes to the driver when a rider request needs approval or rejection.
- `booking.payment.failed` goes to the rider when Stripe payment fails.
- `booking.rider.cancelled` goes to the driver when the rider cancels a pending or confirmed booking.

## Start Ride Reliability Fix

The start/finish/ride-operation endpoints now default missing `actionId` and `clientTimestamp` on the backend. This prevents older web builds or manual API calls from failing validation before the ride status update runs.

Docker Compose now passes `ALLOW_RIDE_SIMULATION` explicitly to backend, mail-worker, and sms-worker containers. In local/dev testing this must be:

```env
ALLOW_RIDE_SIMULATION=true
```

With that flag set, the backend allows testing the ride lifecycle before the scheduled departure time.

## Real-Time Ride State Update Design

The web portal now separates user alerts from state synchronization:

1. A driver/rider action updates the database through REST.
2. The service emits a domain event such as `booking:updated` or `ride:updated`.
3. Open ride screens patch local state immediately from that payload.
4. `createNotification` still saves and emits `notification:new` for user-facing alerts.
5. REST reload remains as a background reconciliation path so the database stays the source of truth.

This reduces perceived latency because the visible status changes before the slower list/detail REST refetch completes.

The intermittent bug had two causes:

- Page-level socket listeners could initialize before the authenticated user/token was ready. In that case the global notification toast could connect later, but the page refresh listener was never attached.
- Socket IDs are stored in Redis so any process can emit to them through the Socket.IO Redis adapter. Filtering socket IDs against only the current process's local socket map can drop valid sockets connected to another worker/process.

When either case happened, notifications were still saved in the database but the open rider/driver page did not receive the event that triggers REST reload.

The fix keeps socket mappings alive with a client heartbeat, avoids process-local socket filtering, and registers page listeners only after auth is ready.

## Domain Events Added

- `booking:updated`
  - Emitted after driver accepts/rejects/cancels, driver arrives, rider arrives at pickup, pickup is verified, no-show is marked, drop-off is pending, rider confirms drop-off, and dev pickup/drop-off simulation.
  - Payload includes `bookingId`, `rideId`, `status`, `previousStatus`, `actor`, `action`, and `updatedAt`.
- `ride:updated`
  - Emitted after ride start and ride finish.
  - Payload includes `rideId`, `status`, `previousStatus`, `actor`, `action`, and `updatedAt`.

The web app consumes these in:

- `/rides`
- `/rides/[id]`
- `/rides/[id]/manage`

## Files Changed

- `src/modules/payments/stripe.webhook.controller.ts`
- `src/modules/payments/stripe.webhook.controller.test.ts`
- `src/modules/publish-ride/draft-ride.service.ts`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/ride-operations/ride-operations.service.ts`
- `src/modules/ride-operations/ride-operations.controller.ts`
- `src/modules/ride-operations/ride-operations.routes.ts`
- `src/modules/ride-operations/ride-operations.validator.ts`
- `src/modules/driver-booking/driver-booking.service.ts`
- `src/modules/ride-operations/ride-operations.service.ts`
- `src/socket/index.ts`
- `docker-compose.yml`
- `web/src/lib/socket.ts`
- `web/src/app/rides/page.tsx`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`
- `src/modules/publish-ride/publish-ride.service.ts`
- `src/modules/tracking/tracking.service.ts`
- `src/app.ts`
- `web/src/lib/api.ts`
- `web/src/app/rides/[id]/manage/page.tsx`
- `web/src/app/rides/[id]/page.tsx`
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

Both checks passed after the changes.
