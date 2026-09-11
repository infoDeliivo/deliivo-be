-- Enforce one active booking per rider per ride at the database level.
--
-- The application already checks this (ACTIVE_BOOKING_STATUSES in
-- ride-booking.service.ts), but that check is a plain read inside a
-- READ COMMITTED transaction, so two concurrent requests could both pass it and
-- create two active bookings with two PaymentIntents. This index makes the
-- second one fail with P2002, which createBooking maps to BOOKING_ALREADY_EXISTS.
--
-- PAYMENT_PENDING is deliberately NOT in this list. An unpaid booking holds no seats
-- and must not lock the rider out of the ride: re-booking it resumes or replaces the
-- unpaid one instead of erroring. See createBooking's resume-or-replace path.
--
-- The status list must stay in sync with ACTIVE_BOOKING_STATUSES.
-- Prisma cannot express a partial unique index, so this migration is hand-written.
CREATE UNIQUE INDEX IF NOT EXISTS "RideBooking_active_rider_ride_key"
    ON "RideBooking" ("rideId", "passengerId")
    WHERE "status" IN ('DRIVER_PENDING', 'CONFIRMED', 'IN_PROGRESS');
