# Publish Ride Proposal: City-Based Origin/Destination With Pickup/Dropoff Points

## Scope
This is a proposal only. No runtime code changes are included.

Goal from product/screens:
- Driver can select a city as origin (not only a precise point).
- Driver sets exactly one pickup point in the origin city.
- Driver sets exactly one dropoff point in the destination city.

## Current Backend State (Audit)
File reviewed: `src/modules/publish-ride/publish-ride.routes.ts`

What already exists:
- Draft origin endpoint: `POST /draft/origin`
- Draft destination endpoint: `PUT /draft/destination`
- Draft service already supports:
  - `updatePickups(...)`
  - `updateDropoffs(...)`
- Validators already exist:
  - `updatePickupsSchema`
  - `updateDropoffsSchema`
- Publish flow already persists pickup/dropoff waypoints into `RideWaypoint`.

Gap found:
- `publish-ride.routes.ts` does not expose routes for pickups/dropoffs even though controller/service/validator support them.
- Current origin/destination request shape only models exact point input, not "city mode" intent.

## Proposed UX-to-API Flow
Map to your screens:

1. Screen 1: "Where are you leaving from?"
- Select origin city.
- API: `POST /draft/origin`

2. Screen 2-3: "Where would like to pick up co-travellers?"
- Add exactly one pickup point.
- API: `PUT /draft/pickups`

3. Screen 4: "Where are you heading?"
- Select destination city.
- API: `PUT /draft/destination`

4. Screen 5-6: "Where would like to drop off co-travellers?"
- Add exactly one dropoff point.
- API: `PUT /draft/dropoffs`

5. Continue with existing flow
- Compute/select route, stopovers, schedule, capacity, pricing, notes, publish.

## API Contract Proposal

### 1) Expose missing draft waypoint endpoints
Add these route mappings:
- `PUT /draft/pickups` -> `controller.updatePickups` with `updatePickupsSchema`
- `PUT /draft/dropoffs` -> `controller.updateDropoffs` with `updateDropoffsSchema`

No DB schema change required for this step.

### 2) Add city-mode fields to origin/destination (non-breaking)
Keep current required fields for compatibility, and add optional metadata:

Origin payload (extended):
```json
{
  "originPlaceId": "...",
  "originAddress": "London, UK",
  "originLat": 51.5072,
  "originLng": -0.1276,
  "originMode": "CITY",
  "originCityPlaceId": "...",
  "originCityName": "London"
}
```

Destination payload (extended):
```json
{
  "destinationPlaceId": "...",
  "destinationAddress": "Manchester, UK",
  "destinationLat": 53.4808,
  "destinationLng": -2.2426,
  "destinationMode": "CITY",
  "destinationCityPlaceId": "...",
  "destinationCityName": "Manchester"
}
```

Notes:
- `originPlaceId`/`destinationPlaceId` remain the canonical fields for routing and publish.
- City metadata is for product intent, validation policy, and analytics.

### 3) City suggestions
Two implementation options:

Option A (recommended first): reuse existing maps service
- Use current `GET /maps/place/autocomplete?input=...`
- Apply city filtering in API/service (`types=(cities)` or prediction-type filter).

Option B: curated endpoint
- New endpoint: `GET /publish-ride/cities?country=GB&q=lon`
- Returns city list for fast UX and stable ranking.

## Validation Rules Proposal

1. Core
- `pickups` must contain exactly 1 item.
- `dropoffs` must contain exactly 1 item.
- Deduplicate by `placeId`.

2. City-mode requirement
- Origin city must include one pickup point.
- Destination city must include one dropoff point.

3. Geographic safety
- Pickup points must be within the selected origin city boundary (or configurable radius).
- Dropoff points must be within the selected destination city boundary (or configurable radius).

4. Draft progression
- Enforce sequence:
  - origin city -> one pickup -> destination city -> one dropoff

## Data & Matching Impact

1. Publish path
- No change to `Ride` table needed.
- `RideWaypoint` already supports `PICKUP` and `DROPOFF`.

2. Search/matching path
- Existing matching already uses ordered waypoints and supports pickup-before-drop logic.
- This proposal improves waypoint quality from city-focused inputs.

## Backward Compatibility

- Existing clients that only send exact origin/destination continue to work.
- Pickup/dropoff endpoints can be introduced without breaking old flows, but new app flow should enforce single pickup/single dropoff for all rides.
- City metadata fields can be optional until all clients upgrade.

## Rollout Plan

Phase 1 (low risk)
- Wire `PUT /draft/pickups` and `PUT /draft/dropoffs` in `publish-ride.routes.ts`.
- Keep payloads as today.

Phase 2
- Extend origin/destination schema with optional city metadata.
- Add policy checks for all rides.

Phase 3
- Add dedicated city suggestions endpoint (or city-filtered autocomplete).
- Add city-boundary validation for pickup/dropoff points.

## Open Product Decisions

1. Boundary policy
- Strict city polygon vs radius around city center.

2. Route behavior
- Should pickups/dropoffs only represent meeting points,
  or should they also affect route computation as intermediate stops?

## Recommendation

Start with Phase 1 immediately because most backend support already exists and this directly aligns with your UI screens. Then add city-mode metadata and policy checks for all rides as a non-breaking enhancement.
