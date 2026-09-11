-- Unpaid bookings no longer hold seats.
--
-- 1. `seatsReservedAt` records whether this booking's seats were actually taken out of
--    ride capacity. releaseSegmentSeats is not idempotent, so every release path checks
--    this first — releasing seats that were never reserved would inflate
--    Ride.availableSeats and oversell the ride. In stripe mode seats are now reserved
--    when the payment confirms, not when the booking is created.
--
--    Backfill: every existing booking that is not in a pre-payment or terminal state
--    does hold seats today, so stamp it. PAYMENT_PENDING rows written before this
--    migration DID hold seats, so they are stamped too and stay correctly releasable.
--
-- 2. `RIDE_FULL_REFUNDED` is the outcome when a payment succeeds but the ride filled up
--    first: the rider is refunded. Kept distinct from PAYMENT_FAILED, where no money moved.
ALTER TABLE "RideBooking" ADD COLUMN IF NOT EXISTS "seatsReservedAt" TIMESTAMP(3);

UPDATE "RideBooking"
SET "seatsReservedAt" = COALESCE("createdAt", NOW())
WHERE "seatsReservedAt" IS NULL
  AND "status" IN (
    'PAYMENT_PENDING', 'DRIVER_PENDING', 'CONFIRMED', 'WAITING_FOR_PICKUP',
    'DRIVER_ARRIVED', 'OTP_PENDING', 'ONBOARD', 'DROP_PENDING', 'DRIVER_DROPPED',
    'IN_PROGRESS', 'DISPUTED'
  );

ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'RIDE_FULL_REFUNDED';
