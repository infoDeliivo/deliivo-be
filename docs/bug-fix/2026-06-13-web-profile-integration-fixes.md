# Web Profile Integration Fixes

Date: 2026-06-13

## Scope

This note documents the local development fixes made while testing the web profile area:

- Profile travel preferences
- Vehicle add/list flow
- Vehicle verification bypass for development
- Payment methods
- Stripe Connect and payout mock behavior
- Local development environment handling
- Baltic web branding updates that were part of the same working session
- Published rides tab loading

## Problems Found

### Vehicle add flow

The frontend called `GET /api/v1/vehicles` and expected `res.data` to be an array.

The backend actually returns:

```json
{
  "data": {
    "vehicles": [],
    "pagination": {}
  }
}
```

This made a newly saved vehicle appear as if it had not been added.

### Vehicle verification in local testing

Vehicle verification is an admin/manual trust step. For local testing, the web portal needs to continue with a mocked or bypassed verification path until Veriff integration is finalized.

### Uploads in development

The S3 upload service already has a local disk fallback when S3 is not configured. The root `.env` previously contained placeholder AWS values, which made the backend attempt S3 uploads instead of using local fallback.

### Payment methods

The frontend used incorrect routes:

```text
/api/v1/payments/methods
/api/v1/payments/setup-intent
```

The backend mounts payment methods at:

```text
/api/v1/payment-methods
```

Also, after Stripe confirmed the card setup, the frontend did not call the backend `save` endpoint, so confirmed cards were not persisted.

### Stripe Connect and payouts

The earnings page expected a driver payout request endpoint:

```text
POST /api/v1/drivers/me/payouts/request
```

That route did not exist.

Stripe Connect also needed a development mock mode so profile payout screens can be tested before real Connect onboarding details are provided.

### Travel preferences

The travel preference frontend and backend validator used old enum values:

```text
LOW, MEDIUM, HIGH
YES, NO, SOMETIMES
```

The Prisma schema uses:

```text
quiet, chatty_when_comfortable, chatterbox
love_pets, depends_on_animal, no_pets
```

### Published rides tab

The Published rides tab could show:

```text
Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

The frontend API wrapper parsed every response as JSON. If the Next.js proxy or backend returned an HTML error page, the JSON parser error was surfaced directly.

The Published rides client type also expected `data` to be an array, while the backend returns a paginated object:

```json
{
  "data": {
    "rides": [],
    "pagination": {}
  }
}
```

Clicking a published ride then failed because the ride details page called the singular search route:

```text
GET /api/v1/search-ride/:id
```

The backend mounts the search routes at:

```text
/api/v1/search-rides
```

The ride details page also expected price preview fields named `baseFare`, `total`, and `currency` at the top level. The backend returns them inside `priceBreakdown` as `subtotal`, `totalPrice`, `serviceFee`, and `currency`.

### Booked rides discoverability

The booked rides screen already loaded the user bookings, but the UI did not make the booking list easy to scan or the ride details path explicit enough. The card itself was clickable, but there was no visible details CTA and no status filter for users who expected to see only active, pending, or completed rides.

## Changes Made

### Frontend API client

File: `web/src/lib/api.ts`

- Vehicle list response type now matches `{ vehicles, pagination }`.
- Published rides response type now matches `{ rides, pagination }`.
- API responses are parsed defensively so HTML proxy/backend error pages produce a useful API error instead of a raw JSON parser crash.
- Search rides endpoints now use `/api/v1/search-rides` instead of `/api/v1/search-ride`.
- Price preview type now matches the backend `priceBreakdown` response.
- Payment methods now call:
  - `GET /api/v1/payment-methods`
  - `POST /api/v1/payment-methods/setup-intent`
  - `POST /api/v1/payment-methods/save`
  - `POST /api/v1/payment-methods/:id/default`
  - `DELETE /api/v1/payment-methods/:id`
- API errors now read either `message` or `error`.
- Travel preference types now match Prisma enum values.

### Vehicle page

File: `web/src/app/profile/vehicle/page.tsx`

- Reads vehicle list from `res.data.vehicles`.
- Defaults licence country to `EE`.
- Resets licence country back to `EE` after saving.

### Publish ride vehicle selector

File: `web/src/app/publish/page.tsx`

- Reads vehicle list from `res.data.vehicles`.
- Fixes the Next.js build error where the publish flow tried to assign the full `{ vehicles, pagination }` object into `Vehicle[]` state.

### Rides page

File: `web/src/app/rides/page.tsx`

- Published rides now reads from `res.data.rides`.
- The tab no longer relies on the old array response fallback.

### Ride details page

File: `web/src/app/rides/[id]/page.tsx`

- Booking price preview now reads `preview.priceBreakdown`.
- Total, subtotal, service fee, and luggage fee display from the backend response shape.
- Existing rider bookings suppress the duplicate "Book this ride" request panel.

### Rides overview page

File: `web/src/app/rides/page.tsx`

- Booked rides now have explicit status filters: All, Active, Pending, Completed, and Cancelled.
- Each booked ride card now has a visible `Open details` button instead of relying on the whole card being clickable.
- Published rides also now have a visible details/manage button for consistency.
- Empty states now distinguish between "no rides at all" and "nothing in the selected filter".

### Booked rides API stability

Files:

- `src/modules/ride-booking/ride-booking.service.ts`
- `src/modules/ride-booking/ride-booking.controller.ts`

Changes:

- Removed the nested Prisma `orderBy` on the bookings list query and sort bookings in memory instead.
- The bookings list endpoint now logs the underlying error server-side.
- In non-production, the bookings list error response includes the underlying error message so frontend issues are easier to diagnose.

### Booking side effects in bypass mode

File: `src/modules/ride-booking/ride-booking.service.ts`

- Booking creation now keeps the reservation successful if bypass-mode payment side effects fail.
- Stripe-mode payment creation/update is wrapped so a post-reservation failure rolls back the temporary booking state and releases seats.

### Driver manage ride actions

Files:

- `web/src/app/rides/[id]/manage/page.tsx`
- `web/src/lib/api.ts`

Changes:

- Added a visible `Cancel Ride` action to the manage ride page.
- Added a concise ride summary with request count, passenger count, status, and ride ID.
- Booking request cards now label the rider side correctly and show the booking id.
- Added the missing `publishRideApi.cancelRide()` client method.

### API proxy and 404 responses

Files:

- `web/src/app/api/proxy/[...path]/route.ts`
- `src/app.ts`

Changes:

- The web proxy forwards `Accept: application/json`.
- If the backend returns HTML, the proxy converts it to JSON with the target URL and response snippet.
- Backend `/api/*` misses now return JSON instead of Express default HTML.

### Payment methods page

File: `web/src/app/profile/payment-methods/page.tsx`

- After `stripe.confirmCardSetup`, extracts `setupIntent.payment_method`.
- Calls `paymentMethodsApi.save(paymentMethodId, customerId)`.
- Shows a clear setup message if `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is missing.

### Stripe helper

File: `web/src/lib/stripe.tsx`

- Added `isStripeConfigured()` so pages can detect whether the publishable key is present.

### Vehicle verification bypass

File: `src/modules/vehicles/draft-vehicle.service.ts`

- Added `SKIP_VEHICLE_VERIFICATION=true` support.
- In development, vehicles saved from draft are marked `isVerified=true`.

### Driver licence verification bypass

File: `src/modules/driver-booking/driver-booking.service.ts`

- Driver booking accept now respects `SKIP_DL_VERIFICATION=true`.

### Ride lifecycle realtime updates

Files:

- `src/socket/index.ts`
- `web/src/lib/socket.ts`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`

Changes:

- Added ride room join/leave events so ride pages can subscribe to `ride:{rideId}` broadcasts.
- Changed the web socket helper to reconnect the existing socket instance instead of replacing it, which preserves event listeners across reconnects.
- Rider and driver ride screens now join the active ride room on mount and rejoin after socket reconnects.
- Rider ride details now fetch the full booking record for the current ride before rendering OTP and segment details.
- Driver manage ride page now reloads itself when ride-scoped notifications arrive.

### Pickup arrival evidence

Files:

- `src/modules/ride-operations/ride-operations.service.ts`
- `src/modules/ride-operations/ride-operations.controller.ts`
- `src/modules/ride-operations/ride-operations.routes.ts`
- `web/src/lib/api.ts`
- `web/src/app/rides/[id]/page.tsx`
- `web/src/app/rides/[id]/manage/page.tsx`

Changes:

- Added `POST /api/v1/bookings/:id/rider-arrived` so riders can mark that they reached the pickup point.
- Driver arrival and rider arrival now capture optional GPS coordinates, compute distance to the resolved pickup waypoint, and store the evidence in `RideEvent.metadataJson`.
- The rider booking page now shows the exact pickup point card and an `I am at pickup point` action when the booking is at the pickup stage.
- The driver manage page now sends the driver’s current location with the `Driver arrived` action when GPS is available.

### Driver ride lifecycle page review

Files:

- `src/modules/publish-ride/publish-ride.service.ts`
- `src/modules/ride-operations/ride-operations.service.ts`
- `web/src/app/rides/[id]/manage/page.tsx`
- `web/src/lib/api.ts`

Changes:

- Driver ride detail responses now include operational booking states after ride start, so passengers no longer disappear after refresh.
- The driver OTP UI now uses the ride-operations pickup OTP endpoint, which accepts `WAITING_FOR_PICKUP` and `DRIVER_ARRIVED` bookings.
- The pickup OTP input now expects the backend-generated 6-digit OTP.
- The driver page now shows OTP verification only for bookings that are actually at pickup stage.
- The passenger card now keeps lifecycle states visible, including `DROP_PENDING`, `NO_SHOW`, `DRIVER_MISSED_PICKUP`, and `COMPLETED`.
- Added a normal driver-side `Confirm drop-off` action for onboard passengers, instead of relying on the dev simulator.
- `ALLOW_RIDE_SIMULATION=true` now bypasses the 10-minute no-show wait for local test runs while keeping the production wait rule intact.
- The rider ride details page now uses a single combined route/live-location map instead of rendering separate route and live-driver map cards.

### Stripe Connect mock mode

File: `src/modules/payments/stripe.connect.controller.ts`

- Added `STRIPE_CONNECT_MOCK_MODE=true`.
- Connect status returns a connected mock account.
- Connect onboarding returns a local profile earnings URL instead of calling Stripe.

### Payout request route

Files:

- `src/modules/payout/payout.controller.ts`
- `src/modules/payout/payout.routes.ts`
- `src/modules/payout/payout.service.ts`

Added:

```text
POST /api/v1/drivers/me/payouts/request
```

In mock mode, payout processing avoids Stripe transfers and records a mock transfer ID.

### Payment method backend safety

Files:

- `src/modules/payment-methods/payment-methods.service.ts`
- `src/modules/payment-methods/payment-methods.controller.ts`

Changes:

- `setDefaultPaymentMethod` now checks ownership with `findFirst`.
- Updates by unique `id` only.
- Handles `PAYMENT_METHOD_NOT_FOUND`.
- Detach from Stripe is skipped when `STRIPE_PAYMENT_METHODS_MOCK_MODE=true`.

### Travel preference enums

File: `src/modules/travel-preferences/travelPreference.types.ts`

Updated enum values to match Prisma.

File: `web/src/app/profile/page.tsx`

Updated dropdown values and display labels to match backend/Prisma values.

### Development environment

Files:

- `.env`
- `.env.example`
- `docker-compose.yml`

Changes:

- `docker-compose.yml` now loads `env_file: .env`.
- `NODE_ENV` is now controlled by `.env` for app services.
- Root `.env` is local-development oriented:
  - `NODE_ENV=development`
  - `LOG_LEVEL=debug`
  - `SMS_MOCK_MODE=true`
  - `EXPOSE_OTP_IN_RESPONSE=true`
  - `GOOGLE_MAPS_MOCK_MODE=true`
  - `SKIP_DL_VERIFICATION=true`
  - `SKIP_VEHICLE_VERIFICATION=true`
  - `STRIPE_CONNECT_MOCK_MODE=true`
- AWS S3 values are blank in local `.env`, enabling local upload fallback.
- Stripe test keys were added to `.env`.

## Current Local Testing Notes

Restart Docker after env or backend changes:

```powershell
cd D:\projects\carpooling-be
docker compose down
docker compose up --build
```

Install frontend dependencies if missing:

```powershell
cd D:\projects\carpooling-be\web
npm.cmd install
```

## Expected Behavior After Restart

- Profile travel preferences should save.
- Adding a vehicle should persist and display in the vehicle list.
- Saved vehicles should appear verified in local development.
- Avatar and vehicle document uploads should use local `uploads/` fallback when S3 is blank.
- Payment methods page should render Stripe Elements if `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set.
- Saved cards should persist after Stripe setup confirmation.
- Earnings page should show a mocked connected Stripe account when `STRIPE_CONNECT_MOCK_MODE=true`.
- Payout request should hit `POST /api/v1/drivers/me/payouts/request`.
- Published rides should call `GET /api/v1/publish-ride` and render `data.rides`.
- Booking should show a TOS acceptance checkbox when `tosAcceptedAt` is missing, and the accept-TOS endpoint now refreshes cached user/profile payloads immediately.
- Booking create errors now surface their underlying cause in non-production, and `INVALID_RIDE_DEPARTURE_TIME` is mapped explicitly.
- Booking requests now include the backend expiry selector (`responseExpiryOption`) and rider booking details show the active request state, decision deadline, booked segment, and withdrawal/cancel actions.
- Driver manage ride now loads `GET /api/v1/publish-ride/:id` so pending requests, passenger details, segment metadata, and driver actions are shown from the driver-owned ride payload instead of the passenger bookings list.
- Real-time notification toasts now listen to the backend socket event name `notification:new`, matching the payload emitted by the notification service.
- Rider pending-request cancellation now uses the backend withdraw flow with an optional reason prompt; the generic cancel action is reserved for accepted bookings.
- Added a real notifications inbox page at `/profile/notifications`, a global unread badge in the navbar, and realtime toast handling for booking alerts.
- Rider pending-request cancellation now uses the general cancel endpoint with an optional reason, so `PENDING`, `PAYMENT_PENDING`, and `DRIVER_PENDING` bookings can be cancelled from the UI consistently.
- Driver rejection of pending booking requests now opens a reason dialog with preset options and custom text, matching the backend validator and ensuring rider notifications are sent with a populated reason.
- Published rides now have status filters on the rides page (`All`, `Pending`, `Active`, `Completed`, `Cancelled`) so drivers can scan their current and historical rides faster.
- Notification inbox cards now use a balanced desktop width, show route and schedule details when available, and render a direct `Open ride` link from backend notification metadata.
- Driver and ride-booking notification payloads now include route details so the inbox can show meaningful context instead of just truncated IDs.
- Ride start now enforces the scheduled departure time in production, while dev mode still allows simulation from home for testing.
- Added explicit ride simulation flag support via `ALLOW_RIDE_SIMULATION=true` and exposed it to the web app as `NEXT_PUBLIC_ALLOW_RIDE_SIMULATION`.
- Web notifications now bridge the existing Socket.IO `notification:new` event into browser-level alerts when the user grants notification permission.
- Added Firebase web push registration for browser users: the web app can request an FCM token, register it through `POST /api/v1/notifications/device-token` with platform `web`, and receive background notifications through `web/public/firebase-messaging-sw.js`.
- Docker and `.env.example` now include the `NEXT_PUBLIC_FIREBASE_*` build-time values required for browser FCM; backend Firebase service-account values remain separate and are only used by the API/worker side.
- Live driver tracking now emits the full location payload (`lat`, `lng`, `timestamp`, etc.) after `POST /api/v1/rides/:rideId/locations`, so rider and driver maps can actually move from the `ride:location` socket event.
- Added dev-only ride simulation endpoints guarded by `ALLOW_RIDE_SIMULATION=true`: driver pickup simulation and drop-off simulation advance bookings through the real lifecycle without requiring physical travel or OTP entry.
- Driver manage ride dev controls now jump the simulated driver marker to each rider pickup/drop-off coordinate and submit that location to the backend before changing booking state.
- Rider ride details now expose the existing tracking-link backend flow, allowing riders to create/copy a read-only live sharing link.
- Added public web tracking page at `/tracking/:token` and mounted the public tracking route before the protected tracking router so shared links work without login.

## Verification Performed

Backend TypeScript compilation completed before `prisma generate`.

`prisma generate` failed in the sandbox because Prisma attempted to download a Windows engine binary and network access was refused:

```text
request to https://binaries.prisma.sh/.../schema-engine.exe.gz.sha256 failed
```

The web build was not run because `web/node_modules` was not installed in the workspace.
