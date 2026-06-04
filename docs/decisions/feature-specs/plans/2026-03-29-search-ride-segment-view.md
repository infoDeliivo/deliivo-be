# Search Ride Segment View - Plain Replan

## Goal
Return segment-based ride results (for stopover-to-stopover searches) with exposing raw `segmentId` in search query params.

## Core Rule
accept or require `segmentId` in `GET /search-rides/advanced` query params.

Use only:
- search coordinates/date/radius filters in query params
- opaque `segmentId` from search response for segment details
- `rideId + pickupWaypointId + dropoffWaypointId` for booking

## API Behavior (Plain)
1. Client calls advanced search with normal query filters.
2. Backend detects matched segment (pickup/drop waypoint).
3. Backend returns rider-facing segment data:
- matched origin/destination
- segment fare
- `segmentId` (opaque signed token)
- booking context
4. Client calls ride details endpoint with segment query:
- `GET /search-rides/:rideId?segmentId=<opaque-segment-id>`
5. Booking endpoint continues with explicit booking context values, not query `segmentId`.

## What to Change
- Keep `segmentId` out of search query validation and controllers.
- Generate `segmentId` server-side from resolved segment.
- Resolve segment details by decoding/verifying `segmentId`.
- Preserve booking contract using waypoint IDs.

## Minimal Implementation Tasks
- [ ] Task 1: Advanced search
  - Return segment-shaped result return the semantch data with full ride key by sengamenst value not add any extar key aonl is segemsnt galse or sengenst id  when match is stopover segment , make .
  - Verify: response has segment fields and no need for query `segmentId`.

- [ ] Task 2: Segment-id details
  - Use `segmentId` query on ride details endpoint.
  - Decode signed segment id and resolve rider-facing segment ride.
  - Verify: details endpoint returns same segment selected in search.

- [ ] Task 3: Booking pricing
  - Use cumulative fare difference between pickup/drop points.
  - Reject invalid segment combinations with `400`.
  - Verify: B->C, C->D valid; invalid order fails.

- [ ] Task 4: Query-param hardening
  - Do not add `segmentId` to search query schema.
  - Ignore/reject unexpected query `segmentId` (project policy).
  - Verify: search works without it; docs/examples do not use it.

## Testing Checklist
- [ ] Advanced search test: segment output has `segmentId`, segment fare, booking context.
- [ ] Segment-id signature test: valid id passes, tampered id fails.
- [ ] Details-by-segmentId test: returns correct segment ride.
- [ ] Booking test: fare = cumulative(drop) - cumulative(pickup).

## Done When
- Segment search works end-to-end without requiring `segmentId` in search filters.
- Segment details are accessed using `segmentId`.
- Booking uses waypoint context and correct segment fare.
