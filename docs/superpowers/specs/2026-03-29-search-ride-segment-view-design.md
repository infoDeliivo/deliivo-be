# Search Ride Segment View Design

Date: 2026-03-29

## Summary

When a rider searches for rides and the best match is only a segment of the driver's route, the API should stop presenting the driver's full route as if it were the rider's route.

For segment matches:

- Replace the main `origin*` fields in the response with the matched pickup point.
- Replace the main `destination*` fields in the response with the matched drop point.
- Replace the main `basePricePerSeat` with the computed segment fare.

This behavior applies to:

- `GET /search-ride/advanced`
- `GET /search-ride/view/:viewToken` for rider-specific segment details

Full-route matches keep the current response behavior.

## Problem

Today, advanced search can match riders against intermediate route points, but the response still exposes the driver's full `originAddress`, `destinationAddress`, and full-ride `basePricePerSeat` as the primary values.

That creates two user-facing problems:

1. The rider sees the wrong route endpoints.
2. The rider sees the full-ride price instead of the matched segment price.

Example:

- Driver route: `A -> B -> C -> D`
- Cumulative prices:
  - `A = 0`
  - `B = 10`
  - `C = 20`
  - `D = 30`

If the rider is traveling from `B -> C`, the rider-facing response should show:

- origin = `B`
- destination = `C`
- price = `20 - 10 = 10`

It should not show:

- origin = `A`
- destination = `D`
- price = `30`

## Goals

- Return rider-facing segment endpoints for segment matches.
- Return rider-facing segment price for segment matches.
- Keep full-route response behavior unchanged for exact full-route matches.
- Keep ride details consistent with the exact segment selected from search.
- Avoid exposing internal waypoint ordering as a public API contract.

## Non-Goals

- Changing the advanced search matching algorithm itself.
- Changing basic `GET /search-ride` behavior in this phase.
- Redesigning booking flows in this spec.
- Recomputing prices dynamically from map distance during search.

## Match Display Rules

### Full-route match

If the selected match represents the driver's full route:

- keep ride `origin*`
- keep ride `destination*`
- keep ride `basePricePerSeat`

### Segment match

If the selected match represents an intermediate segment:

- overwrite response `origin*` with the matched pickup point
- overwrite response `destination*` with the matched drop point
- overwrite response `basePricePerSeat` with the computed segment fare

The rider should see only the segment they can actually book as the primary route in rider-facing search and details responses.

## Pricing Model

Segment pricing is based on cumulative prices from the driver's route origin.

### Cumulative price rules

- Driver origin cumulative price = `0`
- Stopover cumulative price = stored waypoint `pricePerSeat`
- Driver destination cumulative price = ride `basePricePerSeat`

### Segment fare formula

`segmentFare = dropCumulativePrice - pickupCumulativePrice`

### Worked examples

If the route is `A -> B -> C -> D` with:

- `A = 0`
- `B = 10`
- `C = 20`
- `D = 30`

Then:

- `A -> B = 10 - 0 = 10`
- `B -> C = 20 - 10 = 10`
- `C -> D = 30 - 20 = 10`
- `A -> D = 30 - 0 = 30`

### Fallback rules

- If both matched points resolve to cumulative prices, use the exact difference.
- If a matched stopover does not have a stored cumulative `pricePerSeat`, fall back to full ride `basePricePerSeat`.
- Never return a negative price.
- If the computed difference is invalid, fall back to full ride `basePricePerSeat`.

## Data Model Requirements

The current publish flow does not persist stopover `pricePerSeat` values to `RideWaypoint`. That must change, otherwise segment fare cannot be calculated reliably after publish.

### Required persistence behavior

- `STOPOVER` waypoints must be persisted with cumulative `pricePerSeat`.
- `PICKUP` waypoints do not need DB `pricePerSeat`; they resolve to cumulative `0`.
- `DROPOFF` waypoints do not need DB `pricePerSeat`; destination resolves to ride `basePricePerSeat`.

### Draft pricing contract change

Current `updatePricingSchema` accepts:

- `basePricePerSeat`
- optional `waypointPricing[]` using `waypointId`

That does not fit draft stopovers because draft stopovers do not yet have DB waypoint IDs.

The draft pricing contract should move to a draft-safe identifier, preferably:

- `placeId`, or
- a generated `stopoverKey`

Recommended direction:

- keep `basePricePerSeat`
- replace draft waypoint pricing references from `waypointId` to `placeId`

## Search API Design

### `GET /search-ride/advanced`

For each returned ride:

- full-route match: keep current route fields
- segment match: replace the main `origin*`, `destination*`, and `basePricePerSeat`

For segment matches, the response should carry three separate concerns:

1. rider-facing display fields
2. ride booking identifiers
3. rider-specific details token

The API should not force the client to derive booking or details inputs by parsing the rider-facing route fields.

### Additional response fields for segment matches

Return a small segment metadata block so the client can open details for the exact same segment:

- `isSegmentView: true`
- `viewToken: string`
- `bookingContext`

Optional supporting diagnostics may still be returned if useful:

- `matchType`
- `pickupMatchedPoint`
- `dropMatchedPoint`
- `pickupDistanceKm`
- `dropDistanceKm`

But the primary route and price shown to the client must already be the rider-facing segment values.

### Recommended segment-match response shape

For a segment match, the advanced search response should look conceptually like this:

```json
{
  "id": "ride-uuid",
  "originAddress": "Matched pickup point",
  "destinationAddress": "Matched drop point",
  "basePricePerSeat": 10,
  "isSegmentView": true,
  "viewToken": "opaque-view-token",
  "bookingContext": {
    "rideId": "ride-uuid",
    "pickupWaypointId": "pickup-waypoint-uuid-or-null",
    "dropoffWaypointId": "dropoff-waypoint-uuid-or-null"
  },
  "segment": {
    "pickupCumulativePrice": 10,
    "dropCumulativePrice": 20,
    "segmentFare": 10
  }
}
```

Rules for this shape:

- `id` remains the real published ride id.
- `origin*`, `destination*`, and `basePricePerSeat` are rider-facing display values.
- `bookingContext` carries the identifiers required by the current booking API.
- `viewToken` is only for retrieving the same rider-facing segment details view later.
- `segment` is diagnostic metadata and not the source of truth for booking inputs.

### Booking integration from search results

The current booking API expects:

- `rideId`
- optional `pickupWaypointId`
- optional `dropoffWaypointId`

Therefore, advanced search should return a `bookingContext` block for every segment match so the client can call booking without reverse-engineering identifiers from display fields.

Recommended mapping:

- exact full-route match:
  - `rideId = ride.id`
  - `pickupWaypointId = null`
  - `dropoffWaypointId = null`
- origin to stopover:
  - `pickupWaypointId = null`
  - `dropoffWaypointId = matched stopover waypoint id`
- stopover to stopover:
  - `pickupWaypointId = matched pickup stopover waypoint id`
  - `dropoffWaypointId = matched drop stopover waypoint id`
- stopover to destination:
  - `pickupWaypointId = matched pickup stopover waypoint id`
  - `dropoffWaypointId = null`

This allows advanced search to present rider-specific segment data while preserving the identifiers needed by the booking flow.

### Source of search pricing

Advanced search segment pricing must be derived only from published ride data:

- `Ride.basePricePerSeat`
- persisted `RideWaypoint.pricePerSeat`

It must not depend on draft stopover suggestions or unpublished draft pricing data.

## Ride Details API Design

### `GET /search-ride/view/:viewToken`

Add support for:

- `viewToken`

Behavior:

- valid `viewToken`: resolve the encoded segment and return the rider-facing segment view
- invalid `viewToken`: reject with `400`

The details response for a valid token should mirror the same rider-facing route and price selected from search.

The existing `GET /search-ride/:id` endpoint can remain as the normal full-ride details endpoint.

## `viewToken` Design

`viewToken` should be opaque to clients.

### Token payload

Recommended logical payload:

- `v: 1`
- `rideId`
- `mode: "segment"`
- `pickupRef`
- `dropRef`

### Reference types

- `origin`
- `destination`
- `waypoint:<waypointId>`

Examples:

- `pickupRef = origin`
- `dropRef = waypoint:<uuid>`
- `pickupRef = waypoint:<uuid>`
- `dropRef = destination`

### Token rules

- search generates the token for segment matches
- details resolves the ride id from the token itself
- token must be signed
- invalid or tampered tokens must be rejected with `400`

Recommended implementation:

- encode payload
- sign payload
- verify signature before use

This prevents leaking internal ordering and keeps the public contract stable if matching internals change.

## Segment Resolution Rules

When resolving a segment for search shaping or ride details:

1. Resolve `pickupRef` to a point.
2. Resolve `dropRef` to a point.
3. Resolve cumulative pickup price.
4. Resolve cumulative drop price.
5. Compute `segmentFare = drop - pickup`.
6. If valid, overwrite response `origin*`, `destination*`, and `basePricePerSeat`.
7. If invalid, fall back to full-ride view and full-ride `basePricePerSeat`.

### Point resolution

- `origin` resolves from `Ride.origin*`
- `destination` resolves from `Ride.destination*`
- `waypoint:<waypointId>` resolves from the matching persisted waypoint

### Price resolution

- origin cumulative = `0`
- destination cumulative = `Ride.basePricePerSeat`
- stopover cumulative = `RideWaypoint.pricePerSeat`

## Error Handling

### Search

- If segment price cannot be resolved, do not fail the entire search response.
- Fall back to full-ride `basePricePerSeat`.
- Prefer stable search over partial hard failures.

### Ride details

- invalid `viewToken` -> `400`
- referenced waypoint not found on ride -> `400`
- ride not found -> existing `404`

### Invalid pricing state

If a matched stopover segment cannot resolve to a cumulative price because published data is incomplete:

- do not return a negative or partial computed fare
- fall back to full ride `basePricePerSeat`

## Testing

### Unit tests

- resolve cumulative price for origin
- resolve cumulative price for destination
- resolve cumulative price for stopover
- compute segment fare for origin -> stopover
- compute segment fare for stopover -> stopover
- compute segment fare for stopover -> destination
- invalid segment fare falls back to full ride price
- token encode/decode/verification
- token ride mismatch rejection

### Integration tests

- advanced search exact full-route match keeps full route fields
- advanced search segment match rewrites `origin*`, `destination*`, and `basePricePerSeat`
- advanced search segment match returns `bookingContext` with booking identifiers
- advanced search segment match returns `viewToken`
- ride details with valid `viewToken` returns matching segment view
- ride details with tampered `viewToken` returns `400`

### Example integration case

Published route:

- origin `A`
- stopover `B` with cumulative `10`
- stopover `C` with cumulative `20`
- destination `D` with full-ride `30`

Expected:

- search segment `B -> C` returns origin `B`, destination `C`, price `10`
- details with that segment token returns the same origin `B`, destination `C`, price `10`

## Implementation Notes

The smallest clean implementation path is:

1. Persist cumulative stopover prices during publish.
2. Add a segment resolver helper in `search-ride`.
3. Shape advanced search results through that helper with rider-facing fields, `bookingContext`, and `viewToken`.
4. Add `GET /search-ride/view/:viewToken`.
5. Reuse the same segment resolver for token-based details.
6. Update booking price calculation to use cumulative price difference instead of a single waypoint price.

This keeps one source of truth for segment point and fare calculation.
