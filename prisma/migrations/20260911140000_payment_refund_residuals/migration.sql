-- Refunds no longer overwrite the gross amounts on Payment.
--
-- `fareAmount` / `platformFeeAmount` are what the rider was charged and must stay immutable: payout
-- selection, admin revenue sums and the ledger all read them, and a second partial refund computed
-- against an already-reduced figure compounds. Refunds accumulate here instead, and payout owes
-- `fareAmount - refundedFareAmount`.
--
-- Existing rows default to 0: no released code path ever reduced the gross columns, so every
-- historical Payment still holds its original charge.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundedFareAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundedFeeAmount"  DOUBLE PRECISION NOT NULL DEFAULT 0;
