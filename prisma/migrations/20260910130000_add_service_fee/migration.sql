-- Rider-paid service fee, charged ON TOP of the driver's fare.
-- PricingConfig carries the live, admin-editable rate; RidePricingSnapshot freezes it per ride at
-- publish time so a later rate change never reprices an already-published ride. Existing snapshots
-- therefore default to 0: those rides were published under a zero fee.

ALTER TABLE "PricingConfig" ADD COLUMN "serviceFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 2;
ALTER TABLE "PricingConfig" ADD COLUMN "serviceFeeFlat"    DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "RidePricingSnapshot" ADD COLUMN "serviceFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "RidePricingSnapshot" ADD COLUMN "serviceFeeFlat"    DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "RideBooking" ADD COLUMN "serviceFeeAmount"  DOUBLE PRECISION;
ALTER TABLE "RideBooking" ADD COLUMN "serviceFeePercent" DOUBLE PRECISION;

-- Backfill from what was actually charged, not from a presumed rate: PLATFORM_FEE_PERCENT was absent
-- from the live .env (fee 0) but set to "20" in .env.prod, so the true historical fee is only knowable
-- from the Payment row. Bookings that never reached a Payment keep NULL.
UPDATE "RideBooking" b
SET "serviceFeeAmount" = p."platformFeeAmount"
FROM "Payment" p
WHERE p."bookingId" = b."id";
