# ADR: Pricing Architecture

## Status

Accepted as implemented architecture with known gaps.

## Context

The product needs clear Baltic pricing for riders, flexible but bounded driver-selected fares, segment-aware booking prices, and stable financial records for payments and reconciliation. There are two pricing paths in the current codebase: fuel-based publish-draft recommendations and config-based pricing validation and snapshots.

## Decision

Use `PricingConfig` as the active regional pricing policy for distance-rate preview and validation. Use `RidePricingSnapshot` to freeze the active pricing policy and selected driver price at publish time. Continue using publish-draft fuel-based recommendations for the driver publishing UX. Use booking-time segment resolution to calculate rider booking totals.

## Rationale

- Config records make pricing regional and time-bound.
- Snapshots keep historical ride pricing stable even if future config changes.
- Fuel-based draft recommendations provide a practical driver UX before final admin pricing tools are complete.
- Booking-time segment resolution supports partial-route riders and avoids charging every rider the full route price.
- Admin pricing CRUD now lives on the protected admin router so pricing operations remain auditable without exposing mutation on the public pricing router.

## Consequences

- Pricing docs and UI must distinguish config-based validation from fuel-based publish recommendations.
- Active config seed data is required for `/api/v1/pricing` preview and validation to work.
- Public config mutation is not exposed; operational pricing changes are handled through protected admin tooling rather than the read-only public pricing router.
- EUR fuel recommendation depends on fallback Baltic pricing until a live Baltic fuel source is integrated.
- Public `/api/v1/pricing` stays read-only for configs; mutation is intentionally handled by admin routes.

## Alternatives Considered

- Use only driver-entered pricing. Rejected because it allows unrealistic prices and weakens rider trust.
- Use only fuel-cost pricing. Rejected because regional business rules, min/max bounds, and snapshots are needed.
- Recompute historical ride prices from current config. Rejected because pricing must remain stable after publish.
- Store only full-route price. Rejected because segment booking requires partial-route fare calculation.

## Implementation Notes

- The protected pricing router exposes:
  - `POST /api/v1/pricing/price-preview`
  - `POST /api/v1/pricing/validate`
  - `GET /api/v1/pricing/configs`
- The admin router exposes:
  - `GET /api/v1/admin/pricing/configs`
  - `POST /api/v1/admin/pricing/configs`
  - `PUT /api/v1/admin/pricing/configs/:id`
- `validateAndSnapshotPricing()` creates a unique snapshot for a ride after price validation.
- Publish flow calls `validateAndSnapshotPricing()` only when an active config exists; code comments indicate publish may continue without validation if no config exists.
- Booking price includes hard-coded luggage fee of `5.00` per item and optional platform service fee from `PLATFORM_FEE_PERCENT`.

## Code References

- `src/app.ts`
- `src/modules/pricing`
- `src/modules/publish-ride/draft-ride.service.ts`
- `src/modules/ride-booking/ride-booking.service.ts`
- `src/services/fuel-price.service.ts`
- `prisma/schema.prisma`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#pricing`.
- Supporting payment and domain diagrams are in `../../07-architecture-and-flow-diagrams.md`.
