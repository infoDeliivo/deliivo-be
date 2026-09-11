-- Raise the rider-paid service fee to 20%.
--
-- Two things have to move together: the column default (for regions seeded later) and the rows that
-- already exist, since ensureDefaultPricingConfig only writes a row when none is present and would
-- otherwise leave every live environment on the old rate.
--
-- RidePricingSnapshot is deliberately untouched. Each published ride froze its rate at publish time,
-- and repricing those would change what riders and drivers were already shown.

ALTER TABLE "PricingConfig" ALTER COLUMN "serviceFeePercent" SET DEFAULT 20;

UPDATE "PricingConfig" SET "serviceFeePercent" = 20 WHERE "active" = true;
