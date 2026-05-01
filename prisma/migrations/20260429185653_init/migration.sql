-- CreateEnum
CREATE TYPE "DlVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'RESUBMISSION_REQUESTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dlVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DlVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "veriffSessionId" TEXT NOT NULL,
    "veriffSessionUrl" TEXT NOT NULL,
    "status" "DlVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "decisionCode" INTEGER,
    "reasonCode" TEXT,
    "decisionPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DlVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DlVerification_veriffSessionId_key" ON "DlVerification"("veriffSessionId");

-- CreateIndex
CREATE INDEX "DlVerification_userId_idx" ON "DlVerification"("userId");

-- CreateIndex
CREATE INDEX "DlVerification_veriffSessionId_idx" ON "DlVerification"("veriffSessionId");

-- CreateIndex
CREATE INDEX "Ride_vehicleId_idx" ON "Ride"("vehicleId");

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DlVerification" ADD CONSTRAINT "DlVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
