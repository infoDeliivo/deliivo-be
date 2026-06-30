# Publish Ride: Price Calculation Guide

This document explains how ride price is calculated in the `publish-ride` module (`/api/v1/publish-ride`).

## 1. Pricing Flow in API

1. `PUT /draft/capacity` stores `totalSeats`, `basePricePerSeat`, and `currency` in the draft.
2. `GET /draft/pricing/recommended` calculates a suggested `basePricePerSeat` from route distance.
3. Client pre-fills `basePricePerSeat` with this suggestion, and user can keep or edit it.
4. `PUT /draft/pricing` stores the final `basePricePerSeat` selected by the driver and optional stopover cumulative pricing keyed by `placeId`.
5. `POST /draft/publish` saves ride to DB with `basePricePerSeat`, `currency`, and stopover waypoint `pricePerSeat` values when present.

## 2. Recommended Price Formula

### Current implementation

The publish recommendation is now distance-rate-based.

1. If an active pricing config exists for the ride region, the backend uses:
   - `minRatePerKm`
   - `recommendedRatePerKm`
   - `maxRatePerKm`
   - `minimumSeatPrice`
   - `roundingStrategy`
2. If no pricing config exists, the publish recommendation falls back to a built-in Baltic default:
   - `minRatePerKm = 0.06`
   - `recommendedRatePerKm = 0.08`
   - `maxRatePerKm = 0.12`
   - `minimumSeatPrice = 3.00`
   - `roundingStrategy = NEAREST_EURO`

### Operational source of truth

The distance-rate values are not currently read from `.env`.

Current precedence:

1. Active `PricingConfig` row in the database for the target region
2. Built-in fallback config in code for `BALTIC`

This means:

- `.env` is not where `minRatePerKm`, `recommendedRatePerKm`, `maxRatePerKm`, or `minimumSeatPrice` are controlled
- production should have an active DB pricing config so pricing is admin-managed and not dependent on the code fallback

Recommended production config for `BALTIC`:

- `currency = EUR`
- `minRatePerKm = 0.06`
- `recommendedRatePerKm = 0.08`
- `maxRatePerKm = 0.12`
- `minimumSeatPrice = 3.00`
- `roundingStrategy = NEAREST_EURO`

### Inputs

- `distanceKm = routeDistanceMeters / 1000`

### Calculation

- `rawRecommended = distanceKm * recommendedRatePerKm`
- `rawMin = distanceKm * minRatePerKm`
- `rawMax = distanceKm * maxRatePerKm`
- `recommendedPrice = max(minimumSeatPrice, rounded(rawRecommended))`
- `minPrice = max(minimumSeatPrice, rounded(rawMin))`
- `maxPrice = max(minimumSeatPrice, rounded(rawMax))`

`GET /draft/pricing/recommended` returns:

- `recommendedPrice` (used as suggested `basePricePerSeat` for the UI)
- `minPrice`, `maxPrice` (optional guidance range)
- `currency = EUR`; pricing configuration rejects other currencies
- `breakdown.estimatedRouteCost` rounded to 2 decimals
- `breakdown.distanceKm` rounded to 1 decimal
- `breakdown.pricePerKm` rounded to 2 decimals
- `breakdown.pricingStrategy = DISTANCE_RATE_V1`

## 3. Stopover Price Calculation

### 3.1 Suggested stopover price (`GET /draft/stopovers/suggestions`)

If `basePricePerSeat` exists, each suggested stopover gets:

- `distanceRatio = distanceFromOriginKm / routeDistanceKm`
- `pricePerSeat = round(basePricePerSeat * distanceRatio * 100) / 100`

### 3.2 Recommended stopover price (`GET /draft/pricing/recommended`)

For each selected stopover in the draft:

- `distFromOriginKm` is computed using Haversine distance from origin and rounded to 1 decimal.
- `ratio = distFromOriginKm / distanceKm`
- `stopRecommendedPrice = round(recommendedPrice * ratio * 100) / 100`
- Results are sorted by `distanceFromOriginKm` ascending.

### 3.3 Draft stopover pricing storage (`PUT /draft/pricing`)

- The draft stores cumulative stopover pricing in `stopoverPricingByPlaceId`.
- The request payload uses `stopoverPricing[]`, each entry keyed by `placeId`.
- This is draft-safe and survives until publish without depending on database waypoint IDs.

## 4. Validation and Errors

- `basePricePerSeat` must be positive (`updateCapacitySchema`, `updatePricingSchema`).
- `GET /draft/pricing/recommended` requires a selected route.
- If route distance is missing: `ROUTE_REQUIRED_FOR_PRICING` (400).
- If draft is missing: `DRAFT_NOT_FOUND` (404).
- `POST /draft/publish` requires both `totalSeats` and `basePricePerSeat`.
- Missing values on publish: `CAPACITY_AND_PRICING_REQUIRED` (400).

## 5. Recommendation and validation

There are two distance-based pricing layers in the current system:

1. Publish recommendation in the draft flow
   - Used by `GET /draft/pricing/recommended`
   - Produces `minPrice`, `recommendedPrice`, `maxPrice`, and a breakdown for the UI
   - Uses the pricing module when config exists, or a built-in Baltic fallback when it does not

2. Region pricing validation in the pricing module
   - Uses pricing configuration with `minRatePerKm`, `recommendedRatePerKm`, `maxRatePerKm`, `minimumSeatPrice`, and a rounding strategy
   - This is the stricter distance-based rule set used to validate whether a published ride price is acceptable for a region when such config exists
   - If no pricing config exists for a route region, publish currently allows the ride without blocking on strict validation

Alignment summary:

- Both systems are distance-aware.
- The publish recommendation translates distance into a suggested seat price.
- The pricing module validates the selected seat price against an allowed range.
- In practice, recommendation is guidance, while pricing config validation is enforcement when configured.

## 6. What Is Persisted Today

- On publish, ride row stores `basePricePerSeat`, `currency`, `totalSeats`, and `availableSeats`.
- Stopover waypoints are published with `pricePerSeat` from the draft map when available.
- Missing stopover pricing persists as `null`.

## 7. Downstream Booking Price

Current booking logic uses:

- `subtotal = ride.basePricePerSeat * seatsBooked`
- `serviceFee = subtotal * PLATFORM_FEE_PERCENT / 100` when configured, otherwise `0`
- `luggageFee = 0`; luggage is capacity information and never a surcharge
- `totalPrice = subtotal + serviceFee`

If a waypoint has `pricePerSeat`, booking can switch to that waypoint price. In current publish flow, waypoint prices are not set, so booking usually uses `basePricePerSeat`.

## 8. Worked Example

If selected route distance is `180 km` and the active config is:

- `minRatePerKm = 0.06`
- `recommendedRatePerKm = 0.08`
- `maxRatePerKm = 0.12`
- `minimumSeatPrice = 3`
- `roundingStrategy = NEAREST_EURO`

Then:

- `rawMin = 180 * 0.06 = 10.8` → `11`
- `rawRecommended = 180 * 0.08 = 14.4` → `14`
- `rawMax = 180 * 0.12 = 21.6` → `22`

If driver sets `basePricePerSeat = 40` and a stopover is at `90 km` on a `180 km` route:

- `distanceRatio = 90 / 180 = 0.5`
- `stopover pricePerSeat = round(40 * 0.5 * 100) / 100 = 20.00`

## 9. Source of Truth in Code

- `src/modules/publish-ride/draft-ride.service.ts`
- `updateCapacity`, `getRecommendedPrice`, `getStopoversAlongRoute`, `updatePricing`, `publishRide`
- `src/modules/publish-ride/publish-ride.validator.ts`
- `updateCapacitySchema`, `updatePricingSchema`
- `src/modules/publish-ride/publish-ride.routes.ts`
- `GET /draft/pricing/recommended`, `PUT /draft/pricing`
- `src/modules/pricing/pricing.calculator.ts`
- Distance-based allowed-range calculation from pricing config
- `src/modules/pricing/pricing.service.ts`
- Config lookup, preview generation, and validation snapshots
- `src/modules/ride-booking/ride-booking.service.ts`
- Booking total calculation (`subtotal + serviceFee`, with no luggage surcharge)
