# PRD: Ride Publishing, Search, And Booking

## Purpose

Let drivers publish multi-stop rides and let riders search, inspect, request, and pay for seats across the correct route segment.

## Users

- Driver: publishes rides, reviews booking requests, confirms or rejects riders.
- Rider: searches rides, selects a segment, accepts terms, pays, and waits for driver confirmation.
- Admin: investigates booking failures, capacity issues, and payment exceptions.

## Current Capabilities

- Ride publishing with route and waypoint information.
- Search ride APIs and web search screens.
- Ride details screen for riders and drivers.
- Segment-aware booking using pickup and dropoff waypoints.
- Booking request expiry support.
- Driver approval, rejection, and cancellation flows.
- Payment method selection or inline card collection during booking.
- Terms and privacy acceptance during booking.

## Functional Requirements

- Drivers can create a ride with origin, destination, stopovers, schedule, seat count, and pricing.
- Drivers can publish ride preferences including women-only, no smoking, no bicycles, and child-seat availability.
- The system computes and stores segment capacity for each route section.
- Riders can search available published rides by route and date.
- Riders can open ride details from search results or booked rides.
- Riders can reopen booked ride details across the full booking lifecycle, including completed, cancelled, failed-payment, no-show, missed-pickup, and disputed bookings.
- Riders can see ride preference flags before booking.
- Search result cards must show driver trust signals before booking, including driver rating, successful driver rides, successful rider rides, and a clear profile link.
- Riders can browse booked rides by grouped status with backend pagination.
- Drivers can browse published rides by grouped status with backend pagination.
- Riders must accept terms and privacy policy before booking.
- Riders must have a usable card or provide card details during booking.
- Booking and booked-ride panels must show a clear price breakdown: price per seat, fare subtotal, service fee, luggage fee when present, and total.
- Booking requests enter a driver-pending state after payment is confirmed or prepared according to the configured payment mode.
- Drivers can approve or reject booking requests with reason capture for negative actions.
- Driver accept/reject actions must guard against repeated clicks and clearly tell the driver when a request has already moved out of pending state.
- Riders receive immediate feedback for booking, payment retry, cancellation, pickup arrival, drop-off confirmation, issue reporting, and rating actions.
- Booking request expiry must be enforced by backend jobs and reflected in UI state.
- State changes must trigger persisted notifications and realtime updates where supported.

## Non-Functional Requirements

- Capacity changes must be transactionally safe against concurrent bookings.
- Booking APIs must be idempotent or protected against double-submit.
- UI must show immediate pending or loading states after booking actions.
- List endpoints must support status groups without requiring clients to overfetch and filter locally.
- Ride detail APIs must return JSON for all expected web routes and never fall through to HTML pages.

## Success Metrics

- Search-to-detail open rate.
- Detail-to-booking request conversion.
- Booking request approval rate.
- Booking failure rate by validation, payment, and capacity reason.
- Expired request rate.

## Code References

- `src/modules/publish-ride`
- `src/modules/search-ride`
- `src/modules/ride-booking`
- `src/modules/driver-booking`
- `src/modules/pricing`
- `web/src/app/publish`
- `web/src/app/search`
- `web/src/app/rides/[id]`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#publish-ride-flow` and `../../07-architecture-and-flow-diagrams.md#search-and-booking-flow`.
- See `../../08-feature-decisions-bottlenecks.md#ride-publishing-search-and-booking` for final decisions, open questions, and bottlenecks.
