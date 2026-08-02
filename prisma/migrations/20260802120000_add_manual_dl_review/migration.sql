-- Manual driving-licence review: a driver who does not complete Veriff uploads a
-- licence photo instead and an admin approves or declines it. SUPERSEDED closes a
-- manual submission out when Veriff approves the same driver first.

-- AlterEnum
-- Run before the AlterTable below: PostgreSQL forbids using a newly added enum value
-- in the same transaction that added it, and `migrate deploy` runs each migration
-- file's statements in one transaction. Nothing here writes the new value, so this is
-- safe; a later migration or the application is what uses it.
ALTER TYPE "DlVerificationStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

-- AlterTable
ALTER TABLE "DlVerification"
  ADD COLUMN "documentImageKey" TEXT,
  ADD COLUMN "declineReason" TEXT,
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- CreateIndex
-- The admin queue filters on status.
CREATE INDEX "DlVerification_status_idx" ON "DlVerification"("status");

-- AddForeignKey
-- SET NULL rather than CASCADE: deleting an admin account must not delete the
-- verification records they reviewed.
ALTER TABLE "DlVerification"
  ADD CONSTRAINT "DlVerification_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
