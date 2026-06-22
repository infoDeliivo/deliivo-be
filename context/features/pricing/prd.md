# PRD: Pricing

## Purpose

Provide transparent ride pricing for Baltic carpooling while preserving backend validation for driver-selected prices and enough financial detail for booking, payments, payouts, and reconciliation.

## Users

- Driver: sees a recommended fare, selects a valid price, and publishes with pricing clarity.
- Rider: sees upfront segment, luggage, service fee, and total price before booking.
- Admin: reviews active pricing configuration and financial outcomes.

## Current Capabilities

- Protected pricing API mounted at `/api/v1/pricing`.
- `POST /api/v1/pricing/price-preview` calculates min, recommended, and max price per seat from distance and active region config.
- `POST /api/v1/pricing/validate` validates a selected price and creates a `RidePricingSnapshot`.
- `GET /api/v1/pricing/configs` lists active pricing configs.
- Admin pricing management is available through `/api/v1/admin/pricing/configs` for list, create, and update workflows.
- Default pricing region is `BALTIC`.
- `PricingConfig` stores region, currency, min/recommended/max rate per km, minimum seat price, rounding strategy, active flag, and validity window.
- `RidePricingSnapshot` stores an immutable pricing snapshot per ride.
- Publish-draft recommended price uses fuel price, fuel efficiency, route distance, and fuel-cost multipliers.
- Booking price uses segment fare, seat count, luggage fee, and optional platform service fee.

## Functional Requirements

- The system can calculate a recommended price per seat for a distance using the active pricing config.
- The system can validate a driver's selected price against min and max allowed values.
- A valid selected price creates one pricing snapshot per ride.
- If no active pricing config exists for a region, pricing preview and validation return `PRICING_CONFIG_NOT_FOUND`.
- Publish flow can request fuel-based recommended pricing from `/api/v1/publish-ride/draft/pricing/recommended`.
- Publish flow stores `basePricePerSeat`, `currency`, and optional stopover cumulative prices in the draft.
- Published rides persist `basePricePerSeat`, `currency`, and waypoint `pricePerSeat` values when provided.
- Booking price preview and booking creation use the resolved rider segment fare.
- Booking total includes `subtotal`, luggage fee, optional platform service fee, and currency.

## Implemented Pricing Rules

- Config-based pricing:
  - `recommendedPricePerSeat = max(minimumSeatPrice, rounded(distanceKm * recommendedRatePerKm))`
  - `minAllowedPricePerSeat = max(minimumSeatPrice, rounded(distanceKm * minRatePerKm))`
  - `maxAllowedPricePerSeat = max(minimumSeatPrice, rounded(distanceKm * maxRatePerKm))`
- Supported rounding strategies:
  - `NEAREST_EURO`
  - `NEAREST_HALF_EURO`
  - default fallback rounds to two decimals
- Publish-draft fuel recommendation:
  - `pricePerKm = fuelPricePerLiter / FUEL_EFFICIENCY_KM_PER_LITER`
  - `fuelCost = distanceKm * pricePerKm`
  - min, recommended, and max are `0.8x`, `1.5x`, and `2.5x` fuel cost
- Fuel price country mapping:
  - `GBP` maps to `GB`
  - `INR` maps to `IN`
  - all other currencies, including `EUR`, map to `EE` as Baltic fallback

## Current Gaps

- Pricing config create/update routes are not implemented in the exposed pricing router.
- Baltic live fuel source is not implemented; EUR currently uses the `EE` fallback fuel price.
- The source PDF `Baltic_Carpooling_V1_Pricing_Design_Developer.pdf` was not text-extracted in this environment and should be manually reviewed.
- Platform service fee comes from `PLATFORM_FEE_PERCENT`, but business policy for the final percentage should be confirmed.
- Admin pricing CRUD now exists on the protected admin router, but the public pricing router remains read-only for configs.

## Success Metrics

- Publish pricing preview success rate.
- Price validation failure rate by below-min and above-max.
- Booking price mismatch incidents.
- Rider booking drop-off at price confirmation.
- Admin reconciliation issues caused by pricing or fee mismatch.

## Code References

- `src/modules/pricing/pricing.calculator.ts`
- `src/modules/pricing/pricing.service.ts`
- `src/modules/pricing/pricing.routes.ts`
- `src/modules/pricing/pricing.validator.ts`
- `src/modules/publish-ride/draft-ride.service.ts`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/services/fuel-price.service.ts`
- `prisma/schema.prisma`
- `docs/architecture/PRICE_CALCULATION.md`
- `docs/history/phase-2-payments-pricing.md`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md#payment-and-payout-flow`.
- See `../../08-feature-decisions-bottlenecks.md#pricing` for final decisions, open questions, and bottlenecks.
