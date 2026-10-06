-- Read-only. Open rides whose seat-holding bookings exceed the car's seats — sold under
-- the old per-leg capacity rule, before seats were counted for the whole ride. Ops should
-- contact these riders; the fix does not cancel anyone automatically.
--   psql "$DATABASE_URL" -f scripts/overbooked-rides.sql
SELECT r."id"            AS ride_id,
       r."status",
       r."departureDate",
       r."departureTime",
       r."totalSeats",
       SUM(b."seatsBooked") AS held_seats,
       COUNT(b."id")        AS bookings
FROM "Ride" r
JOIN "RideBooking" b ON b."rideId" = r."id" AND b."seatsReservedAt" IS NOT NULL
WHERE r."status" IN ('PUBLISHED', 'IN_PROGRESS')
GROUP BY r."id"
HAVING SUM(b."seatsBooked") > r."totalSeats"
ORDER BY r."departureDate", r."departureTime";
