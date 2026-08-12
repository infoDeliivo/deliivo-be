-- CreateEnum
CREATE TYPE "VehicleVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "stripeAccountName" TEXT,
  ADD COLUMN "stripeNameMatch" BOOLEAN,
  ADD COLUMN "stripeDobMatch" BOOLEAN;

-- AlterTable
ALTER TABLE "DlVerification"
  ADD COLUMN "verifiedName" TEXT,
  ADD COLUMN "verifiedDob" TEXT,
  ADD COLUMN "verifiedGender" TEXT,
  ADD COLUMN "nameMatch" BOOLEAN,
  ADD COLUMN "dobMatch" BOOLEAN,
  ADD COLUMN "genderMatch" BOOLEAN;

-- AlterTable
ALTER TABLE "Vehicle"
  ADD COLUMN "verificationStatus" "VehicleVerificationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT;

-- Preserve the isVerified <-> verificationStatus invariant for pre-existing rows
UPDATE "Vehicle" SET "verificationStatus" = 'APPROVED' WHERE "isVerified" = true;

-- CreateIndex
CREATE INDEX "Vehicle_verificationStatus_idx" ON "Vehicle"("verificationStatus");
