CREATE TABLE IF NOT EXISTS "EmergencyAlert" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rideId" TEXT,
  "bookingId" TEXT,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "message" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,

  CONSTRAINT "EmergencyAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmergencyAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmergencyAlert_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EmergencyAlert_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RideBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "EmergencyAlert_status_createdAt_idx" ON "EmergencyAlert"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "EmergencyAlert_userId_createdAt_idx" ON "EmergencyAlert"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmergencyAlert_rideId_createdAt_idx" ON "EmergencyAlert"("rideId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmergencyAlert_bookingId_createdAt_idx" ON "EmergencyAlert"("bookingId", "createdAt");
