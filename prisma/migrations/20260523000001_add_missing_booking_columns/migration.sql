-- Add columns that exist in the Prisma schema but were never migrated into the database.
-- All columns are nullable so no default value is required for existing rows.

ALTER TABLE "RideBooking" ADD COLUMN IF NOT EXISTS "deadlineExpiredNotifiedAt" TIMESTAMP(3);
ALTER TABLE "RideBooking" ADD COLUMN IF NOT EXISTS "deadlineExtendedAt"        TIMESTAMP(3);
ALTER TABLE "RideBooking" ADD COLUMN IF NOT EXISTS "autoCancelledAt"           TIMESTAMP(3);
ALTER TABLE "RideBooking" ADD COLUMN IF NOT EXISTS "driverRejectionReason"     TEXT;
ALTER TABLE "RideBooking" ADD COLUMN IF NOT EXISTS "driverCancellationReason"  TEXT;
