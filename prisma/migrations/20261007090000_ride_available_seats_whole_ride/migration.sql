-- Seats are now counted for the whole ride: every booking holding seats takes them from
-- the ride's capacity regardless of its pickup/dropoff leg. Recompute availableSeats for
-- open rides from the bookings that hold seats. Rides already sold past capacity under the
-- old per-leg rule land on 0 (see scripts/overbooked-rides.sql); no booking is changed.
UPDATE "Ride" r
SET "availableSeats" = GREATEST(0, r."totalSeats" - COALESCE((
    SELECT SUM(b."seatsBooked")
    FROM "RideBooking" b
    WHERE b."rideId" = r."id" AND b."seatsReservedAt" IS NOT NULL
), 0))
WHERE r."status" IN ('PUBLISHED', 'IN_PROGRESS');
