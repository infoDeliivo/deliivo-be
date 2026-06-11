-- DropForeignKey (ignore if doesn't exist)
ALTER TABLE "UserBlock" DROP CONSTRAINT IF EXISTS "UserBlock_blockedId_fkey";

-- DropForeignKey (ignore if doesn't exist)
ALTER TABLE "UserBlock" DROP CONSTRAINT IF EXISTS "UserBlock_blockerId_fkey";

-- DropForeignKey (ignore if doesn't exist)
ALTER TABLE "UserReport" DROP CONSTRAINT IF EXISTS "UserReport_reportedId_fkey";

-- DropForeignKey (ignore if doesn't exist)
ALTER TABLE "UserReport" DROP CONSTRAINT IF EXISTS "UserReport_reporterId_fkey";

-- CreateIndex (with IF NOT EXISTS check)
CREATE INDEX IF NOT EXISTS "Message_conversationId_receiverId_readAt_idx" ON "Message"("conversationId", "receiverId", "readAt");

-- CreateIndex (with IF NOT EXISTS check)
CREATE INDEX IF NOT EXISTS "Ride_vehicleId_idx" ON "Ride"("vehicleId");

-- CreateIndex (with IF NOT EXISTS check)
CREATE INDEX IF NOT EXISTS "Ride_status_departureDate_idx" ON "Ride"("status", "departureDate");

-- CreateIndex (with IF NOT EXISTS check)
CREATE INDEX IF NOT EXISTS "RideBooking_rideId_status_idx" ON "RideBooking"("rideId", "status");

-- CreateIndex (with IF NOT EXISTS check)
CREATE INDEX IF NOT EXISTS "RideBooking_passengerId_status_idx" ON "RideBooking"("passengerId", "status");

-- AddForeignKey (check if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Ride_vehicleId_fkey'
  ) THEN
    ALTER TABLE "Ride" ADD CONSTRAINT "Ride_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey (check if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserReport_reporterId_fkey'
  ) THEN
    ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey (check if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserReport_reportedId_fkey'
  ) THEN
    ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey (check if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserBlock_blockerId_fkey'
  ) THEN
    ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey (check if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserBlock_blockedId_fkey'
  ) THEN
    ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
