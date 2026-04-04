-- AlterEnum
BEGIN;
CREATE TYPE "BookingStatus_new" AS ENUM ('PAYMENT_PENDING', 'DRIVER_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'PAYMENT_FAILED', 'CANCELLED', 'COMPLETED');
ALTER TABLE "RideBooking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RideBooking"
  ALTER COLUMN "status" TYPE "BookingStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'PENDING' THEN 'PAYMENT_PENDING'
      WHEN "status"::text = 'CONFIRMED' THEN 'CONFIRMED'
      WHEN "status"::text = 'CANCELLED' THEN 'CANCELLED'
      WHEN "status"::text = 'COMPLETED' THEN 'COMPLETED'
      ELSE 'PAYMENT_PENDING'
    END
  )::"BookingStatus_new";
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE "BookingStatus_old";
ALTER TABLE "RideBooking" ALTER COLUMN "status" SET DEFAULT 'PAYMENT_PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "RideBooking" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByRole" TEXT,
ADD COLUMN     "driverDecisionAt" TIMESTAMP(3),
ADD COLUMN     "driverDecisionDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "driverPenaltyAppliedAt" TIMESTAMP(3),
ADD COLUMN     "driverPenaltyValue" DOUBLE PRECISION,
ADD COLUMN     "dropOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "dropOtpHash" TEXT,
ADD COLUMN     "dropOtpVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "otpAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentAmount" DOUBLE PRECISION,
ADD COLUMN     "paymentCapturedAt" TIMESTAMP(3),
ADD COLUMN     "paymentCurrency" TEXT,
ADD COLUMN     "pickupOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pickupOtpHash" TEXT,
ADD COLUMN     "pickupOtpVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "refundAmount" DOUBLE PRECISION,
ADD COLUMN     "refundId" TEXT,
ADD COLUMN     "refundPercent" DOUBLE PRECISION,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "stripeChargeId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PAYMENT_PENDING';

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverPenaltyEvent" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "penaltyPercent" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverPenaltyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "DriverPenaltyEvent_driverId_createdAt_idx" ON "DriverPenaltyEvent"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverPenaltyEvent_bookingId_idx" ON "DriverPenaltyEvent"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "RideBooking_stripePaymentIntentId_key" ON "RideBooking"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "RideBooking_status_idx" ON "RideBooking"("status");

-- CreateIndex
CREATE INDEX "RideBooking_driverDecisionDeadlineAt_idx" ON "RideBooking"("driverDecisionDeadlineAt");
