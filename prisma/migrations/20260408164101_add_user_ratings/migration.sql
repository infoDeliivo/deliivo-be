-- CreateTable
CREATE TABLE "RideRating" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "rateeId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "reviewText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRatingStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalRatings" INTEGER NOT NULL DEFAULT 0,
    "totalStars" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRatingStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideRating_bookingId_idx" ON "RideRating"("bookingId");

-- CreateIndex
CREATE INDEX "RideRating_rateeId_createdAt_idx" ON "RideRating"("rateeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RideRating_bookingId_raterId_key" ON "RideRating"("bookingId", "raterId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRatingStats_userId_key" ON "UserRatingStats"("userId");

-- CreateIndex
CREATE INDEX "UserRatingStats_averageRating_idx" ON "UserRatingStats"("averageRating");

-- AddForeignKey
ALTER TABLE "RideRating" ADD CONSTRAINT "RideRating_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RideBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRating" ADD CONSTRAINT "RideRating_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRating" ADD CONSTRAINT "RideRating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRating" ADD CONSTRAINT "RideRating_rateeId_fkey" FOREIGN KEY ("rateeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRatingStats" ADD CONSTRAINT "UserRatingStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "RideRating"
ADD CONSTRAINT "RideRating_stars_check" CHECK ("stars" >= 1 AND "stars" <= 5);
