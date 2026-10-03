CREATE TABLE "RideRequest" (
 "id" TEXT NOT NULL PRIMARY KEY, "riderId" TEXT NOT NULL,
 "originPlaceId" TEXT NOT NULL, "originAddress" TEXT NOT NULL, "originLat" DOUBLE PRECISION NOT NULL, "originLng" DOUBLE PRECISION NOT NULL,
 "destinationPlaceId" TEXT NOT NULL, "destinationAddress" TEXT NOT NULL, "destinationLat" DOUBLE PRECISION NOT NULL, "destinationLng" DOUBLE PRECISION NOT NULL,
 "departureAfter" TIMESTAMP(3) NOT NULL, "departureBefore" TIMESTAMP(3) NOT NULL,
 "seats" INTEGER NOT NULL CHECK ("seats" BETWEEN 1 AND 4), "luggage" INTEGER NOT NULL DEFAULT 0 CHECK ("luggage" BETWEEN 0 AND 10),
 "budgetPerSeat" DOUBLE PRECISION, "notes" TEXT, "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','CHECKOUT_PENDING','MATCHED','CANCELLED','EXPIRED')),
 "expiresAt" TIMESTAMP(3) NOT NULL, "checkoutExpiresAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "RideRequest_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RideRequest_status_expiresAt_idx" ON "RideRequest"("status", "expiresAt");
CREATE INDEX "RideRequest_riderId_createdAt_idx" ON "RideRequest"("riderId", "createdAt");
CREATE TABLE "RideRequestOffer" (
 "id" TEXT NOT NULL PRIMARY KEY, "requestId" TEXT NOT NULL, "driverId" TEXT NOT NULL, "rideId" TEXT NOT NULL, "bookingId" TEXT,
 "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','SELECTED','ACCEPTED','WITHDRAWN','EXPIRED','CLOSED')),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "RideRequestOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RideRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "RideRequestOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "RideRequestOffer_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "RideRequestOffer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RideBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RideRequestOffer_rideId_key" ON "RideRequestOffer"("rideId");
CREATE UNIQUE INDEX "RideRequestOffer_bookingId_key" ON "RideRequestOffer"("bookingId");
CREATE INDEX "RideRequestOffer_requestId_status_idx" ON "RideRequestOffer"("requestId", "status");
CREATE INDEX "RideRequestOffer_driverId_status_idx" ON "RideRequestOffer"("driverId", "status");
CREATE UNIQUE INDEX "RideRequestOffer_one_selected_per_request" ON "RideRequestOffer"("requestId") WHERE "status" IN ('SELECTED', 'ACCEPTED');
