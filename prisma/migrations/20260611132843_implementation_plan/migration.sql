-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingStatus" ADD VALUE 'WAITING_FOR_PICKUP';
ALTER TYPE "BookingStatus" ADD VALUE 'DRIVER_ARRIVED';
ALTER TYPE "BookingStatus" ADD VALUE 'OTP_PENDING';
ALTER TYPE "BookingStatus" ADD VALUE 'ONBOARD';
ALTER TYPE "BookingStatus" ADD VALUE 'DROP_PENDING';
ALTER TYPE "BookingStatus" ADD VALUE 'DRIVER_DROPPED';
ALTER TYPE "BookingStatus" ADD VALUE 'NO_SHOW';
ALTER TYPE "BookingStatus" ADD VALUE 'DRIVER_MISSED_PICKUP';
ALTER TYPE "BookingStatus" ADD VALUE 'DISPUTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RideStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "RideStatus" ADD VALUE 'READY_TO_START';
ALTER TYPE "RideStatus" ADD VALUE 'COMPLETION_PENDING';
ALTER TYPE "RideStatus" ADD VALUE 'DISPUTED';

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "actualEndTime" TIMESTAMP(3),
ADD COLUMN     "actualStartTime" TIMESTAMP(3),
ADD COLUMN     "currentStopSequence" INTEGER;

-- AlterTable
ALTER TABLE "RideBooking" ADD COLUMN     "captureMethod" TEXT DEFAULT 'automatic',
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "driverArrivedAt" TIMESTAMP(3),
ADD COLUMN     "dropoffAddress" TEXT,
ADD COLUMN     "dropoffConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "dropoffPosition" INTEGER,
ADD COLUMN     "noShowMarkedAt" TIMESTAMP(3),
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "pickupAddress" TEXT,
ADD COLUMN     "pickupPosition" INTEGER,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "responseExpiryHours" INTEGER,
ADD COLUMN     "responseExpiryOption" TEXT,
ADD COLUMN     "riderDropoffConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "segmentFare" DOUBLE PRECISION,
ADD COLUMN     "waitTimerStartedAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnReason" TEXT;

-- CreateTable
CREATE TABLE "RideSegmentCapacity" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "fromPosition" INTEGER NOT NULL,
    "toPosition" INTEGER NOT NULL,
    "occupiedSeats" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RideSegmentCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "amountTotal" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "fareAmount" DOUBLE PRECISION NOT NULL,
    "platformFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "payoutEligibleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "entryGroupId" TEXT NOT NULL,
    "paymentId" TEXT,
    "bookingId" TEXT,
    "userId" TEXT,
    "accountType" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "amountTotal" DOUBLE PRECISION NOT NULL,
    "stripeTransferId" TEXT,
    "stripePayoutId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" TEXT NOT NULL,
    "payoutBatchId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "driverAmount" DOUBLE PRECISION NOT NULL,
    "platformFee" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEventOutbox" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentEventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingConfig" (
    "id" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "minRatePerKm" DOUBLE PRECISION NOT NULL,
    "recommendedRatePerKm" DOUBLE PRECISION NOT NULL,
    "maxRatePerKm" DOUBLE PRECISION NOT NULL,
    "minimumSeatPrice" DOUBLE PRECISION NOT NULL DEFAULT 3.00,
    "roundingStrategy" TEXT NOT NULL DEFAULT 'NEAREST_EURO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RidePricingSnapshot" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "pricingVersion" TEXT NOT NULL DEFAULT 'DISTANCE_RATE_V1',
    "regionCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "minRatePerKm" DOUBLE PRECISION NOT NULL,
    "recommendedRatePerKm" DOUBLE PRECISION NOT NULL,
    "maxRatePerKm" DOUBLE PRECISION NOT NULL,
    "minimumSeatPrice" DOUBLE PRECISION NOT NULL,
    "recommendedPricePerSeat" DOUBLE PRECISION NOT NULL,
    "minAllowedPricePerSeat" DOUBLE PRECISION NOT NULL,
    "maxAllowedPricePerSeat" DOUBLE PRECISION NOT NULL,
    "selectedPricePerSeat" DOUBLE PRECISION NOT NULL,
    "roundingStrategy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RidePricingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationUpdate" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideEvent" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "bookingId" TEXT,
    "actionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "clientTimestamp" TIMESTAMP(3) NOT NULL,
    "serverTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validationStatus" TEXT NOT NULL DEFAULT 'VALID',
    "metadataJson" JSONB,

    CONSTRAINT "RideEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "evidenceJson" JSONB,
    "recommendation" TEXT,
    "riskScore" DOUBLE PRECISION,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingLink" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "accessScope" TEXT NOT NULL DEFAULT 'LOCATION_ONLY',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TrackingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationIssue" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "bookingId" TEXT,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT NOT NULL,
    "stripeState" TEXT,
    "internalState" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoRepaired" BOOLEAN NOT NULL DEFAULT false,
    "repairedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "metadataJson" JSONB,

    CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideSegmentCapacity_rideId_idx" ON "RideSegmentCapacity"("rideId");

-- CreateIndex
CREATE UNIQUE INDEX "RideSegmentCapacity_rideId_fromPosition_toPosition_key" ON "RideSegmentCapacity"("rideId", "fromPosition", "toPosition");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_riderId_createdAt_idx" ON "Payment"("riderId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_rideId_idx" ON "Payment"("rideId");

-- CreateIndex
CREATE INDEX "LedgerEntry_bookingId_idx" ON "LedgerEntry"("bookingId");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_entryGroupId_idx" ON "LedgerEntry"("entryGroupId");

-- CreateIndex
CREATE INDEX "LedgerEntry_paymentId_idx" ON "LedgerEntry"("paymentId");

-- CreateIndex
CREATE INDEX "PayoutBatch_driverId_createdAt_idx" ON "PayoutBatch"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "PayoutBatch_status_idx" ON "PayoutBatch"("status");

-- CreateIndex
CREATE INDEX "PayoutItem_payoutBatchId_idx" ON "PayoutItem"("payoutBatchId");

-- CreateIndex
CREATE INDEX "PayoutItem_bookingId_idx" ON "PayoutItem"("bookingId");

-- CreateIndex
CREATE INDEX "PaymentEventOutbox_status_nextRetryAt_idx" ON "PaymentEventOutbox"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "PaymentEventOutbox_aggregateType_aggregateId_idx" ON "PaymentEventOutbox"("aggregateType", "aggregateId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_stripePaymentMethodId_key" ON "PaymentMethod"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "PaymentMethod_userId_idx" ON "PaymentMethod"("userId");

-- CreateIndex
CREATE INDEX "PricingConfig_regionCode_active_idx" ON "PricingConfig"("regionCode", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RidePricingSnapshot_rideId_key" ON "RidePricingSnapshot"("rideId");

-- CreateIndex
CREATE INDEX "LocationUpdate_rideId_timestamp_idx" ON "LocationUpdate"("rideId", "timestamp");

-- CreateIndex
CREATE INDEX "LocationUpdate_driverId_timestamp_idx" ON "LocationUpdate"("driverId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "RideEvent_actionId_key" ON "RideEvent"("actionId");

-- CreateIndex
CREATE INDEX "RideEvent_rideId_serverTimestamp_idx" ON "RideEvent"("rideId", "serverTimestamp");

-- CreateIndex
CREATE INDEX "RideEvent_actionId_idx" ON "RideEvent"("actionId");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_raisedBy_idx" ON "Dispute"("raisedBy");

-- CreateIndex
CREATE INDEX "Dispute_bookingId_idx" ON "Dispute"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_token_key" ON "TrackingLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_tokenHash_key" ON "TrackingLink"("tokenHash");

-- CreateIndex
CREATE INDEX "TrackingLink_bookingId_idx" ON "TrackingLink"("bookingId");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_issueType_detectedAt_idx" ON "ReconciliationIssue"("issueType", "detectedAt");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_severity_resolvedAt_idx" ON "ReconciliationIssue"("severity", "resolvedAt");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_paymentId_idx" ON "ReconciliationIssue"("paymentId");

-- AddForeignKey
ALTER TABLE "RideSegmentCapacity" ADD CONSTRAINT "RideSegmentCapacity_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RideBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidePricingSnapshot" ADD CONSTRAINT "RidePricingSnapshot_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationUpdate" ADD CONSTRAINT "LocationUpdate_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideEvent" ADD CONSTRAINT "RideEvent_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RideBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RideBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
