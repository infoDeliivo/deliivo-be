# Publish Ride: Price Calculation Guide

This document explains how ride price is calculated in the `publish-ride` module (`/api/v1/publish-ride`).

## 1. Pricing Flow in API

1. `PUT /draft/capacity` stores `totalSeats`, `basePricePerSeat`, and `currency` in the draft.
2. `GET /draft/pricing/recommended` calculates a suggested `basePricePerSeat` from route distance.
3. Client pre-fills `basePricePerSeat` with this suggestion, and user can keep or edit it.
4. `PUT /draft/pricing` stores the final `basePricePerSeat` selected by the driver and optional stopover cumulative pricing keyed by `placeId`.
5. `POST /draft/publish` saves ride to DB with `basePricePerSeat`, `currency`, and stopover waypoint `pricePerSeat` values when present.

## 2. Recommended Price Formula

### Constants used by backend

- `FUEL_EFFICIENCY_KM_PER_LITER` (default `12`, configurable via env)
- `FUEL_PRICE_PER_LITER` is now fetched automatically for UK (`GBP`) from GOV weekly road fuel CSV.
- `PRICE_PER_KM = fuelPricePerLiter / fuelEfficiencyKmPerLiter`

### 2.1 How to get fuel price in UK

Use these sources for automatic `FUEL_PRICE_PER_LITER` retrieval (with Redis cache + fallback):

UK (official):

1. Source page: `https://www.gov.uk/government/statistics/weekly-road-fuel-prices`
2. Download the latest CSV from that page.
3. Read the newest petrol/diesel pump price row.
4. If value is in pence per litre, convert to GBP per litre by dividing by `100`.

Recommended backend handling:

- Store normalized values as `pricePerLiter`, `currency`, `fuelType`, `countryCode`, `effectiveDate`.
- Refresh UK weekly.
- Fallback to a safe default constant if live source is unavailable.

### Inputs

- `distanceKm = routeDistanceMeters / 1000`

### Calculation

- `fuelCost = distanceKm * PRICE_PER_KM`
- `minPrice = round(fuelCost * 0.8)`
- `recommendedPrice = round(fuelCost * 1.5)`
- `maxPrice = round(fuelCost * 2.5)`

`GET /draft/pricing/recommended` returns:

- `recommendedPrice` (used as suggested `basePricePerSeat` for the UI)
- `minPrice`, `maxPrice` (optional guidance range)
- `currency` (draft value, default `GBP`)
- `breakdown.fuelCost` rounded to 2 decimals
- `breakdown.distanceKm` rounded to 1 decimal
- `breakdown.pricePerKm` rounded to 2 decimals

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

## 5. What Is Persisted Today

- On publish, ride row stores `basePricePerSeat`, `currency`, `totalSeats`, and `availableSeats`.
- Stopover waypoints are published with `pricePerSeat` from the draft map when available.
- Missing stopover pricing persists as `null`.

## 6. Downstream Booking Price

Current booking logic uses:

- `totalPrice = ride.basePricePerSeat * seatsBooked`

If a waypoint has `pricePerSeat`, booking can switch to that waypoint price. In current publish flow, waypoint prices are not set, so booking usually uses `basePricePerSeat`.

## 7. Worked Example

If selected route distance is `180 km` and `fuelPricePerLiter = 1.50` with `efficiency = 12`:

- `fuelCost = 180 * 0.125 = 22.5`
- `minPrice = round(22.5 * 0.8) = 18`
- `recommendedPrice = round(22.5 * 1.5) = 34`
- `maxPrice = round(22.5 * 2.5) = 56`

If driver sets `basePricePerSeat = 40` and a stopover is at `90 km` on a `180 km` route:

- `distanceRatio = 90 / 180 = 0.5`
- `stopover pricePerSeat = round(40 * 0.5 * 100) / 100 = 20.00`

## 8. Source of Truth in Code

- `src/modules/publish-ride/draft-ride.service.ts`
- `updateCapacity`, `getRecommendedPrice`, `getStopoversAlongRoute`, `updatePricing`, `publishRide`
- `src/modules/publish-ride/publish-ride.validator.ts`
- `updateCapacitySchema`, `updatePricingSchema`
- `src/modules/publish-ride/publish-ride.routes.ts`
- `GET /draft/pricing/recommended`, `PUT /draft/pricing`
- `src/services/fuel-price.service.ts`
- UK automatic fuel price retrieval and cache logic
- `src/modules/ride-booking/ride-booking.service.ts`
- Booking total calculation (`basePricePerSeat * seatsBooked`)
